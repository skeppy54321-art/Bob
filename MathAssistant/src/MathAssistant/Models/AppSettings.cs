using System.Text.Json.Serialization;

namespace MathAssistant.Models;

/// <summary>
/// User configuration. API keys are stored encrypted with Windows DPAPI
/// (see <see cref="Services.SettingsStore"/>), never in plaintext on disk.
/// </summary>
public sealed class AppSettings
{
    public AiProviderKind Provider { get; set; } = AiProviderKind.Ollama;

    // Per-provider model names.
    public string ClaudeModel { get; set; } = "claude-opus-5-5";
    public string OpenAiModel { get; set; } = "gpt-4o";
    public string OllamaModel { get; set; } = "llama3.1";

    // Endpoints (overridable for proxies / self-hosting).
    public string ClaudeBaseUrl { get; set; } = "https://api.anthropic.com";
    public string OpenAiBaseUrl { get; set; } = "https://api.openai.com";
    public string OllamaBaseUrl { get; set; } = "http://localhost:11434";

    // Encrypted (DPAPI, base64) API keys. Empty when unset.
    public string ClaudeApiKeyProtected { get; set; } = "";
    public string OpenAiApiKeyProtected { get; set; } = "";

    // Behaviour
    public bool PracticeMode { get; set; } = false;   // hints before answers
    public bool AutoVerify { get; set; } = true;      // run SymPy check automatically
    public int MaxImageEdgePixels { get; set; } = 1600;

    // Path to the Python executable used to run the math engine.
    public string PythonPath { get; set; } = "python";

    [JsonIgnore]
    public string ActiveModel => Provider switch
    {
        AiProviderKind.Claude => ClaudeModel,
        AiProviderKind.OpenAI => OpenAiModel,
        _ => OllamaModel
    };
}
