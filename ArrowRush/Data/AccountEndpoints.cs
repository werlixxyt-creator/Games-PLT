using System.Security.Claims;
using ArrowRush.Game;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Data;

/// <summary>
/// HTTP API аккаунта: /api/account/register, login, logout, me.
/// Вход хранится в защищённой HttpOnly-cookie, её же автоматически видит SignalR.
/// </summary>
public static class AccountEndpoints
{
    public const int MinNameLength = 3;
    public const int MaxNameLength = 16;
    public const int MinPasswordLength = 6;
    public const int MaxPasswordLength = 64;

    public sealed record Credentials(string? UserName, string? Password);
    public sealed record SkinChoice(string? Slot, string? Id);

    public static void MapAccount(this WebApplication app)
    {
        var api = app.MapGroup("/api/account");
        api.MapPost("/register", Register);
        api.MapPost("/login", Login);
        api.MapPost("/logout", Logout);
        api.MapGet("/me", Me).RequireAuthorization();
        api.MapPost("/skin", SetSkin).RequireAuthorization();
    }

    private static async Task<IResult> Register(Credentials body, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var name = (body.UserName ?? "").Trim();
        var password = body.Password ?? "";

        if (ValidateName(name) is { } nameError) return Error(nameError);
        if (password.Length > MaxPasswordLength) return Error($"Пароль не длиннее {MaxPasswordLength} символов");

        var user = new AppUser { UserName = name, CreatedAt = DateTime.UtcNow };
        var result = await users.CreateAsync(user, password);
        if (!result.Succeeded) return Error(Translate(result.Errors.First()));

        await signIn.SignInAsync(user, isPersistent: true);
        return Results.Ok(new { userName = user.UserName });
    }

    private static async Task<IResult> Login(Credentials body, SignInManager<AppUser> signIn)
    {
        var name = (body.UserName ?? "").Trim();
        var password = body.Password ?? "";
        if (name.Length == 0 || password.Length == 0 || password.Length > MaxPasswordLength)
            return Error("Введи ник и пароль");

        var result = await signIn.PasswordSignInAsync(name, password, isPersistent: true, lockoutOnFailure: true);
        if (result.IsLockedOut) return Error("Слишком много неудачных попыток. Попробуй через 5 минут.", 429);
        if (!result.Succeeded) return Error("Неверный ник или пароль", 401);

        return Results.Ok();
    }

    private static async Task<IResult> Logout(SignInManager<AppUser> signIn)
    {
        await signIn.SignOutAsync();
        return Results.Ok();
    }

    /// <summary>Профиль: ник, статистика и последние матчи.</summary>
    private static async Task<IResult> Me(ClaimsPrincipal principal, AppDb db)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = userId is null ? null : await db.Users.FindAsync(userId);
        if (user is null) return Results.Unauthorized();

        var mine = db.MatchParticipants.Where(p => p.UserId == userId);

        var byMode = await mine
            .GroupBy(p => new { p.Match.Mode, p.Match.Fast })
            .Select(g => new
            {
                g.Key.Mode,
                g.Key.Fast,
                Games = g.Count(),
                Wins = g.Count(p => p.Place == 1 && p.FinishTime != null),
                Sliders = g.Sum(p => p.Sliders),
            })
            .ToListAsync();

        var recent = await mine
            .OrderByDescending(p => p.MatchRecordId)
            .Take(10)
            .Select(p => new
            {
                p.Match.Mode,
                p.Match.Fast,
                p.Match.Difficulty,
                p.Match.PlayedAt,
                p.Place,
                Players = p.Match.Participants.Count,
                p.FinishTime,
                p.Sliders,
                Total = p.Match.SliderCount,
                p.Left,
            })
            .ToListAsync();

        var achievements = await LoadAchievementsAsync(db, userId!);

        return Results.Ok(new
        {
            userName = user.UserName,
            streak = new { current = achievements.Streak, best = achievements.BestStreak },
            skins = Skins.All.Select(s => new
            {
                slot = s.Slot,
                id = s.Id,
                name = s.Name,
                by = s.By.ToString().ToLowerInvariant(),
                need = s.Need,
                have = achievements.Value(s.By),
                unlocked = achievements.Has(s),
            }),
            equipped = new Dictionary<string, string>
            {
                [Skins.Slider] = Skins.Equipped(Skins.Slider, user.SliderSkin),
                [Skins.Win] = Skins.Equipped(Skins.Win, user.WinSkin),
                [Skins.StreakSlot] = Skins.Equipped(Skins.StreakSlot, user.StreakSkin),
            },
            // { classic: { normal: {games, wins, sliders}, fast: {...} }, mirror: {...} } — нули, если ещё не играл
            stats = Enum.GetValues<GameMode>().ToDictionary(
                m => m.ToWire(),
                m => new[] { false, true }.ToDictionary(
                    fast => fast ? "fast" : "normal",
                    fast => byMode.FirstOrDefault(s => s.Mode == m && s.Fast == fast) is { } s
                        ? new { games = s.Games, wins = s.Wins, sliders = s.Sliders }
                        : new { games = 0, wins = 0, sliders = 0 })),
            recent = recent.Select(r => new
            {
                mode = r.Mode.ToWire(),
                fast = r.Fast,
                difficulty = r.Difficulty.ToWire(),
                // SQLite теряет пометку UTC — возвращаем её, чтобы браузер показал местное время
                playedAt = DateTime.SpecifyKind(r.PlayedAt, DateTimeKind.Utc),
                place = r.Place,
                players = r.Players,
                time = r.FinishTime,
                sliders = r.Sliders,
                total = r.Total,
                left = r.Left,
            }),
        });
    }

    /// <summary>Надеть скин — только открытый.</summary>
    private static async Task<IResult> SetSkin(SkinChoice body, ClaimsPrincipal principal, AppDb db)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = userId is null ? null : await db.Users.FindAsync(userId);
        if (user is null) return Results.Unauthorized();

        var skin = Skins.Find(body.Slot, body.Id);
        if (skin is null) return Error("Нет такого скина");
        if (!(await LoadAchievementsAsync(db, userId!)).Has(skin)) return Error("Этот скин ещё не открыт");

        switch (skin.Slot)
        {
            case Skins.Slider: user.SliderSkin = skin.Id; break;
            case Skins.Win: user.WinSkin = skin.Id; break;
            case Skins.StreakSlot: user.StreakSkin = skin.Id; break;
        }
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    /// <summary>Итоги по всем режимам и серии побед подряд (текущая и лучшая).</summary>
    private static async Task<Achievements> LoadAchievementsAsync(AppDb db, string userId)
    {
        var results = await db.MatchParticipants
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.MatchRecordId)
            .Select(p => new { Win = p.Place == 1 && p.FinishTime != null, p.Sliders })
            .ToListAsync();

        int streak = 0, best = 0;
        foreach (var r in results)
        {
            streak = r.Win ? streak + 1 : 0;
            best = Math.Max(best, streak);
        }

        return new Achievements(results.Count, results.Count(r => r.Win), results.Sum(r => r.Sliders), streak, best);
    }

    private static string? ValidateName(string name)
    {
        if (name.Length < MinNameLength || name.Length > MaxNameLength)
            return $"Ник — от {MinNameLength} до {MaxNameLength} символов";
        if (!name.All(c => char.IsLetterOrDigit(c) || c is '_' or '-' or '.'))
            return "В нике можно использовать только буквы, цифры, «_», «-» и «.»";
        if (name.StartsWith("бот", StringComparison.OrdinalIgnoreCase) || name.StartsWith("bot", StringComparison.OrdinalIgnoreCase))
            return "Ник не может начинаться с «бот»";
        return null;
    }

    private static string Translate(IdentityError e) => e.Code switch
    {
        nameof(IdentityErrorDescriber.DuplicateUserName) => "Этот ник уже занят",
        nameof(IdentityErrorDescriber.InvalidUserName) => "Недопустимый ник",
        nameof(IdentityErrorDescriber.PasswordTooShort) => $"Пароль должен быть не короче {MinPasswordLength} символов",
        _ => e.Description,
    };

    private static IResult Error(string message, int status = 400) =>
        Results.Json(new { error = message }, statusCode: status);
}
