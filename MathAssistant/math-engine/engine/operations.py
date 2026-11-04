"""The actual math operations, each returning a JSON-serialisable dict.

Every operation is wrapped so that a failure returns {"ok": False, "error": ...}
instead of throwing, because this engine runs as a long-lived subprocess and a
single bad request must never take it down.
"""
from __future__ import annotations

import math
import re
from typing import Any, Callable

import sympy as sp

from .parsing import ParseError, main_symbol, to_equation, to_expr


def _attach_match(result: dict, computed: Any, req: dict, *,
                  antiderivative_of: Any = None, var: Any = None) -> dict:
    """If the request carries the AI's claimed answer (`candidate`), compare it
    with what SymPy computed and record `matches` / `match_detail`.

    This is what makes verification independent: SymPy computes the result on
    its own, then checks the model's answer against it.
    """
    cand = req.get("candidate")
    if cand is None or str(cand).strip() == "":
        return result
    try:
        claimed = to_expr(str(cand))
    except ParseError as exc:
        result["matches"] = False
        result["match_detail"] = f"could not parse the claimed answer: {exc}"
        return result
    if antiderivative_of is not None:
        # Antiderivatives differ by a constant, so compare derivatives instead.
        claimed = claimed.subs(sp.Symbol("C"), 0)
        ok, method, detail = _equivalent(sp.diff(claimed, var), antiderivative_of)
    else:
        ok, method, detail = _equivalent(claimed, computed)
    result["matches"] = ok
    result["match_detail"] = f"{method}: {detail}"
    return result


def _match_solution_set(solutions: list, claimed_text: str) -> tuple[bool, str]:
    """Compare SymPy's solution set with a claimed list such as 'x = 2, x = 3'."""
    pieces = [p.strip() for p in re.split(r"[,;]|\bor\b|\band\b", claimed_text)
              if p.strip()]
    claimed = []
    for p in pieces:
        if "=" in p:
            p = p.split("=")[-1]
        claimed.append(to_expr(p))

    def contains(pool: list, item: Any) -> bool:
        return any(_equivalent(item, q)[0] for q in pool)

    missing = [s for s in solutions if not contains(claimed, s)]
    extra = [c for c in claimed if not contains(solutions, c)]
    if not missing and not extra:
        return True, "solution sets agree"
    parts = []
    if missing:
        parts.append("missing " + ", ".join(_pretty(m) for m in missing))
    if extra:
        parts.append("not actually solutions: " + ", ".join(_pretty(e) for e in extra))
    return False, "; ".join(parts)


def _latex(obj: Any) -> str:
    try:
        return sp.latex(obj)
    except Exception:  # noqa: BLE001
        return str(obj)


def _pretty(obj: Any) -> str:
    try:
        return sp.sstr(obj)
    except Exception:  # noqa: BLE001
        return str(obj)


def op_parse(req: dict) -> dict:
    expr = to_expr(req["expr"])
    return {"ok": True, "sympy": _pretty(expr), "latex": _latex(expr),
            "free_symbols": sorted(s.name for s in expr.free_symbols)}


def op_simplify(req: dict) -> dict:
    expr = to_expr(req["expr"])
    simplified = sp.simplify(expr)
    return _attach_match({"ok": True, "result": _pretty(simplified),
                          "latex": _latex(simplified)}, simplified, req)


def op_solve(req: dict) -> dict:
    eq = to_equation(req["expr"])
    var = main_symbol(eq, req.get("var"))
    sols = [sp.simplify(s) for s in sp.solve(eq, var, dict=False)]
    out = [{"sympy": _pretty(s), "latex": _latex(s), "approx": _safe_float(s)}
           for s in sols]
    result = {"ok": True, "variable": var.name, "solutions": out}
    cand = req.get("candidate")
    if cand is not None and str(cand).strip():
        try:
            ok, detail = _match_solution_set(sols, str(cand))
        except ParseError as exc:
            ok, detail = False, f"could not parse the claimed answer: {exc}"
        result["matches"] = ok
        result["match_detail"] = detail
    return result


def op_derivative(req: dict) -> dict:
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    order = int(req.get("order", 1))
    d = sp.diff(expr, var, order)
    d_simpl = sp.simplify(d)
    return _attach_match({"ok": True, "variable": var.name, "order": order,
                          "result": _pretty(d_simpl), "latex": _latex(d_simpl)},
                         d_simpl, req)


def op_integral(req: dict) -> dict:
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    a, b = req.get("lower"), req.get("upper")
    if a is not None and b is not None:
        lo, hi = to_expr(str(a)), to_expr(str(b))
        val = sp.integrate(expr, (var, lo, hi))
        val_s = sp.simplify(val)
        return _attach_match({"ok": True, "definite": True, "variable": var.name,
                              "result": _pretty(val_s), "latex": _latex(val_s),
                              "approx": _safe_float(val_s)}, val_s, req)
    anti = sp.integrate(expr, var)
    return _attach_match({"ok": True, "definite": False, "variable": var.name,
                          "result": _pretty(anti) + " + C",
                          "latex": _latex(anti) + " + C"},
                         anti, req, antiderivative_of=expr, var=var)


def op_limit(req: dict) -> dict:
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    point = to_expr(str(req.get("point", "0")))
    direction = req.get("dir", "+")
    lim = sp.limit(expr, var, point, direction if direction in ("+", "-") else "+")
    return _attach_match({"ok": True, "variable": var.name, "result": _pretty(lim),
                          "latex": _latex(lim), "approx": _safe_float(lim)}, lim, req)


def op_factor(req: dict) -> dict:
    expr = to_expr(req["expr"])
    factored = sp.factor(expr)
    return _attach_match({"ok": True, "result": _pretty(factored),
                          "latex": _latex(factored)}, factored, req)


def op_expand(req: dict) -> dict:
    expr = to_expr(req["expr"])
    expanded = sp.expand(expr)
    return _attach_match({"ok": True, "result": _pretty(expanded),
                          "latex": _latex(expanded)}, expanded, req)


def op_series(req: dict) -> dict:
    """Taylor/Maclaurin series of expr about `point` up to `order` terms."""
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    point = to_expr(str(req.get("point", "0")))
    order = int(req.get("order", 6))
    ser = sp.series(expr, var, point, order).removeO()
    return {"ok": True, "variable": var.name, "point": _pretty(point),
            "order": order, "result": _pretty(ser), "latex": _latex(ser)}


def op_system(req: dict) -> dict:
    """Solve a system of equations. `exprs` is a list like ['x+y=3','x-y=1']."""
    raw = req.get("exprs")
    if not isinstance(raw, list) or not raw:
        raise ParseError("'exprs' must be a non-empty list of equations")
    eqs = [to_equation(str(e)) for e in raw]
    if req.get("vars"):
        variables = [sp.Symbol(v) for v in req["vars"]]
    else:
        variables = sorted({s for eq in eqs for s in eq.free_symbols},
                           key=lambda s: s.name)
    sols = sp.solve(eqs, variables, dict=True)
    out = []
    for sol in sols:
        out.append({str(k): {"sympy": _pretty(v), "latex": _latex(v),
                             "approx": _safe_float(v)} for k, v in sol.items()})
    return {"ok": True, "variables": [v.name for v in variables], "solutions": out}


def op_stats(req: dict) -> dict:
    """Descriptive statistics over a list of numbers (exact where possible)."""
    data = req.get("data")
    if not isinstance(data, list) or not data:
        raise ParseError("'data' must be a non-empty list of numbers")
    vals = [sp.Rational(str(x)) if not isinstance(x, str) else to_expr(x) for x in data]
    n = len(vals)
    total = sum(vals, sp.Integer(0))
    mean = sp.nsimplify(total / n)
    ordered = sorted(vals, key=lambda v: float(sp.N(v)))
    if n % 2 == 1:
        median = ordered[n // 2]
    else:
        median = sp.nsimplify((ordered[n // 2 - 1] + ordered[n // 2]) / 2)
    # population and sample variance
    sq = sum(((v - mean) ** 2 for v in vals), sp.Integer(0))
    pop_var = sp.nsimplify(sq / n)
    samp_var = sp.nsimplify(sq / (n - 1)) if n > 1 else None
    return {
        "ok": True, "n": n,
        "mean": {"sympy": _pretty(mean), "approx": _safe_float(mean)},
        "median": {"sympy": _pretty(median), "approx": _safe_float(median)},
        "min": _safe_float(ordered[0]), "max": _safe_float(ordered[-1]),
        "population_variance": {"sympy": _pretty(pop_var), "approx": _safe_float(pop_var)},
        "population_std": _safe_float(sp.sqrt(pop_var)),
        "sample_variance": None if samp_var is None else
            {"sympy": _pretty(samp_var), "approx": _safe_float(samp_var)},
        "sample_std": None if samp_var is None else _safe_float(sp.sqrt(samp_var)),
    }


def op_evaluate(req: dict) -> dict:
    """Numerically evaluate an expression, optionally substituting variables."""
    expr = to_expr(req["expr"])
    subs = {sp.Symbol(k): to_expr(str(v)) for k, v in (req.get("subs") or {}).items()}
    val = expr.subs(subs)
    digits = int(req.get("digits", 12))
    numeric = _safe_float(val, digits)
    simplified = sp.simplify(val)
    return _attach_match({"ok": True, "result": _pretty(simplified),
                          "latex": _latex(val), "approx": numeric}, simplified, req)


def op_verify(req: dict) -> dict:
    """Core verification: are two expressions equivalent?

    Strategy: symbolic (simplify(a-b)==0) first, then a numeric spot-check over
    random points as a fallback for expressions SymPy cannot simplify to zero.
    """
    a = to_expr(req["candidate"])
    b = to_expr(req["reference"])
    verdict, method, detail = _equivalent(a, b)
    return {"ok": True, "equivalent": verdict, "method": method,
            "candidate": _pretty(a), "reference": _pretty(b), "detail": detail}


def op_verify_solution(req: dict) -> dict:
    """Check that a proposed solution value satisfies an equation."""
    eq = to_equation(req["expr"])
    var = main_symbol(eq, req.get("var"))
    value = to_expr(str(req["value"]))
    residual = sp.simplify(eq.lhs.subs(var, value) - eq.rhs.subs(var, value))
    satisfied = residual == 0
    if not satisfied:
        approx = _safe_float(residual)
        satisfied = approx is not None and abs(approx) < 1e-9
    return {"ok": True, "satisfied": bool(satisfied), "variable": var.name,
            "residual": _pretty(residual)}


def _equivalent(a: sp.Expr, b: sp.Expr) -> tuple[bool, str, str]:
    diff = sp.simplify(a - b)
    if diff == 0:
        return True, "symbolic", "simplify(candidate - reference) == 0"
    try:
        if sp.simplify(sp.nsimplify(diff)) == 0:
            return True, "symbolic", "nsimplify reduced difference to 0"
    except Exception:  # noqa: BLE001
        pass
    # Numeric spot check over several random points for each free symbol.
    syms = sorted((a - b).free_symbols, key=lambda s: s.name)
    import random
    rng = random.Random(1234)
    checks = 0
    for _ in range(25):
        subs = {s: sp.Rational(rng.randint(-50, 50), rng.randint(1, 17)) for s in syms}
        try:
            val = complex((a - b).subs(subs).evalf())
        except Exception:  # noqa: BLE001
            continue
        if val != val:  # NaN -> undefined point, skip
            continue
        checks += 1
        if abs(val) > 1e-6:
            return False, "numeric", f"differs at {subs}"
    if checks:
        return True, "numeric", f"agreed at {checks} random sample points"
    return False, "inconclusive", "could not evaluate difference"


def _safe_float(obj: Any, digits: int = 12) -> float | str | None:
    try:
        v = sp.N(obj, digits)
        if v.is_real:
            f = float(v)
            # inf/nan would serialise as bare Infinity/NaN, which is not valid
            # JSON and would break the C# client's parser.
            return f if math.isfinite(f) else str(v)
        return str(v)
    except Exception:  # noqa: BLE001
        return None


# Dispatch table: operation name -> handler
OPERATIONS: dict[str, Callable[[dict], dict]] = {
    "parse": op_parse,
    "simplify": op_simplify,
    "solve": op_solve,
    "system": op_system,
    "factor": op_factor,
    "expand": op_expand,
    "series": op_series,
    "stats": op_stats,
    "derivative": op_derivative,
    "integral": op_integral,
    "limit": op_limit,
    "evaluate": op_evaluate,
    "verify": op_verify,
    "verify_solution": op_verify_solution,
}


def handle(req: dict) -> dict:
    """Dispatch one request dict to the right operation, never raising."""
    op = req.get("op")
    if op not in OPERATIONS:
        return {"ok": False, "error": f"unknown op {op!r}",
                "available": sorted(OPERATIONS)}
    try:
        result = OPERATIONS[op](req)
        result.setdefault("op", op)
        if "id" in req:
            result["id"] = req["id"]
        return result
    except ParseError as exc:
        return {"ok": False, "op": op, "error": f"parse error: {exc}",
                "id": req.get("id")}
    except Exception as exc:  # noqa: BLE001 - last-resort guard for the subprocess
        return {"ok": False, "op": op, "error": f"{type(exc).__name__}: {exc}",
                "id": req.get("id")}
