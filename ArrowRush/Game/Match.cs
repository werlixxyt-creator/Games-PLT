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

    /// <summary>«Кловд»: на какой линии паук, 0 — потолок, 1 — пол.</summary>
    public int Lane { get; set; } = 1;
    /// <summary>Сколько прыжков паука дошло до сервера: так клиент узнаёт, что его прыжок учтён.</summary>
    public int Hops { get; set; }

    /// <summary>Поршень: высота НЛО над путём и скорость вверх, единицы сцены.</summary>
    public double FlyY { get; set; }
    public double FlyV { get; set; }
    /// <summary>Поршень: на этой ячейке трубу позади не проверяем — игрок врезался и начал с неё заново.</summary>
    public int PipeCleared { get; set; } = -1;

    /// <summary>
    /// Препятствия, о которых ждём ответ клиента: ячейка, до какого времени ждём и что решил сам сервер
    /// (null — труба поршня: смотреть <see cref="PipeHits"/>). См. <see cref="GameRules.VerdictWaitSeconds"/>.
    /// </summary>
    public List<(int Index, double Deadline, bool? Ok)> Pending { get; } = [];
    /// <summary>Клиент уже сказал «пролетел», а сервер до препятствия ещё не дошёл.</summary>
    public HashSet<int> Passed { get; } = [];
    /// <summary>Поршень: о какие трубы НЛО ударилось по расчёту сервера.</summary>
    public HashSet<int> PipeHits { get; } = [];

    /// <summary>«Радуга»: какую стену ломает игрок, -1 — никакую.</summary>
    public int WallAt { get; set; } = -1;
    public int WallHits { get; set; }
    /// <summary>Сколько секунд его обстреливают у этой стены; жизни считаются от этого времени.</summary>
    public double WallSeconds { get; set; }
    public int WallLives => GameRules.WallLives - (int)(WallSeconds / GameRules.WallLifeSeconds);

    /// <summary>Когда игрок встал на текущую ячейку, по игровому времени: на шипах первые мгновения нажатия прощаются.</summary>
    public double EnteredAt { get; set; }

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
    /// <param name="custom">Уровень из редактора вместо случайного.</param>
    public Match(string id, GameMode mode, bool fast, Difficulty difficulty, Random rnd, bool practice = false,
        ModeRules? rules = null, IReadOnlyList<string>? lobbyIds = null, string theme = "auto", PlayableLevel? custom = null)
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
        Custom = custom;
        Level = custom?.Sliders ?? LevelGenerator.Generate(fast, _diff, rnd, _rules.LevelScale);
        // свой уровень может быть сколь угодно длинным: время — по его ячейкам
        TimeLimit = custom is null
            ? GameRules.MatchTimeLimitSeconds * _rules.LevelScale
            : Math.Max(GameRules.MatchTimeLimitSeconds, (Level.Sum(s => s.FillSeconds) + Level.Length * 0.5) * GameRules.CustomTimeFactor);
    }

    /// <summary>Уровень из редактора, на котором идёт матч; null — случайный.</summary>
    public PlayableLevel? Custom { get; }
    public double TimeLimit { get; }

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

        Settle(p);

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

        if (InCloud(p))
        {
            Dodge(p, dt);
            return;
        }

        if (InPiston(p))
        {
            Flutter(p, dt);
            return;
        }

        if (Level[p.Index].Spike)
        {
            Wait(p, dt);
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

        Pass(p, ClearsCell(p));
    }

    /// <summary>
    /// Персонаж дошёл до препятствия в конце ячейки. Бота судит сервер. Игрок летит дальше, а удар о препятствие
    /// пришлёт его клиент: он считает по тому, что нарисовано (см. <see cref="Verdict"/>). Не пришлёт — решит ok.
    /// </summary>
    private void Pass(Player p, bool? ok)
    {
        var index = p.Index;
        if (p.IsBot && ok == false)
        {
            Crash(p, index);
            return;
        }
        Advance(p);
        if (!p.IsBot && !p.Passed.Remove(index)) p.Pending.Add((index, GameTime + GameRules.VerdictWaitSeconds, ok));
    }

    /// <summary>Ответ клиента так и не пришёл: решает то, что посчитал сервер.</summary>
    private void Settle(Player p)
    {
        for (var k = 0; k < p.Pending.Count; k++)
        {
            var (index, deadline, ok) = p.Pending[k];
            if (GameTime < deadline) continue;
            p.Pending.RemoveAt(k--);
            if (!(ok ?? !p.PipeHits.Contains(index)))
            {
                Crash(p, index);
                return;
            }
        }
    }

    private static bool Dodged(Slider s) => s.Ufo || s.Zone is LevelGenerator.Cloud or LevelGenerator.Piston;

    /// <summary>
    /// Клиент пролетел препятствие ячейки index или врезался в него. tries — сколько ударов он знал: ответ о прошлой попытке не считается.
    /// </summary>
    public void Verdict(string connectionId, int index, bool ok, int tries)
    {
        var p = FindByConnection(connectionId);
        if (p is null || p.Left || p.IsBot || !p.Active || Phase != MatchPhase.Running || tries != p.Crashes) return;
        if (index < Math.Max(0, p.Index - 3) || index > p.Index + 1 || index >= Level.Length || !Dodged(Level[index])) return;

        if (!ok)
        {
            Crash(p, index);
            return;
        }
        var k = p.Pending.FindIndex(x => x.Index == index);
        if (k >= 0) p.Pending.RemoveAt(k);
        else p.Passed.Add(index);
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
    private void Crash(Player p, int index)
    {
        p.Crashes++;
        p.JumpAt = double.NegativeInfinity;
        p.BotSeenIndex = -1;
        p.FlyY = p.FlyV = 0;
        p.Pending.Clear();
        p.Passed.Clear();
        p.PipeHits.Clear();

        if (Punishes)
        {
            // игрок мог уже улететь дальше препятствия: тогда просто летит дальше.
            // Клиент сказал об ударе раньше, чем сервер дошёл до препятствия: сам сервер его второй раз не засчитывает
            if (p.Index == index)
            {
                p.Progress = 0;
                if (_rules.Setback == 0) p.Passed.Add(index);
            }
            Slip(p);
        }
        else
        {
            p.Index = index;
            while (p.Index > 0 && Dodged(Level[p.Index - 1])) p.Index--;
            p.Progress = 0;
            p.EnteredAt = GameTime;
            p.Lane = 1;
        }
        p.PipeCleared = p.Index;
    }

    private bool InPiston(Player p) => Level[p.Index].Zone == LevelGenerator.Piston;

    /// <summary>Поршень ещё держит персонажа: начало первой трубы участка.</summary>
    private bool Grabbed(Player p) =>
        (p.Index == 0 || Level[p.Index - 1].Zone != LevelGenerator.Piston)
        && p.Progress * Level[p.Index].FillSeconds < GameRules.PistonGrabSeconds;

    /// <summary>
    /// Поршень: НЛО падает, взмахи поднимают его. Труба стоит в конце ячейки, и пока НЛО проходит через неё
    /// (ближе к её оси, чем <see cref="GameRules.PistonReach"/>, до и после), оно должно быть в просвете.
    /// Клиент считает так же (app.js, stepFly): полёт плавный, а удар виден сразу.
    /// </summary>
    private void Flutter(Player p, double dt)
    {
        if (p.IsBot) BotFlutter(p);

        if (Grabbed(p))
        {
            p.FlyY = p.FlyV = 0;
        }
        else
        {
            p.FlyV -= GameRules.PistonGravity * dt;
            p.FlyY += p.FlyV * dt;
            if (Math.Abs(p.FlyY) > GameRules.PistonLimit)
            {
                p.FlyY = Math.Clamp(p.FlyY, -GameRules.PistonLimit, GameRules.PistonLimit);
                p.FlyV = 0;
            }
        }

        p.Progress = Math.Min(1, p.Progress + dt / Level[p.Index].FillSeconds);
        var len = Level[p.Index].FillSeconds * GameRules.PistonSpeed;
        // подлетает к трубе этой ячейки
        if ((1 - p.Progress) * len <= GameRules.PistonReach && !InGap(p, Level[p.Index]))
        {
            if (!HitPipe(p, p.Index)) return;
        }
        // ещё не вылетел из трубы прошлой ячейки; после удара о неё не проверяем — персонаж уже начал заново
        else if (p.Index > 0 && Level[p.Index - 1].Zone == LevelGenerator.Piston && p.PipeCleared != p.Index
            && p.Progress * len <= GameRules.PistonReach && !InGap(p, Level[p.Index - 1]))
        {
            if (!HitPipe(p, p.Index - 1)) return;
        }
        if (p.Progress >= 1) Pass(p, null);
    }

    /// <summary>Сервер насчитал удар о трубу. Бот разбивается сразу (false — дальше не лететь), про игрока решит его клиент.</summary>
    private bool HitPipe(Player p, int index)
    {
        if (!p.IsBot)
        {
            p.PipeHits.Add(index);
            return true;
        }
        Crash(p, index);
        return false;
    }

    /// <summary>Тарелка в просвете: её хитбокс (выше центра <see cref="GameRules.PistonSaucerUp"/>, ниже — Down) не задевает края трубы.</summary>
    private static bool InGap(Player p, Slider pipe)
    {
        var off = p.FlyY - (pipe.Gap ?? 0);
        return off <= GameRules.PistonGapHalf - GameRules.PistonSaucerUp && -off <= GameRules.PistonGapHalf - GameRules.PistonSaucerDown;
    }

    /// <summary>Взмах: любая стрелка, пока поршень не держит.</summary>
    private void Flap(Player p)
    {
        if (!Grabbed(p)) p.FlyV = GameRules.PistonFlap;
    }

    /// <summary>Бот машет, когда опустился ниже просвета, а иногда зевает целую трубу и врезается.</summary>
    private void BotFlutter(Player bot)
    {
        bot.HeldMask = 0;
        if (bot.BotSeenIndex != bot.Index)
        {
            bot.BotSeenIndex = bot.Index;
            bot.BotWrong = _rnd.NextDouble() < BotMistakeChance(0.05) ? 1 : 0;
        }
        // пока не вылетел из трубы позади, держится её просвета; взмах поднимает на 80, так что машет ниже середины на 40
        var len = Level[bot.Index].FillSeconds * GameRules.PistonSpeed;
        var behind = bot.Index > 0 && Level[bot.Index - 1].Zone == LevelGenerator.Piston && bot.Progress * len <= GameRules.PistonReach + 20;
        var gap = (behind ? Level[bot.Index - 1].Gap : Level[bot.Index].Gap) ?? 0;
        if (bot.BotWrong == 0 && bot.FlyY < gap - 40 && bot.FlyV < 60) Flap(bot);
    }

    private bool InCloud(Player p) => Level[p.Index].Zone == LevelGenerator.Cloud;

    /// <summary>«Кловд»: стрелка долетает сама; если паук на её линии — удар, как на участке с НЛО.</summary>
    private void Dodge(Player p, double dt)
    {
        if (p.IsBot) BotDodge(p);

        p.Progress += dt / Level[p.Index].FillSeconds;
        if (p.Progress < 1) return;

        Pass(p, p.Lane != Level[p.Index].Lane);
    }

    /// <summary>↑ — на потолок, ↓ — на пол, остальные стрелки перебрасывают на другую линию.</summary>
    private static void Hop(Player p, int pressed)
    {
        p.Hops++;
        p.Lane = (pressed & (1 << (int)Arrow.Up)) != 0 ? 0 : (pressed & (1 << (int)Arrow.Down)) != 0 ? 1 : 1 - p.Lane;
    }

    /// <summary>Бот уходит с линии стрелки незадолго до неё, а иногда зевает.</summary>
    private void BotDodge(Player bot)
    {
        bot.HeldMask = 0;
        if (bot.BotSeenIndex != bot.Index)
        {
            bot.BotSeenIndex = bot.Index;
            bot.BotWrong = _rnd.NextDouble() < BotMistakeChance(0.05) ? 1 : 0;
            bot.BotWait = GameRules.CloudBotSeconds * (0.6 + _rnd.NextDouble() * 0.6);
        }

        var cell = Level[bot.Index];
        if (bot.BotWrong == 0 && (1 - bot.Progress) * cell.FillSeconds <= bot.BotWait) bot.Lane = 1 - cell.Lane!.Value;
    }

    /// <summary>Шипы: ячейка проходит сама, пока ничего не зажато. Держать стрелку с прошлой ячейки можно — время просто стоит.</summary>
    private void Wait(Player p, double dt)
    {
        if (p.IsBot) p.HeldMask = 0;
        if ((p.HeldMask & 0b1111) != 0) return;
        p.Progress += dt / Level[p.Index].FillSeconds;
        if (p.Progress >= 1) Advance(p);
    }

    /// <summary>Нажатие на шипах — удар: ячейка начинается заново, а где ошибка дорога, считает режим.</summary>
    private void Prick(Player p)
    {
        if (GameTime - p.EnteredAt < GameRules.SpikeGraceSeconds) return;
        p.Crashes++;
        p.Progress = 0;
        if (Punishes) Slip(p);
    }

    /// <summary>Игрок подошёл к стене: счёт ударов и жизней начинается заново. Сюда можно попасть и назад из «Отката».</summary>
    private static void FaceWall(Player p)
    {
        if (p.WallAt == p.Index) return;
        p.WallAt = p.Index;
        p.WallHits = 0;
        p.WallSeconds = 0;
    }

    /// <summary>«Радуга»: пока стена цела, лазеры снимают жизни; кончились — игрок выбыл. У стены из редактора лазеров нет.</summary>
    private void UnderFire(Player p, double dt)
    {
        FaceWall(p);
        if (p.IsBot) BotWall(p, dt);
        if (!p.Active || !Level[p.Index].Wall || Level[p.Index].Zone != LevelGenerator.Rainbow) return; // бот мог сломать стену

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
        p.EnteredAt = GameTime;

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
        else if (InCloud(p) && Level[p.Index - 1].Zone != LevelGenerator.Cloud)
        {
            p.Lane = 1; // паук начинает на полу
        }
        else if (InPiston(p) && Level[p.Index - 1].Zone != LevelGenerator.Piston)
        {
            p.FlyY = p.FlyV = 0; // поршень берёт персонажа с пути
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
            p.EnteredAt = GameTime;
            if (InRast(p)) StartHole(p); // ошибка отбросила обратно в «Раст»
            p.FlyY = p.FlyV = 0;
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
        else if (Phase == MatchPhase.Running && p.Active && InCloud(p)) Hop(p, pressed);
        else if (Phase == MatchPhase.Running && p.Active && InPiston(p)) Flap(p);
        else if (Phase == MatchPhase.Running && p.Active && Level[p.Index].Spike) Prick(p);
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
        else if (GameTime >= TimeLimit) Finish("time_limit");
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
        custom = Custom is null ? null : new { id = Custom.Id, name = Custom.Name },
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
        piston = new
        {
            grab = GameRules.PistonGrabSeconds, gravity = GameRules.PistonGravity, flap = GameRules.PistonFlap, limit = GameRules.PistonLimit,
            speed = GameRules.PistonSpeed, gap = GameRules.PistonGapHalf, reach = GameRules.PistonReach,
        },
        holeStart = GameRules.RastStartGap,
        wallHits = GameRules.WallHits,
        level = Level.Select(s => new { arrow = (int)s.Arrow, fill = s.FillSeconds, chart = s.Chart, was = (int?)s.Was, swam = s.Swam, ufo = s.Ufo, @event = s.Event, zone = s.Zone, wall = s.Wall, lane = s.Lane, spike = s.Spike, fake = s.Fake, gap = s.Gap }),
        // блоки, декор и триггеры уровня из редактора; C уже номер ползунка в матче
        objects = Custom?.Objects ?? [],
        world = Custom?.World, // настройки мира: фон, частицы, цвета
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
            lane = p.Lane,
            hops = p.Hops,
            hp = p.WallAt == p.Index ? Math.Max(0, p.WallLives) : GameRules.WallLives,
            hits = p.WallAt == p.Index ? p.WallHits : 0,
            // сколько секунд длится прыжок, -1 — на земле
            air = GameTime - p.JumpAt < GameRules.SwamJumpSeconds ? Math.Round(GameTime - p.JumpAt, 2) : -1,
            fy = Math.Round(p.FlyY, 1), // поршень: высота НЛО над путём
            fv = Math.Round(p.FlyV, 1),
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
        custom = Custom is null ? null : new { id = Custom.Id, name = Custom.Name },
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
