using System.Security.Claims;
using ArrowRush.Game;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Data;

/// <summary>
/// HTTP API профилей и друзей: /api/account/players, /api/account/friends. Только для вошедших.
/// Когда заявки или дружба меняются, второму игроку уходит событие friends через хаб.
/// </summary>
public static class SocialEndpoints
{
    /// <summary>Сколько всего друзей и отправленных заявок может быть у игрока.</summary>
    public const int MaxFriends = 100;
    public const int MinSearchLength = 2;
    public const int SearchResults = 10;
    /// <summary>Сколько последних матчей видно в чужом профиле.</summary>
    public const int ProfileMatches = 5;

    public sealed record FriendTarget(string? UserName);

    public static void MapSocial(this WebApplication app)
    {
        var api = app.MapGroup("/api/account").RequireAuthorization();
        api.MapGet("/players", Search);
        api.MapGet("/players/{name}", Player);
        api.MapGet("/friends", Friends);
        api.MapPost("/friends/request", SendRequest);
        api.MapPost("/friends/accept", Accept);
        api.MapPost("/friends/remove", Remove);
    }

    private static string Me(ClaimsPrincipal principal) => principal.FindFirstValue(ClaimTypes.NameIdentifier)!;

    private static Task<AppUser?> FindUserAsync(UserManager<AppUser> users, string? name) =>
        users.FindByNameAsync((name ?? "").Trim());

    /// <summary>Запись о паре игроков, в какую бы сторону ни шла заявка.</summary>
    private static Task<Friendship?> FindLinkAsync(AppDb db, string a, string b) =>
        db.Friendships.FirstOrDefaultAsync(f => (f.FromId == a && f.ToId == b) || (f.FromId == b && f.ToId == a));

    private static Task NotifyAsync(IHubContext<GameHub> hub, string userId) =>
        hub.Clients.User(userId).SendAsync("friends");

    private static IResult NotFound() => AccountEndpoints.Error("Игрок не найден", 404);

    /// <summary>Поиск игроков по началу ника, без учёта регистра.</summary>
    private static async Task<IResult> Search(string? q, ClaimsPrincipal principal, UserManager<AppUser> users, AppDb db)
    {
        var query = (q ?? "").Trim();
        if (query.Length < MinSearchLength) return Results.Ok(Array.Empty<object>());

        var me = Me(principal);
        var prefix = users.NormalizeName(query);
        var found = await db.Users
            .Where(u => u.Id != me && u.NormalizedUserName!.StartsWith(prefix))
            .OrderBy(u => u.NormalizedUserName)
            .Take(SearchResults)
            .Select(u => new { userName = u.UserName, u.AvatarColor })
            .ToListAsync();

        return Results.Ok(found.Select(u => new { u.userName, color = AccountEndpoints.AvatarColor(u.AvatarColor) }));
    }

    /// <summary>Профиль игрока. relation: self, none, outgoing, incoming или friends.</summary>
    private static async Task<IResult> Player(string name, ClaimsPrincipal principal, UserManager<AppUser> users, AppDb db)
    {
        var user = await FindUserAsync(users, name);
        if (user is null) return NotFound();

        var me = Me(principal);
        var link = await FindLinkAsync(db, me, user.Id);
        var relation = user.Id == me ? "self"
            : link is null ? "none"
            : link.Accepted ? "friends"
            : link.FromId == me ? "outgoing" : "incoming";

        var achievements = await AccountEndpoints.LoadAchievementsAsync(db, user.Id);

        return Results.Ok(new
        {
            userName = user.UserName,
            about = user.About,
            color = AccountEndpoints.AvatarColor(user.AvatarColor),
            hero = Skins.Equipped(Skins.Hero, user.HeroSkin),
            // SQLite теряет пометку UTC
            joined = DateTime.SpecifyKind(user.CreatedAt, DateTimeKind.Utc),
            relation,
            friends = await db.Friendships.CountAsync(f => f.Accepted && (f.FromId == user.Id || f.ToId == user.Id)),
            games = achievements.Games,
            wins = achievements.Wins,
            sliders = achievements.Sliders,
            bestStreak = achievements.BestStreak,
            recent = await AccountEndpoints.LoadRecentAsync(db, user.Id, ProfileMatches),
        });
    }

    /// <summary>Друзья и заявки в обе стороны.</summary>
    private static async Task<IResult> Friends(ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var links = await db.Friendships
            .Where(f => f.FromId == me || f.ToId == me)
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => new
            {
                f.Accepted,
                Mine = f.FromId == me,
                Name = f.FromId == me ? f.To.UserName : f.From.UserName,
                Color = f.FromId == me ? f.To.AvatarColor : f.From.AvatarColor,
            })
            .ToListAsync();

        object Person(string? name, string? color) => new { userName = name, color = AccountEndpoints.AvatarColor(color) };

        return Results.Ok(new
        {
            friends = links.Where(l => l.Accepted).OrderBy(l => l.Name).Select(l => Person(l.Name, l.Color)),
            incoming = links.Where(l => !l.Accepted && !l.Mine).Select(l => Person(l.Name, l.Color)),
            outgoing = links.Where(l => !l.Accepted && l.Mine).Select(l => Person(l.Name, l.Color)),
        });
    }

    /// <summary>Заявка в друзья. Если этот игрок уже сам прислал заявку, она сразу принимается.</summary>
    private static async Task<IResult> SendRequest(FriendTarget body, ClaimsPrincipal principal, UserManager<AppUser> users, AppDb db, IHubContext<GameHub> hub)
    {
        var other = await FindUserAsync(users, body.UserName);
        if (other is null) return NotFound();

        var me = Me(principal);
        if (other.Id == me) return AccountEndpoints.Error("Нельзя добавить в друзья самого себя");

        var link = await FindLinkAsync(db, me, other.Id);
        if (link is { Accepted: true }) return AccountEndpoints.Error("Вы уже друзья");
        if (link is not null && link.FromId == me) return Results.Ok();

        var taken = await db.Friendships.CountAsync(f => f.FromId == me || (f.ToId == me && f.Accepted));
        if (taken >= MaxFriends) return AccountEndpoints.Error($"Друзей и заявок может быть не больше {MaxFriends}");

        if (link is not null) link.Accepted = true;
        else db.Friendships.Add(new Friendship { FromId = me, ToId = other.Id, CreatedAt = DateTime.UtcNow });

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Results.Ok(); // двойное нажатие: такая заявка только что записалась
        }

        await NotifyAsync(hub, other.Id);
        return Results.Ok();
    }

    /// <summary>Принять заявку, пришедшую от этого игрока.</summary>
    private static async Task<IResult> Accept(FriendTarget body, ClaimsPrincipal principal, UserManager<AppUser> users, AppDb db, IHubContext<GameHub> hub)
    {
        var other = await FindUserAsync(users, body.UserName);
        if (other is null) return NotFound();

        var me = Me(principal);
        var link = await db.Friendships.FirstOrDefaultAsync(f => f.FromId == other.Id && f.ToId == me);
        if (link is null) return AccountEndpoints.Error("Заявки уже нет");

        link.Accepted = true;
        await db.SaveChangesAsync();
        await NotifyAsync(hub, other.Id);
        return Results.Ok();
    }

    /// <summary>Убирает связь с игроком: отклонить или отозвать заявку, удалить из друзей.</summary>
    private static async Task<IResult> Remove(FriendTarget body, ClaimsPrincipal principal, UserManager<AppUser> users, AppDb db, IHubContext<GameHub> hub)
    {
        var other = await FindUserAsync(users, body.UserName);
        if (other is null) return NotFound();

        var me = Me(principal);
        await db.Friendships
            .Where(f => (f.FromId == me && f.ToId == other.Id) || (f.FromId == other.Id && f.ToId == me))
            .ExecuteDeleteAsync();
        await NotifyAsync(hub, other.Id);
        return Results.Ok();
    }
}
