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
    public const int MaxAboutLength = 160;

    /// <summary>Цвета аватара на выбор; первый — по умолчанию.</summary>
    public static readonly string[] AvatarColors = ["#ff4f9a", "#22c7f0", "#7ee03a", "#ffb31f", "#a77bff", "#ff7a4d", "#2fd6a8", "#ffffff"];

    public sealed record Credentials(string? UserName, string? Password);
    public sealed record SkinChoice(string? Slot, string? Id);
    public sealed record ProfileEdit(string? UserName, string? About, string? Color);

    /// <summary>
    /// Итоги одного режима и темпа. Kills и Deaths — как в К/Д: сколько соперников игрок обошёл и сколько обошли его.
    /// Finishes — сколько раз дошёл до конца, Carries — сколько побед принёс своим финишем,
    /// BestRate — лучший темп на дошедшем до конца уровне, ползунков в секунду.
    /// </summary>
    public sealed record ModeStats(int Games, int Wins, int Sliders, int Kills, int Deaths, int Finishes, int Carries, double BestRate);

    public static void MapAccount(this WebApplication app)
    {
        var api = app.MapGroup("/api/account");
        api.MapPost("/register", Register);
        api.MapPost("/login", Login);
        api.MapPost("/logout", Logout);
        api.MapGet("/me", Me).RequireAuthorization();
        api.MapPost("/skin", SetSkin).RequireAuthorization();
        api.MapPost("/profile", EditProfile).RequireAuthorization();
    }

    /// <summary>Цвет аватара для показа: пусто или неизвестный — по умолчанию.</summary>
    public static string AvatarColor(string? stored) =>
        AvatarColors.Contains(stored) ? stored! : AvatarColors[0];

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

        var played = await mine
            .Select(p => new
            {
                p.Match.Mode,
                p.Match.Fast,
                p.Won,
                p.Place,
                p.FinishTime,
                p.Sliders,
                Players = p.Match.Participants.Count,
                AnyoneWon = p.Match.Participants.Any(o => o.Won),
            })
            .ToListAsync();

        var byMode = played
            .GroupBy(p => (p.Mode, p.Fast))
            .ToDictionary(g => g.Key, g =>
            {
                var duels = g.Select(p => p.Mode.Rules().Teams
                    // команды: победители обошли обоих соперников; если никто не финишировал, счёт не меняется
                    ? (Kills: p.Won ? p.Mode.Rules().TeamSize : 0, Deaths: p.AnyoneWon && !p.Won ? p.Mode.Rules().TeamSize : 0)
                    : (Kills: p.Players - p.Place, Deaths: p.Place - 1)).ToList();
                return new ModeStats(
                    g.Count(),
                    g.Count(p => p.Won),
                    g.Sum(p => p.Sliders),
                    duels.Sum(d => d.Kills),
                    duels.Sum(d => d.Deaths),
                    g.Count(p => p.FinishTime != null),
                    g.Count(p => p.Won && p.Place == 1 && p.FinishTime != null),
                    g.Where(p => p.FinishTime > 0).Select(p => p.Sliders / p.FinishTime!.Value).DefaultIfEmpty(0).Max());
            });

        var achievements = await LoadAchievementsAsync(db, userId!);

        return Results.Ok(new
        {
            userName = user.UserName,
            about = user.About,
            color = AvatarColor(user.AvatarColor),
            avatarColors = AvatarColors,
            // входящие заявки в друзья — значок на кнопке «Друзья»
            incoming = await db.Friendships.CountAsync(f => f.ToId == userId && !f.Accepted),
            streak =new { current = achievements.Streak, best = achievements.BestStreak },
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
                [Skins.Hero] = Skins.Equipped(Skins.Hero, user.HeroSkin),
                [Skins.Win] = Skins.Equipped(Skins.Win, user.WinSkin),
                [Skins.StreakSlot] = Skins.Equipped(Skins.StreakSlot, user.StreakSkin),
            },
            // { classic: { normal: ModeStats, fast: ModeStats }, mirror: {...} } — нули, если ещё не играл
            stats = Enum.GetValues<GameMode>().ToDictionary(
                m => m.ToWire(),
                m => new[] { false, true }.ToDictionary(
                    fast => fast ? "fast" : "normal",
                    fast => byMode.GetValueOrDefault((m, fast)) ?? new ModeStats(0, 0, 0, 0, 0, 0, 0, 0))),
            recent = await LoadRecentAsync(db, userId!, 10),
        });
    }

    /// <summary>Последние матчи игрока в том виде, в каком их показывает клиент.</summary>
    public static async Task<List<object>> LoadRecentAsync(AppDb db, string userId, int count)
    {
        var recent = await db.MatchParticipants
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.MatchRecordId)
            .Take(count)
            .Select(p => new
            {
                p.Match.Mode,
                p.Match.Fast,
                p.Match.Difficulty,
                p.Match.PlayedAt,
                p.Won,
                p.Place,
                Players = p.Match.Participants.Count,
                p.FinishTime,
                p.Sliders,
                Total = p.Match.SliderCount,
                p.Left,
            })
            .ToListAsync();

        return recent.Select(r => (object)new
        {
            mode = r.Mode.ToWire(),
            fast = r.Fast,
            difficulty = r.Difficulty.ToWire(),
            // SQLite теряет пометку UTC — возвращаем её, чтобы браузер показал местное время
            playedAt = DateTime.SpecifyKind(r.PlayedAt, DateTimeKind.Utc),
            won = r.Won,
            place = r.Place,
            players = r.Players,
            time = r.FinishTime,
            sliders = r.Sliders,
            total = r.Total,
            left = r.Left,
        }).ToList();
    }

    /// <summary>Правка своего профиля: ник, подпись и цвет аватара.</summary>
    private static async Task<IResult> EditProfile(ProfileEdit body, ClaimsPrincipal principal, UserManager<AppUser> users, SignInManager<AppUser> signIn)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return Results.Unauthorized();

        var name = (body.UserName ?? "").Trim();
        // подпись — одна строка: переносы и управляющие символы убираем
        var about = string.Concat((body.About ?? "").Where(c => !char.IsControl(c))).Trim();
        if (ValidateName(name) is { } nameError) return Error(nameError);
        if (about.Length > MaxAboutLength) return Error($"О себе — не длиннее {MaxAboutLength} символов");
        if (!AvatarColors.Contains(body.Color)) return Error("Нет такого цвета");

        user.About = about.Length > 0 ? about : null;
        user.AvatarColor = body.Color;

        var renamed = name != user.UserName;
        var result = renamed ? await users.SetUserNameAsync(user, name) : await users.UpdateAsync(user);
        if (!result.Succeeded) return Error(Translate(result.Errors.First()));

        // при смене ника меняется метка безопасности: без новой cookie вход со временем слетит
        if (renamed) await signIn.RefreshSignInAsync(user);
        return Results.Ok(new { userName = user.UserName });
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
            case Skins.Hero: user.HeroSkin = skin.Id; break;
            case Skins.Win: user.WinSkin = skin.Id; break;
            case Skins.StreakSlot: user.StreakSkin = skin.Id; break;
        }
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    /// <summary>Итоги по всем режимам и серии побед подряд (текущая и лучшая).</summary>
    public static async Task<Achievements> LoadAchievementsAsync(AppDb db, string userId)
    {
        var results = await db.MatchParticipants
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.MatchRecordId)
            .Select(p => new { Win = p.Won, p.Sliders })
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

    public static IResult Error(string message, int status = 400) =>
        Results.Json(new { error = message }, statusCode: status);
}
