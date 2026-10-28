namespace ArrowRush.Game;

/// <summary>
/// Все настройки игры в одном месте — меняй здесь, чтобы подкрутить баланс.
/// </summary>
public static class GameRules
{
    // Сервер
    public const int TicksPerSecond = 20;

    // Матчмейкинг
    public const int MinPlayers = 2;
    public const int MaxPlayers = 4;
    /// <summary>Сколько ждать ещё игроков, когда в очереди уже есть двое.</summary>
    public const double GatherSeconds = 4;
    /// <summary>Через сколько секунд одиночке подставляется бот.</summary>
    public const double BotAfterSeconds = 12;

    // Матч
    public const double CountdownSeconds = 3;
    public const double MatchTimeLimitSeconds = 60;
    /// <summary>Сколько матч ещё идёт после финиша первого игрока.</summary>
    public const double AfterFirstFinishSeconds = 12;

    // Уровень
    public const int MinSliders = 6;
    public const int MaxSliders = 10;
    /// <summary>Время заполнения одного ползунка (сек), если держать правильную стрелку.</summary>
    public const double MinFillSeconds = 0.6;
    public const double MaxFillSeconds = 1.6;

    // Штрафы (доля ползунка в секунду)
    /// <summary>Ничего не нажато — ползунок медленно сползает.</summary>
    public const double IdleDrainPerSecond = 0.35;
    /// <summary>Зажата неправильная стрелка — ползунок быстро теряет прогресс.</summary>
    public const double WrongDrainPerSecond = 1.2;

    // Режим «Скорость»: одно нажатие — один ползунок
    public const int SpeedMinSliders = 20;
    public const int SpeedMaxSliders = 30;
    /// <summary>Нажал не ту стрелку — столько секунд нажатия не засчитываются.</summary>
    public const double SpeedWrongStunSeconds = 0.5;

    // Режим «Хардкор»: нажатия без пауз, но ошибки ограничены
    public const int HardcoreMinSliders = 25;
    public const int HardcoreMaxSliders = 35;
    /// <summary>Столько ошибок — и игрок выбывает.</summary>
    public const int HardcoreLives = 3;
}
