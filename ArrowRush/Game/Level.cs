namespace ArrowRush.Game;

/// <summary>Стрелки кодируются числом 0..3, на клиенте так же.</summary>
public enum Arrow
{
    Left = 0,
    Up = 1,
    Right = 2,
    Down = 3,
}

/// <summary>
/// Режим игры. В базе хранится числом, клиенту передаётся строкой (см. <see cref="GameModes"/>).
/// Темп (обычный — держать стрелку, быстрый — нажимать) выбирается отдельно для любого режима.
/// </summary>
public enum GameMode
{
    /// <summary>Без особых правил.</summary>
    Classic = 0,
    // 1 — бывшая «Скорость», теперь это «Классика» в быстром темпе (старые записи переносит Database.EnsureDatabase)
    /// <summary>Правильная стрелка — противоположная нарисованной.</summary>
    Mirror = 2,
    /// <summary>Видна только текущая стрелка.</summary>
    Blind = 3,
    /// <summary>После нескольких ошибок игрок выбывает (зато без пауз за ошибку).</summary>
    Hardcore = 4,
    /// <summary>Две команды по двое: побеждает команда того, кто финишировал первым.</summary>
    Teams = 5,
    /// <summary>То же, что <see cref="Teams"/>, но команды по пять человек и уровень длиннее.</summary>
    Teams5 = 6,
    /// <summary>Уровень вдвое короче.</summary>
    Sprint = 7,
    /// <summary>Уровень в три раза длиннее.</summary>
    Marathon = 8,
    /// <summary>Видно только несколько ячеек вперёд.</summary>
    Fog = 9,
    /// <summary>Ошибка отбрасывает на несколько ячеек назад.</summary>
    Setback = 10,
    /// <summary>Первая ошибка выбивает из матча.</summary>
    OneLife = 11,
}

/// <summary>
/// Правила режима. Mirror — правильная стрелка противоположна нарисованной.
/// Sight &gt; 0 — сколько ячеек видно, считая текущую: дальше клиент прячет стрелки.
/// Setback &gt; 0 — на сколько ячеек отбрасывает ошибка (и пауз за ошибку нет).
/// Lives &gt; 0 — столько ошибок можно сделать до выбывания (и пауз за ошибку нет).
/// TeamSize &gt; 0 — игроки делятся на две команды такого размера, матч заканчивается на первом финише;
/// пустые места занимают боты. LevelScale — во сколько раз уровень длиннее обычного (и лимит времени тоже).
/// </summary>
public sealed record ModeRules(string Wire, bool Mirror = false, int Sight = 0, int Lives = 0, int Setback = 0, int TeamSize = 0, double LevelScale = 1)
{
    public bool Teams => TeamSize > 0;

    /// <summary>Сколько мест в матче: все команды или обычный максимум.</summary>
    public int Seats => Teams ? TeamSize * GameRules.TeamCount : GameRules.MaxPlayers;
}

public static class GameModes
{
    private static readonly Dictionary<GameMode, ModeRules> All = new()
    {
        [GameMode.Classic] = new("classic"),
        [GameMode.Mirror] = new("mirror", Mirror: true),
        [GameMode.Blind] = new("blind", Sight: 1),
        [GameMode.Hardcore] = new("hardcore", Lives: GameRules.HardcoreLives),
        [GameMode.Teams] = new("teams", TeamSize: 2),
        [GameMode.Teams5] = new("teams5", TeamSize: 5, LevelScale: 4),
        [GameMode.Sprint] = new("sprint", LevelScale: 0.5),
        [GameMode.Marathon] = new("marathon", LevelScale: 3),
        [GameMode.Fog] = new("fog", Sight: GameRules.FogSight),
        [GameMode.Setback] = new("setback", Setback: GameRules.SetbackCells),
        [GameMode.OneLife] = new("onelife", Lives: 1),
    };

    public static ModeRules Rules(this GameMode mode) => All[mode];

    public static string ToWire(this GameMode mode) => All[mode].Wire;

    /// <summary>Неизвестная строка — «Классика».</summary>
    public static GameMode Parse(string? mode) => All.FirstOrDefault(kv => kv.Value.Wire == mode).Key;
}

/// <summary>
/// Один ползунок: какая стрелка нарисована и сколько секунд он заполняется (в быстром темпе — 0).
/// Chart — ячейка «Чарт». Was — у ячеек за чартом: какой стрелкой она выглядит, пока чарт не пройден.
/// Считается всегда Arrow: дойти до этих ячеек раньше чарта нельзя.
/// Swam — ячейка «Свам», проходится как обычная. Ufo — ячейка за ней: её надо перепрыгнуть с НЛО,
/// стрелка здесь не важна, а FillSeconds — сколько НЛО к ней подлетает. Пока свам не пройден,
/// она выглядит обычной ячейкой со стрелкой Was.
/// Event — ячейка ивента (см. <see cref="LevelGenerator.Events"/>), проходится как обычная. Zone — ячейка за ней: тот же ивент в действии.
/// Wall — стена «Радуги»: её ломают нажатиями любой клавиши. Пока ивент не начался, она выглядит обычной ячейкой со стрелкой Was.
/// Lane — ячейка «Кловда»: стрелка летит по этой линии (0 — потолок, 1 — пол), FillSeconds — через сколько она долетит до игрока.
/// Препятствия из редактора: Wall без Zone — отдельная стена, жизни у неё не тают. Spike — шипы: ячейка проходит сама,
/// пока ничего не нажато, а нажатие — удар. Fake — обман: до неё видна стрелка Was, настоящая открывается, когда игрок дошёл.
/// </summary>
public sealed record Slider(Arrow Arrow, double FillSeconds, bool Chart = false, Arrow? Was = null, bool Swam = false, bool Ufo = false, string? Event = null, string? Zone = null, bool Wall = false, int? Lane = null,
    bool Spike = false, bool Fake = false);

/// <summary>
/// Уровень из редактора, готовый к матчу. Revision — номер правки: прохождение автора засчитывается,
/// только если уровень с тех пор не менялся.
/// </summary>
public sealed record PlayableLevel(int Id, string Name, string AuthorId, int Revision, bool Fast, Difficulty Difficulty, string Theme, bool Published, Slider[] Sliders,
    IReadOnlyList<LevelObject> Objects);

/// <summary>
/// Ячейка редактора уровней: стрелка 0..3, секунды заполнения в обычном темпе, особая ячейка (см. <see cref="LevelGenerator.EditorSpecials"/>) или null,
/// препятствие (см. <see cref="LevelGenerator.EditorObstacles"/>) или null.
/// </summary>
public sealed record EditorCell(int A, double F, string? S = null, string? O = null, int N = 0, double P = 0);

/// <summary>
/// Блок, декорация или триггер из редактора (виды — <see cref="LevelGenerator.EditorObjects"/>). На игру сервер их не тратит:
/// рисует и запускает их клиент. C — номер ячейки, к которой объект привязан, X и Y — сдвиг от её стрелки,
/// S — размер, V — цвет, текст или сила триггера, R — поворот в градусах, W и H — растяжение по ширине и высоте,
/// Fx и Fy — отражение, A — непрозрачность, Z — слой (0 — за дорогой, 1 — перед ней), G — сила свечения.
/// Gr — группа: у объекта — в какой он группе, у триггера анимации — какую группу двигает (0 — все объекты).
/// Настройки триггера (их выполняет клиент, trigrun.js): P и Q — числа (сдвиг, угол, сила…), D — длительность,
/// E — плавность 0–9 (easecurve.js), B — своя кривая плавности "x1,y1,x2,y2". L — слой редактора (только для редактора, на игру не влияет).
/// </summary>
public sealed record LevelObject(string K, int C, double X, double Y, double S = 1, string? V = null, double R = 0,
    double W = 1, double H = 1, bool Fx = false, bool Fy = false, double A = 1, int Z = 0, double G = 0,
    int Gr = 0, double P = 0, double Q = 0, double D = 0, int E = 0, string? B = null, int L = 0);

public static class LevelGenerator
{
    /// <summary>
    /// Ивенты. Овердрайв — ячейки заполняются быстрее; остальное он меняет только на клиенте, как и шторм
    /// (темно, дальние ячейки видны при молнии) и переворот (мир отражается вверх ногами).
    /// </summary>
    public static readonly string[] Events = ["over", "storm", "flip"];

    /// <summary>Ивент «Раст»: он длиннее других и стоит отдельно, см. <see cref="AddRast"/>.</summary>
    public const string Rast = "rast";

    /// <summary>Ивент «Радуга»: глаза с крыльями ставят стены, см. <see cref="AddRainbow"/>. Его ячейка выглядит обычной: он начинается внезапно.</summary>
    public const string Rainbow = "rainbow";

    /// <summary>Ивент «Кловд»: игрок становится пауком и уклоняется от стрелок, см. <see cref="AddCloud"/>.</summary>
    public const string Cloud = "cloud";

    /// <param name="fast">Быстрый темп: ползунок — одно нажатие, зато их больше.</param>
    /// <param name="scale">Во сколько раз уровень длиннее обычного.</param>
    public static Slider[] Generate(bool fast, DifficultyRules d, Random rnd, double scale = 1)
    {
        var count = (int)Math.Round(scale * (fast
            ? rnd.Next(d.FastMinSliders, d.FastMaxSliders + 1)
            : rnd.Next(d.MinSliders, d.MaxSliders + 1)));
        var sliders = new Slider[count];

        for (var i = 0; i < count; i++)
        {
            Arrow arrow;
            do
            {
                arrow = (Arrow)rnd.Next(4);
            }
            // не больше двух одинаковых стрелок подряд — иначе скучно
            while (i >= 2 && arrow == sliders[i - 1].Arrow && arrow == sliders[i - 2].Arrow);

            var seconds = fast ? 0 : d.MinFillSeconds
                          + rnd.NextDouble() * (d.MaxFillSeconds - d.MinFillSeconds);

            sliders[i] = new Slider(arrow, Math.Round(seconds, 2));
        }

        return AddSpecials(sliders, fast, rnd);
    }

    /// <summary>
    /// Расставляет особые ячейки так, чтобы их участки не пересекались. Для каждой выбирается одно из явлений,
    /// шанс зависит от веса (см. <see cref="GameRules"/>). «Радуга» бывает не больше раза за уровень.
    /// Чарт самый длинный: у конца уровня, где он не помещается, выбор идёт из остальных.
    /// Ячейки «Раста» и «Кловда» добавляются к уровню в конце, чтобы не сбить номера, поэтому помещаются всегда.
    /// </summary>
    private static Slider[] AddSpecials(Slider[] sliders, bool fast, Random rnd)
    {
        var maxGap = fast ? GameRules.ChartMaxGapFast : GameRules.ChartMaxGap;
        var lastStart = sliders.Length - new[] { GameRules.SwamCells, GameRules.EventCells, GameRules.RainbowCells }.Max() - 1;
        var lastChart = sliders.Length - GameRules.ChartCells - 1;
        if (lastStart < 1) return sliders;

        var added = new List<(int At, string Name)>();
        var rainbow = false;
        var at = rnd.Next(1, Math.Min(maxGap / 2, lastStart + 1));
        while (at <= lastStart)
        {
            var spot = at;
            var kinds = new List<(int Weight, Func<int> Add)>
            {
                (GameRules.SpecialWeight, () => AddSwam(sliders, spot)),
                (GameRules.SpecialWeight, () => AddEvent(sliders, spot, Events[0])),
                (GameRules.SpecialWeight, () => AddEvent(sliders, spot, Events[1])),
                (GameRules.SpecialWeight, () => AddEvent(sliders, spot, Events[2])),
                (GameRules.SpecialWeight, () => MarkAdded(sliders, spot, Rast, added)),
                (GameRules.CloudWeight, () => MarkAdded(sliders, spot, Cloud, added)),
            };
            if (!rainbow) kinds.Add((GameRules.RainbowWeight, () => { rainbow = true; return AddRainbow(sliders, spot); }));
            if (at <= lastChart) kinds.Add((GameRules.SpecialWeight, () => AddChart(sliders, spot, rnd)));

            var roll = rnd.Next(kinds.Sum(k => k.Weight));
            var picked = kinds.First(k => (roll -= k.Weight) < 0);
            at += picked.Add() + 1 + rnd.Next(GameRules.ChartMinGap, maxGap);
        }

        // с конца: так вставка не сдвигает ещё не обработанные места
        foreach (var (spot, name) in Enumerable.Reverse(added))
            sliders = name == Rast ? AddRast(sliders, spot, rnd) : AddCloud(sliders, spot, rnd);
        return sliders;
    }

    /// <summary>
    /// Настройки особой ячейки в редакторе: N — длина (сколько ячеек меняет или сколько добавляет), P — сила.
    /// Adds — «Раст» и «Кловд» добавляют свои ячейки к уровню, поэтому места за ними не нужно.
    /// HasP — есть ли у явления сила: у «Свама» и «Кловда» это секунды на ячейку, у «Овердрайва» — множитель времени заполнения.
    /// </summary>
    public sealed record SpecialSettings(int DefN, int MinN, int MaxN, bool Adds = false, bool HasP = false, double DefP = 0, double MinP = 0, double MaxP = 0)
    {
        /// <summary>Длина с учётом выбора автора: 0 — по умолчанию.</summary>
        public int N(EditorCell c) => c.N == 0 ? DefN : Math.Clamp(c.N, MinN, MaxN);
        public double P(EditorCell c) => !HasP || c.P == 0 ? DefP : Math.Clamp(c.P, MinP, MaxP);
        /// <summary>Сколько ячеек уровня за особой занимает её участок.</summary>
        public int Span(EditorCell c) => Adds ? 0 : N(c);
    }

    /// <summary>
    /// Особые ячейки, которые автор ставит в редакторе, и их настройки. За особой ячейкой должно идти столько обычных,
    /// сколько она меняет, и другая особая не может стоять среди них. Те же числа знает редактор (levels.js, SPECIALS).
    /// </summary>
    public static readonly Dictionary<string, SpecialSettings> EditorSpecials = new()
    {
        ["chart"] = new(GameRules.ChartCells, 3, 20),
        ["swam"] = new(GameRules.SwamCells, 2, 12, HasP: true, DefP: GameRules.SwamCellSeconds, MinP: 0.8, MaxP: 1.6),
        [Events[0]] = new(GameRules.EventCells, 2, 20, HasP: true, DefP: GameRules.OverdriveFill, MinP: 0.3, MaxP: 0.9),
        [Events[1]] = new(GameRules.EventCells, 2, 20),
        [Events[2]] = new(GameRules.EventCells, 2, 20),
        [Rainbow] = new(GameRules.RainbowCells, 2, 16),
        [Rast] = new(GameRules.RastCells, 10, 80, Adds: true),
        [Cloud] = new(GameRules.CloudCells, 4, 16, Adds: true, HasP: true, DefP: GameRules.CloudCellSeconds, MinP: 0.45, MaxP: 1.2),
    };

    /// <summary>
    /// Уровень из редактора: ячейки автора и его особые ячейки, с той же механикой, что у случайных уровней.
    /// Чарт делает следующие ячейки такими же, как он сам. rnd — для того, что в «Расте» и «Кловде» выбирает игра;
    /// с одним и тем же seed уровень всегда одинаковый. Ячейки уже проверены (см. LevelEndpoints.Validate).
    /// </summary>
    public static Slider[] FromEditor(IReadOnlyList<EditorCell> cells, bool fast, Random rnd)
    {
        var sliders = cells.Select(c => c.O switch
        {
            // стена до удара выглядит своей стрелкой, обман — противоположной
            "wall" => new Slider((Arrow)c.A, 0, Wall: true, Was: (Arrow)c.A),
            "spike" => new Slider((Arrow)c.A, fast ? GameRules.SpikeFastSeconds : Math.Round(c.F, 2), Spike: true),
            "fake" => new Slider((Arrow)c.A, fast ? 0 : Math.Round(c.F, 2), Was: (Arrow)((c.A + 2) % 4), Fake: true),
            _ => new Slider((Arrow)c.A, fast ? 0 : Math.Round(c.F, 2)),
        }).ToArray();
        var added = new List<(int At, string Name)>();
        for (var i = 0; i < cells.Count; i++)
        {
            var c = cells[i];
            if (c.S is null || !EditorSpecials.TryGetValue(c.S, out var set)) continue;
            var n = set.N(c);
            switch (c.S)
            {
                case "chart": AddChart(sliders, i, rnd, sliders[i].Arrow, n); break;
                case "swam": AddSwam(sliders, i, n, set.P(c)); break;
                case Rainbow: AddRainbow(sliders, i, n); break;
                case Rast or Cloud: MarkAdded(sliders, i, c.S, added); break;
                case { } name when Events.Contains(name): AddEvent(sliders, i, name, n, name == "over" ? set.P(c) : 1); break;
            }
        }
        // с конца: так вставка не сдвигает ещё не обработанные места
        foreach (var (spot, name) in Enumerable.Reverse(added))
        {
            var c = cells[spot];
            var set = EditorSpecials[name];
            sliders = name == Rast ? AddRast(sliders, spot, rnd, set.N(c)) : AddCloud(sliders, spot, rnd, set.N(c), set.P(c));
        }
        return sliders;
    }

    /// <summary>Препятствия, которые автор ставит на ячейку. Особой ячейкой и ячейкой внутри её участка оно быть не может.</summary>
    public static readonly HashSet<string> EditorObstacles = ["wall", "spike", "fake"];

    /// <summary>Виды объектов редактора: блоки, декор и триггеры (t-…). Как они выглядят и что делают — levelobj.js и trigrun.js.</summary>
    public static readonly HashSet<string> EditorObjects =
    [
        // блоки
        "block", "b-gem", "b-inset", "b-grid", "b-panel", "b-brick", "b-stone", "b-metal", "b-crate",
        "b-hazard", "b-tech", "b-dark", "b-frame", "b-checker", "b-studs",
        "b-ice", "b-lava", "b-wood", "b-gold", "b-dots", "b-stripes", "b-diamond", "b-neon",
        // формы и склоны
        "half", "small", "slab", "pillar", "plank", "step", "cross", "s-circle", "s-semi", "s-hex", "s-octa", "s-ring", "s-arch",
        "ramp", "ramp2", "ramp-half", "wedge", "curve",
        // стекло
        "g-block", "g-half", "g-pane", "g-ramp", "g-tile", "g-crack", "g-shards", "g-orb", "g-gem", "g-tube",
        // эффекты
        "fx-boom", "fx-bang", "fx-spark", "fx-fire", "fx-smoke", "fx-bolt", "fx-debris", "fx-confetti", "fx-beam",
        "fx-ring", "fx-portal", "fx-glitch", "fx-laser",
        // декор (cloud и ring остались от прошлых версий: в палитре их нет, но старые уровни их рисуют)
        "text", "star", "crystal", "lamp", "d-gear", "d-arrow", "d-sign", "d-flag", "d-chain", "d-pipe", "d-grass", "d-heart", "d-moon",
        "d-tree", "d-cactus", "d-skull", "d-eye", "d-coin", "d-key", "d-torch", "d-bush", "d-mushroom", "d-planet",
        "cloud", "ring",
        // триггеры мира и камеры
        "t-color", "t-bg", "t-ground", "t-bgimg", "t-effect", "t-dark", "t-flash", "t-shake", "t-zoom", "t-tilt", "t-offset", "t-msg",
        "t-camspin", "t-camreset", "t-hue", "t-letterbox", "t-invert",
        // триггеры анимации групп
        "t-move", "t-rotate", "t-spin", "t-scale", "t-alpha", "t-toggle", "t-gcolor", "t-pulse", "t-stop", "t-oscill", "t-orbit",
    ];

    /// <summary>Номер ячейки редактора → номер ползунка в матче: «Раст» и «Кловд» вставляют свои ячейки и сдвигают следующие.</summary>
    public static int[] EditorIndexMap(IReadOnlyList<EditorCell> cells)
    {
        var map = new int[cells.Count];
        var shift = 0;
        for (var i = 0; i < cells.Count; i++)
        {
            map[i] = i + shift;
            if (cells[i].S is { } s && EditorSpecials.TryGetValue(s, out var set) && set.Adds) shift += set.N(cells[i]);
        }
        return map;
    }

    /// <summary>«Радуга»: каждая вторая ячейка за особой становится стеной, между ними обычные ячейки. n — длина участка.</summary>
    private static int AddRainbow(Slider[] sliders, int at, int n = GameRules.RainbowCells)
    {
        sliders[at] = sliders[at] with { Event = Rainbow };
        for (var i = 1; i <= n; i++)
        {
            var cell = sliders[at + i] with { Zone = Rainbow };
            sliders[at + i] = i % 2 == 0 ? cell with { Wall = true, Was = cell.Arrow } : cell;
        }
        return n;
    }

    /// <summary>
    /// Ячейки «Кловда» добавляются к уровню: на каждую одна стрелка по случайной линии, но не больше трёх подряд по одной.
    /// Пока ивент не начался, они выглядят обычными (Was). n — сколько стрелок, seconds — через сколько прилетает следующая.
    /// </summary>
    private static Slider[] AddCloud(Slider[] sliders, int at, Random rnd, int n = GameRules.CloudCells, double seconds = GameRules.CloudCellSeconds)
    {
        var zone = new List<Slider>();
        int last = -1, run = 0;
        for (var i = 0; i < n; i++)
        {
            var lane = rnd.Next(2);
            if (lane == last && run >= 3) lane = 1 - lane;
            run = lane == last ? run + 1 : 1;
            last = lane;
            zone.Add(new Slider(lane == 0 ? Arrow.Up : Arrow.Down, i == 0 ? GameRules.CloudIntroSeconds : seconds, Was: (Arrow)rnd.Next(4), Zone: Cloud, Lane: lane));
        }
        return [.. sliders.Take(at + 1), .. zone, .. sliders.Skip(at + 1)];
    }

    /// <summary>Ячейка явления, чьи ячейки добавятся к уровню позже: сама она ничего не занимает.</summary>
    private static int MarkAdded(Slider[] sliders, int at, string name, List<(int At, string Name)> added)
    {
        sliders[at] = sliders[at] with { Event = name };
        added.Add((at, name));
        return 0;
    }

    /// <summary>
    /// Ячейки «Раста»: они добавляются к уровню, поэтому помещаются и в короткий. Это две стрелки по очереди,
    /// скорости заполнения у них нет: проходятся нажатиями в любом темпе. Пока ивент не начался, они выглядят обычными (Was).
    /// </summary>
    private static Slider[] AddRast(Slider[] sliders, int at, Random rnd, int n = GameRules.RastCells)
    {
        var first = (Arrow)rnd.Next(4);
        var second = (Arrow)(((int)first + 1 + rnd.Next(3)) % 4);
        var zone = Enumerable.Range(0, n)
            .Select(i => new Slider(i % 2 == 0 ? first : second, 0, Was: (Arrow)rnd.Next(4), Zone: Rast));

        return [.. sliders.Take(at + 1), .. zone, .. sliders.Skip(at + 1)];
    }

    /// <summary>Ивент на следующие n ячеек. Выглядят они как обычные, пока он не начался. over — во сколько раз быстрее заполняются ячейки «Овердрайва».</summary>
    private static int AddEvent(Slider[] sliders, int at, string name, int n = GameRules.EventCells, double over = GameRules.OverdriveFill)
    {
        sliders[at] = sliders[at] with { Event = name };
        for (var i = at + 1; i <= at + n; i++)
        {
            var seconds = sliders[i].FillSeconds * (name == "over" ? over : 1);
            sliders[i] = sliders[i] with { Zone = name, FillSeconds = Math.Round(seconds, 2) };
        }
        return n;
    }

    /// <summary>Чарт: за ним идут n одинаковых ячеек, прежняя стрелка остаётся в Was. same — какой стрелкой, иначе случайной.</summary>
    private static int AddChart(Slider[] sliders, int at, Random rnd, Arrow? chosen = null, int n = GameRules.ChartCells)
    {
        sliders[at] = sliders[at] with { Chart = true };
        var same = chosen ?? (Arrow)rnd.Next(4);
        for (var i = at + 1; i <= at + n; i++)
        {
            sliders[i] = sliders[i] with { Arrow = same, Was = sliders[i].Arrow };
        }
        return n;
    }

    /// <summary>Свам: следующие n ячеек становятся препятствиями, прежняя стрелка остаётся в Was. До первой из них лететь дольше: идёт сцена прилёта НЛО. seconds — сколько НЛО летит до следующей.</summary>
    private static int AddSwam(Slider[] sliders, int at, int n = GameRules.SwamCells, double seconds = GameRules.SwamCellSeconds)
    {
        sliders[at] = sliders[at] with { Swam = true };
        for (var i = at + 1; i <= at + n; i++)
        {
            sliders[i] = sliders[i] with { FillSeconds = i == at + 1 ? GameRules.SwamIntroSeconds : seconds, Was = sliders[i].Arrow, Ufo = true };
        }
        return n;
    }
}
