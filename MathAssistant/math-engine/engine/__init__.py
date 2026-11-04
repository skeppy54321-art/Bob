"""MathAssistant symbolic math engine.

A small, dependency-light service built on SymPy. It is intentionally
*independent* of any LLM: its job is to compute and to verify, so that an
answer produced by a language model can be checked against a deterministic
symbolic/numeric oracle before it is shown to the user.
"""

__version__ = "0.1.0"
