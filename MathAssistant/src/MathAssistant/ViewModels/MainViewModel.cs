using System.Collections.ObjectModel;
using System.IO;
using System.Net.Http;
using System.Text;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MathAssistant.Models;
using MathAssistant.Services;

namespace MathAssistant.ViewModels;

/// <summary>
/// Main window view model. Owns the chat transcript, the current attachment,
/// the history list, and the commands that drive solving and settings.
/// </summary>
public sealed partial class MainViewModel : ObservableObject, IAsyncDisposable
{
    private readonly SettingsStore _settingsStore = new();
    private readonly HistoryStore _history = new();
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(3) };
    // Rebuilt when the relevant settings change (see OpenSettingsAsync).
    private MathEngineClient _engine = null!;
    private MathTutorService _tutor = null!;
    private ImageImportService _images = null!;
    private string _engineDir = "";

    private byte[]? _attachedImage;
    private string _attachedMediaType = "image/png";

    public AppSettings Settings { get; private set; }
    public ObservableCollection<ChatMessage> Messages { get; } = new();
    public ObservableCollection<HistoryEntry> History { get; } = new();

    [ObservableProperty] private string _inputText = "";
    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private string _statusText = "";
    [ObservableProperty] private string? _attachmentName;
    [ObservableProperty] private bool _practiceMode;

    public MainViewModel()
    {
        Settings = _settingsStore.Load();
        PracticeMode = Settings.PracticeMode;

        _engineDir = Path.Combine(AppContext.BaseDirectory, "math-engine");
        _engine = new MathEngineClient(Settings.PythonPath, _engineDir);
        _tutor = new MathTutorService(_engine);
        _images = new ImageImportService(Settings.MaxImageEdgePixels);

        RefreshStatus();
        LoadHistory();
        Messages.Add(new ChatMessage
        {
            Role = "assistant",
            Text = "Hi! Paste or attach a math problem (image, screenshot, or PDF page), "
                 + "or just type it. I'll explain it step by step and double-check the answer with SymPy."
        });
    }

    partial void OnPracticeModeChanged(bool value)
    {
        Settings.PracticeMode = value;
        _settingsStore.Save(Settings);
        RefreshStatus();
    }

    private void RefreshStatus() =>
        StatusText = $"{Settings.Provider} · {Settings.ActiveModel}" +
                     (PracticeMode ? " · Practice mode (hints only)" : "") +
                     (Settings.AutoVerify ? " · auto-verify on" : "");

    private void LoadHistory()
    {
        History.Clear();
        foreach (var h in _history.GetRecent()) History.Add(h);
    }

    // ---- Commands ----------------------------------------------------------

    [RelayCommand(CanExecute = nameof(CanSend))]
    private async Task SendAsync()
    {
        var text = InputText.Trim();
        if (string.IsNullOrEmpty(text) && _attachedImage is null) return;

        IsBusy = true;
        SendCommand.NotifyCanExecuteChanged();
        var userMsg = new ChatMessage { Role = "user", Text = text, ImagePath = AttachmentName };
        Messages.Add(userMsg);
        InputText = "";

        try
        {
            var provider = AiProviderFactory.Create(Settings, _http);
            var (solution, verification, markdown) = await _tutor.SolveAsync(
                provider, Settings, text, _attachedImage, _attachedMediaType);

            Messages.Add(new ChatMessage { Role = "assistant", Text = markdown });

            if (!PracticeMode)
            {
                var entry = new HistoryEntry
                {
                    Question = string.IsNullOrWhiteSpace(text) ? "(image problem)" : text,
                    ImagePath = AttachmentName,
                    ProviderModel = $"{Settings.Provider}/{Settings.ActiveModel}",
                    AnswerMarkdown = markdown,
                    VerificationSummary = verification.Ran ? verification.Summary : null,
                    Topic = solution.Topic
                };
                _history.Add(entry);
                LoadHistory();
            }
        }
        catch (Exception ex)
        {
            Messages.Add(new ChatMessage { Role = "assistant", Text = $"⚠️ {ex.Message}" });
        }
        finally
        {
            ClearAttachment();
            IsBusy = false;
            SendCommand.NotifyCanExecuteChanged();
        }
    }

    private bool CanSend() => !IsBusy;

    [RelayCommand]
    private void AttachImage()
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Attach a math problem",
            Filter = "Images and PDFs|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.pdf|All files|*.*"
        };
        if (dlg.ShowDialog() != true) return;
        try
        {
            var (png, media) = _images.FromFile(dlg.FileName);
            _attachedImage = png; _attachedMediaType = media;
            AttachmentName = Path.GetFileName(dlg.FileName);
        }
        catch (Exception ex)
        {
            Messages.Add(new ChatMessage { Role = "assistant", Text = $"⚠️ Could not load image: {ex.Message}" });
        }
    }

    [RelayCommand]
    private void PasteImage()
    {
        try
        {
            var png = _images.FromClipboard();
            if (png is null)
            {
                StatusText = "No image on the clipboard.";
                RefreshStatusLater();
                return;
            }
            _attachedImage = png; _attachedMediaType = "image/png";
            AttachmentName = "(pasted screenshot)";
        }
        catch (Exception ex)
        {
            Messages.Add(new ChatMessage { Role = "assistant", Text = $"⚠️ Paste failed: {ex.Message}" });
        }
    }

    [RelayCommand]
    private void ClearAttachmentCmd() => ClearAttachment();

    private void ClearAttachment()
    {
        _attachedImage = null;
        AttachmentName = null;
    }

    [RelayCommand]
    private async Task OpenSettingsAsync()
    {
        var oldPython = Settings.PythonPath;
        var oldEdge = Settings.MaxImageEdgePixels;

        // The dialog edits a copy, so Cancel leaves the live settings untouched.
        var working = _settingsStore.Load();
        var win = new Views.SettingsWindow(working, _settingsStore) { Owner = System.Windows.Application.Current.MainWindow };
        if (win.ShowDialog() != true) return;

        Settings = working;
        PracticeMode = Settings.PracticeMode;

        if (Settings.MaxImageEdgePixels != oldEdge)
            _images = new ImageImportService(Settings.MaxImageEdgePixels);

        if (!string.Equals(Settings.PythonPath, oldPython, StringComparison.Ordinal))
        {
            // Restart the engine with the new interpreter.
            var old = _engine;
            _engine = new MathEngineClient(Settings.PythonPath, _engineDir);
            _tutor = new MathTutorService(_engine);
            await old.DisposeAsync();
        }
        RefreshStatus();
    }

    [RelayCommand]
    private void ClearHistory()
    {
        _history.Clear();
        LoadHistory();
    }

    [RelayCommand]
    private void CopyMessage(ChatMessage? msg)
    {
        if (msg is null) return;
        try
        {
            System.Windows.Clipboard.SetText(msg.Text);
            StatusText = "Copied to clipboard.";
        }
        catch (Exception ex)
        {
            StatusText = "Copy failed: " + ex.Message;
        }
        RefreshStatusLater();
    }

    [RelayCommand]
    private void ExportHistory()
    {
        var entries = _history.GetRecent(int.MaxValue);
        if (entries.Count == 0)
        {
            StatusText = "No history to export.";
            RefreshStatusLater();
            return;
        }

        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Export history",
            FileName = $"math-history-{DateTime.Now:yyyyMMdd-HHmm}",
            Filter = "Markdown (*.md)|*.md|JSON (*.json)|*.json"
        };
        if (dlg.ShowDialog() != true) return;

        try
        {
            if (dlg.FileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            {
                var json = System.Text.Json.JsonSerializer.Serialize(entries,
                    new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(dlg.FileName, json);
            }
            else
            {
                var sb = new StringBuilder();
                sb.AppendLine("# AI Mathematics Assistant — history").AppendLine();
                foreach (var e in entries)
                {
                    sb.AppendLine($"## {e.CreatedAt:g} · {e.Topic}");
                    sb.AppendLine($"**Q:** {e.Question}");
                    if (!string.IsNullOrEmpty(e.ImagePath)) sb.AppendLine($"_attachment: {e.ImagePath}_");
                    sb.AppendLine($"_model: {e.ProviderModel}_").AppendLine();
                    sb.AppendLine(e.AnswerMarkdown).AppendLine();
                    if (!string.IsNullOrWhiteSpace(e.VerificationSummary))
                        sb.AppendLine($"> {e.VerificationSummary}").AppendLine();
                    sb.AppendLine("---").AppendLine();
                }
                File.WriteAllText(dlg.FileName, sb.ToString());
            }
            StatusText = $"Exported {entries.Count} entries.";
        }
        catch (Exception ex)
        {
            Messages.Add(new ChatMessage { Role = "assistant", Text = $"⚠️ Export failed: {ex.Message}" });
        }
        RefreshStatusLater();
    }

    [RelayCommand]
    private void LoadHistoryEntry(HistoryEntry? entry)
    {
        if (entry is null) return;
        Messages.Add(new ChatMessage { Role = "user", Text = entry.Question });
        Messages.Add(new ChatMessage { Role = "assistant", Text = entry.AnswerMarkdown });
    }

    private async void RefreshStatusLater()
    {
        await Task.Delay(2500);
        RefreshStatus();
    }

    public async ValueTask DisposeAsync()
    {
        _http.Dispose();
        await _engine.DisposeAsync();
    }
}
