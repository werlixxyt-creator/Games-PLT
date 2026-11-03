using System.Diagnostics;
using ArrowRush.Data;
using Microsoft.AspNetCore.SignalR;

namespace ArrowRush.Game;

/// <summary>
/// Очередь поиска матча + все идущие матчи + игровой цикл (20 тиков в секунду).
/// Все изменения состояния — под одним lock, отправка сообщений и запись в базу — уже вне его.
/// </summary>
public sealed partial class MatchManager(IHubContext<GameHub> hub, IServiceScopeFactory scopes, ILogger<MatchManager> log) : BackgroundService
{
    private sealed record QueuedPlayer(string ConnectionId, string UserId, string Name, string Skin, string Hero, GameMode Mode, bool Fast, Difficulty Difficulty, double JoinedAt);
    /// <param name="Users">To — id аккаунтов, а не подключений.</param>
    private sealed record Outgoing(IReadOnlyList<string> To, string Method, object? Payload, bool Users = false);

    // в «5 на 5» ботов может понадобиться девять
    private static readonly string[] BotNames =
        ["Бот Шустрик", "Бот Ракета", "Бот Стрелок", "Бот Молния", "Бот Турбо", "Бот Искра", "Бот Вихрь", "Бот Комета", "Бот Дротик"];

    private readonly object _lock = new();
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly Random _rnd = new();
    private readonly List<QueuedPlayer> _queue = [];
    private readonly List<Match> _matches = [];
    private readonly Dictionary<string, Match> _matchByConnection = [];

    private double Now => _clock.Elapsed.TotalSeconds;

    // ---------- Вызовы из GameHub ----------

    /// <param name="practice">Тренировка: матч с ботом сразу, без очереди и без записи в статистику.</param>
    public Task FindMatchAsync(string connectionId, string userId, string name, string skin, string hero, GameMode mode, bool fast, Difficulty difficulty, bool practice)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            if (_matchByConnection.ContainsKey(connectionId) || _queue.Any(q => q.ConnectionId == connectionId))
                return Task.CompletedTask;

            // один аккаунт — одно место: иначе можно играть против себя из второй вкладки
            if (_queue.Any(q => q.UserId == userId) || _matches.Any(m => m.Players.Any(p => p.UserId == userId && !p.Left)))
                throw new HubException("Ты уже ищешь матч или играешь в другой вкладке");
            if (_lobbyByConnection.ContainsKey(connectionId)) throw new HubException("Сначала выйди из лобби");

            var me = new QueuedPlayer(connectionId, userId, name, skin, hero, mode, fast, difficulty, Now);
            if (practice)
            {
                outbox = [];
                StartMatch(mode, fast, difficulty, [me], outbox, practice: true);
            }
            else
            {
                _queue.Add(me);
                outbox = QueueUpdates();
            }
        }
        return SendAsync(outbox);
    }

    /// <summary>Сыграть уровень из редактора: сразу, без очереди и статистики; withBot — с ботом, иначе одному.</summary>
    public Task PlayLevelAsync(string connectionId, string userId, string name, string skin, string hero, PlayableLevel level, bool withBot)
    {
        List<Outgoing> outbox = [];
        lock (_lock)
        {
            if (_matchByConnection.ContainsKey(connectionId) || _queue.Any(q => q.UserId == userId)
                || _matches.Any(m => m.Players.Any(p => p.UserId == userId && !p.Left)))
                throw new HubException("Ты уже ищешь матч или играешь в другой вкладке");
            if (_lobbyByConnection.ContainsKey(connectionId)) throw new HubException("Сначала выйди из лобби");

            var me = new QueuedPlayer(connectionId, userId, name, skin, hero, GameMode.Classic, level.Fast, level.Difficulty, Now);
            StartMatch(GameMode.Classic, level.Fast, level.Difficulty, [me], outbox, practice: true, custom: level, seats: withBot ? 2 : 1);
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

    /// <summary>Игрок отключился: уходит из очереди, матча и лобби.</summary>
    public Task DisconnectAsync(string connectionId)
    {
        List<Outgoing> outbox = [];
        lock (_lock) LeaveLobby(connectionId, outbox);
        return Task.WhenAll(SendAsync(outbox), LeaveAsync(connectionId));
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
            List<Match> custom;
            lock (_lock)
            {
                outbox = [];
                finished = [];
                custom = [];
                RunMatchmaking(outbox);
                RunLobbySearch(outbox);
                TickMatches(dt, outbox, finished, custom);
            }

            // базу не ждём, чтобы не тормозить тики
            if (finished.Count > 0) _ = SaveAsync(finished);
            if (custom.Count > 0) _ = SaveLevelPlaysAsync(custom);

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

        // у каждого сочетания режима, темпа и сложности своя очередь
        foreach (var (mode, fast, difficulty) in _queue.Select(q => (q.Mode, q.Fast, q.Difficulty)).Distinct().ToList())
        {
            while (true)
            {
                var queue = _queue.Where(q => q.Mode == mode && q.Fast == fast && q.Difficulty == difficulty).ToList();
                List<QueuedPlayer> group;

                if (queue.Count >= mode.Rules().Seats)
                {
                    group = queue.Take(mode.Rules().Seats).ToList();
                }
                else if (mode.Rules().Teams)
                {
                    // команды ждут полного состава; кто ждёт слишком долго — играет с ботами
                    if (queue.Count == 0 || Now - queue[0].JoinedAt < GameRules.BotAfterSeconds) break;
                    group = queue;
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
                StartMatch(mode, fast, difficulty, group, outbox);
                changed = true;
            }
        }

        if (changed) outbox.AddRange(QueueUpdates());
    }

    /// <param name="custom">Уровень из редактора; его дизайн тоже выбрал автор.</param>
    /// <param name="seats">Сколько мест заполнить ботами; null — как в обычном матче.</param>
    private void StartMatch(GameMode mode, bool fast, Difficulty difficulty, List<QueuedPlayer> group, List<Outgoing> outbox, bool practice = false,
        PlayableLevel? custom = null, int? seats = null)
    {
        var match = new Match(Guid.NewGuid().ToString("N")[..8], mode, fast, difficulty, new Random(_rnd.Next()), practice,
            theme: custom?.Theme ?? "auto", custom: custom);

        // чётные места — одна команда, нечётные — другая: двое людей окажутся друг против друга
        int TeamOf(int seat) => match.Teams ? seat % GameRules.TeamCount : -1;

        var slot = 0;
        foreach (var q in group)
        {
            match.Players.Add(new Player { Slot = slot, Name = q.Name, ConnectionId = q.ConnectionId, UserId = q.UserId, Skin = q.Skin, Hero = q.Hero, Team = TeamOf(slot) });
            _matchByConnection[q.ConnectionId] = match;
            slot++;
        }

        // одиночке — бот, чтобы не ждать вечно; в командах боты занимают все пустые места
        var botSeats = seats ?? (match.Teams ? mode.Rules().Seats : GameRules.MinPlayers);
        var botNames = BotNames.OrderBy(_ => _rnd.Next()).ToList();
        for (var bot = 0; match.Players.Count < botSeats; bot++)
        {
            match.Players.Add(new Player
            {
                Slot = slot,
                Name = botNames[bot],
                Skin = Skins.SliderIds[_rnd.Next(Skins.SliderIds.Length)],
                Hero = RandomHero(),
                Team = TeamOf(slot),
            });
            slot++;
        }

        _matches.Add(match);
        log.LogInformation("Матч {Id} ({Mode}{Fast}, {Difficulty}{Practice}): {Players}", match.Id, mode, fast ? ", быстрый" : "", difficulty, practice ? ", тренировка" : "", string.Join(", ", match.Players.Select(p => p.Name)));

        foreach (var p in match.Players.Where(p => !p.IsBot))
        {
            outbox.Add(new Outgoing([p.ConnectionId!], "matchStart", match.StartPayload(p.Slot)));
        }
    }

    /// <param name="custom">Кончившиеся матчи на уровнях из редактора: их игры и прохождения пишутся в уровень.</param>
    private void TickMatches(double dt, List<Outgoing> outbox, List<MatchRecord> finished, List<Match> custom)
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
                if (match.Custom is not null) custom.Add(match);
                LobbyMatchEnded(match, outbox);
                continue;
            }

            if (to.Count > 0) outbox.Add(new Outgoing(to, "state", match.StatePayload()));
        }
    }

    // ---------- Вспомогательное ----------

    private string RandomHero()
    {
        var heroes = Skins.All.Where(s => s.Slot == Skins.Hero).ToArray();
        return heroes[_rnd.Next(heroes.Length)].Id;
    }

    private async Task SaveAsync(List<MatchRecord> records)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.Matches.AddRange(records);
            await db.SaveChangesAsync();

            // клиент уже мог перечитать профиль: матч сохраняется позже, чем приходят итоги
            var users = records.SelectMany(r => r.Participants).Select(p => p.UserId).OfType<string>().Distinct().ToList();
            await hub.Clients.Users(users).SendAsync("stats");
        }
        catch (Exception e)
        {
            log.LogError(e, "Не удалось сохранить матчи {Ids}", string.Join(", ", records.Select(r => r.Code)));
        }
    }

    /// <summary>
    /// Матчи на уровнях из редактора: у опубликованного считаем игры и прохождения других игроков,
    /// а черновик, который автор прошёл и с тех пор не менял, становится пройденным — его можно публиковать.
    /// </summary>
    private async Task SaveLevelPlaysAsync(List<Match> matches)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            var verified = new List<string>();
            foreach (var match in matches)
            {
                var level = await db.CustomLevels.FindAsync(match.Custom!.Id);
                if (level is null) continue;
                var humans = match.Players.Where(p => !p.IsBot && p.UserId is not null).ToList();
                if (level.Published)
                {
                    var others = humans.Where(p => p.UserId != level.AuthorId).ToList();
                    level.Plays += others.Count;
                    level.Clears += others.Count(p => p.Done);
                }
                else if (!level.Verified && level.Revision == match.Custom.Revision
                         && humans.Any(p => p.UserId == level.AuthorId && p.Done))
                {
                    level.Verified = true;
                    verified.Add(level.AuthorId);
                }
            }
            await db.SaveChangesAsync();
            if (verified.Count > 0) await hub.Clients.Users(verified).SendAsync("levels");
        }
        catch (Exception e)
        {
            log.LogError(e, "Не удалось записать игры на уровнях {Ids}", string.Join(", ", matches.Select(m => m.Custom!.Id)));
        }
    }

    private List<Outgoing> QueueUpdates() => _queue
        .GroupBy(q => (q.Mode, q.Fast, q.Difficulty))
        .Select(g =>
        {
            var waiting = g.Select(q => q.ConnectionId).ToList();
            return new Outgoing(waiting, "queued", new { inQueue = waiting.Count, botAfter = GameRules.BotAfterSeconds });
        })
        .ToList();

    private Task SendAsync(List<Outgoing> outbox) =>
        Task.WhenAll(outbox.Select(o => (o.Users ? hub.Clients.Users(o.To) : hub.Clients.Clients(o.To)).SendAsync(o.Method, o.Payload)));
}
