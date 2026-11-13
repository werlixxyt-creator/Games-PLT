namespace ArrowRush.Game;

/// <summary>
/// Рейтинг и ранги. Рейтинг меняют только рейтинговые матчи: не тренировка, не лобби и не уровень из редактора.
/// За место дают очки: первый +30, последний −20, между ними — поровну; в командах победа +25, поражение −15.
/// Вышел из матча — −25. Сложность умножает: лёгкая ×0,6, сложная ×1,3. Ниже старта потери вдвое меньше.
/// Те же ранги в app.js (RANKS) — меняй вместе.
/// </summary>
public static class Ranks
{
    public const int Start = 1000;

    /// <summary>С какого рейтинга начинается ранг.</summary>
    public static readonly (int From, string Id, string Name)[] All =
    [
        (0, "bronze", "Бронза"),
        (1100, "silver", "Серебро"),
        (1300, "gold", "Золото"),
        (1500, "platinum", "Платина"),
        (1700, "diamond", "Алмаз"),
        (1900, "master", "Мастер"),
        (2200, "legend", "Легенда"),
    ];

    public static string Of(int rating) => All.Last(r => rating >= r.From).Id;

    /// <summary>Очки за матч по месту, без учёта рейтинга игрока (его знает только база, см. <see cref="Apply"/>).</summary>
    public static int Raw(int place, int players, bool teams, bool won, bool left, Difficulty difficulty)
    {
        double d = left ? -25
            : teams ? (won ? 25 : -15)
            : players < 2 ? 0
            : 30 - 50.0 * (place - 1) / (players - 1);
        d *= difficulty switch { Difficulty.Easy => 0.6, Difficulty.Hard => 1.3, _ => 1 };
        return (int)Math.Round(d);
    }

    /// <summary>Сколько рейтинга на самом деле изменится: ниже старта потери вдвое меньше, и ниже нуля он не падает.</summary>
    public static int Apply(int raw, int rating)
    {
        var d = raw < 0 && rating < Start ? (int)Math.Round(raw / 2.0) : raw;
        return Math.Max(-rating, d);
    }
}
