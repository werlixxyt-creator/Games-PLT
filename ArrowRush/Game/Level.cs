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
/// </summary>
public sealed record Slider(Arrow Arrow, double FillSeconds, bool Chart = false, Arrow? Was = null, bool Swam = false, bool Ufo = false, string? Event = null, string? Zone = null, bool Wall = false);

public static class LevelGenerator
{
    /// <summary>
    /// Ивенты. Овердрайв — ячейки заполняются быстрее; остальное он меняет только на клиенте, как и шторм
    /// (темно, дальние ячейки видны при молнии) и переворот (мир отражается вверх ногами).
    /// </summary>
    public static readonly string[] Events = ["over", "storm", "flip"];

    /// <summary>Ивент «Раст»: он длиннее других и стоит отдельно, см. <see cref="AddRast"/>.</summary>
    public const string Rast = "rast";

    /// <summary>Ивент «Радуга»: человечки на радуге ставят стены, см. <see cref="AddRainbow"/>.</summary>
    public const string Rainbow = "rainbow";

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
    /// у всех равный шанс: свам, чарт, три ивента, «Радуга» и «Раст». Чарт самый длинный: у конца уровня, где он не помещается,
    /// выбор идёт из остальных. Ячейки «Раста» добавляются к уровню в конце, чтобы не сбить номера.
    /// </summary>
    private static Slider[] AddSpecials(Slider[] sliders, bool fast, Random rnd)
    {
        var maxGap = fast ? GameRules.ChartMaxGapFast : GameRules.ChartMaxGap;
        var lastStart = sliders.Length - new[] { GameRules.SwamCells, GameRules.EventCells, GameRules.RainbowCells }.Max() - 1;
        var lastChart = sliders.Length - GameRules.ChartCells - 1;
        if (lastStart < 1) return sliders;

        var rasts = new List<int>();
        var at = rnd.Next(1, Math.Min(maxGap / 2, lastStart + 1));
        while (at <= lastStart)
        {
            // чарт последний в списке: он выпадает из выбора, если не помещается
            var cells = rnd.Next(at > lastChart ? 6 : 7) switch
            {
                0 => AddSwam(sliders, at),
                1 => AddEvent(sliders, at, Events[0]),
                2 => AddEvent(sliders, at, Events[1]),
                3 => AddEvent(sliders, at, Events[2]),
                4 => MarkRast(sliders, at, rasts),
                5 => AddRainbow(sliders, at),
                _ => AddChart(sliders, at, rnd),
            };
            at += cells + 1 + rnd.Next(GameRules.ChartMinGap, maxGap);
        }

        // с конца: так вставка не сдвигает ещё не обработанные места
        foreach (var rast in Enumerable.Reverse(rasts)) sliders = AddRast(sliders, rast, rnd);
        return sliders;
    }

    /// <summary>«Радуга»: каждая вторая ячейка за особой становится стеной, между ними обычные ячейки.</summary>
    private static int AddRainbow(Slider[] sliders, int at)
    {
        sliders[at] = sliders[at] with { Event = Rainbow };
        for (var i = 1; i <= GameRules.RainbowCells; i++)
        {
            var cell = sliders[at + i] with { Zone = Rainbow };
            sliders[at + i] = i % 2 == 0 ? cell with { Wall = true, Was = cell.Arrow } : cell;
        }
        return GameRules.RainbowCells;
    }

    private static int MarkRast(Slider[] sliders, int at, List<int> rasts)
    {
        sliders[at] = sliders[at] with { Event = Rast };
        rasts.Add(at);
        return 0;
    }

    /// <summary>
    /// Ячейки «Раста»: они добавляются к уровню, поэтому помещаются и в короткий. Это две стрелки по очереди,
    /// скорости заполнения у них нет: проходятся нажатиями в любом темпе. Пока ивент не начался, они выглядят обычными (Was).
    /// </summary>
    private static Slider[] AddRast(Slider[] sliders, int at, Random rnd)
    {
        var first = (Arrow)rnd.Next(4);
        var second = (Arrow)(((int)first + 1 + rnd.Next(3)) % 4);
        var zone = Enumerable.Range(0, GameRules.RastCells)
            .Select(i => new Slider(i % 2 == 0 ? first : second, 0, Was: (Arrow)rnd.Next(4), Zone: Rast));

        return [.. sliders.Take(at + 1), .. zone, .. sliders.Skip(at + 1)];
    }

    /// <summary>Ивент на следующие ячейки. Выглядят они как обычные, пока он не начался.</summary>
    private static int AddEvent(Slider[] sliders, int at, string name)
    {
        sliders[at] = sliders[at] with { Event = name };
        for (var i = at + 1; i <= at + GameRules.EventCells; i++)
        {
            var seconds = sliders[i].FillSeconds * (name == "over" ? GameRules.OverdriveFill : 1);
            sliders[i] = sliders[i] with { Zone = name, FillSeconds = Math.Round(seconds, 2) };
        }
        return GameRules.EventCells;
    }

    /// <summary>Чарт: за ним идут одинаковые ячейки, прежняя стрелка остаётся в Was.</summary>
    private static int AddChart(Slider[] sliders, int at, Random rnd)
    {
        sliders[at] = sliders[at] with { Chart = true };
        var same = (Arrow)rnd.Next(4);
        for (var i = at + 1; i <= at + GameRules.ChartCells; i++)
        {
            sliders[i] = sliders[i] with { Arrow = same, Was = sliders[i].Arrow };
        }
        return GameRules.ChartCells;
    }

    /// <summary>Свам: следующие ячейки становятся препятствиями, прежняя стрелка остаётся в Was. До первой из них лететь дольше: идёт сцена прилёта НЛО.</summary>
    private static int AddSwam(Slider[] sliders, int at)
    {
        sliders[at] = sliders[at] with { Swam = true };
        for (var i = at + 1; i <= at + GameRules.SwamCells; i++)
        {
            var seconds = i == at + 1 ? GameRules.SwamIntroSeconds : GameRules.SwamCellSeconds;
            sliders[i] = sliders[i] with { FillSeconds = seconds, Was = sliders[i].Arrow, Ufo = true };
        }
        return GameRules.SwamCells;
    }
}
