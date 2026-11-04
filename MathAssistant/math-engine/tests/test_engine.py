"""Unit tests for the symbolic engine. Run with: pytest -q"""
from engine.operations import handle


def test_solve_quadratic():
    r = handle({"op": "solve", "expr": "x^2 - 5x + 6 = 0"})
    assert r["ok"]
    approx = sorted(s["approx"] for s in r["solutions"])
    assert approx == [2.0, 3.0]


def test_solve_linear_implicit_mult():
    r = handle({"op": "solve", "expr": "2x + 3 = 11"})
    assert r["solutions"][0]["approx"] == 4.0


def test_derivative():
    r = handle({"op": "derivative", "expr": "x^3"})
    assert r["result"] == "3*x**2"


def test_definite_integral():
    r = handle({"op": "integral", "expr": "x^2", "lower": "0", "upper": "3"})
    assert r["approx"] == 9.0


def test_limit_sinc():
    r = handle({"op": "limit", "expr": "sin(x)/x", "point": "0"})
    assert r["approx"] == 1.0


def test_verify_equivalent():
    r = handle({"op": "verify", "candidate": "(x+1)^2", "reference": "x^2+2x+1"})
    assert r["equivalent"] is True


def test_verify_not_equivalent():
    r = handle({"op": "verify", "candidate": "x^2+2x", "reference": "x^2+2x+1"})
    assert r["equivalent"] is False


def test_verify_solution_true():
    r = handle({"op": "verify_solution", "expr": "x^2 = 9", "value": "3"})
    assert r["satisfied"] is True


def test_verify_solution_false():
    r = handle({"op": "verify_solution", "expr": "x^2 = 9", "value": "4"})
    assert r["satisfied"] is False


def test_latex_parse():
    r = handle({"op": "parse", "expr": r"\frac{1}{2} + \sqrt{x}"})
    assert r["ok"] and r["free_symbols"] == ["x"]


def test_factor():
    r = handle({"op": "factor", "expr": "x^2 - 5x + 6"})
    assert r["result"] in ("(x - 2)*(x - 3)", "(x - 3)*(x - 2)")


def test_expand():
    r = handle({"op": "expand", "expr": "(x+1)*(x+2)"})
    assert r["result"] == "x**2 + 3*x + 2"


def test_series():
    r = handle({"op": "series", "expr": "exp(x)", "point": "0", "order": 4})
    # 1 + x + x^2/2 + x^3/6
    assert "x**3/6" in r["result"]


def test_system_linear():
    r = handle({"op": "system", "exprs": ["x + y = 3", "x - y = 1"]})
    assert r["ok"]
    sol = r["solutions"][0]
    assert sol["x"]["approx"] == 2.0 and sol["y"]["approx"] == 1.0


def test_stats_mean_median():
    r = handle({"op": "stats", "data": [2, 4, 4, 4, 5, 5, 7, 9]})
    assert r["mean"]["approx"] == 5.0
    assert r["median"]["approx"] == 4.5
    assert r["population_std"] == 2.0  # classic textbook example


def test_unknown_op_is_safe():
    r = handle({"op": "nope"})
    assert r["ok"] is False and "available" in r


def test_bad_input_does_not_raise():
    r = handle({"op": "solve", "expr": "@@@###"})
    assert r["ok"] is False and "error" in r


INJECTION_PROBES = [
    "__import__('os').system('touch {f}')",
    "open('{f}', 'w').write('x')",
    "exec(\"open('{f}','w')\")",
    "Symbol.__class__",
    "x.__class__.__mro__",
    "(1).real",
    "lambda: open('{f}','w')",
    "[c for c in ().__class__.__bases__]",
    "getattr(x, 'subs')",
]


def test_injection_has_no_side_effects(tmp_path):
    """Hostile input must be rejected AND must not have run.

    The old version of this test only checked the return value, which passed
    even though the payload had already executed. Here each payload tries to
    create a file, and we assert that the file never appears.
    """
    target = tmp_path / "pwned"
    for probe in INJECTION_PROBES:
        payload = probe.format(f=str(target))
        for op in ("parse", "evaluate", "simplify"):
            r = handle({"op": op, "expr": payload})
            assert r["ok"] is False, (op, payload, r)
        r = handle({"op": "solve", "expr": payload + " = 0"})
        assert r["ok"] is False, (payload, r)
        r = handle({"op": "verify", "candidate": payload, "reference": "x"})
        assert r["ok"] is False, (payload, r)
    assert not target.exists(), "an injection payload executed"


def test_legit_math_still_parses_after_hardening():
    for expr in ("2x + 3(x-1)", "sin(x)^2 + cos(x)^2", "sqrt(2)/2", "5!",
                 "abs(-3)", "log(E)", "2.5x", "x**2"):
        assert handle({"op": "parse", "expr": expr})["ok"], expr


def test_unicode_math_is_normalised():
    r = handle({"op": "solve", "expr": "x² − 5x + 6 = 0"})
    assert sorted(s["approx"] for s in r["solutions"]) == [2.0, 3.0]
    r = handle({"op": "evaluate", "expr": "√16 × π / π"})
    assert r["approx"] == 4.0


def test_solve_candidate_match_and_mismatch():
    ok = handle({"op": "solve", "expr": "x^2 - 5x + 6 = 0", "candidate": "x = 3, x = 2"})
    assert ok["matches"] is True
    wrong = handle({"op": "solve", "expr": "x^2 - 5x + 6 = 0", "candidate": "2, 4"})
    assert wrong["matches"] is False
    assert "4" in wrong["match_detail"]
    partial = handle({"op": "solve", "expr": "x^2 - 5x + 6 = 0", "candidate": "2"})
    assert partial["matches"] is False and "missing" in partial["match_detail"]


def test_solve_without_candidate_has_no_verdict():
    r = handle({"op": "solve", "expr": "x^2 = 4"})
    assert "matches" not in r


def test_derivative_candidate():
    assert handle({"op": "derivative", "expr": "x^3", "candidate": "3x^2"})["matches"] is True
    assert handle({"op": "derivative", "expr": "x^3", "candidate": "3x"})["matches"] is False


def test_indefinite_integral_accepts_any_constant():
    r = handle({"op": "integral", "expr": "2x", "candidate": "x^2 + C"})
    assert r["matches"] is True
    r = handle({"op": "integral", "expr": "2x", "candidate": "x^2 + 7"})
    assert r["matches"] is True
    r = handle({"op": "integral", "expr": "2x", "candidate": "2x^2"})
    assert r["matches"] is False


def test_definite_integral_candidate():
    assert handle({"op": "integral", "expr": "x^2", "lower": "0", "upper": "3",
                   "candidate": "9"})["matches"] is True


def test_unparseable_candidate_is_a_mismatch_not_a_crash():
    r = handle({"op": "derivative", "expr": "x^2", "candidate": "two x"})
    assert r["ok"] is True
    # "two x" parses as symbols t*w*o*x, which is not 2x
    assert r["matches"] is False


def test_responses_are_strict_json():
    """inf/nan must never reach the wire as bare Infinity/NaN."""
    import json
    for req in ({"op": "evaluate", "expr": "10^400"},
                {"op": "limit", "expr": "1/x", "point": "0"},
                {"op": "evaluate", "expr": "0/0"}):
        json.dumps(handle(req), allow_nan=False)  # raises if non-finite floats leak


def test_oversized_input_rejected():
    r = handle({"op": "parse", "expr": "x+" * 2000 + "x"})
    assert r["ok"] is False
