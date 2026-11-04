# Architecture & Multi-Stage Plan

This document describes the overall three-application project, the staged build
plan, and — for the Windows systems work in Applications 1 and 3 — the specific
Win32 APIs involved, the OS permissions required, and the real limitations of
each technique. It is written to be useful as a study reference even before
Stages 2 and 3 are implemented.

## Guiding scope

All three programs are **independent**. They are study tools for software you own
and control. This project does **not** build:
- covert/stealth remote access or hidden agents,
- mechanisms to evade third-party exam or proctoring software,
- any automated pipeline that captures a locked-down exam and supplies answers.

The remote desktop app (Application 3) is explicitly **consent-first**: a visible
session indicator, user-granted permissions, and immediate disconnect. The
testing simulator (Application 1) is a **defensive** artifact for understanding
how kiosk/lockdown software detects integrity events on a machine you administer.

---

## Stage plan

- **Stage 1 (done): AI Mathematics Assistant.** Full WPF app + Python/SymPy
  engine, three AI providers, verification, history, practice mode.
- **Stage 2: Secure Testing Simulator.** Full-screen exam UI, question bank,
  timer, and a monitoring layer (process/focus/screen-capture/remote-session)
  that writes to a local event log. Self-tests for detection accuracy.
- **Stage 3: Remote Desktop (authorized).** Consent-first screen sharing +
  input control over an encrypted channel, pairing/auth, session indicator.

Each stage is a separate solution folder and can be built and run on its own.

---

## Application 1 — Secure Testing Simulator (Stage 2 design)

A defensive, self-contained exam environment. The interesting engineering is the
**monitoring layer**. Below is the planned mapping of feature → Windows API →
permission → limitation. (This is design/reference; code lands in Stage 2.)

### Full-screen / kiosk interface
- **How:** WPF `Window` with `WindowStyle=None`, `WindowState=Maximized`,
  `Topmost=true`, covering the work area. Optionally a secondary "assigned access"
  style flow.
- **Permission:** none (normal user).
- **Limitation:** This is *cooperative* full-screen, not a true OS kiosk. The user
  can still Alt+Tab / Win key away unless combined with Assigned Access (which is
  an OS feature configured outside the app). A desktop app **cannot** fully trap
  the Windows key or Ctrl+Alt+Del — by design of the OS. We detect leaving,
  rather than preventing it.

### Process enumeration & monitoring
- **How:** `System.Diagnostics.Process.GetProcesses()`, or `EnumProcesses`
  (PSAPI) / `CreateToolhelp32Snapshot` (Tool Help) via P/Invoke; poll on a timer
  and diff against a baseline to log new processes.
- **Permission:** basic enumeration works as standard user; reading details of
  processes owned by *other* users or elevated processes may require
  administrator / `SeDebugPrivilege`.
- **Limitation:** Polling has a window between samples; a short-lived process can
  start and exit between polls. You see *that* a process exists, not intent.

### Application focus-change detection
- **How:** `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, …)` for foreground changes,
  plus `GetForegroundWindow` + `GetWindowThreadProcessId` to identify the new
  window/app; log each transition away from the exam window.
- **Permission:** none for foreground events of the current desktop session.
- **Limitation:** Hooks observe the **interactive desktop**; they don't see
  another user session. UWP/packaged apps report as their host process.

### Keyboard shortcut handling
- **How:** `RegisterHotKey` for a small set, or a `WH_KEYBOARD_LL` low-level hook
  to observe keystrokes within supported limits.
- **Permission:** none; but low-level hooks run in the app's session only.
- **Limitation:** You **cannot** reliably suppress `Ctrl+Alt+Del` (Secure
  Attention Sequence), and the Windows key / accessibility combos are
  intentionally hard to block from user space. Treat shortcut "handling" as
  best-effort within what the OS permits — the simulator *logs* rather than
  *guarantees* prevention.

### Screen-capture restriction
- **How:** `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` (Windows 10
  2004+) so the window is excluded from screenshots/most capture paths; or
  `WDA_MONITOR`.
- **Permission:** none.
- **Limitation:** Protects *this app's window* from standard capture APIs and
  many recorders. It does **not** stop a phone camera pointed at the screen, a
  hardware capture card, or capture tools using paths the OS doesn't gate. It is
  a deterrent, not a guarantee.

### Network connectivity monitoring
- **How:** `GetExtendedTcpTable` (IP Helper) to enumerate TCP connections and
  owning PIDs; `NetworkInformation`/`NetworkChange` for up/down events; log new
  external connections during an exam.
- **Permission:** none for the current user's connections; full system detail may
  need elevation.
- **Limitation:** Visibility into connections ≠ control. Encrypted traffic is
  opaque; this is logging/telemetry, not a firewall.

### Remote-session detection (defensive)
- **How:** `GetSystemMetrics(SM_REMOTESESSION)` (true under RDP);
  WTS APIs (`WTSQuerySessionInformation`) for session protocol/client; check for
  well-known remote-tool processes/services as *hints*. The point is to **log**
  that a remote session is present during an exam on a machine you control.
- **Permission:** none for the current session; enumerating all sessions may need
  elevation.
- **Limitation:** `SM_REMOTESESSION` detects RDP specifically; third-party
  remote tools render into the local console session and are **not** flagged by
  it — you fall back to heuristic process/port hints, which have false
  positives/negatives. This is detection-and-logging for a cooperative,
  self-administered setting; it is **not** an anti-cheat arms race.

### Logging
- **How:** structured append-only log (JSON lines) under `%PROGRAMDATA%` or
  `%APPDATA%`; optionally the Windows **Event Log** via `EventLog`.
- **Permission:** writing to the Windows Event Log *source* registration needs
  admin once; writing entries afterwards does not.

### Administrator-configurable settings & safe exit
- Admin settings behind a password/role; a clearly documented **exit** (e.g.
  a visible "End exam" button + confirmation) so the simulation never traps the
  user. Recovery: on crash/restart, restore timer and answers from autosave.

---

## Application 3 — Remote Desktop, authorized (Stage 3 design)

Consent-first remote support for machines you own/administer.

- **Capture:** Windows.Graphics.Capture / Desktop Duplication API
  (`IDXGIOutputDuplication`) for efficient frame capture.
- **Transport:** TCP/QUIC with **TLS** (or a libsodium-style authenticated
  encryption) between host and viewer; LAN by default, optional authenticated
  internet via a relay you run.
- **Input injection:** `SendInput` on the host, applied only while the host user
  has granted control.
- **Pairing/auth:** short code + public-key pinning; connection history log.
- **Consent UX (required):** a persistent, always-visible **"Screen is being
  shared"** indicator; per-session grant of view vs. control; a one-click
  **Disconnect**; no auto-accept, no hidden/background mode.
- **Permission:** `SendInput` and capture run as the interactive user; capturing
  the secure desktop (UAC prompts, logon) is restricted by design.
- **Limitation:** This is overt remote support, not unattended stealth access.
  It will not (and is not meant to) hide from the person at the keyboard.

---

## Application 2 — AI Mathematics Assistant (implemented)

See the top-level `README.md`. Key design choice: the LLM returns a **structured**
solution with an optional verification request, and a separate **SymPy** process
re-derives/checks the result. The two never share state beyond that JSON, and the
engine parses input in a restricted namespace (no `eval` of arbitrary Python).

### Security considerations (Stage 1)
- Secrets at rest: DPAPI (`CurrentUser`).
- Subprocess isolation: the engine is a child process speaking line-delimited
  JSON on stdio; a malformed request returns an error object rather than
  crashing the engine, and the parent restarts it if it dies.
- Input safety: `parsing.py` uses `parse_expr` with an explicit transformation
  set and a curated local namespace; unknown names become free symbols or raise.
