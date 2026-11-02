namespace ArrowRush.Game;

/// <summary>
/// Все настройки игры в одном месте — меняй здесь, чтобы подкрутить баланс.
/// То, что зависит от сложности (ползунки, штрафы, бот), — в <see cref="Difficulties"/>.
/// </summary>
public static class GameRules
{
    // Сервер
    public const int TicksPerSecond = 20;

    // Матчмейкинг
    public const int MinPlayers = 2;
    public const int MaxPlayers = 4;
    /// <summary>Сколько команд в командных режимах; их размер задан в правилах режима.</summary>
    public const int TeamCount = 2;
    /// <summary>Сколько ждать ещё игроков, когда в очереди уже есть двое.</summary>
    public const double GatherSeconds = 4;
    /// <summary>Через сколько секунд одиночке подставляется бот.</summary>
    public const double BotAfterSeconds = 12;

    // Матч
    public const double CountdownSeconds = 3;
    public const double MatchTimeLimitSeconds = 180;
    /// <summary>Сколько матч ещё идёт после финиша первого игрока.</summary>
    public const double AfterFirstFinishSeconds = 30;

    // Ячейка «Чарт»: следующие ячейки становятся одинаковыми
    public const int ChartCells = 10;
    /// <summary>Сколько обычных ячеек минимум между чартами; верхняя граница зависит от темпа.</summary>
    public const int ChartMinGap = 2;
    public const int ChartMaxGap = 5;
    public const int ChartMaxGapFast = 14;

    // Ивенты: особая ячейка меняет следующие ячейки. Каждая особая ячейка выбирается
    // из явлений поровну: свам, чарт, овердрайв, шторм, переворот и «Раст» (см. LevelGenerator)
    /// <summary>Длина ивента: не длиннее <see cref="SwamCells"/>, чтобы он помещался и в короткий уровень.</summary>
    public const int EventCells = 6;
    /// <summary>«Овердрайв»: во сколько раз быстрее заполняются ячейки при удержании.</summary>
    public const double OverdriveFill = 0.6;

    // Ячейка «Свам»: персонаж падает на НЛО и перепрыгивает следующие ячейки
    public const int SwamCells = 6;
    /// <summary>За сколько секунд НЛО подлетает к следующей ячейке.</summary>
    public const double SwamCellSeconds = 0.9;
    /// <summary>Сколько НЛО летит к первой ячейке: за это время идёт сцена его прилёта.</summary>
    public const double SwamIntroSeconds = 1.8;
    /// <summary>Сколько длится прыжок. Должно быть меньше <see cref="SwamCellSeconds"/>, иначе не успеть приземлиться.</summary>
    public const double SwamJumpSeconds = 0.75;
    /// <summary>В какой доле прыжка персонаж выше ячейки: раньше и позже он в неё врезается.</summary>
    public const double SwamClearFrom = 0.12;
    public const double SwamClearTo = 0.88;

    // Ивент «Раст»: следующие ячейки — две стрелки по очереди, сзади них надвигается чёрная дыра
    /// <summary>Сколько ячеек он добавляет к уровню.</summary>
    public const int RastCells = 40;
    /// <summary>Сколько секунд дыра идёт до игрока в начале и насколько далеко её можно отогнать.</summary>
    public const double RastStartGap = 3;
    /// <summary>Сколько секунд дыра стоит у правого края, пока гаснет мир: игрок должен увидеть её там и успеть среагировать.</summary>
    public const double RastPauseSeconds = 1.3;
    public const double RastMaxGap = 4;
    /// <summary>Насколько отгоняет верное нажатие и подпускает неверное, в секундах.</summary>
    public const double RastGain = 0.18;
    public const double RastWrong = 0.4;
    /// <summary>Сколько нажатий в секунду делает бот обычной реакции.</summary>
    public const double RastBotRate = 6;

    // Режим «Хардкор»: без пауз за ошибку, но ошибки ограничены
    /// <summary>Столько ошибок — и игрок выбывает.</summary>
    public const int HardcoreLives = 3;

    // Режим «Туман»
    /// <summary>Сколько ячеек видно, считая текущую.</summary>
    public const int FogSight = 3;

    // Режим «Откат»
    /// <summary>На сколько ячеек отбрасывает ошибка.</summary>
    public const int SetbackCells = 3;
}

/// <summary>Сложность уровня. В базе хранится числом, клиенту передаётся строкой.</summary>
public enum Difficulty
{
    Easy = 0,
    Normal = 1,
    Hard = 2,
}

/// <summary>
/// Баланс одной сложности.
/// Ползунки: сколько их в обычном темпе (удержание) и в быстром (нажатия), за сколько секунд заполняется один.
/// Штрафы — доля ползунка в секунду: ничего не нажато (Idle) и зажата не та стрелка (Wrong).
/// FastWrongStun — пауза за ошибку в быстром темпе.
/// BotReaction и BotMistakes — множители к тому, как долго бот замечает стрелку и как часто ошибается.
/// RastDrain — скорость чёрной дыры в «Расте»: сколько секунд запаса она съедает за секунду.
/// </summary>
public sealed record DifficultyRules(
    string Wire,
    int MinSliders, int MaxSliders,
    int FastMinSliders, int FastMaxSliders,
    double MinFillSeconds, double MaxFillSeconds,
    double IdleDrainPerSecond, double WrongDrainPerSecond,
    double FastWrongStunSeconds,
    double BotReaction, double BotMistakes,
    double RastDrain);

public static class Difficulties
{
    private static readonly Dictionary<Difficulty, DifficultyRules> All = new()
    {
        [Difficulty.Easy] = new("easy",
            MinSliders: 15, MaxSliders: 21, FastMinSliders: 42, FastMaxSliders: 60,
            MinFillSeconds: 0.8, MaxFillSeconds: 1.8,
            IdleDrainPerSecond: 0.2, WrongDrainPerSecond: 0.7,
            FastWrongStunSeconds: 0.35,
            BotReaction: 1.8, BotMistakes: 2,
            RastDrain: 0.95),
        [Difficulty.Normal] = new("normal",
            MinSliders: 18, MaxSliders: 30, FastMinSliders: 60, FastMaxSliders: 90,
            MinFillSeconds: 0.6, MaxFillSeconds: 1.6,
            IdleDrainPerSecond: 0.35, WrongDrainPerSecond: 1.2,
            FastWrongStunSeconds: 0.5,
            BotReaction: 1, BotMistakes: 1,
            RastDrain: 1.25),
        [Difficulty.Hard] = new("hard",
            MinSliders: 27, MaxSliders: 39, FastMinSliders: 84, FastMaxSliders: 114,
            MinFillSeconds: 0.45, MaxFillSeconds: 1.2,
            IdleDrainPerSecond: 0.55, WrongDrainPerSecond: 1.7,
            FastWrongStunSeconds: 0.7,
            BotReaction: 0.6, BotMistakes: 0.4,
            RastDrain: 1.6),
    };

    public static DifficultyRules Rules(this Difficulty difficulty) => All[difficulty];

    public static string ToWire(this Difficulty difficulty) => All[difficulty].Wire;

    /// <summary>Неизвестная строка — нормальная сложность.</summary>
    public static Difficulty Parse(string? wire) =>
        All.Where(kv => kv.Value.Wire == wire).Select(kv => (Difficulty?)kv.Key).FirstOrDefault() ?? Difficulty.Normal;
}
