using ArrowRush.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Game;

/// <summary>
/// Точка входа для клиентов (WebSocket через SignalR). Подключиться можно только после входа в аккаунт.
/// Клиент вызывает эти методы, сервер отвечает событиями:
/// queued, matchStart, state, matchEnd. Событие friends — изменились заявки или список друзей (см. SocialEndpoints).
/// </summary>
[Authorize]
public sealed class GameHub(MatchManager manager, AppDb db) : Hub
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

    public override Task OnDisconnectedAsync(Exception? exception) => manager.LeaveAsync(Context.ConnectionId);
}
