namespace ArrowRush.Game;

/// <summary>Стрелки кодируются числом 0..3, на клиенте так же.</summary>
public enum Arrow
{
    Left = 0,
    Up = 1,
    Right = 2,
    Down = 3,
}

/// <summary>Режим игры. В базе хранится числом, клиенту передаётся строкой (см. <see cref="GameModes"/>).</summary>
public enum GameMode
{
    /// <summary>Держи стрелку, пока ползунок не заполнится.</summary>
    Classic = 0,
    /// <summary>Одно нажатие — один ползунок, но их больше.</summary>
    Speed = 1,
    /// <summary>Как «Классика», но держать надо противоположную стрелку.</summary>
    Mirror = 2,
    /// <summary>Как «Скорость», но видна только текущая стрелка.</summary>
    Blind = 3,
    /// <summary>Нажатия без пауз за ошибку, но после нескольких ошибок игрок выбывает.</summary>
    Hardcore = 4,
}

/// <summary>
/// Правила режима. Press — ползунок заполняется одним нажатием, иначе его надо держать.
/// Mirror — правильная стрелка противоположна нарисованной. Blind — клиент прячет следующие стрелки.
/// Lives &gt; 0 — столько ошибок можно сделать до выбывания (и пауз за ошибку нет).
/// </summary>
public sealed record ModeRules(string Wire, bool Press, int MinSliders, int MaxSliders, bool Mirror = false, bool Blind = false, int Lives = 0);

public static class GameModes
{
    private static readonly Dictionary<GameMode, ModeRules> All = new()
    {
        [GameMode.Classic] = new("classic", Press: false, GameRules.MinSliders, GameRules.MaxSliders),
        [GameMode.Speed] = new("speed", Press: true, GameRules.SpeedMinSliders, GameRules.SpeedMaxSliders),
        [GameMode.Mirror] = new("mirror", Press: false, GameRules.MinSliders, GameRules.MaxSliders, Mirror: true),
        [GameMode.Blind] = new("blind", Press: true, GameRules.SpeedMinSliders, GameRules.SpeedMaxSliders, Blind: true),
        [GameMode.Hardcore] = new("hardcore", Press: true, GameRules.HardcoreMinSliders, GameRules.HardcoreMaxSliders, Lives: GameRules.HardcoreLives),
    };

    public static ModeRules Rules(this GameMode mode) => All[mode];

    public static string ToWire(this GameMode mode) => All[mode].Wire;

    /// <summary>Неизвестная строка — «Классика».</summary>
    public static GameMode Parse(string? mode) => All.FirstOrDefault(kv => kv.Value.Wire == mode).Key;
}

/// <summary>Один ползунок: какая стрелка нарисована и сколько секунд он заполняется (в режимах с нажатиями — 0).</summary>
public sealed record Slider(Arrow Arrow, double FillSeconds);

public static class LevelGenerator
{
    public static Slider[] Generate(GameMode mode, Random rnd)
    {
        var rules = mode.Rules();
        var count = rnd.Next(rules.MinSliders, rules.MaxSliders + 1);
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

            var seconds = rules.Press ? 0 : GameRules.MinFillSeconds
                          + rnd.NextDouble() * (GameRules.MaxFillSeconds - GameRules.MinFillSeconds);

            sliders[i] = new Slider(arrow, Math.Round(seconds, 2));
        }

        return sliders;
    }
}
