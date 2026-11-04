using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using MathAssistant.Models;

namespace MathAssistant.Services;

/// <summary>
/// Launches the Python SymPy engine as a child process and talks to it over a
/// line-delimited JSON protocol on stdin/stdout. One request per line, one
/// response per line. The process is kept alive between requests for speed.
///
/// Robustness rules:
///  * stderr is drained continuously (an unread redirected pipe can fill up and
///    deadlock both processes) and kept as a short tail for error messages.
///  * every call has a timeout; on timeout or any I/O failure the process is
///    killed and restarted on the next call, so request/response pairing can
///    never drift out of sync.
/// </summary>
public sealed class MathEngineClient : IAsyncDisposable
{
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(30);
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    private readonly string _pythonPath;
    private readonly string _engineDir;
    private readonly TimeSpan _callTimeout;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Queue<string> _stderrTail = new();
    private readonly object _stderrLock = new();

    private Process? _proc;
    private StreamWriter? _stdin;
    private StreamReader? _stdout;
    private bool _disposed;

    public MathEngineClient(string pythonPath, string engineDir, TimeSpan? callTimeout = null)
    {
        _pythonPath = string.IsNullOrWhiteSpace(pythonPath) ? "python" : pythonPath;
        _engineDir = engineDir;
        _callTimeout = callTimeout ?? TimeSpan.FromSeconds(20);
    }

    private string StderrTail()
    {
        lock (_stderrLock) return string.Join(Environment.NewLine, _stderrTail);
    }

    private async Task EnsureStartedAsync(CancellationToken ct)
    {
        if (_proc is { HasExited: false }) return;
        KillProcess(); // clean up a dead previous instance, if any

        if (!Directory.Exists(_engineDir))
            throw new InvalidOperationException($"Math engine folder not found: {_engineDir}");

        var psi = new ProcessStartInfo
        {
            FileName = _pythonPath,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = _engineDir,
            StandardOutputEncoding = Utf8NoBom,
            StandardErrorEncoding = Utf8NoBom,
            StandardInputEncoding = Utf8NoBom,
        };
        psi.ArgumentList.Add("-m");
        psi.ArgumentList.Add("engine.server");
        // Make Python use UTF-8 for its pipes regardless of the Windows code page.
        psi.Environment["PYTHONUTF8"] = "1";
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        psi.Environment["PYTHONUNBUFFERED"] = "1";

        lock (_stderrLock) _stderrTail.Clear();
        Process proc;
        try
        {
            proc = Process.Start(psi) ?? throw new InvalidOperationException("Process.Start returned null.");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"Could not start Python ('{_pythonPath}'). Set the full path to python.exe in Settings. ({ex.Message})", ex);
        }

        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            lock (_stderrLock)
            {
                _stderrTail.Enqueue(e.Data);
                while (_stderrTail.Count > 20) _stderrTail.Dequeue();
            }
        };
        proc.BeginErrorReadLine();

        _proc = proc;
        _stdin = proc.StandardInput;
        _stdout = proc.StandardOutput;

        // Wait for the engine's readiness banner.
        var banner = await ReadLineWithTimeoutAsync(StartupTimeout, ct).ConfigureAwait(false);
        if (banner is null || !banner.Contains("\"ready\""))
        {
            KillProcess();
            var tail = StderrTail();
            throw new InvalidOperationException(
                "Math engine did not start. Did you run 'pip install -r requirements.txt'?" +
                (string.IsNullOrWhiteSpace(tail) ? "" : Environment.NewLine + tail));
        }
    }

    /// <summary>
    /// Read one line, giving up after <paramref name="timeout"/>. Reads on
    /// anonymous pipes are not reliably cancellable on Windows, so on timeout we
    /// kill the process, which closes the pipe and completes the pending read.
    /// </summary>
    private async Task<string?> ReadLineWithTimeoutAsync(TimeSpan timeout, CancellationToken ct)
    {
        var readTask = _stdout!.ReadLineAsync();
        using var delayCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var delayTask = Task.Delay(timeout, delayCts.Token);
        var finished = await Task.WhenAny(readTask, delayTask).ConfigureAwait(false);
        if (finished == readTask)
        {
            delayCts.Cancel();
            return await readTask.ConfigureAwait(false);
        }

        KillProcess();
        try { await readTask.ConfigureAwait(false); } catch { /* pipe closed */ }
        ct.ThrowIfCancellationRequested();
        throw new TimeoutException($"Math engine took longer than {timeout.TotalSeconds:0}s and was restarted.");
    }

    /// <summary>Send one request object, await one response object.</summary>
    public async Task<JsonDocument> CallAsync(object request, CancellationToken ct = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await EnsureStartedAsync(ct).ConfigureAwait(false);
            try
            {
                var json = JsonSerializer.Serialize(request);
                await _stdin!.WriteLineAsync(json).ConfigureAwait(false);
                await _stdin.FlushAsync().ConfigureAwait(false);

                var line = await ReadLineWithTimeoutAsync(_callTimeout, ct).ConfigureAwait(false)
                           ?? throw new IOException("Math engine exited unexpectedly. " + StderrTail());
                return JsonDocument.Parse(line);
            }
            catch
            {
                // Any failure mid-exchange may leave the pipe out of sync; start fresh next time.
                KillProcess();
                throw;
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Run whatever verification the AI attached to its answer.</summary>
    public async Task<VerificationResult> VerifyAsync(VerificationRequest req, CancellationToken ct = default)
    {
        var result = new VerificationResult();
        if (string.IsNullOrWhiteSpace(req.Check)) return result;

        // Map the model's verification request to an engine op payload. The
        // model's own answer travels as `candidate`, so SymPy can compute the
        // result independently and then compare.
        object payload = req.Check switch
        {
            "solve" => new { op = "solve", expr = req.Expr, var = req.Var, candidate = req.Candidate },
            "verify" => new { op = "verify", candidate = req.Candidate, reference = req.Reference },
            "verify_solution" => new { op = "verify_solution", expr = req.Expr, value = req.Value, var = req.Var },
            "integral" => new { op = "integral", expr = req.Expr, var = req.Var,
                                lower = req.Lower, upper = req.Upper, candidate = req.Candidate },
            "simplify" or "factor" or "expand" or "evaluate" or "derivative" or "limit"
                => new { op = req.Check, expr = req.Expr, var = req.Var, candidate = req.Candidate },
            _ => null!
        };
        if (payload is null)
        {
            result.Summary = $"Unknown verification type '{req.Check}' - skipped.";
            return result;
        }

        try
        {
            using var doc = await CallAsync(payload, ct).ConfigureAwait(false);
            var root = doc.RootElement;
            result.Ran = true;
            result.RawJson = root.GetRawText();

            if (!root.TryGetProperty("ok", out var okProp) || okProp.ValueKind != JsonValueKind.True)
            {
                result.Passed = false;
                result.Summary = "Could not check this answer: " + GetStr(root, "error");
                return result;
            }

            (result.Passed, result.Summary) = Interpret(req.Check, root);
        }
        catch (Exception ex)
        {
            result.Ran = false;
            result.Summary = "Verification unavailable: " + ex.Message;
        }
        return result;
    }

    private static (bool passed, string summary) Interpret(string check, JsonElement root)
    {
        // Preferred path: SymPy computed the result itself and compared it with
        // the model's answer.
        if (root.TryGetProperty("matches", out var m) &&
            m.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            var computed = Describe(root);
            return m.GetBoolean()
                ? (true, $"✓ SymPy independently got {computed}, which matches the answer.")
                : (false, $"✗ SymPy independently got {computed}, which does NOT match the answer " +
                          $"({GetStr(root, "match_detail")}). Treat the answer above with caution.");
        }

        return check switch
        {
            "verify" => root.TryGetProperty("equivalent", out var eq) && eq.ValueKind == JsonValueKind.True
                ? (true, $"✓ The two forms are equivalent ({GetStr(root, "method")}).")
                : (false, "✗ SymPy says the two forms are NOT equivalent."),
            "verify_solution" => root.TryGetProperty("satisfied", out var sat) && sat.ValueKind == JsonValueKind.True
                ? (true, "✓ The value satisfies the equation (residual 0).")
                : (false, $"✗ The value does not satisfy the equation (residual {GetStr(root, "residual")})."),
            // No claimed answer was supplied: report what SymPy found, without a verdict.
            _ => (false, $"SymPy's own result: {Describe(root)} (no answer supplied to compare).")
        };
    }

    private static string Describe(JsonElement root)
    {
        if (root.TryGetProperty("solutions", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            var parts = arr.EnumerateArray().Select(s => GetStr(s, "sympy")).ToList();
            return parts.Count == 0 ? "no solutions" : string.Join(", ", parts);
        }
        return root.TryGetProperty("result", out var r) ? r.ToString() : root.GetRawText();
    }

    private static string GetStr(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString()) : "";

    private void KillProcess()
    {
        var proc = _proc;
        _proc = null; _stdin = null; _stdout = null;
        if (proc is null) return;
        try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* already gone */ }
        proc.Dispose();
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_proc is { HasExited: false } && _stdin is not null)
            {
                try
                {
                    await _stdin.WriteLineAsync("{\"op\":\"shutdown\"}").ConfigureAwait(false);
                    await _stdin.FlushAsync().ConfigureAwait(false);
                    _proc.WaitForExit(1500);
                }
                catch { /* best effort */ }
            }
            KillProcess();
        }
        finally
        {
            _gate.Release();
        }
    }
}
