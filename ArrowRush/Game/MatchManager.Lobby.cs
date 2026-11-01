using ArrowRush.Data;
using Microsoft.AspNetCore.SignalR;

namespace ArrowRush.Game;

/// <summary>Лобби: всё под общим lock менеджера, сообщения уходят уже вне его.</summary>
public sealed partial class MatchManager
{
    private readonly Dictionary<string, Lobby> _lobbies = [];
    private readonly Dictionary<string, Lobby> _lobbyByConnection = [];

    // ---------- Вызовы из GameHub ----------

    public Task CreateLobbyAsync(LobbyMember me)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            EnsureFree(me.UserId);
            var lobby = new Lobby(Guid.NewGuid().ToString("N")[..8], me.UserId);
            lobby.Members.Add(me);
            lobby.Write($"{me.Name} создал лобби");
            _lobbies[lobby.Id] = lobby;
            _lobbyByConnection[me.ConnectionId] = lobby;
            outbox = LobbyStates(lobby);
        }
        return SendAsync(outbox);
    }

    public Task UpdateLobbyAsync(string connectionId, string? mode, bool teams, bool fast, string? difficulty, string? theme, int maxPlayers)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            var lobby = LeaderLobby(connectionId);
            var parsed = GameModes.Parse(mode);
            var max = Math.Clamp(maxPlayers, Math.Max(LobbySettings.MinPlayers, lobby.Members.Count), LobbySettings.MaxLobbyPlayers);
            lobby.Settings = new LobbySettings(
                LobbySettings.Modes.Contains(parsed) ? parsed : GameMode.Classic, teams, fast,
                Difficulties.Parse(difficulty), LobbySettings.Themes.Contains(theme) ? theme! : "auto", max);
            FitBots(lobby, lobby.Bots.Count);
            outbox = LobbyStates(lobby);
        }
        return SendAsync(outbox);
    }

    public Task SetLobbyBotsAsync(string connectionId, int count)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            var lobby = LeaderLobby(connectionId);
            FitBots(lobby, count);
            outbox = LobbyStates(lobby);
        }
        return SendAsync(outbox);
    }

    public Task InviteAsync(string connectionId, string targetId, string targetName)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            var lobby = LeaderLobby(connectionId);
            if (lobby.Members.Any(m => m.UserId == targetId)) throw new HubException($"{targetName} уже в лобби");

            var from = lobby.Members.First(m => m.UserId == lobby.LeaderId).Name;
            lobby.Invites[targetId] = from;
            lobby.Write($"{from} пригласил {targetName}");
            outbox = LobbyStates(lobby);
            outbox.Add(InviteList(targetId));
        }
        return SendAsync(outbox);
    }

    public Task JoinLobbyAsync(string lobbyId, LobbyMember me)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            if (!_lobbies.TryGetValue(lobbyId, out var lobby) || !lobby.Invites.ContainsKey(me.UserId))
                throw new HubException("Приглашение устарело");
            EnsureFree(me.UserId);
            if (lobby.InMatch) throw new HubException("В лобби уже идёт матч, попробуй чуть позже");
            // место живого игрока важнее бота
            if (lobby.Total >= lobby.Settings.MaxPlayers && lobby.Bots.Count > 0) lobby.Bots.RemoveAt(lobby.Bots.Count - 1);
            if (lobby.Total >= lobby.Settings.MaxPlayers) throw new HubException("В лобби нет свободных мест");

            lobby.Invites.Remove(me.UserId);
            lobby.Members.Add(me);
            _lobbyByConnection[me.ConnectionId] = lobby;
            lobby.Write($"{me.Name} присоединился");
            outbox = LobbyStates(lobby);
            outbox.Add(InviteList(me.UserId));
        }
        return SendAsync(outbox);
    }

    public Task DeclineInviteAsync(string lobbyId, string userId)
    {
        List<Outgoing> outbox = [];
        lock (_lock)
        {
            if (_lobbies.TryGetValue(lobbyId, out var lobby)) lobby.Invites.Remove(userId);
            outbox.Add(InviteList(userId));
        }
        return SendAsync(outbox);
    }

    /// <summary>Лидер убирает игрока или бота по нику.</summary>
    public Task KickFromLobbyAsync(string connectionId, string name)
    {
        List<Outgoing> outbox;
        lock (_lock)
        {
            var lobby = LeaderLobby(connectionId);
            lobby.Bots.RemoveAll(b => b.Name == name);
            var member = lobby.Members.FirstOrDefault(m => m.Name == name && m.UserId != lobby.LeaderId);
            outbox = [];
            if (member is not null)
            {
                RemoveMember(lobby, member, outbox);
                lobby.Write($"{member.Name} исключён");
                outbox.Add(new Outgoing([member.ConnectionId], "lobby", null));
            }
            outbox.AddRange(LobbyStates(lobby));
        }
        return SendAsync(outbox);
    }

    public Task LeaveLobbyAsync(string connectionId)
    {
        List<Outgoing> outbox = [];
        lock (_lock)
        {
            LeaveLobby(connectionId, outbox);
            outbox.Add(new Outgoing([connectionId], "lobby", null));
        }
        return SendAsync(outbox);
    }

    public Task StartLobbyAsync(string connectionId)
    {
        List<Outgoing> outbox = [];
        lock (_lock)
        {
            var lobby = LeaderLobby(connectionId);
            if (lobby.InMatch) throw new HubException("Матч уже идёт");
            if (lobby.Total < LobbySettings.MinPlayers) throw new HubException("Нужно хотя бы двое: пригласи друга или поставь бота");

            var s = lobby.Settings;
            var match = new Match(Guid.NewGuid().ToString("N")[..8], s.Mode, s.Fast, s.Difficulty, new Random(_rnd.Next()), practice: true,
                s.RulesFor(lobby.Total), lobby.Id, s.Theme);

            var slot = 0;
            int TeamOf(int seat) => match.Teams ? seat % GameRules.TeamCount : -1;
            foreach (var m in lobby.Members)
            {
                match.Players.Add(new Player { Slot = slot, Name = m.Name, ConnectionId = m.ConnectionId, UserId = m.UserId, Skin = m.Skin, Team = TeamOf(slot) });
                _matchByConnection[m.ConnectionId] = match;
                slot++;
            }
            foreach (var b in lobby.Bots)
            {
                match.Players.Add(new Player { Slot = slot, Name = b.Name, Skin = b.Skin, Team = TeamOf(slot) });
                slot++;
            }

            _matches.Add(match);
            lobby.InMatch = true;
            lobby.Write("Матч начался");
            foreach (var p in match.Players.Where(p => !p.IsBot))
                outbox.Add(new Outgoing([p.ConnectionId!], "matchStart", match.StartPayload(p.Slot)));
            outbox.AddRange(LobbyStates(lobby));
        }
        return SendAsync(outbox);
    }

    /// <summary>Приглашения игрока: для кнопки друзей после подключения.</summary>
    public object LobbyInvites(string userId)
    {
        lock (_lock) return InvitesOf(userId);
    }

    // ---------- Вспомогательное ----------

    private void EnsureFree(string userId)
    {
        if (_queue.Any(q => q.UserId == userId) || _matches.Any(m => m.Players.Any(p => p.UserId == userId && !p.Left)))
            throw new HubException("Сначала закончи матч или поиск");
        if (_lobbies.Values.Any(l => l.Members.Any(m => m.UserId == userId)))
            throw new HubException("Ты уже в лобби");
    }

    /// <summary>Лобби, в котором этот игрок лидер.</summary>
    private Lobby LeaderLobby(string connectionId)
    {
        if (!_lobbyByConnection.TryGetValue(connectionId, out var lobby)) throw new HubException("Ты не в лобби");
        if (lobby.Members.First(m => m.ConnectionId == connectionId).UserId != lobby.LeaderId)
            throw new HubException("Это может только лидер лобби");
        return lobby;
    }

    /// <summary>Подгоняет число ботов под запрошенное и свободные места.</summary>
    private void FitBots(Lobby lobby, int count)
    {
        var wanted = Math.Clamp(count, 0, lobby.Settings.MaxPlayers - lobby.Members.Count);
        if (lobby.Bots.Count > wanted) lobby.Bots.RemoveRange(wanted, lobby.Bots.Count - wanted);

        var heroes = Skins.All.Where(s => s.Slot == Skins.Hero).Select(s => s.Id).ToArray();
        while (lobby.Bots.Count < wanted)
        {
            var taken = lobby.Bots.Select(b => b.Name).ToHashSet();
            var name = BotNames.FirstOrDefault(n => !taken.Contains(n))
                ?? Enumerable.Range(1, LobbySettings.MaxLobbyPlayers).Select(i => $"Бот №{i}").First(n => !taken.Contains(n));
            lobby.Bots.Add(new LobbyBot(name, Skins.SliderIds[_rnd.Next(Skins.SliderIds.Length)], heroes[_rnd.Next(heroes.Length)],
                AccountEndpoints.AvatarColors[_rnd.Next(AccountEndpoints.AvatarColors.Length)]));
        }
    }

    private void RemoveMember(Lobby lobby, LobbyMember member, List<Outgoing> outbox)
    {
        lobby.Members.Remove(member);
        _lobbyByConnection.Remove(member.ConnectionId);

        if (lobby.Members.Count == 0)
        {
            _lobbies.Remove(lobby.Id);
            var invited = lobby.Invites.Keys.ToList();
            lobby.Invites.Clear();
            outbox.AddRange(invited.Select(InviteList));
        }
        else if (member.UserId == lobby.LeaderId)
        {
            lobby.LeaderId = lobby.Members[0].UserId;
            lobby.Write($"{lobby.Members[0].Name} теперь лидер");
        }
    }

    private void LeaveLobby(string connectionId, List<Outgoing> outbox)
    {
        if (!_lobbyByConnection.TryGetValue(connectionId, out var lobby)) return;
        var member = lobby.Members.First(m => m.ConnectionId == connectionId);
        RemoveMember(lobby, member, outbox);
        lobby.Write($"{member.Name} вышел");
        outbox.AddRange(LobbyStates(lobby));
    }

    /// <summary>Матч лобби закончился: игроки могут собираться снова.</summary>
    private void LobbyMatchEnded(Match match, List<Outgoing> outbox)
    {
        if (match.LobbyId is null || !_lobbies.TryGetValue(match.LobbyId, out var lobby)) return;
        lobby.InMatch = false;
        outbox.AddRange(LobbyStates(lobby));
    }

    /// <summary>Каждому участнику своё состояние: в нём отмечено, кто он и лидер ли.</summary>
    private static List<Outgoing> LobbyStates(Lobby lobby) => lobby.Members
        .Select(me => new Outgoing([me.ConnectionId], "lobby", LobbyPayload(lobby, me)))
        .ToList();

    private static object LobbyPayload(Lobby lobby, LobbyMember me) => new
    {
        id = lobby.Id,
        leader = me.UserId == lobby.LeaderId,
        inMatch = lobby.InMatch,
        total = lobby.Total,
        bots = lobby.Bots.Count,
        log = lobby.Log,
        settings = new
        {
            mode = lobby.Settings.Mode.ToWire(),
            teams = lobby.Settings.Teams,
            fast = lobby.Settings.Fast,
            difficulty = lobby.Settings.Difficulty.ToWire(),
            theme = lobby.Settings.Theme,
            maxPlayers = lobby.Settings.MaxPlayers,
        },
        players = lobby.Members
            .Select(m => new { name = m.Name, hero = m.Hero, color = m.Color, leader = m.UserId == lobby.LeaderId, you = m.UserId == me.UserId, bot = false })
            .Concat(lobby.Bots.Select(b => new { name = b.Name, hero = b.Hero, color = b.Color, leader = false, you = false, bot = true })),
    };

    private List<object> InvitesOf(string userId) => _lobbies.Values
        .Where(l => l.Invites.ContainsKey(userId))
        .Select(l => (object)new { id = l.Id, from = l.Invites[userId], total = l.Total, max = l.Settings.MaxPlayers })
        .ToList();

    private Outgoing InviteList(string userId) => new([userId], "lobbyInvites", InvitesOf(userId), Users: true);
}
