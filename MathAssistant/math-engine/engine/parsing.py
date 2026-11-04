"""Parsing helpers: turn user/LLM text (plain or LaTeX) into SymPy objects.

We keep parsing deliberately conservative. `sympify`/`eval` style parsing is a
classic injection vector, so we parse with an explicit transformation set and a
restricted local namespace rather than letting arbitrary Python through.
"""
from __future__ import annotations

import re
from typing import Any

import sympy as sp
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

# Allow things like "2x", "3(x+1)", "sin 2x" to mean multiplication/application.
_TRANSFORMS = standard_transformations + (implicit_multiplication_application,)

# A curated, safe namespace of names the parser is allowed to resolve.
# Everything else becomes a free Symbol (or raises), so no __import__ etc.
_SAFE_LOCALS: dict[str, Any] = {
    # elementary functions
    "sqrt": sp.sqrt, "exp": sp.exp, "log": sp.log, "ln": sp.log,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "Abs": sp.Abs, "abs": sp.Abs, "factorial": sp.factorial,
    "floor": sp.floor, "ceiling": sp.ceiling,
    # constants
    "pi": sp.pi, "E": sp.E, "e": sp.E, "I": sp.I, "oo": sp.oo,
    "infinity": sp.oo, "inf": sp.oo,
}


class ParseError(ValueError):
    """Raised when input cannot be parsed into a SymPy expression."""


def _strip_latex_wrappers(text: str) -> str:
    text = text.strip()
    # Strip common delimiters: $$ ... $$, $ ... $, \( ... \), \[ ... \]
    for a, b in (("$$", "$$"), ("$", "$"), (r"\(", r"\)"), (r"\[", r"\]")):
        if text.startswith(a) and text.endswith(b) and len(text) > len(a) + len(b):
            text = text[len(a): len(text) - len(b)].strip()
            break
    return text


def looks_like_latex(text: str) -> bool:
    """Heuristic: does this string use LaTeX-specific constructs?"""
    markers = (r"\frac", r"\sqrt", r"\int", r"\sum", r"\begin", r"\left",
               r"\right", "^{", "_{", r"\cdot", r"\times", r"\pi", r"\infty")
    return any(m in text for m in markers) or bool(re.search(r"\\[a-zA-Z]+", text))


def to_expr(text: str) -> sp.Expr:
    """Parse a single expression (no '=') into a SymPy expression."""
    raw = _strip_latex_wrappers(str(text))
    if not raw:
        raise ParseError("empty expression")

    if looks_like_latex(raw):
        try:
            from sympy.parsing.latex import parse_latex  # requires antlr4 runtime
            return parse_latex(raw)
        except Exception:
            # Fall back to a few mechanical LaTeX->plain rewrites, then plain parse.
            raw = _latex_fallback(raw)

    # Normalise a couple of plain-text conventions.
    raw = raw.replace("^", "**")
    try:
        return parse_expr(raw, transformations=_TRANSFORMS,
                          local_dict=_SAFE_LOCALS, evaluate=True)
    except Exception as exc:  # noqa: BLE001 - we re-wrap to a typed error
        raise ParseError(f"could not parse {text!r}: {exc}") from exc


def _latex_fallback(s: str) -> str:
    """Very small LaTeX rewriter for when the ANTLR parser is unavailable."""
    s = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"((\1)/(\2))", s)
    s = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"sqrt(\1)", s)
    s = s.replace(r"\cdot", "*").replace(r"\times", "*")
    s = s.replace(r"\pi", "pi").replace(r"\infty", "oo")
    s = s.replace(r"\left", "").replace(r"\right", "")
    s = re.sub(r"\\[a-zA-Z]+", lambda m: m.group(0)[1:], s)  # drop other backslashes
    s = s.replace("{", "(").replace("}", ")")
    return s


def to_equation(text: str) -> sp.Eq:
    """Parse 'lhs = rhs' into a SymPy Eq. If no '=', treat as 'expr = 0'."""
    raw = _strip_latex_wrappers(str(text))
    # Only split on a single '=' that is not '==', '<=', '>='.
    parts = re.split(r"(?<![<>=!])=(?![=])", raw)
    if len(parts) == 1:
        return sp.Eq(to_expr(parts[0]), 0)
    if len(parts) == 2:
        return sp.Eq(to_expr(parts[0]), to_expr(parts[1]))
    raise ParseError(f"expected a single '=' in {text!r}")


def main_symbol(expr: sp.Basic, prefer: str | None = None) -> sp.Symbol:
    """Pick the variable to solve/operate on."""
    syms = sorted(expr.free_symbols, key=lambda s: s.name)
    if prefer:
        for s in syms:
            if s.name == prefer:
                return s
    for name in ("x", "y", "t", "n", "z"):
        for s in syms:
            if s.name == name:
                return s
    if syms:
        return syms[0]
    return sp.Symbol("x")
