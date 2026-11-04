using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using MathAssistant.Models;

namespace MathAssistant.Services;

/// <summary>
/// Launches the Python SymPy engine as a child process and talks to it over a
/// line-delimited JSON protocol on stdin/stdout. One request per line, one
/// response per line. The process is kept alive between requests for speed and
/// restarted automatically if it dies.
/// </summary>
public sealed class MathEngineClient : IAsyncDisposable
{
    private readonly string _pythonPath;
    private readonly string _engineDir;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Process? _proc;
    private StreamWriter? _stdin;
    private StreamReader? _stdout;

    public MathEngineClient(string pythonPath, string engineDir)
    {
        _pythonPath = string.IsNullOrWhiteSpace(pythonPath) ? "python" : pythonPath;
        _engineDir = engineDir;
    }

    private async Task EnsureStartedAsync(CancellationToken ct)
    {
        if (_proc is { HasExited: false }) return;

        var psi = new ProcessStartInfo
        {
            FileName = _pythonPath,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = _engineDir,
            StandardOutputEncoding = Encoding.UTF8,
            StandardInputEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add("-m");
        psi.ArgumentList.Add("engine.server");

        _proc = Process.Start(psi) ?? throw new InvalidOperationException(
            $"Could not start Python ('{_pythonPath}'). Check Settings > Python path.");
        _stdin = _proc.StandardInput;
        _stdout = _proc.StandardOutput;

        // Wait for the engine's readiness banner.
        var banner = await _stdout.ReadLineAsync(ct).ConfigureAwait(false);
        if (banner is null || !banner.Contains("\"ready\""))
            throw new InvalidOperationException(
                "Math engine did not report readiness. " + (banner ?? "<no output>"));
    }

    /// <summary>Send one request object, await one response object.</summary>
    public async Task<JsonDocument> CallAsync(object request, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await EnsureStartedAsync(ct).ConfigureAwait(false);
            var json = JsonSerializer.Serialize(request);
            await _stdin!.WriteLineAsync(json.AsMemory(), ct).ConfigureAwait(false);
            await _stdin.FlushAsync(ct).ConfigureAwait(false);

            var line = await _stdout!.ReadLineAsync(ct).ConfigureAwait(false)
                       ?? throw new IOException("Math engine closed the pipe.");
            return JsonDocument.Parse(line);
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

        // Map the model's verification request to an engine op payload.
        object payload = req.Check switch
        {
            "solve" => new { op = "solve", expr = req.Expr, var = req.Var },
            "verify" => new { op = "verify", candidate = req.Candidate, reference = req.Reference },
            "verify_solution" => new { op = "verify_solution", expr = req.Expr, value = req.Value, var = req.Var },
            "simplify" => new { op = "simplify", expr = req.Expr },
            "evaluate" => new { op = "evaluate", expr = req.Expr },
            "derivative" => new { op = "derivative", expr = req.Expr, var = req.Var },
            "integral" => new { op = "integral", expr = req.Expr },
            _ => new { op = req.Check, expr = req.Expr }
        };

        try
        {
            using var doc = await CallAsync(payload, ct).ConfigureAwait(false);
            var root = doc.RootElement;
            result.Ran = true;
            result.RawJson = root.GetRawText();

            if (!root.GetProperty("ok").GetBoolean())
            {
                result.Passed = false;
                result.Summary = "Engine error: " + GetStr(root, "error");
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

    private static (bool passed, string summary) Interpret(string check, JsonElement root) => check switch
    {
        "verify" => (root.GetProperty("equivalent").GetBoolean(),
            root.GetProperty("equivalent").GetBoolean()
                ? $"✓ Independently verified equivalent ({GetStr(root, "method")})."
                : "✗ SymPy says the answer is NOT equivalent to the reference."),
        "verify_solution" => (root.GetProperty("satisfied").GetBoolean(),
            root.GetProperty("satisfied").GetBoolean()
                ? "✓ The value satisfies the equation (residual 0)."
                : $"✗ The value does not satisfy the equation (residual {GetStr(root, "residual")})."),
        "solve" => (true, "SymPy solved independently: " + DescribeSolutions(root)),
        _ => (true, "SymPy result: " + (root.TryGetProperty("result", out var r) ? r.ToString() : root.GetRawText()))
    };

    private static string DescribeSolutions(JsonElement root)
    {
        if (!root.TryGetProperty("solutions", out var arr)) return root.GetRawText();
        var parts = new List<string>();
        foreach (var s in arr.EnumerateArray())
            parts.Add(GetStr(s, "sympy"));
        return string.Join(", ", parts);
    }

    private static string GetStr(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ToString()) : "";

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_proc is { HasExited: false } && _stdin is not null)
            {
                await _stdin.WriteLineAsync("{\"op\":\"shutdown\"}").ConfigureAwait(false);
                await _stdin.FlushAsync().ConfigureAwait(false);
                if (!_proc.WaitForExit(1500)) _proc.Kill(entireProcessTree: true);
            }
        }
        catch { /* best effort */ }
        finally { _proc?.Dispose(); _gate.Dispose(); }
    }
}
