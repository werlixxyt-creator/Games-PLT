using System.Diagnostics;
using ArrowRush.Data;
using Microsoft.AspNetCore.SignalR;

namespace ArrowRush.Game;

/// <summary>
/// Очередь поиска матча + все идущие матчи + игровой цикл (20 тиков в секунду).
/// Все изменения состояния — под одним lock, отправка сообщений и запись в базу — уже вне его.
/// </summary>
public sealed class MatchManager(IHubContext<GameHub> hub, IServiceScopeFactory scopes, ILogger<MatchManager> log) : BackgroundService
{
    private sealed record QueuedPlayer(string ConnectionId, string UserId, string Name, string Skin, GameMode Mode, double JoinedAt);
    private sealed record Outgoing(IReadOnlyList<string> To, string Method, object Payload);

    private static readonly string[] BotNames = ["Бот Шустрик", "Бот Ракета", "Бот Стрелок"];

    private readonly object _lock = new();
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly Random _rnd = new();
    private readonly List<QueuedPlayer> _queue = [];
    private readonly List<Match> _matches = [];
    private readonly Dictionary<string, Match> _matchByConnection = [];

    private double Now => _clock.Elapsed.TotalSeconds;

    // ---------- Вызовы из GameHub ----------

    /// <param name="practice">Тренировка: матч с ботом сразу, без очереди и без записи в статистику.</param>
    public Task FindMatchAsync(string connectionId, string userId, string name, string skin, GameMode mode, bool practice)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            if (_matchByConnection.ContainsKey(connectionId) || _queue.Any(q => q.ConnectionId == connectionId))
                return Task.CompletedTask;

            // один аккаунт — одно место: иначе можно играть против себя из второй вкладки
            if (_queue.Any(q => q.UserId == userId) || _matches.Any(m => m.Players.Any(p => p.UserId == userId && !p.Left)))
                throw new HubException("Ты уже ищешь матч или играешь в другой вкладке");

            var me = new QueuedPlayer(connectionId, userId, name, skin, mode, Now);
            if (practice)
            {
                outbox = [];
                StartMatch(mode, [me], outbox, practice: true);
            }
            else
            {
                _queue.Add(me);
                outbox = QueueUpdates();
            }
        }
        return SendAsync(outbox);
    }

    public Task CancelSearchAsync(string connectionId)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            if (_queue.RemoveAll(q => q.ConnectionId == connectionId) == 0) return Task.CompletedTask;
            outbox = QueueUpdates();
        }
        return SendAsync(outbox);
    }

    public void SetInput(string connectionId, int mask)
    {
        lock (_lock)
        {
            if (_matchByConnection.TryGetValue(connectionId, out var match))
                match.SetInput(connectionId, mask);
        }
    }

    public Task LeaveAsync(string connectionId)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            _queue.RemoveAll(q => q.ConnectionId == connectionId);
            if (_matchByConnection.Remove(connectionId, out var match))
                match.MarkLeft(connectionId);
            outbox = QueueUpdates();
        }
        return SendAsync(outbox);
    }

    // ---------- Игровой цикл ----------

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1.0 / GameRules.TicksPerSecond));
        var last = Now;

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var now = Now;
            var dt = Math.Min(now - last, 0.25); // защита от больших скачков после паузы
            last = now;

            List<Outgoing> outbox;
            List<MatchRecord> finished;
            lock (_lock)
            {
                outbox = [];
                finished = [];
                RunMatchmaking(outbox);
                TickMatches(dt, outbox, finished);
            }

            // базу не ждём, чтобы не тормозить тики
            if (finished.Count > 0) _ = SaveAsync(finished);

            try
            {
                await SendAsync(outbox);
            }
            catch (Exception e)
            {
                log.LogWarning(e, "Ошибка отправки сообщений клиентам");
            }
        }
    }

    private void RunMatchmaking(List<Outgoing> outbox)
    {
        var changed = false;

        // у каждого режима своя очередь
        foreach (var mode in Enum.GetValues<GameMode>())
        {
            while (true)
            {
                var queue = _queue.Where(q => q.Mode == mode).ToList();
                List<QueuedPlayer> group;

                if (queue.Count >= GameRules.MaxPlayers)
                {
                    group = queue.Take(GameRules.MaxPlayers).ToList();
                }
                else if (queue.Count >= GameRules.MinPlayers && Now - queue[GameRules.MinPlayers - 1].JoinedAt >= GameRules.GatherSeconds)
                {
                    group = queue;
                }
                else if (queue.Count == 1 && Now - queue[0].JoinedAt >= GameRules.BotAfterSeconds)
                {
                    group = queue;
                }
                else
                {
                    break;
                }

                _queue.RemoveAll(group.Contains);
                StartMatch(mode, group, outbox);
                changed = true;
            }
        }

        if (changed) outbox.AddRange(QueueUpdates());
    }

    private void StartMatch(GameMode mode, List<QueuedPlayer> group, List<Outgoing> outbox, bool practice = false)
    {
        var match = new Match(Guid.NewGuid().ToString("N")[..8], mode, new Random(_rnd.Next()), practice);

        var slot = 0;
        foreach (var q in group)
        {
            match.Players.Add(new Player { Slot = slot++, Name = q.Name, ConnectionId = q.ConnectionId, UserId = q.UserId, Skin = q.Skin });
            _matchByConnection[q.ConnectionId] = match;
        }

        // одиночке — один бот, чтобы не ждать вечно
        if (match.Players.Count < GameRules.MinPlayers)
        {
            match.Players.Add(new Player
            {
                Slot = slot,
                Name = BotNames[_rnd.Next(BotNames.Length)],
                Skin = Skins.SliderIds[_rnd.Next(Skins.SliderIds.Length)],
            });
        }

        _matches.Add(match);
        log.LogInformation("Матч {Id} ({Mode}{Practice}): {Players}", match.Id, mode, practice ? ", тренировка" : "", string.Join(", ", match.Players.Select(p => p.Name)));

        foreach (var p in match.Players.Where(p => !p.IsBot))
        {
            outbox.Add(new Outgoing([p.ConnectionId!], "matchStart", match.StartPayload(p.Slot)));
        }
    }

    private void TickMatches(double dt, List<Outgoing> outbox, List<MatchRecord> finished)
    {
        for (var i = _matches.Count - 1; i >= 0; i--)
        {
            var match = _matches[i];
            match.Tick(dt);

            var to = match.ActiveConnections.ToList();

            if (match.Phase == MatchPhase.Finished)
            {
                if (to.Count > 0)
                {
                    outbox.Add(new Outgoing(to, "state", match.StatePayload()));
                    outbox.Add(new Outgoing(to, "matchEnd", match.ResultPayload()));
                }
                foreach (var c in to) _matchByConnection.Remove(c);
                _matches.RemoveAt(i);
                if (!match.Practice) finished.Add(match.ToRecord());
                continue;
            }

            if (to.Count > 0) outbox.Add(new Outgoing(to, "state", match.StatePayload()));
        }
    }

    // ---------- Вспомогательное ----------

    private async Task SaveAsync(List<MatchRecord> records)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.Matches.AddRange(records);
            await db.SaveChangesAsync();
        }
        catch (Exception e)
        {
            log.LogError(e, "Не удалось сохранить матчи {Ids}", string.Join(", ", records.Select(r => r.Code)));
        }
    }

    private List<Outgoing> QueueUpdates() => _queue
        .GroupBy(q => q.Mode)
        .Select(g =>
        {
            var waiting = g.Select(q => q.ConnectionId).ToList();
            return new Outgoing(waiting, "queued", new { inQueue = waiting.Count, botAfter = GameRules.BotAfterSeconds });
        })
        .ToList();

    private Task SendAsync(List<Outgoing> outbox) =>
        Task.WhenAll(outbox.Select(o => hub.Clients.Clients(o.To).SendAsync(o.Method, o.Payload)));
}
