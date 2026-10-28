namespace ArrowRush.Data;

/// <summary>За что открывается скин.</summary>
public enum Unlock
{
    Free,
    Games,
    Wins,
    Sliders,
    /// <summary>Лучшая серия побед подряд.</summary>
    Streak,
}

/// <summary>
/// Скин. Slot — куда он надевается: ползунки, эффект победы или эффект серии побед.
/// Как скин выглядит, знает только клиент (по Id), сервер решает, открыт ли он.
/// </summary>
public sealed record Skin(string Slot, string Id, string Name, Unlock By = Unlock.Free, int Need = 0);

/// <summary>Достижения игрока, по которым открываются скины.</summary>
public sealed record Achievements(int Games, int Wins, int Sliders, int Streak, int BestStreak)
{
    public int Value(Unlock by) => by switch
    {
        Unlock.Games => Games,
        Unlock.Wins => Wins,
        Unlock.Sliders => Sliders,
        Unlock.Streak => BestStreak,
        _ => 0,
    };

    public bool Has(Skin skin) => Value(skin.By) >= skin.Need;
}

public static class Skins
{
    public const string Slider = "slider";
    public const string Win = "win";
    public const string StreakSlot = "streak";

    /// <summary>Первый скин каждого слота — бесплатный, он надет по умолчанию.</summary>
    public static readonly Skin[] All =
    [
        new(Slider, "classic", "Классика"),
        new(Slider, "neon", "Неон", Unlock.Games, 1),
        new(Slider, "candy", "Карамель", Unlock.Wins, 3),
        new(Slider, "pixel", "Пиксели", Unlock.Sliders, 300),
        new(Slider, "gold", "Золото", Unlock.Wins, 15),
        new(Slider, "rainbow", "Радуга", Unlock.Streak, 5),

        new(Win, "confetti", "Конфетти"),
        new(Win, "stars", "Звездопад", Unlock.Wins, 1),
        new(Win, "snow", "Снегопад", Unlock.Wins, 5),
        new(Win, "fireworks", "Салют", Unlock.Wins, 25),

        new(StreakSlot, "flame", "Пламя"),
        new(StreakSlot, "electric", "Молнии", Unlock.Streak, 3),
        new(StreakSlot, "rainbow", "Радуга", Unlock.Streak, 8),
    ];

    public static readonly string[] SliderIds = All.Where(s => s.Slot == Slider).Select(s => s.Id).ToArray();

    public static Skin? Find(string? slot, string? id) => All.FirstOrDefault(s => s.Slot == slot && s.Id == id);

    /// <summary>Надетый скин слота; пусто или неизвестный — скин по умолчанию.</summary>
    public static string Equipped(string slot, string? stored) =>
        Find(slot, stored)?.Id ?? All.First(s => s.Slot == slot).Id;
}
