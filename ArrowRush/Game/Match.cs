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
    /// <summary>Персонаж: его видят те, кто наблюдает за игроком.</summary>
    public string Hero { get; init; } = "circle";
    /// <summary>Командные режимы: номер команды, 0 или 1. В остальных режимах -1.</summary>
    public int Team { get; init; } = -1;
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

    /// <summary>Участок с НЛО: когда начался последний прыжок, по игровому времени.</summary>
    public double JumpAt { get; set; } = double.NegativeInfinity;
    /// <summary>Сколько раз врезался в ячейку: клиент так узнаёт об ударе.</summary>
    public int Crashes { get; set; }

    /// <summary>«Раст»: через сколько секунд чёрная дыра догонит игрока.</summary>
    public double HoleGap { get; set; }
    /// <summary>«Раст»: сколько секунд дыра ещё стоит на месте.</summary>
    public double HolePause { get; set; }

    /// <summary>«Радуга»: какую стену ломает игрок, -1 — никакую.</summary>
    public int WallAt { get; set; } = -1;
    public int WallHits { get; set; }
    /// <summary>Сколько секунд его обстреливают у этой стены; жизни считаются от этого времени.</summary>
    public double WallSeconds { get; set; }
    public int WallLives => GameRules.WallLives - (int)(WallSeconds / GameRules.WallLifeSeconds);

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
    private readonly DifficultyRules _diff;
    private int _finishedCount;
    private double? _firstFinishAt;
    private int? _winningTeam;

    /// <param name="rules">Правила лобби вместо обычных правил режима.</param>
    /// <param name="lobbyIds">Из каких лобби матч: в общих их две команды.</param>
    /// <param name="theme">Дизайн уровня, выбранный в лобби; "auto" — случайный.</param>
    public Match(string id, GameMode mode, bool fast, Difficulty difficulty, Random rnd, bool practice = false,
        ModeRules? rules = null, IReadOnlyList<string>? lobbyIds = null, string theme = "auto")
    {
        Id = id;
        Mode = mode;
        Fast = fast;
        Difficulty = difficulty;
        Practice = practice;
        _rnd = rnd;
        _rules = rules ?? mode.Rules();
        LobbyIds = lobbyIds ?? [];
        Theme = theme;
        _diff = difficulty.Rules();
        Level = LevelGenerator.Generate(fast, _diff, rnd, _rules.LevelScale);
    }

    public string Id { get; }
    public GameMode Mode { get; }
    /// <summary>Быстрый темп: ползунок заполняется одним нажатием. Иначе стрелку надо держать.</summary>
    public bool Fast { get; }
    public Difficulty Difficulty { get; }
    public bool Teams => _rules.Teams;
    /// <summary>Тренировка с ботом: в базу не сохраняется.</summary>
    public bool Practice { get; }
    public IReadOnlyList<string> LobbyIds { get; }
    public string Theme { get; }
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

        if (Level[p.Index].Ufo)
        {
            Ride(p, dt);
            return;
        }

        if (InRast(p))
        {
            Flee(p, dt);
            return;
        }

        if (Level[p.Index].Wall)
        {
            UnderFire(p, dt);
            return;
        }

        if (Fast)
        {
            // люди продвигаются в SetInput, по нажатиям; здесь думает только бот
            if (p.IsBot) BotThinkFast(p, dt);
            return;
        }

        if (p.IsBot) BotThink(p, dt);

        var slider = Level[p.Index];
        var target = 1 << TargetOf(p.Index);
        var held = p.HeldMask & 0b1111;

        if (held == 0)
        {
            p.Progress -= _diff.IdleDrainPerSecond * dt;
        }
        else if ((held & ~target) != 0)
        {
            // зажата хоть одна неправильная стрелка (даже вместе с правильной) — штраф
            p.Progress -= _diff.WrongDrainPerSecond * dt;
        }
        else
        {
            p.Progress += dt / slider.FillSeconds;
        }

        if (p.Progress < 0) p.Progress = 0;
        if (p.Progress >= 1) Advance(p);
    }

    /// <summary>Участок с НЛО: персонаж сам летит к ячейке, и к её концу он должен быть в прыжке выше неё.</summary>
    private void Ride(Player p, double dt)
    {
        if (p.IsBot) BotRide(p);

        p.Progress += dt / Level[p.Index].FillSeconds;
        if (p.Progress < 1) return;

        if (ClearsCell(p)) Advance(p);
        else Crash(p);
    }

    private bool ClearsCell(Player p)
    {
        var jump = (GameTime - p.JumpAt) / GameRules.SwamJumpSeconds;
        return jump is >= GameRules.SwamClearFrom and <= GameRules.SwamClearTo;
    }

    /// <summary>Прыжок с НЛО; в воздухе ещё раз прыгнуть нельзя.</summary>
    private void Jump(Player p)
    {
        if (GameTime - p.JumpAt >= GameRules.SwamJumpSeconds) p.JumpAt = GameTime;
    }

    /// <summary>Удар о ячейку. Где ошибка стоит дорого, считает режим, иначе участок с НЛО начинается заново.</summary>
    private void Crash(Player p)
    {
        p.Crashes++;
        p.JumpAt = double.NegativeInfinity;
        p.BotSeenIndex = -1;
        p.Progress = 0;

        if (Punishes) Slip(p);
        else while (Level[p.Index - 1].Ufo) p.Index--;
    }

    /// <summary>Игрок подошёл к стене: счёт ударов и жизней начинается заново. Сюда можно попасть и назад из «Отката».</summary>
    private static void FaceWall(Player p)
    {
        if (p.WallAt == p.Index) return;
        p.WallAt = p.Index;
        p.WallHits = 0;
        p.WallSeconds = 0;
    }

    /// <summary>«Радуга»: пока стена цела, лазеры снимают жизни; кончились — игрок выбыл.</summary>
    private void UnderFire(Player p, double dt)
    {
        FaceWall(p);
        if (p.IsBot) BotWall(p, dt);
        if (!p.Active || !Level[p.Index].Wall) return; // бот мог сломать стену

        p.WallSeconds += dt;
        if (p.WallLives <= 0) p.Out = true;
    }

    /// <summary>Удар по стене любой клавишей; прогресс показывает, насколько она разбита.</summary>
    private void HitWall(Player p)
    {
        FaceWall(p);
        p.WallHits++;
        p.Progress = (double)p.WallHits / GameRules.WallHits;
        if (p.WallHits >= GameRules.WallHits)
        {
            p.WallAt = -1;
            Advance(p);
        }
    }

    private void BotWall(Player bot, double dt)
    {
        bot.BotWait -= dt;
        if (bot.BotWait > 0) return;
        bot.BotWait = (0.8 + _rnd.NextDouble() * 0.5) * _diff.BotReaction * GameRules.WallBotSeconds;
        HitWall(bot);
    }

    private bool InRast(Player p) => Level[p.Index].Zone == LevelGenerator.Rast;

    /// <summary>«Раст»: дыра надвигается; догнала — игрок выбыл.</summary>
    private void Flee(Player p, double dt)
    {
        if (p.IsBot) BotRast(p, dt);
        if (!p.Active || !InRast(p)) return; // бот мог пройти последнюю ячейку

        if (p.HolePause > 0)
        {
            p.HolePause -= dt;
            return;
        }

        p.HoleGap -= _diff.RastDrain * dt;
        if (p.HoleGap > 0) return;
        p.HoleGap = 0;
        p.Out = true;
    }

    /// <summary>Дыра появляется у левого края и стоит, пока игрок её не увидит.</summary>
    private static void StartHole(Player p)
    {
        p.HoleGap = GameRules.RastStartGap;
        p.HolePause = GameRules.RastPauseSeconds;
    }

    /// <summary>«Раст»: нажатие считается сразу в любом темпе. Верное отгоняет дыру, неверное подпускает.</summary>
    private void PressRast(Player p, int pressed)
    {
        if (pressed == 1 << TargetOf(p.Index))
        {
            p.HoleGap = Math.Min(GameRules.RastMaxGap, p.HoleGap + GameRules.RastGain);
            Advance(p);
        }
        else
        {
            p.HoleGap = Math.Max(0, p.HoleGap - GameRules.RastWrong);
        }
    }

    /// <summary>Бот жмёт в своём темпе: у каждого нажатия случайный разброс, иногда он ошибается.</summary>
    private void BotRast(Player bot, double dt)
    {
        bot.BotWait -= dt;
        if (bot.BotWait > 0) return;
        // корень: нажимать бот может и на лёгкой, медленная реакция не должна отдавать его дыре всегда
        bot.BotWait = (0.8 + _rnd.NextDouble() * 0.5) * Math.Sqrt(_diff.BotReaction) / GameRules.RastBotRate;

        var wrong = _rnd.NextDouble() < 0.03 * _diff.BotMistakes;
        PressRast(bot, 1 << (wrong ? (TargetOf(bot.Index) + 1) % 4 : TargetOf(bot.Index)));
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
            _winningTeam ??= p.Team;
        }
        else if (InRast(p) && Level[p.Index - 1].Zone != LevelGenerator.Rast)
        {
            StartHole(p);
        }
    }

    /// <summary>
    /// Быстрый темп: только что нажатые стрелки. Правильная — ползунок заполнен сразу,
    /// любая другая — оглушение, и пока оно идёт, нажатия не считаются.
    /// В «Хардкоре» оглушения нет, зато ошибка засчитывается (см. <see cref="Miss"/>).
    /// </summary>
    private void Press(Player p, int pressed)
    {
        if (Phase != MatchPhase.Running || !p.Active || GameTime < p.StunUntil) return;

        if (pressed == 1 << TargetOf(p.Index))
        {
            Advance(p);
        }
        else if (Punishes)
        {
            Slip(p);
        }
        else
        {
            p.StunUntil = GameTime + _diff.FastWrongStunSeconds;
        }
    }

    /// <summary>Ошибка стоит не паузы: режим считает её сам.</summary>
    private bool Punishes => _rules.Lives > 0 || _rules.Setback > 0;

    /// <summary>«Откат»: ячейки назад. «Хардкор» и «Один шанс»: ещё одна ошибка, последняя выбивает из матча.</summary>
    private void Slip(Player p)
    {
        if (_rules.Setback > 0)
        {
            p.Index = Math.Max(0, p.Index - _rules.Setback);
            p.Progress = 0;
            if (InRast(p)) StartHole(p); // ошибка отбросила обратно в «Раст»
        }
        else if (++p.Mistakes >= _rules.Lives)
        {
            p.Out = true;
        }
    }

    /// <summary>
    /// Какие стрелки теперь зажаты. В быстром темпе новые нажатия идут в <see cref="Press"/>;
    /// в обычном «Хардкоре» ошибка — нажать (не просто держать) неправильную стрелку.
    /// </summary>
    private void SetHeld(Player p, int mask)
    {
        var pressed = mask & ~p.HeldMask;
        p.HeldMask = mask;
        if (pressed == 0) return;

        if (Phase == MatchPhase.Running && p.Active && Level[p.Index].Ufo) Jump(p);
        else if (Phase == MatchPhase.Running && p.Active && InRast(p)) PressRast(p, pressed);
        else if (Phase == MatchPhase.Running && p.Active && Level[p.Index].Wall) HitWall(p);
        else if (Fast) Press(p, pressed);
        else if (Punishes && Phase == MatchPhase.Running && p.Active && (pressed & ~(1 << TargetOf(p.Index))) != 0) Slip(p);
    }

    /// <summary>Как часто бот ошибается: зависит от сложности; где ошибка дорога, он осторожнее, иначе почти всегда выбывает.</summary>
    private double BotMistakeChance(double usual) => (_rules.Lives == 1 ? 0.01 : Punishes ? 0.03 : usual) * _diff.BotMistakes;

    /// <summary>Сколько бот «замечает» новую стрелку: на лёгкой — дольше, на сложной — быстрее.</summary>
    private double BotReactionTime(double spread) => (0.2 + _rnd.NextDouble() * spread) * _diff.BotReaction;

    private void BotThinkFast(Player bot, double dt)
    {
        if (GameTime < bot.StunUntil) return;

        var target = TargetOf(bot.Index);

        if (bot.BotSeenIndex != bot.Index)
        {
            bot.BotSeenIndex = bot.Index;
            bot.BotWait = BotReactionTime(0.2);
            bot.BotWrong = _rnd.NextDouble() < BotMistakeChance(0.08) ? 1 : 0;
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

    /// <summary>Бот прыгает так, чтобы над ячейкой быть в верхней точке, а иногда прозёвывает прыжок и врезается.</summary>
    private void BotRide(Player bot)
    {
        bot.HeldMask = 0;
        if (bot.BotSeenIndex != bot.Index)
        {
            bot.BotSeenIndex = bot.Index;
            bot.BotWrong = _rnd.NextDouble() < BotMistakeChance(0.05) ? 1 : 0;
            // разброс меньше окна, где персонаж выше ячейки
            bot.BotWait = GameRules.SwamJumpSeconds * (0.5 + (_rnd.NextDouble() - 0.5) * 0.3);
        }

        var left = (1 - bot.Progress) * Level[bot.Index].FillSeconds;
        if (bot.BotWrong == 0 && left <= bot.BotWait) Jump(bot);
    }

    private void BotThink(Player bot, double dt)
    {
        var target = TargetOf(bot.Index);

        if (bot.BotSeenIndex != bot.Index)
        {
            // новый ползунок: бот "замечает" стрелку с задержкой и иногда ошибается
            bot.BotSeenIndex = bot.Index;
            bot.BotWait = BotReactionTime(0.25);
            bot.BotWrong = _rnd.NextDouble() < BotMistakeChance(0.12) ? 0.3 : 0;
            SetHeld(bot, 0);
        }

        if (bot.BotWait > 0)
        {
            bot.BotWait -= dt;
            SetHeld(bot, 0);
        }
        else if (bot.BotWrong > 0)
        {
            bot.BotWrong -= dt;
            SetHeld(bot, 1 << ((target + 1) % 4));
        }
        else
        {
            SetHeld(bot, 1 << target);
        }
    }

    private void CheckEnd()
    {
        var humansLeft = Players.Where(p => !p.IsBot).All(p => p.Left);
        var everyoneDone = Players.All(p => !p.Active);

        if (humansLeft) Finish("abandoned");
        else if (Teams && _firstFinishAt.HasValue) Finish("team_finished");
        else if (everyoneDone) Finish("all_finished");
        else if (_firstFinishAt is { } first && GameTime - first >= GameRules.AfterFirstFinishSeconds) Finish("time_after_winner");
        else if (GameTime >= GameRules.MatchTimeLimitSeconds * _rules.LevelScale) Finish("time_limit");
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

        SetHeld(p, mask & 0b1111);
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
        fast = Fast,
        difficulty = Difficulty.ToWire(),
        practice = Practice,
        lobby = LobbyIds.Count > 0,
        theme = Theme,
        mirror = _rules.Mirror,
        sight = _rules.Sight,
        lives = _rules.Lives,
        setback = _rules.Setback,
        teams = Teams,
        you = yourSlot,
        countdown = GameRules.CountdownSeconds,
        stun = _diff.FastWrongStunSeconds,
        idleDrain = _diff.IdleDrainPerSecond,
        wrongDrain = _diff.WrongDrainPerSecond,
        jump = GameRules.SwamJumpSeconds,
        holeStart = GameRules.RastStartGap,
        wallHits = GameRules.WallHits,
        level = Level.Select(s => new { arrow = (int)s.Arrow, fill = s.FillSeconds, chart = s.Chart, was = (int?)s.Was, swam = s.Swam, ufo = s.Ufo, @event = s.Event, zone = s.Zone, wall = s.Wall }),
        players = Players.Select(p => new { slot = p.Slot, name = p.Name, bot = p.IsBot, skin = p.Skin, hero = p.Hero, team = p.Team }),
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
            crash = p.Crashes,
            hole = Math.Round(p.HoleGap, 2),
            hp = p.WallAt == p.Index ? Math.Max(0, p.WallLives) : GameRules.WallLives,
            hits = p.WallAt == p.Index ? p.WallHits : 0,
            // сколько секунд длится прыжок, -1 — на земле
            air = GameTime - p.JumpAt < GameRules.SwamJumpSeconds ? Math.Round(GameTime - p.JumpAt, 2) : -1,
            @out = p.Out,
            done = p.Done,
            place = p.Place,
            left = p.Left,
        }),
    };

    /// <summary>Победил ли игрок: в командных режимах — вся команда первого финишировавшего, кроме вышедших, иначе — только он сам.</summary>
    public bool Won(Player p) => Teams ? p.Team == _winningTeam && !p.Left : p.Done && p.Place == 1;

    /// <summary>Итоговый порядок: победители, финишировавшие по месту, потом по прогрессу, за ними выбывшие, вышедшие — в конце.</summary>
    public List<Player> Standings() => Players
        .OrderBy(p => Won(p) ? 0 : 1)
        .ThenBy(p => p.Done ? 0 : 1)
        .ThenBy(p => p.Done ? p.Place : 0)
        .ThenBy(p => p.Left ? 2 : p.Out ? 1 : 0)
        .ThenByDescending(p => p.Index + p.Progress)
        .ToList();

    public object ResultPayload() => new
    {
        mode = Mode.ToWire(),
        fast = Fast,
        practice = Practice,
        lobby = LobbyIds.Count > 0,
        teams = Teams,
        reason = EndReason,
        results = Standings()
            .Select((p, i) => new
            {
                slot = p.Slot,
                name = p.Name,
                bot = p.IsBot,
                team = p.Team,
                won = Won(p),
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
        Fast = Fast,
        Difficulty = Difficulty,
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
                Won = Won(p),
                Place = i + 1,
                FinishTime = p.FinishTime,
                Sliders = Math.Min(p.Index, Level.Length),
                Left = p.Left,
            })
            .ToList(),
    };
}
