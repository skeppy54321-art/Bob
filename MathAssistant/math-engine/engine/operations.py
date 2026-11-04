"""The actual math operations, each returning a JSON-serialisable dict.

Every operation is wrapped so that a failure returns {"ok": False, "error": ...}
instead of throwing, because this engine runs as a long-lived subprocess and a
single bad request must never take it down.
"""
from __future__ import annotations

from typing import Any, Callable

import sympy as sp

from .parsing import ParseError, main_symbol, to_equation, to_expr


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
    return {"ok": True, "result": _pretty(simplified), "latex": _latex(simplified)}


def op_solve(req: dict) -> dict:
    eq = to_equation(req["expr"])
    var = main_symbol(eq, req.get("var"))
    sols = sp.solve(eq, var, dict=False)
    out = []
    for s in sols:
        s_simpl = sp.simplify(s)
        out.append({"sympy": _pretty(s_simpl), "latex": _latex(s_simpl),
                    "approx": _safe_float(s_simpl)})
    return {"ok": True, "variable": var.name, "solutions": out}


def op_derivative(req: dict) -> dict:
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    order = int(req.get("order", 1))
    d = sp.diff(expr, var, order)
    d_simpl = sp.simplify(d)
    return {"ok": True, "variable": var.name, "order": order,
            "result": _pretty(d_simpl), "latex": _latex(d_simpl)}


def op_integral(req: dict) -> dict:
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    a, b = req.get("lower"), req.get("upper")
    if a is not None and b is not None:
        lo, hi = to_expr(str(a)), to_expr(str(b))
        val = sp.integrate(expr, (var, lo, hi))
        val_s = sp.simplify(val)
        return {"ok": True, "definite": True, "variable": var.name,
                "result": _pretty(val_s), "latex": _latex(val_s),
                "approx": _safe_float(val_s)}
    anti = sp.integrate(expr, var)
    return {"ok": True, "definite": False, "variable": var.name,
            "result": _pretty(anti) + " + C", "latex": _latex(anti) + " + C"}


def op_limit(req: dict) -> dict:
    expr = to_expr(req["expr"])
    var = main_symbol(expr, req.get("var"))
    point = to_expr(str(req.get("point", "0")))
    direction = req.get("dir", "+")
    lim = sp.limit(expr, var, point, direction if direction in ("+", "-") else "+")
    return {"ok": True, "variable": var.name, "result": _pretty(lim),
            "latex": _latex(lim), "approx": _safe_float(lim)}


def op_evaluate(req: dict) -> dict:
    """Numerically evaluate an expression, optionally substituting variables."""
    expr = to_expr(req["expr"])
    subs = {sp.Symbol(k): to_expr(str(v)) for k, v in (req.get("subs") or {}).items()}
    val = expr.subs(subs)
    digits = int(req.get("digits", 12))
    numeric = _safe_float(val, digits)
    return {"ok": True, "result": _pretty(sp.simplify(val)),
            "latex": _latex(val), "approx": numeric}


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
            return float(v)
        return str(v)
    except Exception:  # noqa: BLE001
        return None


# Dispatch table: operation name -> handler
OPERATIONS: dict[str, Callable[[dict], dict]] = {
    "parse": op_parse,
    "simplify": op_simplify,
    "solve": op_solve,
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
