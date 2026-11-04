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


def test_injection_is_not_executed():
    # Must be treated as symbols/parse-error, never evaluated as Python.
    r = handle({"op": "parse", "expr": "__import__('os').system('echo hi')"})
    assert r["ok"] is False or "system" in r.get("sympy", "")
