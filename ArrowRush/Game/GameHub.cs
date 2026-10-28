using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ArrowRush.Game;

/// <summary>
/// Точка входа для клиентов (WebSocket через SignalR). Подключиться можно только после входа в аккаунт.
/// Клиент вызывает эти методы, сервер отвечает событиями:
/// queued, matchStart, state, matchEnd.
/// </summary>
[Authorize]
public sealed class GameHub(MatchManager manager) : Hub
{
    /// <param name="mode">"classic" или "speed".</param>
    public Task FindMatch(string? mode) =>
        manager.FindMatchAsync(Context.ConnectionId, Context.UserIdentifier!, Context.User!.FindFirstValue(ClaimTypes.Name)!, GameModes.Parse(mode));

    public Task CancelSearch() => manager.CancelSearchAsync(Context.ConnectionId);

    /// <summary>Какие стрелки сейчас зажаты (битовая маска, см. Arrow).</summary>
    public void Input(int heldMask) => manager.SetInput(Context.ConnectionId, heldMask);

    public Task LeaveMatch() => manager.LeaveAsync(Context.ConnectionId);

    public override Task OnDisconnectedAsync(Exception? exception) => manager.LeaveAsync(Context.ConnectionId);
}
