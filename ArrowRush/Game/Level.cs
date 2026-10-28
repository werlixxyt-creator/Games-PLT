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
}

public static class GameModes
{
    public static string ToWire(this GameMode mode) => mode == GameMode.Speed ? "speed" : "classic";

    public static GameMode Parse(string? mode) => mode == "speed" ? GameMode.Speed : GameMode.Classic;
}

/// <summary>Один ползунок: какую стрелку держать и сколько секунд он заполняется (в «Скорости» — 0).</summary>
public sealed record Slider(Arrow Arrow, double FillSeconds);

public static class LevelGenerator
{
    public static Slider[] Generate(GameMode mode, Random rnd)
    {
        var speed = mode == GameMode.Speed;
        var count = speed
            ? rnd.Next(GameRules.SpeedMinSliders, GameRules.SpeedMaxSliders + 1)
            : rnd.Next(GameRules.MinSliders, GameRules.MaxSliders + 1);
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

            var seconds = speed ? 0 : GameRules.MinFillSeconds
                          + rnd.NextDouble() * (GameRules.MaxFillSeconds - GameRules.MinFillSeconds);

            sliders[i] = new Slider(arrow, Math.Round(seconds, 2));
        }

        return sliders;
    }
}
