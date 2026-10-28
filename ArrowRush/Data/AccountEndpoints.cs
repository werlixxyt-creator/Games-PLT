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

    public static void MapAccount(this WebApplication app)
    {
        var api = app.MapGroup("/api/account");
        api.MapPost("/register", Register);
        api.MapPost("/login", Login);
        api.MapPost("/logout", Logout);
        api.MapGet("/me", Me).RequireAuthorization();
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
            .GroupBy(p => p.Match.Mode)
            .Select(g => new
            {
                Mode = g.Key,
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
                p.Match.PlayedAt,
                p.Place,
                Players = p.Match.Participants.Count,
                p.FinishTime,
                p.Sliders,
                Total = p.Match.SliderCount,
                p.Left,
            })
            .ToListAsync();

        return Results.Ok(new
        {
            userName = user.UserName,
            // { classic: {games, wins, sliders}, speed: {...} } — нули, если в режиме ещё не играл
            stats = Enum.GetValues<GameMode>().ToDictionary(
                m => m.ToWire(),
                m => byMode.FirstOrDefault(s => s.Mode == m) is { } s
                    ? new { games = s.Games, wins = s.Wins, sliders = s.Sliders }
                    : new { games = 0, wins = 0, sliders = 0 }),
            recent = recent.Select(r => new
            {
                mode = r.Mode.ToWire(),
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
