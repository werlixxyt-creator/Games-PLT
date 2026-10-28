using System.Security.Claims;
using ArrowRush.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Game;

/// <summary>
/// Точка входа для клиентов (WebSocket через SignalR). Подключиться можно только после входа в аккаунт.
/// Клиент вызывает эти методы, сервер отвечает событиями:
/// queued, matchStart, state, matchEnd.
/// </summary>
[Authorize]
public sealed class GameHub(MatchManager manager, AppDb db) : Hub
{
    /// <param name="mode">"classic", "mirror", "blind" или "hardcore".</param>
    /// <param name="fast">Быстрый темп: ползунок — одно нажатие; иначе стрелку надо держать.</param>
    /// <param name="difficulty">"easy", "normal" или "hard".</param>
    /// <param name="practice">true — сразу матч с ботом, не в статистику.</param>
    public async Task FindMatch(string? mode, bool fast, string? difficulty, bool practice)
    {
        var userId = Context.UserIdentifier!;
        // скин ползунков берём из базы: его увидят соперники
        var skin = await db.Users.Where(u => u.Id == userId).Select(u => u.SliderSkin).FirstOrDefaultAsync();

        await manager.FindMatchAsync(Context.ConnectionId, userId, Context.User!.FindFirstValue(ClaimTypes.Name)!,
            Skins.Equipped(Skins.Slider, skin), GameModes.Parse(mode), fast, Difficulties.Parse(difficulty), practice);
    }

    public Task CancelSearch() => manager.CancelSearchAsync(Context.ConnectionId);

    /// <summary>Какие стрелки сейчас зажаты (битовая маска, см. Arrow).</summary>
    public void Input(int heldMask) => manager.SetInput(Context.ConnectionId, heldMask);

    public Task LeaveMatch() => manager.LeaveAsync(Context.ConnectionId);

    public override Task OnDisconnectedAsync(Exception? exception) => manager.LeaveAsync(Context.ConnectionId);
}
