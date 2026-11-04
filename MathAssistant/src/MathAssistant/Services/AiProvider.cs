using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MathAssistant.Models;

namespace MathAssistant.Services;

/// <summary>One message to send to a provider, optionally carrying an image.</summary>
public sealed record AiTurn(string Role, string Text, byte[]? ImageBytes = null, string ImageMediaType = "image/png");

public sealed class AiRequest
{
    public string Model { get; init; } = "";
    public string SystemPrompt { get; init; } = "";
    public List<AiTurn> Turns { get; init; } = new();
    public int MaxTokens { get; init; } = 2048;
}

public interface IAiProvider
{
    string Name { get; }
    Task<string> CompleteAsync(AiRequest request, CancellationToken ct = default);
}

/// <summary>Builds the configured provider from settings.</summary>
public static class AiProviderFactory
{
    public static IAiProvider Create(AppSettings s, HttpClient http) => s.Provider switch
    {
        AiProviderKind.Claude => new ClaudeProvider(http, s.ClaudeBaseUrl,
            SettingsStore.Unprotect(s.ClaudeApiKeyProtected)),
        AiProviderKind.OpenAI => new OpenAiProvider(http, s.OpenAiBaseUrl,
            SettingsStore.Unprotect(s.OpenAiApiKeyProtected)),
        _ => new OllamaProvider(http, s.OllamaBaseUrl),
    };
}

// ---------------------------------------------------------------------------
// Claude (Anthropic Messages API)
// ---------------------------------------------------------------------------
public sealed class ClaudeProvider : IAiProvider
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _apiKey;
    public string Name => "Claude";

    public ClaudeProvider(HttpClient http, string baseUrl, string apiKey)
    {
        _http = http; _baseUrl = baseUrl.TrimEnd('/'); _apiKey = apiKey;
    }

    public async Task<string> CompleteAsync(AiRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
            throw new InvalidOperationException("Claude API key is not set (Settings).");

        var messages = request.Turns.Select(t =>
        {
            var content = new List<object>();
            if (t.ImageBytes is not null)
                content.Add(new
                {
                    type = "image",
                    source = new { type = "base64", media_type = t.ImageMediaType, data = Convert.ToBase64String(t.ImageBytes) }
                });
            content.Add(new { type = "text", text = t.Text });
            return new { role = t.Role == "assistant" ? "assistant" : "user", content };
        }).ToArray();

        var body = new
        {
            model = request.Model,
            max_tokens = request.MaxTokens,
            system = request.SystemPrompt,
            messages
        };

        using var msg = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/v1/messages");
        msg.Headers.Add("x-api-key", _apiKey);
        msg.Headers.Add("anthropic-version", "2023-06-01");
        msg.Content = JsonBody(body);

        using var resp = await _http.SendAsync(msg, ct).ConfigureAwait(false);
        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Claude API {(int)resp.StatusCode}: {json}");

        using var doc = JsonDocument.Parse(json);
        var sb = new StringBuilder();
        foreach (var block in doc.RootElement.GetProperty("content").EnumerateArray())
            if (block.GetProperty("type").GetString() == "text")
                sb.Append(block.GetProperty("text").GetString());
        return sb.ToString();
    }

    private static StringContent JsonBody(object o) =>
        new(JsonSerializer.Serialize(o), Encoding.UTF8, "application/json");
}

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions API)
// ---------------------------------------------------------------------------
public sealed class OpenAiProvider : IAiProvider
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _apiKey;
    public string Name => "OpenAI";

    public OpenAiProvider(HttpClient http, string baseUrl, string apiKey)
    {
        _http = http; _baseUrl = baseUrl.TrimEnd('/'); _apiKey = apiKey;
    }

    public async Task<string> CompleteAsync(AiRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
            throw new InvalidOperationException("OpenAI API key is not set (Settings).");

        var messages = new List<object> { new { role = "system", content = request.SystemPrompt } };
        foreach (var t in request.Turns)
        {
            if (t.ImageBytes is not null)
            {
                var dataUrl = $"data:{t.ImageMediaType};base64,{Convert.ToBase64String(t.ImageBytes)}";
                messages.Add(new
                {
                    role = t.Role,
                    content = new object[]
                    {
                        new { type = "text", text = t.Text },
                        new { type = "image_url", image_url = new { url = dataUrl } }
                    }
                });
            }
            else
            {
                messages.Add(new { role = t.Role, content = t.Text });
            }
        }

        // max_completion_tokens replaces the deprecated max_tokens; newer OpenAI
        // models reject max_tokens outright, while older ones accept both.
        var body = new { model = request.Model, max_completion_tokens = request.MaxTokens, messages };

        using var msg = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/v1/chat/completions");
        msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
        msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(msg, ct).ConfigureAwait(false);
        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"OpenAI API {(int)resp.StatusCode}: {json}");

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("choices")[0]
            .GetProperty("message").GetProperty("content").GetString() ?? "";
    }
}

// ---------------------------------------------------------------------------
// Ollama (local models) - no API key, runs on localhost
// ---------------------------------------------------------------------------
public sealed class OllamaProvider : IAiProvider
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    public string Name => "Ollama";

    public OllamaProvider(HttpClient http, string baseUrl)
    {
        _http = http; _baseUrl = baseUrl.TrimEnd('/');
    }

    public async Task<string> CompleteAsync(AiRequest request, CancellationToken ct = default)
    {
        var messages = new List<object> { new { role = "system", content = request.SystemPrompt } };
        foreach (var t in request.Turns)
        {
            if (t.ImageBytes is not null)
                messages.Add(new { role = t.Role, content = t.Text, images = new[] { Convert.ToBase64String(t.ImageBytes) } });
            else
                messages.Add(new { role = t.Role, content = t.Text });
        }

        var body = new { model = request.Model, messages, stream = false };

        using var msg = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/api/chat");
        msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(msg, ct).ConfigureAwait(false);
        var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException(
                $"Ollama {(int)resp.StatusCode}: {json}. Is 'ollama serve' running and the model pulled?");

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("message").GetProperty("content").GetString() ?? "";
    }
}
