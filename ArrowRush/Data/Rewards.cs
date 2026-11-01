using System.Globalization;
using System.Security.Claims;
using ArrowRush.Game;
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
    /// <summary>Сколько раз дошёл до конца уровня.</summary>
    Finishes,
    FastGames,
    HardGames,
    TeamGames,
    MirrorGames,
    BlindGames,
}

/// <summary>Задание: за Need единиц цели в текущем периоде дают Stars звёзд.</summary>
public sealed record RewardTask(string Id, bool Weekly, string Name, RewardGoal Goal, int Need, int Stars);

/// <summary>
/// Ежедневные и еженедельные награды. Каждый день и каждую неделю из общего списка выбираются новые задания,
/// у всех игроков одинаковые. Прогресс считается по сохранённым матчам периода, поэтому отдельно не хранится
/// (тренировки в базу не попадают, матчи, из которых игрок вышел, не считаются). Хранятся только полученные награды.
/// Звёзды копятся и не тратятся: их сумма открывает скины (<see cref="Unlock.Stars"/>).
/// </summary>
public static class Rewards
{
    /// <summary>Сутки и неделя (с понедельника) считаются по московскому времени.</summary>
    public static readonly TimeSpan ResetOffset = TimeSpan.FromHours(3);

    /// <summary>Сколько случайных заданий выбирается на день (кроме «Зайди в игру») и на неделю.</summary>
    public const int DailyPicks = 3;
    public const int WeeklyPicks = 3;

    /// <summary>Есть каждый день.</summary>
    public static readonly RewardTask Visit = new("daily-visit", false, "Зайди в игру", RewardGoal.Visit, 1, 10);

    public static readonly RewardTask[] Pool =
    [
        new("daily-games", false, "Сыграй 3 матча", RewardGoal.Games, 3, 20),
        new("daily-win", false, "Выиграй матч", RewardGoal.Wins, 1, 20),
        new("daily-wins2", false, "Выиграй 2 матча", RewardGoal.Wins, 2, 35),
        new("daily-sliders", false, "Заполни 150 ползунков", RewardGoal.Sliders, 150, 20),
        new("daily-finish", false, "Дойди до конца уровня 2 раза", RewardGoal.Finishes, 2, 25),
        new("daily-fast", false, "Сыграй 2 матча в быстром темпе", RewardGoal.FastGames, 2, 25),
        new("daily-hard", false, "Сыграй матч на сложной", RewardGoal.HardGames, 1, 30),
        new("daily-team", false, "Сыграй командный матч", RewardGoal.TeamGames, 1, 25),
        new("daily-mirror", false, "Сыграй в «Зеркале»", RewardGoal.MirrorGames, 1, 25),
        new("daily-blind", false, "Сыграй «Вслепую»", RewardGoal.BlindGames, 1, 25),

        new("weekly-games", true, "Сыграй 15 матчей", RewardGoal.Games, 15, 100),
        new("weekly-wins", true, "Выиграй 7 матчей", RewardGoal.Wins, 7, 100),
        new("weekly-wins15", true, "Выиграй 15 матчей", RewardGoal.Wins, 15, 160),
        new("weekly-sliders", true, "Заполни 500 ползунков", RewardGoal.Sliders, 500, 80),
        new("weekly-sliders2", true, "Заполни 1500 ползунков", RewardGoal.Sliders, 1500, 140),
        new("weekly-finish", true, "Дойди до конца уровня 10 раз", RewardGoal.Finishes, 10, 90),
        new("weekly-fast", true, "Сыграй 8 матчей в быстром темпе", RewardGoal.FastGames, 8, 90),
        new("weekly-hard", true, "Сыграй 5 матчей на сложной", RewardGoal.HardGames, 5, 110),
        new("weekly-team", true, "Сыграй 5 командных матчей", RewardGoal.TeamGames, 5, 100),
    ];

    private sealed record Played(bool Won, int Sliders, bool Finished, bool Fast, Difficulty Difficulty, GameMode Mode);

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
    public static string PeriodKey(DateTime start) =>
        (start + ResetOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Задания периода: выбор зависит только от его номера, поэтому он один у всех и не меняется до сброса.</summary>
    public static List<RewardTask> TasksOf(bool weekly, string key)
    {
        var rnd = new Random(int.Parse(key.Replace("-", ""), CultureInfo.InvariantCulture) + (weekly ? 1 : 0));
        var picked = Pool.Where(t => t.Weekly == weekly)
            .OrderBy(_ => rnd.Next())
            .DistinctBy(t => t.Goal) // чтобы не выпали «Выиграй матч» и «Выиграй 2 матча» разом
            .Take(weekly ? WeeklyPicks : DailyPicks);
        return (weekly ? picked : picked.Prepend(Visit)).ToList();
    }

    private static Task<List<Played>> LoadPlayedAsync(AppDb db, string userId, DateTime start) => db.MatchParticipants
        .Where(p => p.UserId == userId && !p.Left && p.Match.PlayedAt >= start)
        .Select(p => new Played(p.Won, p.Sliders, p.FinishTime != null, p.Match.Fast, p.Match.Difficulty, p.Match.Mode))
        .ToListAsync();

    private static int Progress(RewardTask task, List<Played> played) => task.Goal switch
    {
        RewardGoal.Visit => 1,
        RewardGoal.Games => played.Count,
        RewardGoal.Wins => played.Count(p => p.Won),
        RewardGoal.Sliders => played.Sum(p => p.Sliders),
        RewardGoal.Finishes => played.Count(p => p.Finished),
        RewardGoal.FastGames => played.Count(p => p.Fast),
        RewardGoal.HardGames => played.Count(p => p.Difficulty == Difficulty.Hard),
        RewardGoal.TeamGames => played.Count(p => p.Mode.Rules().Teams),
        RewardGoal.MirrorGames => played.Count(p => p.Mode == GameMode.Mirror),
        RewardGoal.BlindGames => played.Count(p => p.Mode == GameMode.Blind),
        _ => 0,
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
                tasks = TasksOf(weekly, key).Select(t => new
                {
                    id = t.Id,
                    name = t.Name,
                    goal = t.Goal.ToString().ToLowerInvariant(),
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

    /// <summary>Забрать награду за выполненное задание текущего периода, один раз.</summary>
    private static async Task<IResult> Claim(ClaimBody body, ClaimsPrincipal principal, AppDb db)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var now = DateTime.UtcNow;

        var known = body.Id == Visit.Id ? Visit : Pool.FirstOrDefault(t => t.Id == body.Id);
        if (known is null) return AccountEndpoints.Error("Нет такого задания");

        var start = PeriodStart(known.Weekly, now);
        var key = PeriodKey(start);
        if (!TasksOf(known.Weekly, key).Contains(known)) return AccountEndpoints.Error("Задание уже сменилось");

        if (await db.RewardClaims.AnyAsync(c => c.UserId == userId && c.TaskId == known.Id && c.Period == key))
            return AccountEndpoints.Error("Награда уже получена");
        if (Progress(known, await LoadPlayedAsync(db, userId, start)) < known.Need)
            return AccountEndpoints.Error("Задание ещё не выполнено");

        db.RewardClaims.Add(new RewardClaim { UserId = userId, TaskId = known.Id, Period = key, Stars = known.Stars, ClaimedAt = now });
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
