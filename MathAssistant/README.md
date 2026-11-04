# Study Tools Suite

A three-application Windows learning project for studying **secure testing
environments**, **AI-assisted mathematics**, and **remote desktop technology**.
Each application is **independent** and useful on its own.

> **Scope and intent.** These are *study* tools, built to learn Windows systems
> programming, secure application design, and AI integration on software you own
> and control. This project deliberately does **not** implement covert remote
> access, stealth/anti-detection mechanisms, exam-monitoring evasion, or any
> automated pipeline that feeds answers into a locked-down exam. The three apps
> are separate programs and are not wired together into such a pipeline.

| # | Application | Stack | Status |
|---|-------------|-------|--------|
| 1 | Secure Testing Simulator | C# / .NET 10 / WPF + Win32 | _Stage 2 (planned)_ |
| 2 | **AI Mathematics Assistant** | C# / .NET 10 / WPF + Python/SymPy | **Stage 1 — implemented** |
| 3 | Remote Desktop (authorized) | C# / .NET 10 / WPF | _Stage 3 (planned)_ |

This README covers **Application 2**, which is implemented first.

---

## Application 2 — AI Mathematics Assistant

A desktop tutor for your own study materials. Import a screenshot, photo, or PDF
page of a math problem (or type it), and get a step-by-step explanation whose
**final answer is independently checked by a SymPy engine** — so you are not just
trusting the language model.

### Features implemented in Stage 1
- Providers: **Claude**, **OpenAI**, and **Ollama** (local), selectable in Settings.
- Input: typed text, attached image files, **pasted screenshots**, and **PDF pages**.
- Vision: images are sent to the vision-capable model you configure.
- **Independent verification** of answers with SymPy. Engine operations:
  `solve`, `system` (simultaneous equations), `verify`, `verify_solution`,
  `simplify`, `factor`, `expand`, `series` (Taylor), `evaluate`, `derivative`,
  `integral`, `limit`, and `stats` (mean/median/variance/std).
- Step-by-step explanations rendered in a chat UI, with **copy-to-clipboard**.
- **Practice mode**: hints first, answer withheld.
- Local **SQLite history** of solved problems, with **export to Markdown/JSON**.
- API keys encrypted at rest with **Windows DPAPI**, plus a **Test connection**
  button in Settings.

### Architecture

```
┌─────────────────────────────────────────────┐
│  WPF app (C# / .NET 10)                       │
│                                               │
│  MainViewModel ── MathTutorService            │
│       │                 │                     │
│       │                 ├─ IAiProvider ──────────► Claude / OpenAI / Ollama (HTTPS)
│       │                 │                     │
│       │                 └─ MathEngineClient ──┐│
│       ├─ HistoryStore (SQLite)                ││  stdin/stdout JSON lines
│       └─ SettingsStore (DPAPI)                ││
└───────────────────────────────────────────────┘
                                                ▼
                        ┌──────────────────────────────────┐
                        │ Python engine (engine.server)     │
                        │ SymPy: parse / solve / verify      │
                        └──────────────────────────────────┘
```

The AI proposes a **structured** solution (JSON) that includes an optional
machine-checkable verification request. The C# app forwards that request to the
Python engine, which recomputes the result symbolically/numerically and reports
whether it agrees. This "LLM proposes, CAS verifies" split is the point of the
app.

### Directory structure

```
MathAssistant/
├── README.md
├── config.example.json
├── docs/
│   └── ARCHITECTURE.md
├── math-engine/                 # Python + SymPy (cross-platform, testable on Linux)
│   ├── requirements.txt
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── parsing.py           # safe text/LaTeX -> SymPy
│   │   ├── operations.py        # solve/verify/derivative/...
│   │   └── server.py            # stdio + CLI entry point
│   └── tests/
│       └── test_engine.py
└── src/                          # C# WPF app (build on Windows)
    ├── MathAssistant.sln
    └── MathAssistant/
        ├── MathAssistant.csproj
        ├── app.manifest
        ├── App.xaml(.cs)
        ├── MainWindow.xaml(.cs)
        ├── Models/
        ├── Services/
        ├── ViewModels/
        └── Views/
```

---

## Dependencies

### Python math engine (works on Windows, macOS, Linux)
- Python 3.10+
- `sympy==1.14.0`, `antlr4-python3-runtime==4.11.*` (LaTeX parsing), `pytest` (tests)

```bash
cd MathAssistant/math-engine
python -m pip install -r requirements.txt
```

### C# desktop app (Windows only to build/run)
- **.NET 10 SDK** (or .NET 8 SDK — change the TFM in `MathAssistant.csproj`
  from `net10.0-windows` to `net8.0-windows`).
- Windows 10 version 1809+ or Windows 11.
- NuGet packages (restored automatically): `Microsoft.Data.Sqlite`,
  `CommunityToolkit.Mvvm`.
- Optional: **Poppler** (`pdftoppm` on PATH) for PDF page import.
- Optional: **Ollama** (https://ollama.com) if you want local models.

---

## Build & run (Windows)

```powershell
# 1. Install the Python engine deps (used at runtime by the app)
cd MathAssistant\math-engine
python -m pip install -r requirements.txt
python -m engine.server --selftest    # sanity check: should print "13/13 ok"

# 2. Build and run the WPF app
cd ..\src
dotnet restore
dotnet build -c Release
dotnet run -c Release --project MathAssistant
```

To produce a distributable build:

```powershell
dotnet publish MathAssistant\MathAssistant.csproj -c Release -r win-x64 `
    --self-contained false -o .\publish
```

The Python engine files are copied next to the executable (`math-engine\`), and
the app launches `python -m engine.server` from there. Set the Python path in
**Settings** if `python` is not on PATH.

### First-run configuration
1. Launch the app → **Settings**.
2. Pick a provider:
   - **Ollama**: set base URL (default `http://localhost:11434`) and a model
     you've pulled (e.g. `ollama pull llama3.1`). For images use a vision model
     such as `llava`.
   - **Claude / OpenAI**: paste your API key (stored DPAPI-encrypted) and a
     model name (e.g. `claude-opus-5-5`, `gpt-4o`).
3. Save, then type or attach a problem and press **Send** (or Ctrl+Enter).

See `config.example.json` for the on-disk settings shape (written to
`%APPDATA%\MathAssistant\settings.json`).

---

## Testing

### Python engine (runs anywhere, including CI)
```bash
cd MathAssistant/math-engine
python -m pytest -q          # 13 unit tests
python -m engine.server --selftest
```
The suite (18 tests) covers solving, systems, factoring, expansion, series,
differentiation, integration, limits, descriptive statistics, equivalence
verification (both positive and negative), solution checking, LaTeX parsing,
and **injection safety** (input is never `eval`'d as Python).

You can also drive the engine by hand:
```bash
python -m engine.server --request '{"op":"solve","expr":"x^2 - 5x + 6 = 0"}'
python -m engine.server --request '{"op":"verify","candidate":"(x+1)^2","reference":"x^2+2x+1"}'
python -m engine.server --request '{"op":"system","exprs":["x+y=3","x-y=1"]}'
python -m engine.server --request '{"op":"stats","data":[2,4,4,4,5,5,7,9]}'
```

### C# app
Manual test checklist for Stage 1:
1. Type `solve x^2 - 5x + 6 = 0` → expect steps + answer `x = 2, 3` + a green
   "Independently verified" line.
2. Paste a screenshot of a problem (Paste button) → expect an answer referencing
   the image.
3. Toggle **Practice mode** → expect hints only, no final answer, nothing saved
   to history.
4. Kill `python.exe` mid-session, then solve again → the engine auto-restarts
   (verification line may say "unavailable" once, then recover).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not start Python" | Set the full path to `python.exe` in Settings. |
| "Math engine did not report readiness" | `pip install -r requirements.txt`; run `--selftest`. |
| LaTeX parses poorly | Install `antlr4-python3-runtime`; otherwise the built-in fallback is used. |
| PDF import error | Install Poppler and ensure `pdftoppm` is on PATH, or export the page as PNG. |
| Ollama 404 / connection refused | Run `ollama serve`; `ollama pull <model>`; check the base URL. |
| Claude/OpenAI 401 | Re-enter the API key in Settings (DPAPI keys are per-user/per-machine). |
| Images rejected by model | Use a vision-capable model (e.g. `gpt-4o`, `llava`, a Claude model). |

---

## Security & privacy notes
- **API keys** are encrypted with DPAPI (`CurrentUser`) and never written in
  plaintext. They are sent only to the provider endpoint you choose.
- **Your data** (history, settings) stays in `%APPDATA%\MathAssistant`.
- **Images** you attach are sent to the selected AI provider — don't attach
  anything you wouldn't send to that provider. Use **Ollama** for fully local,
  offline processing.
- The Python engine **parses** math with a restricted namespace and never
  executes input as code (see `tests/test_engine.py::test_injection_is_not_executed`).

See `docs/ARCHITECTURE.md` for the full multi-app plan and the Windows APIs used
by Applications 1 and 3.
