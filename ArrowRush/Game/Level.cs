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
/// </summary>
public sealed record Slider(Arrow Arrow, double FillSeconds, bool Chart = false, Arrow? Was = null);

public static class LevelGenerator
{
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

        AddCharts(sliders, fast, rnd);
        return sliders;
    }

    /// <summary>Расставляет чарты: за каждым идут одинаковые ячейки, прежняя стрелка остаётся в Was.</summary>
    private static void AddCharts(Slider[] sliders, bool fast, Random rnd)
    {
        var maxGap = fast ? GameRules.ChartMaxGapFast : GameRules.ChartMaxGap;
        var lastStart = sliders.Length - GameRules.ChartCells - 1;
        if (lastStart < 1) return;

        var at = rnd.Next(1, Math.Min(maxGap, lastStart + 1));
        while (at <= lastStart)
        {
            sliders[at] = sliders[at] with { Chart = true };
            var same = (Arrow)rnd.Next(4);
            for (var i = at + 1; i <= at + GameRules.ChartCells; i++)
            {
                sliders[i] = sliders[i] with { Arrow = same, Was = sliders[i].Arrow };
            }
            at += GameRules.ChartCells + 1 + rnd.Next(GameRules.ChartMinGap, maxGap);
        }
    }
}
