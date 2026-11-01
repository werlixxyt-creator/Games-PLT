using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Data;

/// <summary>Что считает задание.</summary>
public enum RewardGoal
{
    /// <summary>Просто зайти в игру.</summary>
    Visit,
    Games,
    Wins,
    Sliders,
}

/// <summary>Задание: за Need единиц цели в текущем периоде дают Stars звёзд.</summary>
public sealed record RewardTask(string Id, bool Weekly, string Name, RewardGoal Goal, int Need, int Stars);

/// <summary>
/// Ежедневные и еженедельные награды. Прогресс считается по сохранённым матчам периода, поэтому отдельно не хранится
/// (тренировки в базу не попадают, матчи, из которых игрок вышел, не считаются). Хранятся только полученные награды.
/// Звёзды копятся и не тратятся: их сумма открывает скины (<see cref="Unlock.Stars"/>).
/// </summary>
public static class Rewards
{
    /// <summary>Сутки и неделя (с понедельника) считаются по московскому времени.</summary>
    public static readonly TimeSpan ResetOffset = TimeSpan.FromHours(3);

    public static readonly RewardTask[] All =
    [
        new("daily-visit", false, "Зайди в игру", RewardGoal.Visit, 1, 10),
        new("daily-games", false, "Сыграй 3 матча", RewardGoal.Games, 3, 20),
        new("daily-win", false, "Выиграй матч", RewardGoal.Wins, 1, 20),

        new("weekly-games", true, "Сыграй 15 матчей", RewardGoal.Games, 15, 100),
        new("weekly-wins", true, "Выиграй 7 матчей", RewardGoal.Wins, 7, 100),
        new("weekly-sliders", true, "Заполни 500 ползунков", RewardGoal.Sliders, 500, 80),
    ];

    public sealed record ClaimBody(string? Id);

    public static void MapRewards(this WebApplication app)
    {
        var api = app.MapGroup("/api/account/rewards").RequireAuthorization();
        api.MapGet("/", Load);
        api.MapPost("/claim", Claim);
    }

    /// <summary>Начало текущего периода в UTC.</summary>
    public static DateTime PeriodStart(bool weekly, DateTime utcNow)
    {
        var local = utcNow + ResetOffset;
        var start = local.Date;
        if (weekly) start = start.AddDays(-(((int)local.DayOfWeek + 6) % 7));
        return DateTime.SpecifyKind(start - ResetOffset, DateTimeKind.Utc);
    }

    /// <summary>Номер периода в базе — его первый день по московскому времени.</summary>
    private static string PeriodKey(DateTime start) =>
        (start + ResetOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Итоги игрока с начала периода: матчи, победы, ползунки.</summary>
    private static async Task<(int Games, int Wins, int Sliders)> LoadPlayedAsync(AppDb db, string userId, DateTime start)
    {
        var played = await db.MatchParticipants
            .Where(p => p.UserId == userId && !p.Left && p.Match.PlayedAt >= start)
            .Select(p => new { p.Won, p.Sliders })
            .ToListAsync();
        return (played.Count, played.Count(p => p.Won), played.Sum(p => p.Sliders));
    }

    private static int Progress(RewardTask task, (int Games, int Wins, int Sliders) played) => task.Goal switch
    {
        RewardGoal.Visit => 1,
        RewardGoal.Games => played.Games,
        RewardGoal.Wins => played.Wins,
        _ => played.Sliders,
    };

    private static async Task<IResult> Load(ClaimsPrincipal principal, AppDb db)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var now = DateTime.UtcNow;

        async Task<object> PeriodAsync(bool weekly)
        {
            var start = PeriodStart(weekly, now);
            var key = PeriodKey(start);
            var played = await LoadPlayedAsync(db, userId, start);
            var claimed = await db.RewardClaims.Where(c => c.UserId == userId && c.Period == key).Select(c => c.TaskId).ToListAsync();
            return new
            {
                resetsAt = start.AddDays(weekly ? 7 : 1),
                tasks = All.Where(t => t.Weekly == weekly).Select(t => new
                {
                    id = t.Id,
                    name = t.Name,
                    need = t.Need,
                    have = Progress(t, played),
                    stars = t.Stars,
                    claimed = claimed.Contains(t.Id),
                }).ToList(),
            };
        }

        return Results.Ok(new
        {
            stars = await db.RewardClaims.Where(c => c.UserId == userId).SumAsync(c => c.Stars),
            day = await PeriodAsync(false),
            week = await PeriodAsync(true),
        });
    }

    /// <summary>Забрать награду за выполненное задание, один раз за период.</summary>
    private static async Task<IResult> Claim(ClaimBody body, ClaimsPrincipal principal, AppDb db)
    {
        var task = All.FirstOrDefault(t => t.Id == body.Id);
        if (task is null) return AccountEndpoints.Error("Нет такого задания");

        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var now = DateTime.UtcNow;
        var start = PeriodStart(task.Weekly, now);
        var key = PeriodKey(start);

        if (await db.RewardClaims.AnyAsync(c => c.UserId == userId && c.TaskId == task.Id && c.Period == key))
            return AccountEndpoints.Error("Награда уже получена");
        if (Progress(task, await LoadPlayedAsync(db, userId, start)) < task.Need)
            return AccountEndpoints.Error("Задание ещё не выполнено");

        db.RewardClaims.Add(new RewardClaim { UserId = userId, TaskId = task.Id, Period = key, Stars = task.Stars, ClaimedAt = now });
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return AccountEndpoints.Error("Награда уже получена"); // двойное нажатие
        }
        return Results.Ok();
    }
}
