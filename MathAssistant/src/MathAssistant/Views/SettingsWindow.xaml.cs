using System.Globalization;
using System.Net.Http;
using System.Windows;
using MathAssistant.Models;
using MathAssistant.Services;

namespace MathAssistant.Views;

public partial class SettingsWindow : Window
{
    private readonly AppSettings _settings;
    private readonly SettingsStore _store;

    public SettingsWindow(AppSettings settings, SettingsStore store)
    {
        InitializeComponent();
        _settings = settings;
        _store = store;
        Populate();
        ProviderBox.SelectionChanged += (_, _) => OnProviderChanged();
    }

    private void Populate()
    {
        ProviderBox.SelectedIndex = _settings.Provider switch
        {
            AiProviderKind.Ollama => 0,
            AiProviderKind.Claude => 1,
            AiProviderKind.OpenAI => 2,
            _ => 0
        };
        OllamaUrlBox.Text = _settings.OllamaBaseUrl;
        ClaudeUrlBox.Text = _settings.ClaudeBaseUrl;
        OpenAiUrlBox.Text = _settings.OpenAiBaseUrl;
        PythonBox.Text = _settings.PythonPath;
        AutoVerifyBox.IsChecked = _settings.AutoVerify;
        MaxEdgeBox.Text = _settings.MaxImageEdgePixels.ToString(CultureInfo.InvariantCulture);
        OnProviderChanged();
    }

    private void OnProviderChanged()
    {
        ModelBox.Text = ProviderBox.SelectedIndex switch
        {
            1 => _settings.ClaudeModel,
            2 => _settings.OpenAiModel,
            _ => _settings.OllamaModel
        };
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        _settings.Provider = ProviderBox.SelectedIndex switch
        {
            1 => AiProviderKind.Claude,
            2 => AiProviderKind.OpenAI,
            _ => AiProviderKind.Ollama
        };

        switch (_settings.Provider)
        {
            case AiProviderKind.Claude: _settings.ClaudeModel = ModelBox.Text.Trim(); break;
            case AiProviderKind.OpenAI: _settings.OpenAiModel = ModelBox.Text.Trim(); break;
            default: _settings.OllamaModel = ModelBox.Text.Trim(); break;
        }

        _settings.OllamaBaseUrl = OllamaUrlBox.Text.Trim();
        _settings.ClaudeBaseUrl = ClaudeUrlBox.Text.Trim();
        _settings.OpenAiBaseUrl = OpenAiUrlBox.Text.Trim();
        _settings.PythonPath = string.IsNullOrWhiteSpace(PythonBox.Text) ? "python" : PythonBox.Text.Trim();
        _settings.AutoVerify = AutoVerifyBox.IsChecked == true;

        if (int.TryParse(MaxEdgeBox.Text, out var edge) && edge >= 256)
            _settings.MaxImageEdgePixels = edge;

        // Only overwrite keys when the user actually typed one.
        if (!string.IsNullOrEmpty(ClaudeKeyBox.Password))
            _settings.ClaudeApiKeyProtected = SettingsStore.Protect(ClaudeKeyBox.Password);
        if (!string.IsNullOrEmpty(OpenAiKeyBox.Password))
            _settings.OpenAiApiKeyProtected = SettingsStore.Protect(OpenAiKeyBox.Password);

        _store.Save(_settings);
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    /// <summary>Send a tiny request to the selected provider to confirm it works.</summary>
    private async void Test_Click(object sender, RoutedEventArgs e)
    {
        TestButton.IsEnabled = false;
        TestButton.Content = "Testing…";
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            IAiProvider provider = ProviderBox.SelectedIndex switch
            {
                1 => new ClaudeProvider(http, ClaudeUrlBox.Text.Trim(),
                        ResolveKey(ClaudeKeyBox.Password, _settings.ClaudeApiKeyProtected)),
                2 => new OpenAiProvider(http, OpenAiUrlBox.Text.Trim(),
                        ResolveKey(OpenAiKeyBox.Password, _settings.OpenAiApiKeyProtected)),
                _ => new OllamaProvider(http, OllamaUrlBox.Text.Trim())
            };
            var req = new AiRequest
            {
                Model = ModelBox.Text.Trim(),
                SystemPrompt = "Reply with exactly: OK",
                MaxTokens = 64,   // headroom for reasoning models that spend tokens before replying
                Turns = { new AiTurn("user", "ping") }
            };
            var reply = await provider.CompleteAsync(req);
            MessageBox.Show(this, $"Success — {provider.Name} replied:\n\n{reply}",
                "Connection OK", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Connection failed",
                MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            TestButton.IsEnabled = true;
            TestButton.Content = "Test connection";
        }
    }

    private static string ResolveKey(string typed, string storedProtected)
        => string.IsNullOrEmpty(typed) ? SettingsStore.Unprotect(storedProtected) : typed;
}
