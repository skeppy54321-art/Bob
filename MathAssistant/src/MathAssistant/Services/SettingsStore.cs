using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MathAssistant.Models;

namespace MathAssistant.Services;

/// <summary>
/// Loads/saves <see cref="AppSettings"/> as JSON under %APPDATA%\MathAssistant.
/// API keys are encrypted with Windows DPAPI (CurrentUser scope): the ciphertext
/// can only be decrypted by the same Windows user on the same machine, so keys
/// never sit in plaintext in the settings file.
/// </summary>
public sealed class SettingsStore
{
    public static string AppDataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MathAssistant");

    private static readonly string SettingsPath = Path.Combine(AppDataDir, "settings.json");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MathAssistant.v1.dpapi");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };

    public AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsPath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(SettingsPath), JsonOpts)
                       ?? new AppSettings();
        }
        catch { /* fall through to defaults on any corruption */ }
        return new AppSettings();
    }

    public void Save(AppSettings settings)
    {
        Directory.CreateDirectory(AppDataDir);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, JsonOpts));
    }

    // ---- DPAPI helpers (Windows only) --------------------------------------

    public static string Protect(string plaintext)
    {
        if (string.IsNullOrEmpty(plaintext)) return "";
        byte[] data = Encoding.UTF8.GetBytes(plaintext);
        byte[] enc = ProtectedData.Protect(data, Entropy, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(enc);
    }

    public static string Unprotect(string protectedBase64)
    {
        if (string.IsNullOrEmpty(protectedBase64)) return "";
        try
        {
            byte[] enc = Convert.FromBase64String(protectedBase64);
            byte[] data = ProtectedData.Unprotect(enc, Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(data);
        }
        catch
        {
            return ""; // wrong user/machine, or tampering -> treat as unset
        }
    }
}
