"""Entry point for the math engine.

Two transports, same dispatch logic:

1. stdio (default): read one JSON request per line on stdin, write one JSON
   response per line on stdout. This is how the C#/WPF app drives it — it spawns
   `python -m engine.server` and talks over the pipe. No network, no ports.

2. one-shot CLI: `python -m engine.server --request '{"op":"solve","expr":"x^2=4"}'`
   prints a single response. Handy for testing and shell scripting.

Run `python -m engine.server --selftest` to execute a batch of sanity checks.
"""
from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .operations import handle


def _run_stdio() -> int:
    # Announce readiness so the parent process can wait for a known line.
    banner = {"ok": True, "op": "ready", "version": __version__}
    sys.stdout.write(json.dumps(banner) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            resp = {"ok": False, "error": f"invalid JSON: {exc}"}
        else:
            if req.get("op") == "shutdown":
                sys.stdout.write(json.dumps({"ok": True, "op": "shutdown"}) + "\n")
                sys.stdout.flush()
                return 0
            resp = handle(req)
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
    return 0


def _run_once(payload: str) -> int:
    try:
        req = json.loads(payload)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"invalid JSON: {exc}"}))
        return 2
    print(json.dumps(handle(req), indent=2))
    return 0 if handle(req).get("ok") else 1


def _selftest() -> int:
    cases = [
        {"op": "solve", "expr": "x^2 - 5x + 6 = 0"},
        {"op": "solve", "expr": "2x + 3 = 11"},
        {"op": "derivative", "expr": "sin(x)*x^2"},
        {"op": "integral", "expr": "x^2", "lower": "0", "upper": "3"},
        {"op": "integral", "expr": "1/x"},
        {"op": "limit", "expr": "sin(x)/x", "point": "0"},
        {"op": "simplify", "expr": "(x^2 - 1)/(x - 1)"},
        {"op": "evaluate", "expr": "sqrt(2)", "digits": 8},
        {"op": "verify", "candidate": "(x+1)^2", "reference": "x^2 + 2x + 1"},
        {"op": "verify", "candidate": "x^2 + 2x", "reference": "x^2 + 2x + 1"},
        {"op": "verify_solution", "expr": "x^2 = 9", "value": "3"},
        {"op": "verify_solution", "expr": "x^2 = 9", "value": "4"},
        {"op": "parse", "expr": r"\frac{1}{2} + \sqrt{x}"},
    ]
    failures = 0
    for c in cases:
        r = handle(c)
        status = "ok " if r.get("ok") else "ERR"
        if not r.get("ok"):
            failures += 1
        print(f"[{status}] {json.dumps(c)}")
        print(f"       -> {json.dumps({k: v for k, v in r.items() if k != 'op'})}")
    print(f"\n{len(cases) - failures}/{len(cases)} ok, {failures} failed")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="MathAssistant symbolic engine")
    ap.add_argument("--request", help="run a single JSON request and exit")
    ap.add_argument("--selftest", action="store_true", help="run built-in checks")
    ap.add_argument("--version", action="store_true")
    args = ap.parse_args(argv)

    if args.version:
        print(__version__)
        return 0
    if args.selftest:
        return _selftest()
    if args.request:
        return _run_once(args.request)
    return _run_stdio()


if __name__ == "__main__":
    raise SystemExit(main())
