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
}

/// <summary>
/// Правила режима. Mirror — правильная стрелка противоположна нарисованной. Blind — клиент прячет следующие стрелки.
/// Lives &gt; 0 — столько ошибок можно сделать до выбывания (и пауз за ошибку нет).
/// </summary>
public sealed record ModeRules(string Wire, bool Mirror = false, bool Blind = false, int Lives = 0);

public static class GameModes
{
    private static readonly Dictionary<GameMode, ModeRules> All = new()
    {
        [GameMode.Classic] = new("classic"),
        [GameMode.Mirror] = new("mirror", Mirror: true),
        [GameMode.Blind] = new("blind", Blind: true),
        [GameMode.Hardcore] = new("hardcore", Lives: GameRules.HardcoreLives),
    };

    public static ModeRules Rules(this GameMode mode) => All[mode];

    public static string ToWire(this GameMode mode) => All[mode].Wire;

    /// <summary>Неизвестная строка — «Классика».</summary>
    public static GameMode Parse(string? mode) => All.FirstOrDefault(kv => kv.Value.Wire == mode).Key;
}

/// <summary>Один ползунок: какая стрелка нарисована и сколько секунд он заполняется (в быстром темпе — 0).</summary>
public sealed record Slider(Arrow Arrow, double FillSeconds);

public static class LevelGenerator
{
    /// <param name="fast">Быстрый темп: ползунок — одно нажатие, зато их больше.</param>
    public static Slider[] Generate(bool fast, DifficultyRules d, Random rnd)
    {
        var count = fast
            ? rnd.Next(d.FastMinSliders, d.FastMaxSliders + 1)
            : rnd.Next(d.MinSliders, d.MaxSliders + 1);
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

        return sliders;
    }
}
