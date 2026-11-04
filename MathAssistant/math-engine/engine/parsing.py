"""Parsing helpers: turn user/LLM text (plain or LaTeX) into SymPy objects.

SECURITY: SymPy's `parse_expr` ultimately calls Python's `eval`, and by default
it exposes Python builtins (including `__import__`) to the evaluated code. The
text we parse can come from a language model, whose output can be steered by
prompt injection hidden in an image or PDF, so it must be treated as hostile.

We therefore defend in two independent layers:
  1. `_validate_tokens` rejects anything that is not plain math *before* parsing:
     dunder names, attribute access (`a.b`), string literals, Python keywords,
     and unexpected characters.
  2. `parse_expr` is called with a global namespace that contains NO builtins,
     only the handful of SymPy constructors the parser's transformations emit.
"""
from __future__ import annotations

import io
import keyword
import re
import tokenize
from typing import Any

import sympy as sp
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

# Allow things like "2x", "3(x+1)", "sin 2x" to mean multiplication/application.
_TRANSFORMS = standard_transformations + (implicit_multiplication_application,)

# Hard cap on input size: keeps pathological inputs from tying up the engine.
MAX_INPUT_CHARS = 2000

# Global namespace for eval: no builtins, only what the transformations emit.
_SAFE_GLOBALS: dict[str, Any] = {
    "__builtins__": {},
    "Symbol": sp.Symbol, "Integer": sp.Integer, "Float": sp.Float,
    "Rational": sp.Rational, "Function": sp.Function,
    "factorial": sp.factorial, "factorial2": sp.factorial2,
}

# Common Unicode math the models (and people) produce -> ASCII equivalents.
_UNICODE_MAP = {
    "−": "-", "–": "-", "×": "*", "⋅": "*", "·": "*",
    "÷": "/", "∕": "/", "√": "sqrt", "π": "pi",
    "∞": "oo", "²": "^2", "³": "^3", "⁰": "^0",
    "¹": "^1", "⁴": "^4", "⁵": "^5", "⁶": "^6",
    "⁷": "^7", "⁸": "^8", "⁹": "^9", "≤": "<=",
    "≥": ">=", " ": " ", "﻿": "",
}


def normalize_unicode(text: str) -> str:
    # "√16" / "√x" -> "sqrt(16)" / "sqrt(x)"; "√(...)" is handled by the map.
    text = re.sub(r"√\s*(\d+(?:\.\d+)?|[A-Za-z])", r"sqrt(\1)", text)
    for k, v in _UNICODE_MAP.items():
        text = text.replace(k, v)
    return text


def _validate_tokens(text: str) -> None:
    """Reject anything that isn't plain mathematical notation.

    Raises ParseError for dunder names, attribute access, string literals,
    Python keywords, or characters outside a small math alphabet.
    """
    if len(text) > MAX_INPUT_CHARS:
        raise ParseError(f"input longer than {MAX_INPUT_CHARS} characters")
    if "__" in text:
        raise ParseError("double underscores are not allowed")
    bad = set(re.sub(r"[A-Za-z0-9_\s+\-*/^().,!=<>|]", "", text))
    if bad:
        raise ParseError(f"unsupported characters: {''.join(sorted(bad))!r}")
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError) as exc:
        raise ParseError(f"could not tokenize: {exc}") from exc
    prev = None
    for tok in toks:
        if tok.type == tokenize.STRING:
            raise ParseError("string literals are not allowed")
        if tok.type == tokenize.NAME:
            if keyword.iskeyword(tok.string):
                raise ParseError(f"keyword {tok.string!r} is not allowed")
            if prev is not None and prev.type == tokenize.OP and prev.string == ".":
                raise ParseError("attribute access is not allowed")
        if tok.type not in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT,
                            tokenize.DEDENT, tokenize.ENDMARKER):
            prev = tok

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
    raw = _strip_latex_wrappers(normalize_unicode(str(text)))
    if not raw:
        raise ParseError("empty expression")
    if len(raw) > MAX_INPUT_CHARS:
        raise ParseError(f"input longer than {MAX_INPUT_CHARS} characters")

    if looks_like_latex(raw):
        try:
            # The ANTLR-based LaTeX parser builds SymPy objects directly and
            # never calls eval, so it is safe to try first.
            from sympy.parsing.latex import parse_latex  # requires antlr4 runtime
            result = parse_latex(raw)
            if isinstance(result, sp.Basic):
                return result
        except Exception:  # noqa: BLE001
            pass
        # Fall back to a few mechanical LaTeX->plain rewrites, then plain parse.
        raw = _latex_fallback(raw)

    # Normalise a couple of plain-text conventions.
    raw = raw.replace("^", "**")
    _validate_tokens(raw)
    try:
        result = parse_expr(raw, transformations=_TRANSFORMS,
                            local_dict=dict(_SAFE_LOCALS),
                            global_dict=dict(_SAFE_GLOBALS), evaluate=True)
    except Exception as exc:  # noqa: BLE001 - we re-wrap to a typed error
        raise ParseError(f"could not parse {text!r}: {exc}") from exc
    if not isinstance(result, sp.Basic):
        # e.g. a bare Python tuple from "1, 2" - not a single math expression.
        raise ParseError(f"{text!r} is not a single mathematical expression")
    return result


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
    raw = _strip_latex_wrappers(normalize_unicode(str(text)))
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
