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

    // Ивенты: особая ячейка меняет следующие ячейки. Какое явление выпадет, зависит от веса:
    // чем он больше, тем чаще (см. LevelGenerator)
    /// <summary>Свам, чарт, овердрайв, шторм, переворот и «Раст».</summary>
    public const int SpecialWeight = 2;
    public const int CloudWeight = 4;
    /// <summary>«Радуга» ещё и бывает не больше раза за уровень.</summary>
    public const int RainbowWeight = 1;
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

    // Ивент «Кловд»: игрок становится пауком и уклоняется от стрелок, перескакивая между потолком и полом
    /// <summary>Сколько стрелок летит: по одной на ячейку. Эти ячейки добавляются к уровню.</summary>
    public const int CloudCells = 8;
    /// <summary>Через сколько секунд прилетает следующая стрелка.</summary>
    public const double CloudCellSeconds = 0.7;
    /// <summary>Сколько летит первая: за это время идёт превращение в паука.</summary>
    public const double CloudIntroSeconds = 1.7;
    /// <summary>Как быстро бот реагирует на стрелку: столько секунд до неё он успевает уйти на другую линию.</summary>
    public const double CloudBotSeconds = 0.3;

    // Ивент «Радуга»: над радугой летают глаза с крыльями, их лазеры ставят стены; пока ломаешь стену, они снимают жизни
    /// <summary>Сколько ячеек за особой ячейкой; каждая вторая становится стеной.</summary>
    public const int RainbowCells = 6;
    /// <summary>Сколько нажатий любой клавиши ломают стену.</summary>
    public const int WallHits = 10;
    /// <summary>Жизни на каждую стену и как часто лазер снимает одну: всего 9 секунд на стену.</summary>
    public const int WallLives = 10;
    public const double WallLifeSeconds = 0.9;
    /// <summary>Как часто бьёт по стене бот обычной реакции, в секундах.</summary>
    public const double WallBotSeconds = 0.35;

    // Ивент «Раст»: следующие ячейки — две стрелки по очереди, сзади них надвигается чёрная дыра
    /// <summary>Сколько ячеек он добавляет к уровню.</summary>
    public const int RastCells = 40;
    /// <summary>Сколько секунд дыра идёт до игрока в начале и насколько далеко её можно отогнать.</summary>
    public const double RastStartGap = 3;
    /// <summary>Сколько секунд дыра стоит у левого края, пока гаснет мир: игрок должен увидеть её там и успеть среагировать.</summary>
    public const double RastPauseSeconds = 1;
    public const double RastMaxGap = 4;
    /// <summary>Насколько отгоняет верное нажатие и подпускает неверное, в секундах.</summary>
    public const double RastGain = 0.18;
    public const double RastWrong = 0.4;
    /// <summary>Сколько нажатий в секунду делает бот обычной реакции.</summary>
    public const double RastBotRate = 7.5;

    // Режим «Хардкор»: без пауз за ошибку, но ошибки ограничены
    /// <summary>Столько ошибок — и игрок выбывает.</summary>
    public const int HardcoreLives = 3;

    // Режим «Туман»
    /// <summary>Сколько ячеек видно, считая текущую.</summary>
    public const int FogSight = 3;

    // Режим «Откат»
    /// <summary>На сколько ячеек отбрасывает ошибка.</summary>
    public const int SetbackCells = 3;

    // Редактор уровней (см. LevelEndpoints)
    public const int EditorMinCells = 5;
    public const int EditorMaxCells = 400;
    /// <summary>Сколько секунд заполняется ячейка в обычном темпе: границы для автора.</summary>
    public const double EditorMinFill = 0.3;
    public const double EditorMaxFill = 3;
    public const int LevelNameMax = 32;
    public const int LevelAboutMax = 140;
    /// <summary>Сколько уровней (черновиков и опубликованных) может быть у одного игрока.</summary>
    public const int LevelsPerUser = 50;
    /// <summary>Сколько блоков, декораций и триггеров можно поставить на уровень.</summary>
    public const int EditorMaxObjects = 400;
    /// <summary>Насколько далеко от своей ячейки может стоять объект, в единицах сцены.</summary>
    public const double EditorObjectReach = 2000;
    /// <summary>Сколько групп объектов можно завести на уровне: их двигают и красят триггеры анимации.</summary>
    public const int EditorMaxGroup = 99;
    /// <summary>Шипы в быстром темпе: столько секунд ничего не нажимать (в обычном — время заполнения ячейки).</summary>
    public const double SpikeFastSeconds = 0.6;
    /// <summary>Столько секунд после входа на шипы нажатие не считается ударом: последний удар по стене или лишнее нажатие не наказывают.</summary>
    public const double SpikeGraceSeconds = 0.3;
    /// <summary>Лимит времени матча на своём уровне: столько раз дольше, чем нужно на сами ячейки, и не меньше обычного.</summary>
    public const double CustomTimeFactor = 3;
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
            RastDrain: 1.15),
        [Difficulty.Normal] = new("normal",
            MinSliders: 18, MaxSliders: 30, FastMinSliders: 60, FastMaxSliders: 90,
            MinFillSeconds: 0.6, MaxFillSeconds: 1.6,
            IdleDrainPerSecond: 0.35, WrongDrainPerSecond: 1.2,
            FastWrongStunSeconds: 0.5,
            BotReaction: 1, BotMistakes: 1,
            RastDrain: 1.5),
        [Difficulty.Hard] = new("hard",
            MinSliders: 27, MaxSliders: 39, FastMinSliders: 84, FastMaxSliders: 114,
            MinFillSeconds: 0.45, MaxFillSeconds: 1.2,
            IdleDrainPerSecond: 0.55, WrongDrainPerSecond: 1.7,
            FastWrongStunSeconds: 0.7,
            BotReaction: 0.6, BotMistakes: 0.4,
            RastDrain: 1.9),
    };

    public static DifficultyRules Rules(this Difficulty difficulty) => All[difficulty];

    public static string ToWire(this Difficulty difficulty) => All[difficulty].Wire;

    /// <summary>Неизвестная строка — нормальная сложность.</summary>
    public static Difficulty Parse(string? wire) =>
        All.Where(kv => kv.Value.Wire == wire).Select(kv => (Difficulty?)kv.Key).FirstOrDefault() ?? Difficulty.Normal;
}
