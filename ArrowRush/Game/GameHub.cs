using ArrowRush.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Game;

/// <summary>
/// Точка входа для клиентов (WebSocket через SignalR). Подключиться можно только после входа в аккаунт.
/// Клиент вызывает эти методы, сервер отвечает событиями:
/// queued, matchStart, state, matchEnd, lobby, lobbyInvites. Событие friends — изменились заявки или список друзей (см. SocialEndpoints).
/// </summary>
[Authorize]
public sealed class GameHub(MatchManager manager, AppDb db, UserManager<AppUser> users) : Hub
{
    /// <param name="mode">"classic", "mirror", "blind", "hardcore", "teams" или "teams5".</param>
    /// <param name="fast">Быстрый темп: ползунок — одно нажатие; иначе стрелку надо держать.</param>
    /// <param name="difficulty">"easy", "normal" или "hard".</param>
    /// <param name="practice">true — сразу матч с ботом, не в статистику.</param>
    public async Task FindMatch(string? mode, bool fast, string? difficulty, bool practice)
    {
        var userId = Context.UserIdentifier!;
        // ник и скин ползунков берём из базы: соперники увидят их, а ник мог измениться после подключения
        var me = await db.Users.Where(u => u.Id == userId).Select(u => new { u.UserName, u.SliderSkin }).FirstAsync();

        await manager.FindMatchAsync(Context.ConnectionId, userId, me.UserName!,
            Skins.Equipped(Skins.Slider, me.SliderSkin), GameModes.Parse(mode), fast, Difficulties.Parse(difficulty), practice);
    }

    public Task CancelSearch() => manager.CancelSearchAsync(Context.ConnectionId);

    /// <summary>Какие стрелки сейчас зажаты (битовая маска, см. Arrow).</summary>
    public void Input(int heldMask) => manager.SetInput(Context.ConnectionId, heldMask);

    public Task LeaveMatch() => manager.LeaveAsync(Context.ConnectionId);

    public override Task OnDisconnectedAsync(Exception? exception) => manager.DisconnectAsync(Context.ConnectionId);

    // ---------- Лобби ----------

    /// <param name="isPublic">Общее лобби: команда, в которую можно войти из списка.</param>
    public async Task CreateLobby(bool isPublic) => await manager.CreateLobbyAsync(await MeInLobbyAsync(), isPublic);

    public object PublicLobbies() => manager.PublicLobbies();

    public Task SearchLobby(bool on) => manager.SearchLobbyAsync(Context.ConnectionId, on);

    public Task UpdateLobby(string? mode, bool teams, bool fast, string? difficulty, string? theme, int maxPlayers) =>
        manager.UpdateLobbyAsync(Context.ConnectionId, mode, teams, fast, difficulty, theme, maxPlayers);

    public Task SetLobbyBots(int count) => manager.SetLobbyBotsAsync(Context.ConnectionId, count);

    /// <summary>Приглашать можно только друзей.</summary>
    public async Task InviteToLobby(string? userName)
    {
        var me = Context.UserIdentifier!;
        var target = await users.FindByNameAsync(userName ?? "") ?? throw new HubException("Игрок не найден");
        var friends = await db.Friendships.AnyAsync(f => f.Accepted
            && ((f.FromId == me && f.ToId == target.Id) || (f.FromId == target.Id && f.ToId == me)));
        if (!friends) throw new HubException("Приглашать можно только друзей");
        await manager.InviteAsync(Context.ConnectionId, target.Id, target.UserName!);
    }

    public async Task JoinLobby(string lobbyId) => await manager.JoinLobbyAsync(lobbyId, await MeInLobbyAsync());

    public Task DeclineInvite(string lobbyId) => manager.DeclineInviteAsync(lobbyId, Context.UserIdentifier!);

    public Task KickFromLobby(string name) => manager.KickFromLobbyAsync(Context.ConnectionId, name);

    public Task LeaveLobby() => manager.LeaveLobbyAsync(Context.ConnectionId);

    public Task StartLobby() => manager.StartLobbyAsync(Context.ConnectionId);

    public object LobbyInvites() => manager.LobbyInvites(Context.UserIdentifier!);

    /// <summary>Как игрок выглядит в лобби: скины берём из базы, их увидят остальные.</summary>
    private async Task<LobbyMember> MeInLobbyAsync()
    {
        var userId = Context.UserIdentifier!;
        var me = await db.Users.Where(u => u.Id == userId).Select(u => new { u.UserName, u.SliderSkin, u.HeroSkin, u.AvatarColor }).FirstAsync();
        return new LobbyMember(userId, Context.ConnectionId, me.UserName!, Skins.Equipped(Skins.Slider, me.SliderSkin),
            Skins.Equipped(Skins.Hero, me.HeroSkin), AccountEndpoints.AvatarColor(me.AvatarColor));
    }
}
