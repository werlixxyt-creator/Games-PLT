using ArrowRush.Data;

namespace ArrowRush.Game;

public enum MatchPhase
{
    Countdown,
    Running,
    Finished,
}

public sealed class Player
{
    public required int Slot { get; init; }
    public required string Name { get; init; }
    public string? ConnectionId { get; init; }
    /// <summary>Id аккаунта, у бота — null.</summary>
    public string? UserId { get; init; }
    /// <summary>Скин ползунков — его видят и соперники.</summary>
    public string Skin { get; init; } = "classic";
    public bool IsBot => ConnectionId is null;

    /// <summary>Номер текущего ползунка. Равен длине уровня, когда игрок финишировал.</summary>
    public int Index { get; set; }

    /// <summary>Заполненность текущего ползунка, 0..1.</summary>
    public double Progress { get; set; }

    /// <summary>Битовая маска зажатых стрелок: бит N = стрелка N (см. <see cref="Arrow"/>).</summary>
    public int HeldMask { get; set; }

    /// <summary>«Скорость»: до этого игрового времени нажатия не засчитываются (штраф за ошибку).</summary>
    public double StunUntil { get; set; } = double.NegativeInfinity;

    /// <summary>«Хардкор»: сколько раз нажал не ту стрелку; Out — ошибки кончились, игрок выбыл.</summary>
    public int Mistakes { get; set; }
    public bool Out { get; set; }

    public double? FinishTime { get; set; }
    public int Place { get; set; }
    public bool Left { get; set; }
    public bool Done => FinishTime.HasValue;
    /// <summary>Ещё играет: не финишировал, не вышел и не выбыл.</summary>
    public bool Active => !Done && !Left && !Out;

    // Состояние бота
    internal int BotSeenIndex = -1;
    internal double BotWait;
    internal double BotWrong;
}

/// <summary>
/// Один матч. Вся игровая логика считается здесь, на сервере:
/// клиент только сообщает, какие стрелки зажаты, и рисует то, что прислал сервер.
/// </summary>
public sealed class Match
{
    private readonly Random _rnd;
    private readonly ModeRules _rules;
    private int _finishedCount;
    private double? _firstFinishAt;

    public Match(string id, GameMode mode, Random rnd, bool practice = false)
    {
        Id = id;
        Mode = mode;
        Practice = practice;
        _rnd = rnd;
        _rules = mode.Rules();
        Level = LevelGenerator.Generate(mode, rnd);
    }

    public string Id { get; }
    public GameMode Mode { get; }
    /// <summary>Тренировка с ботом: в базу не сохраняется.</summary>
    public bool Practice { get; }
    public Slider[] Level { get; }
    public List<Player> Players { get; } = [];
    public MatchPhase Phase { get; private set; } = MatchPhase.Countdown;

    /// <summary>Секунды с момента создания матча (включая отсчёт).</summary>
    public double Clock { get; private set; }

    /// <summary>Игровое время: отрицательное во время отсчёта, 0 — старт.</summary>
    public double GameTime => Clock - GameRules.CountdownSeconds;

    public string? EndReason { get; private set; }

    public Player? FindByConnection(string connectionId) =>
        Players.FirstOrDefault(p => p.ConnectionId == connectionId);

    public IEnumerable<string> ActiveConnections =>
        Players.Where(p => !p.IsBot && !p.Left).Select(p => p.ConnectionId!);

    public void Tick(double dt)
    {
        if (Phase == MatchPhase.Finished) return;

        Clock += dt;

        if (Phase == MatchPhase.Countdown)
        {
            if (GameTime < 0) return;
            Phase = MatchPhase.Running;
        }

        foreach (var player in Players)
        {
            Step(player, dt);
        }

        CheckEnd();
    }

    /// <summary>Какую стрелку надо держать или нажать на ползунке index. В «Зеркале» — противоположную нарисованной.</summary>
    private int TargetOf(int index)
    {
        var arrow = (int)Level[index].Arrow;
        return _rules.Mirror ? (arrow + 2) % 4 : arrow;
    }

    private void Step(Player p, double dt)
    {
        if (!p.Active) return;

        if (_rules.Press)
        {
            // люди продвигаются в SetInput, по нажатиям; здесь думает только бот
            if (p.IsBot) BotThinkSpeed(p, dt);
            return;
        }

        if (p.IsBot) BotThink(p, dt);

        var slider = Level[p.Index];
        var target = 1 << TargetOf(p.Index);
        var held = p.HeldMask & 0b1111;

        if (held == 0)
        {
            p.Progress -= GameRules.IdleDrainPerSecond * dt;
        }
        else if ((held & ~target) != 0)
        {
            // зажата хоть одна неправильная стрелка (даже вместе с правильной) — штраф
            p.Progress -= GameRules.WrongDrainPerSecond * dt;
        }
        else
        {
            p.Progress += dt / slider.FillSeconds;
        }

        if (p.Progress < 0) p.Progress = 0;
        if (p.Progress >= 1) Advance(p);
    }

    private void Advance(Player p)
    {
        p.Index++;
        p.Progress = 0;

        if (p.Index >= Level.Length)
        {
            p.FinishTime = Math.Round(GameTime, 2);
            p.Place = ++_finishedCount;
            _firstFinishAt ??= GameTime;
        }
    }

    /// <summary>
    /// Режимы с нажатиями: только что нажатые стрелки. Правильная — ползунок заполнен сразу,
    /// любая другая — оглушение, и пока оно идёт, нажатия не считаются.
    /// В «Хардкоре» оглушения нет, зато ошибки считаются, и последняя выбивает из матча.
    /// </summary>
    private void Press(Player p, int pressed)
    {
        if (Phase != MatchPhase.Running || !p.Active || GameTime < p.StunUntil) return;

        if (pressed == 1 << TargetOf(p.Index))
        {
            Advance(p);
        }
        else if (_rules.Lives > 0)
        {
            if (++p.Mistakes >= _rules.Lives) p.Out = true;
        }
        else
        {
            p.StunUntil = GameTime + GameRules.SpeedWrongStunSeconds;
        }
    }

    private void BotThinkSpeed(Player bot, double dt)
    {
        if (GameTime < bot.StunUntil) return;

        var target = TargetOf(bot.Index);

        if (bot.BotSeenIndex != bot.Index)
        {
            bot.BotSeenIndex = bot.Index;
            bot.BotWait = 0.2 + _rnd.NextDouble() * 0.2;
            // в «Хардкоре» бот осторожнее, иначе почти всегда выбывает
            bot.BotWrong = _rnd.NextDouble() < (_rules.Lives > 0 ? 0.03 : 0.08) ? 1 : 0;
        }

        if (bot.BotWait > 0)
        {
            bot.BotWait -= dt;
        }
        else if (bot.BotWrong > 0)
        {
            bot.BotWrong = 0;
            Press(bot, 1 << ((target + 1) % 4));
        }
        else
        {
            Press(bot, 1 << target);
        }
    }

    private void BotThink(Player bot, double dt)
    {
        var target = TargetOf(bot.Index);

        if (bot.BotSeenIndex != bot.Index)
        {
            // новый ползунок: бот "замечает" стрелку с задержкой и иногда ошибается
            bot.BotSeenIndex = bot.Index;
            bot.BotWait = 0.2 + _rnd.NextDouble() * 0.25;
            bot.BotWrong = _rnd.NextDouble() < 0.12 ? 0.3 : 0;
            bot.HeldMask = 0;
        }

        if (bot.BotWait > 0)
        {
            bot.BotWait -= dt;
            bot.HeldMask = 0;
        }
        else if (bot.BotWrong > 0)
        {
            bot.BotWrong -= dt;
            bot.HeldMask = 1 << ((target + 1) % 4);
        }
        else
        {
            bot.HeldMask = 1 << target;
        }
    }

    private void CheckEnd()
    {
        var humansLeft = Players.Where(p => !p.IsBot).All(p => p.Left);
        var everyoneDone = Players.All(p => !p.Active);

        if (humansLeft) Finish("abandoned");
        else if (everyoneDone) Finish("all_finished");
        else if (_firstFinishAt is { } first && GameTime - first >= GameRules.AfterFirstFinishSeconds) Finish("time_after_winner");
        else if (GameTime >= GameRules.MatchTimeLimitSeconds) Finish("time_limit");
    }

    private void Finish(string reason)
    {
        Phase = MatchPhase.Finished;
        EndReason = reason;
    }

    public void SetInput(string connectionId, int mask)
    {
        var p = FindByConnection(connectionId);
        if (p is null || p.Left) return;

        mask &= 0b1111;
        var pressed = mask & ~p.HeldMask;
        p.HeldMask = mask;

        if (_rules.Press && pressed != 0) Press(p, pressed);
    }

    public void MarkLeft(string connectionId)
    {
        var p = FindByConnection(connectionId);
        if (p is null) return;
        p.Left = true;
        p.HeldMask = 0;
    }

    // ---- Сообщения для клиента ----

    public object StartPayload(int yourSlot) => new
    {
        matchId = Id,
        mode = Mode.ToWire(),
        practice = Practice,
        press = _rules.Press,
        mirror = _rules.Mirror,
        blind = _rules.Blind,
        lives = _rules.Lives,
        you = yourSlot,
        countdown = GameRules.CountdownSeconds,
        stun = GameRules.SpeedWrongStunSeconds,
        idleDrain = GameRules.IdleDrainPerSecond,
        wrongDrain = GameRules.WrongDrainPerSecond,
        level = Level.Select(s => new { arrow = (int)s.Arrow, fill = s.FillSeconds }),
        players = Players.Select(p => new { slot = p.Slot, name = p.Name, bot = p.IsBot, skin = p.Skin }),
    };

    public object StatePayload() => new
    {
        t = Math.Round(GameTime, 2),
        players = Players.Select(p => new
        {
            slot = p.Slot,
            idx = p.Index,
            p = Math.Round(p.Progress, 3),
            held = p.HeldMask,
            stun = GameTime < p.StunUntil,
            miss = p.Mistakes,
            @out = p.Out,
            done = p.Done,
            place = p.Place,
            left = p.Left,
        }),
    };

    /// <summary>Итоговый порядок: финишировавшие по месту, потом по прогрессу, за ними выбывшие, вышедшие — в конце.</summary>
    public List<Player> Standings() => Players
        .OrderBy(p => p.Done ? 0 : 1)
        .ThenBy(p => p.Done ? p.Place : 0)
        .ThenBy(p => p.Left ? 2 : p.Out ? 1 : 0)
        .ThenByDescending(p => p.Index + p.Progress)
        .ToList();

    public object ResultPayload() => new
    {
        mode = Mode.ToWire(),
        practice = Practice,
        reason = EndReason,
        results = Standings()
            .Select((p, i) => new
            {
                slot = p.Slot,
                name = p.Name,
                bot = p.IsBot,
                place = i + 1,
                time = p.FinishTime,
                done = p.Done,
                left = p.Left,
                @out = p.Out,
                sliders = Math.Min(p.Index, Level.Length),
            }),
        total = Level.Length,
    };

    /// <summary>Запись для сохранения в базу.</summary>
    public MatchRecord ToRecord() => new()
    {
        Code = Id,
        Mode = Mode,
        PlayedAt = DateTime.UtcNow,
        Duration = Math.Round(Math.Max(0, GameTime), 2),
        SliderCount = Level.Length,
        EndReason = EndReason ?? "",
        Participants = Standings()
            .Select((p, i) => new MatchParticipant
            {
                UserId = p.UserId,
                Name = p.Name,
                IsBot = p.IsBot,
                Place = i + 1,
                FinishTime = p.FinishTime,
                Sliders = Math.Min(p.Index, Level.Length),
                Left = p.Left,
            })
            .ToList(),
    };
}
