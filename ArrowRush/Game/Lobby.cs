namespace ArrowRush.Game;

/// <summary>Игрок в лобби. Hero и Color нужны, чтобы нарисовать его персонажа.</summary>
public sealed record LobbyMember(string UserId, string ConnectionId, string Name, string Skin, string Hero, string Color);

/// <summary>Бот, которого лидер поставил в лобби.</summary>
public sealed record LobbyBot(string Name, string Skin, string Hero, string Color);

/// <summary>Настройки лобби. Mode — модификация правил, Teams — две команды вместо «все против всех».</summary>
public sealed record LobbySettings(GameMode Mode, bool Teams, bool Fast, Difficulty Difficulty, string Theme, int MaxPlayers)
{
    /// <summary>Модификации, которые можно выбрать; команды включаются отдельно.</summary>
    public static readonly GameMode[] Modes = [GameMode.Classic, GameMode.Mirror, GameMode.Blind, GameMode.Hardcore];

    /// <summary>Дизайны уровня, как в course.js; "auto" — случайный.</summary>
    public static readonly string[] Themes = ["auto", "violet", "ocean", "neon", "night", "lighthouse", "abyss"];

    public const int MinPlayers = 2;
    public const int MaxLobbyPlayers = 40;

    public static readonly LobbySettings Default = new(GameMode.Classic, false, false, Difficulty.Normal, "auto", 8);

    /// <summary>Правила матча на total игроков.</summary>
    public ModeRules RulesFor(int total) => Mode.Rules() with { TeamSize = Teams ? (total + 1) / 2 : 0 };
}

/// <summary>
/// Лобби: лидер собирает игроков и ботов и сам запускает матч. Матчи лобби не идут в статистику и задания.
/// Хранится в памяти сервера, как очередь и матчи, все изменения — под общим lock в <see cref="MatchManager"/>.
/// </summary>
public sealed class Lobby(string id, string leaderId)
{
    /// <summary>Сколько последних событий видно в журнале.</summary>
    public const int LogSize = 3;

    public string Id { get; } = id;
    public string LeaderId { get; set; } = leaderId;
    public LobbySettings Settings { get; set; } = LobbySettings.Default;
    public List<LobbyMember> Members { get; } = [];
    public List<LobbyBot> Bots { get; } = [];
    /// <summary>Кого пригласили: id аккаунта → ник пригласившего.</summary>
    public Dictionary<string, string> Invites { get; } = [];
    public List<string> Log { get; } = [];
    public bool InMatch { get; set; }

    public int Total => Members.Count + Bots.Count;

    public void Write(string line)
    {
        Log.Add(line);
        if (Log.Count > LogSize) Log.RemoveAt(0);
    }
}
