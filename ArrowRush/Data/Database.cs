using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Npgsql;

namespace ArrowRush.Data;

public static class Database
{
    /// <summary>
    /// Есть переменная DATABASE_URL (Railway PostgreSQL) — работаем с PostgreSQL.
    /// Нет — локальный файл SQLite (arrowrush.db рядом с проектом).
    /// </summary>
    public static void AddAppDatabase(this IServiceCollection services, IConfiguration config)
    {
        var url = Environment.GetEnvironmentVariable("DATABASE_URL");
        if (!string.IsNullOrEmpty(url))
        {
            services.AddDbContext<AppDb>(o => o.UseNpgsql(ToNpgsql(url)));
        }
        else
        {
            var sqlite = config.GetConnectionString("Sqlite") ?? "Data Source=arrowrush.db";
            services.AddDbContext<AppDb>(o => o.UseSqlite(sqlite));
        }
    }

    /// <summary>Создаёт таблицы, если базы ещё нет, и дописывает колонки, появившиеся позже.</summary>
    public static void EnsureDatabase(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>().Database;

        // на хостинге файл SQLite живёт внутри контейнера и пропадает при каждом деплое — вместе с аккаунтами
        if (!db.IsNpgsql() && !app.Environment.IsDevelopment())
            app.Logger.LogWarning("DATABASE_URL не задан: данные хранятся в SQLite внутри контейнера и сотрутся при следующем деплое. Подключи PostgreSQL.");
        db.EnsureCreated();

        // EnsureCreated не трогает уже существующие таблицы — новые колонки добавляем сами.
        // SQL подходит и для SQLite, и для PostgreSQL.
        AddColumnIfMissing(db, "Matches", "Mode", "INTEGER NOT NULL DEFAULT 0");
        AddColumnIfMissing(db, "Matches", "Fast", "BOOLEAN NOT NULL DEFAULT FALSE");
        // матчи до появления сложности считаем сыгранными на нормальной (1)
        AddColumnIfMissing(db, "Matches", "Difficulty", "INTEGER NOT NULL DEFAULT 1");
        // бывший режим «Скорость» (1) — теперь «Классика» в быстром темпе
        db.ExecuteSqlRaw("UPDATE \"Matches\" SET \"Mode\" = 0, \"Fast\" = TRUE WHERE \"Mode\" = 1");
        AddColumnIfMissing(db, "AspNetUsers", "SliderSkin", "TEXT NULL");
        AddColumnIfMissing(db, "AspNetUsers", "WinSkin", "TEXT NULL");
        AddColumnIfMissing(db, "AspNetUsers", "StreakSkin", "TEXT NULL");
    }

    /// <remarks>Имена — константы из кода, не пользовательский ввод.</remarks>
    private static void AddColumnIfMissing(DatabaseFacade db, string table, string column, string definition)
    {
        var probe = $"SELECT \"{column}\" FROM \"{table}\" LIMIT 1";
        var alter = $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition}";
        try
        {
            db.ExecuteSqlRaw(probe);
        }
        catch (DbException)
        {
            db.ExecuteSqlRaw(alter);
        }
    }

    /// <summary>
    /// postgresql://user:pass@host:port/db?sslmode=require → строка подключения Npgsql.
    /// sslmode из адреса учитывается: внешние базы (Neon, Supabase) без SSL не пускают.
    /// </summary>
    private static string ToNpgsql(string url)
    {
        if (!url.StartsWith("postgres", StringComparison.OrdinalIgnoreCase) || !url.Contains("://"))
            return url; // уже в формате "Host=...;Username=..."

        var uri = new Uri(url);
        var user = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.Trim('/'),
            Username = Uri.UnescapeDataString(user[0]),
            Password = user.Length > 1 ? Uri.UnescapeDataString(user[1]) : null,
        };

        var sslMode = uri.Query.TrimStart('?').Split('&')
            .Select(p => p.Split('=', 2))
            .FirstOrDefault(p => p.Length == 2 && p[0].Equals("sslmode", StringComparison.OrdinalIgnoreCase))?[1];
        if (sslMode is not null && Enum.TryParse<SslMode>(sslMode.Replace("-", ""), ignoreCase: true, out var mode))
            builder.SslMode = mode;

        return builder.ConnectionString;
    }
}
