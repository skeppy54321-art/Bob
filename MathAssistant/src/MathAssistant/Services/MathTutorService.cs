using System.Text;
using System.Text.Json;
using MathAssistant.Models;

namespace MathAssistant.Services;

/// <summary>
/// Ties the AI provider and the SymPy engine together into a tutoring flow:
///   1. Ask the model to solve, returning a STRUCTURED JSON solution.
///   2. Optionally run the model's own verification request through SymPy.
///   3. Format a readable, step-by-step answer (or just hints, in practice mode).
/// </summary>
public sealed class MathTutorService
{
    private readonly MathEngineClient _engine;

    public MathTutorService(MathEngineClient engine) => _engine = engine;

    private const string SolveSystemPrompt = """
        You are a careful mathematics tutor for a student using their own study
        materials. Solve the problem shown in the user's text and/or image.

        Respond with ONLY a single JSON object, no prose before or after, shaped:
        {
          "topic": "algebra|geometry|trigonometry|calculus|statistics|arithmetic|word-problem|other",
          "restated_problem": "the problem in clear terms",
          "steps": ["step 1 ...", "step 2 ...", "..."],
          "final_answer": "the final answer, concise",
          "verification": {
             "check": "solve|derivative|integral|limit|simplify|factor|expand|evaluate",
             "expr": "the ORIGINAL problem expression, e.g. x^2-5x+6=0 or x^3",
             "candidate": "YOUR final result, e.g. 2, 3 (all solutions, comma-separated) or 3x^2",
             "var": "x",
             "lower": "only for definite integrals",
             "upper": "only for definite integrals"
          }
        }
        The "verification" object is optional: include it only when the problem
        maps cleanly onto one of those checks. A separate computer algebra system
        will recompute the result from "expr" and compare it with "candidate".

        Write ALL math as plain text everywhere, including the steps: use ^ for
        powers, * for multiplication, sqrt(...), pi, and (a)/(b) for fractions.
        Never use LaTeX or backslashes. Do not include comments in the JSON.
        Show enough steps that a student can follow the reasoning.
        """;

    private const string HintSystemPrompt = """
        You are a Socratic mathematics tutor in PRACTICE MODE. The student wants to
        solve the problem themselves. Do NOT give the final answer or full solution.
        Respond with ONLY a JSON object shaped:
        {
          "topic": "...",
          "restated_problem": "...",
          "steps": ["hint 1 (what to notice / which method)", "hint 2 (next nudge)", "hint 3 (set-up, but stop before the answer)"],
          "final_answer": ""
        }
        Give at most three escalating hints and leave final_answer empty.
        """;

    public async Task<(AiSolution solution, VerificationResult verification, string markdown)>
        SolveAsync(IAiProvider provider, AppSettings settings, string questionText,
                   byte[]? imageBytes, string imageMediaType, CancellationToken ct = default)
    {
        var req = new AiRequest
        {
            Model = settings.ActiveModel,
            SystemPrompt = settings.PracticeMode ? HintSystemPrompt : SolveSystemPrompt,
            MaxTokens = 2048,
            Turns =
            {
                new AiTurn("user",
                    string.IsNullOrWhiteSpace(questionText)
                        ? "Solve the math problem in the attached image."
                        : questionText,
                    imageBytes, imageMediaType)
            }
        };

        var raw = await provider.CompleteAsync(req, ct).ConfigureAwait(false);
        var solution = ParseSolution(raw);

        var verification = new VerificationResult();
        if (!settings.PracticeMode && settings.AutoVerify && solution.Verification is { } vreq)
            verification = await _engine.VerifyAsync(vreq, ct).ConfigureAwait(false);

        var markdown = Format(solution, verification, settings.PracticeMode);
        return (solution, verification, markdown);
    }

    private static readonly JsonSerializerOptions LenientJson = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,  // models sometimes copy "// ..." comments
        AllowTrailingCommas = true,
    };

    /// <summary>Tolerant JSON extraction - models sometimes wrap JSON in prose/fences.</summary>
    internal static AiSolution ParseSolution(string raw)
    {
        var json = ExtractJsonObject(raw);
        if (json is not null)
        {
            // Try as-is, then once more with invalid escapes (e.g. a stray "\sqrt")
            // repaired by doubling the backslash.
            foreach (var candidate in new[] { json, RepairInvalidEscapes(json) })
            {
                try
                {
                    var sol = JsonSerializer.Deserialize<AiSolution>(candidate, LenientJson);
                    if (sol is not null && (sol.Steps.Count > 0 || !string.IsNullOrWhiteSpace(sol.FinalAnswer)))
                        return sol;
                }
                catch (JsonException) { /* try the next form */ }
            }
        }
        // Fallback: show whatever the model said.
        return new AiSolution { RestatedProblem = "", FinalAnswer = "", Steps = { raw.Trim() } };
    }

    /// <summary>
    /// Doubles any backslash that does not start a valid JSON escape sequence.
    /// Only invalid sequences are touched, so well-formed JSON is never changed.
    /// </summary>
    private static string RepairInvalidEscapes(string json) =>
        System.Text.RegularExpressions.Regex.Replace(json, @"\\(?![""\\/bfnrtu])", @"\\");

    private static string? ExtractJsonObject(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        int start = text.IndexOf('{');
        int end = text.LastIndexOf('}');
        if (start >= 0 && end > start) return text.Substring(start, end - start + 1);
        return null;
    }

    private static string Format(AiSolution s, VerificationResult v, bool practice)
    {
        var sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(s.RestatedProblem))
            sb.AppendLine($"**Problem.** {s.RestatedProblem}").AppendLine();

        if (practice)
        {
            sb.AppendLine("**Hints** (practice mode — try it yourself):").AppendLine();
            for (int i = 0; i < s.Steps.Count; i++)
                sb.AppendLine($"{i + 1}. {s.Steps[i]}");
            sb.AppendLine().AppendLine("_Ask to \"reveal the answer\" (turn off Practice Mode) when you're ready._");
            return sb.ToString();
        }

        if (s.Steps.Count > 0)
        {
            sb.AppendLine("**Solution.**").AppendLine();
            for (int i = 0; i < s.Steps.Count; i++)
                sb.AppendLine($"{i + 1}. {s.Steps[i]}");
            sb.AppendLine();
        }
        if (!string.IsNullOrWhiteSpace(s.FinalAnswer))
            sb.AppendLine($"**Answer.** {s.FinalAnswer}").AppendLine();

        if (v.Ran)
            sb.AppendLine($"> **Independent check (SymPy):** {v.Summary}");
        else if (!string.IsNullOrWhiteSpace(v.Summary))
            sb.AppendLine($"> _{v.Summary}_");
        else
            sb.AppendLine("> _Not independently checked (no symbolic form was provided, or auto-verify is off)._");

        return sb.ToString();
    }
}
