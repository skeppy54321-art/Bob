using System.Text.Json.Serialization;

namespace MathAssistant.Models;

/// <summary>Which AI backend to use.</summary>
public enum AiProviderKind
{
    Claude,
    OpenAI,
    Ollama
}

/// <summary>A single turn in the chat transcript.</summary>
public sealed class ChatMessage
{
    public string Role { get; set; } = "user";      // "user" | "assistant" | "system"
    public string Text { get; set; } = "";
    public string? ImagePath { get; set; }           // optional attached image
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.Now;

    [JsonIgnore] public bool IsUser => Role == "user";
    [JsonIgnore] public bool IsAssistant => Role == "assistant";
}

/// <summary>Persisted history record (one solved problem).</summary>
public sealed class HistoryEntry
{
    public long Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
    public string Question { get; set; } = "";
    public string? ImagePath { get; set; }
    public string ProviderModel { get; set; } = "";
    public string AnswerMarkdown { get; set; } = "";
    public string? VerificationSummary { get; set; }
    public string Topic { get; set; } = "general";
}

/// <summary>
/// The structured object we ask the AI to return. Keeping the model's output
/// structured lets us pull out the final answer and hand it to the SymPy engine
/// for an independent check.
/// </summary>
public sealed class AiSolution
{
    [JsonPropertyName("topic")] public string Topic { get; set; } = "general";
    [JsonPropertyName("restated_problem")] public string RestatedProblem { get; set; } = "";
    [JsonPropertyName("steps")] public List<string> Steps { get; set; } = new();
    [JsonPropertyName("final_answer")] public string FinalAnswer { get; set; } = "";

    /// <summary>
    /// A machine-checkable form of the result, when one exists, e.g.
    /// {"check":"solve","expr":"x^2-5x+6=0"} or {"check":"verify","candidate":"...","reference":"..."}.
    /// Optional - the model omits it for word problems with no clean symbolic form.
    /// </summary>
    [JsonPropertyName("verification")] public VerificationRequest? Verification { get; set; }
}

public sealed class VerificationRequest
{
    [JsonPropertyName("check")] public string Check { get; set; } = "";     // engine op name
    [JsonPropertyName("expr")] public string? Expr { get; set; }
    [JsonPropertyName("value")] public string? Value { get; set; }
    [JsonPropertyName("candidate")] public string? Candidate { get; set; }
    [JsonPropertyName("reference")] public string? Reference { get; set; }
    [JsonPropertyName("var")] public string? Var { get; set; }
}

/// <summary>Result of running the independent SymPy verification.</summary>
public sealed class VerificationResult
{
    public bool Ran { get; set; }
    public bool Passed { get; set; }
    public string Summary { get; set; } = "";
    public string RawJson { get; set; } = "";
}
