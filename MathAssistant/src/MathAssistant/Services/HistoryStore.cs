using System.IO;
using Microsoft.Data.Sqlite;
using MathAssistant.Models;

namespace MathAssistant.Services;

/// <summary>
/// SQLite-backed store of solved problems, saved locally under
/// %APPDATA%\MathAssistant\history.db. Everything stays on the user's machine.
/// </summary>
public sealed class HistoryStore
{
    private readonly string _connString;

    public HistoryStore()
    {
        Directory.CreateDirectory(SettingsStore.AppDataDir);
        var dbPath = Path.Combine(SettingsStore.AppDataDir, "history.db");
        _connString = new SqliteConnectionStringBuilder { DataSource = dbPath }.ToString();
        Initialize();
    }

    private void Initialize()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS history (
                Id            INTEGER PRIMARY KEY AUTOINCREMENT,
                CreatedAt     TEXT NOT NULL,
                Question      TEXT NOT NULL,
                ImagePath     TEXT,
                ProviderModel TEXT NOT NULL,
                AnswerMarkdown TEXT NOT NULL,
                VerificationSummary TEXT,
                Topic         TEXT NOT NULL DEFAULT 'general'
            );
            CREATE INDEX IF NOT EXISTS ix_history_created ON history(CreatedAt DESC);
            """;
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_connString);
        c.Open();
        return c;
    }

    public long Add(HistoryEntry e)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO history (CreatedAt, Question, ImagePath, ProviderModel, AnswerMarkdown, VerificationSummary, Topic)
            VALUES ($created, $q, $img, $pm, $ans, $ver, $topic);
            """;
        cmd.Parameters.AddWithValue("$created", e.CreatedAt.ToString("o"));
        cmd.Parameters.AddWithValue("$q", e.Question);
        cmd.Parameters.AddWithValue("$img", (object?)e.ImagePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$pm", e.ProviderModel);
        cmd.Parameters.AddWithValue("$ans", e.AnswerMarkdown);
        cmd.Parameters.AddWithValue("$ver", (object?)e.VerificationSummary ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$topic", e.Topic);
        cmd.ExecuteNonQuery();

        using var idCmd = conn.CreateCommand();
        idCmd.CommandText = "SELECT last_insert_rowid();";
        return (long)(idCmd.ExecuteScalar() ?? 0L);
    }

    public IReadOnlyList<HistoryEntry> GetRecent(int limit = 200)
    {
        var list = new List<HistoryEntry>();
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT * FROM history ORDER BY CreatedAt DESC LIMIT $lim;";
        cmd.Parameters.AddWithValue("$lim", limit);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            list.Add(new HistoryEntry
            {
                Id = r.GetInt64(r.GetOrdinal("Id")),
                CreatedAt = DateTimeOffset.Parse(r.GetString(r.GetOrdinal("CreatedAt"))),
                Question = r.GetString(r.GetOrdinal("Question")),
                ImagePath = r["ImagePath"] as string,
                ProviderModel = r.GetString(r.GetOrdinal("ProviderModel")),
                AnswerMarkdown = r.GetString(r.GetOrdinal("AnswerMarkdown")),
                VerificationSummary = r["VerificationSummary"] as string,
                Topic = r.GetString(r.GetOrdinal("Topic")),
            });
        }
        return list;
    }

    public void Delete(long id)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM history WHERE Id = $id;";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void Clear()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM history;";
        cmd.ExecuteNonQuery();
    }
}
