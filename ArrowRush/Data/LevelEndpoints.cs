using System.Security.Claims;
using System.Text.Json;
using ArrowRush.Game;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Data;

/// <summary>
/// HTTP API редактора уровней: /api/levels. Только для вошедших.
/// Автор создаёт черновик, меняет его и проходит сам (матч через хаб, GameHub.PlayLevel) —
/// после этого уровень можно опубликовать, и в него играют все. Опубликованный уровень не меняется.
/// </summary>
public static class LevelEndpoints
{
    /// <summary>Сколько уровней в списке за раз.</summary>
    public const int ListSize = 50;

    public sealed record LevelBody(string? Name, string? About, bool Fast, string? Difficulty, string? Theme, List<EditorCell>? Cells, List<LevelObject>? Objects);

    public static void MapLevels(this WebApplication app)
    {
        var api = app.MapGroup("/api/levels").RequireAuthorization();
        api.MapGet("/", List);
        api.MapGet("/mine", Mine);
        api.MapGet("/{id:int}", Get);
        api.MapPost("/", Create);
        api.MapPut("/{id:int}", Update);
        api.MapDelete("/{id:int}", Delete);
        api.MapPost("/{id:int}/publish", Publish);
        api.MapPost("/{id:int}/like", Like);
    }

    private static string Me(ClaimsPrincipal principal) => principal.FindFirstValue(ClaimTypes.NameIdentifier)!;

    private static IResult NotFound() => AccountEndpoints.Error("Уровень не найден", 404);

    /// <summary>Уровень, готовый к матчу. Случайные части «Раста» и «Кловда» от id: у всех игроков уровень одинаковый.</summary>
    public static PlayableLevel Playable(CustomLevel l)
    {
        var cells = JsonSerializer.Deserialize<List<EditorCell>>(l.Cells, JsonSerializerOptions.Web)!;
        // объекты привязаны к ячейкам редактора, а в матче между ними могут встать ячейки «Раста» и «Кловда»
        var map = LevelGenerator.EditorIndexMap(cells);
        var objects = ObjectsOf(l).Where(o => o.C >= 0 && o.C < map.Length).Select(o => o with { C = map[o.C] }).ToList();
        return new(l.Id, l.Name, l.AuthorId, l.Revision, l.Fast, l.Difficulty, l.Theme, l.Published,
            LevelGenerator.FromEditor(cells, l.Fast, new Random(l.Id)), objects);
    }

    private static List<LevelObject> ObjectsOf(CustomLevel l) => JsonSerializer.Deserialize<List<LevelObject>>(l.Objects, JsonSerializerOptions.Web) ?? [];

    /// <summary>Опубликованные уровни. q — часть названия или ника автора; sort — new, popular или liked.</summary>
    private static async Task<IResult> List(string? q, string? sort, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var query = db.CustomLevels.Where(l => l.Published);
        var text = (q ?? "").Trim().ToLower();
        if (text.Length > 0) query = query.Where(l => l.Name.ToLower().Contains(text) || l.Author.NormalizedUserName!.ToLower().Contains(text));
        query = sort switch
        {
            "popular" => query.OrderByDescending(l => l.Plays).ThenByDescending(l => l.PublishedAt),
            "liked" => query.OrderByDescending(l => l.Likes).ThenByDescending(l => l.PublishedAt),
            _ => query.OrderByDescending(l => l.PublishedAt),
        };
        return Results.Ok(await Summaries(query.Take(ListSize), db, me));
    }

    /// <summary>Мои уровни: черновики и опубликованные, свежие сверху.</summary>
    private static async Task<IResult> Mine(ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        return Results.Ok(await Summaries(db.CustomLevels.Where(l => l.AuthorId == me).OrderByDescending(l => l.UpdatedAt), db, me));
    }

    private static Task<List<object>> Summaries(IQueryable<CustomLevel> query, AppDb db, string me) => query
        .Select(l => (object)new
        {
            id = l.Id,
            name = l.Name,
            about = l.About,
            author = l.Author.UserName,
            mine = l.AuthorId == me,
            fast = l.Fast,
            difficulty = l.Difficulty.ToWire(), // последний Select: EF считает это уже в памяти
            theme = l.Theme,
            cells = l.CellCount,
            verified = l.Verified,
            published = l.Published,
            publishedAt = l.PublishedAt,
            plays = l.Plays,
            clears = l.Clears,
            likes = l.Likes,
            liked = db.LevelLikes.Any(k => k.LevelId == l.Id && k.UserId == me),
        })
        .ToListAsync();

    /// <summary>Уровень с ячейками: опубликованный — любому, черновик — только автору.</summary>
    private static async Task<IResult> Get(int id, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var l = await db.CustomLevels.Include(x => x.Author).FirstOrDefaultAsync(x => x.Id == id && (x.Published || x.AuthorId == me));
        return l is null ? NotFound() : Results.Ok(Detail(l, me));
    }

    private static object Detail(CustomLevel l, string me) => new
    {
        id = l.Id,
        name = l.Name,
        about = l.About,
        author = l.Author.UserName,
        mine = l.AuthorId == me,
        fast = l.Fast,
        difficulty = l.Difficulty.ToWire(),
        theme = l.Theme,
        verified = l.Verified,
        published = l.Published,
        plays = l.Plays,
        clears = l.Clears,
        likes = l.Likes,
        cells = JsonSerializer.Deserialize<List<EditorCell>>(l.Cells, JsonSerializerOptions.Web),
        objects = ObjectsOf(l),
    };

    private static async Task<IResult> Create(LevelBody body, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        if (await db.CustomLevels.CountAsync(l => l.AuthorId == me) >= GameRules.LevelsPerUser)
            return AccountEndpoints.Error($"Не больше {GameRules.LevelsPerUser} уровней: удали ненужные");
        if (Validate(body) is { } error) return AccountEndpoints.Error(error);

        var now = DateTime.UtcNow;
        var level = new CustomLevel { AuthorId = me, Name = "", Theme = "auto", Cells = "[]", CreatedAt = now };
        Apply(level, body, now);
        db.CustomLevels.Add(level);
        await db.SaveChangesAsync();
        await db.Entry(level).Reference(l => l.Author).LoadAsync();
        return Results.Ok(Detail(level, me));
    }

    /// <summary>Правка черновика: он снова считается не пройденным.</summary>
    private static async Task<IResult> Update(int id, LevelBody body, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var level = await db.CustomLevels.Include(l => l.Author).FirstOrDefaultAsync(l => l.Id == id && l.AuthorId == me);
        if (level is null) return NotFound();
        if (level.Published) return AccountEndpoints.Error("Опубликованный уровень менять нельзя — сделай копию", 409);
        if (Validate(body) is { } error) return AccountEndpoints.Error(error);

        Apply(level, body, DateTime.UtcNow);
        level.Revision++;
        level.Verified = false;
        await db.SaveChangesAsync();
        return Results.Ok(Detail(level, me));
    }

    private static void Apply(CustomLevel level, LevelBody body, DateTime now)
    {
        level.Name = body.Name!.Trim();
        level.About = string.IsNullOrWhiteSpace(body.About) ? null : body.About.Trim();
        level.Fast = body.Fast;
        level.Difficulty = Difficulties.Parse(body.Difficulty);
        level.Theme = LobbySettings.Themes.Contains(body.Theme) ? body.Theme! : "auto";
        // в быстром темпе секунды не нужны, но храним их: автор может переключить темп обратно
        level.Cells = JsonSerializer.Serialize(body.Cells!.Select(c => c with { F = Math.Round(c.F, 2) }), JsonSerializerOptions.Web);
        level.Objects = JsonSerializer.Serialize((body.Objects ?? []).Select(o => o with
        {
            X = Math.Round(o.X, 1),
            Y = Math.Round(o.Y, 1),
            S = Math.Round(o.S, 2),
            V = string.IsNullOrWhiteSpace(o.V) ? null : o.V.Trim(),
        }), JsonSerializerOptions.Web);
        level.CellCount = body.Cells!.Count;
        level.UpdatedAt = now;
    }

    private static async Task<IResult> Delete(int id, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var level = await db.CustomLevels.FirstOrDefaultAsync(l => l.Id == id && l.AuthorId == me);
        if (level is null) return NotFound();
        db.CustomLevels.Remove(level);
        await db.SaveChangesAsync();
        return Results.Ok();
    }

    /// <summary>Как в GD: выложить можно только уровень, который автор сам прошёл после последней правки.</summary>
    private static async Task<IResult> Publish(int id, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var level = await db.CustomLevels.Include(l => l.Author).FirstOrDefaultAsync(l => l.Id == id && l.AuthorId == me);
        if (level is null) return NotFound();
        if (level.Published) return Results.Ok(Detail(level, me));
        if (!level.Verified) return AccountEndpoints.Error("Сначала пройди уровень сам — кнопка «Тест»");

        level.Published = true;
        level.PublishedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Results.Ok(Detail(level, me));
    }

    /// <summary>Поставить или снять лайк опубликованному уровню. Свой лайкать нельзя.</summary>
    private static async Task<IResult> Like(int id, ClaimsPrincipal principal, AppDb db)
    {
        var me = Me(principal);
        var level = await db.CustomLevels.FirstOrDefaultAsync(l => l.Id == id && l.Published);
        if (level is null) return NotFound();
        if (level.AuthorId == me) return AccountEndpoints.Error("Свой уровень лайкать нельзя");

        var like = await db.LevelLikes.FindAsync(me, id);
        if (like is null)
        {
            db.LevelLikes.Add(new LevelLike { UserId = me, LevelId = id });
            level.Likes++;
        }
        else
        {
            db.LevelLikes.Remove(like);
            level.Likes = Math.Max(0, level.Likes - 1);
        }
        await db.SaveChangesAsync();
        return Results.Ok(new { liked = like is null, likes = level.Likes });
    }

    /// <summary>
    /// Проверка уровня; те же правила проверяет редактор (levels.js), чтобы показать ошибку сразу.
    /// За особой ячейкой должно идти столько ячеек, сколько она меняет, и другой особой среди них быть не может.
    /// </summary>
    private static string? Validate(LevelBody body)
    {
        var name = (body.Name ?? "").Trim();
        if (name.Length == 0) return "Назови уровень";
        if (name.Length > GameRules.LevelNameMax) return $"Название не длиннее {GameRules.LevelNameMax} символов";
        if ((body.About ?? "").Trim().Length > GameRules.LevelAboutMax) return $"Описание не длиннее {GameRules.LevelAboutMax} символов";

        var cells = body.Cells ?? [];
        if (cells.Count < GameRules.EditorMinCells) return $"Нужно хотя бы {GameRules.EditorMinCells} ячеек";
        if (cells.Count > GameRules.EditorMaxCells) return $"Не больше {GameRules.EditorMaxCells} ячеек";

        var busyUntil = -1; // до какой ячейки идёт участок прошлой особой
        for (var i = 0; i < cells.Count; i++)
        {
            var c = cells[i];
            if (c.A is < 0 or > 3) return $"Ячейка {i + 1}: неизвестная стрелка";
            if (!body.Fast && (double.IsNaN(c.F) || c.F < GameRules.EditorMinFill || c.F > GameRules.EditorMaxFill))
                return $"Ячейка {i + 1}: заполнение от {GameRules.EditorMinFill} до {GameRules.EditorMaxFill} с";
            if (c.O is not null)
            {
                if (!LevelGenerator.EditorObstacles.Contains(c.O)) return $"Ячейка {i + 1}: неизвестное препятствие";
                if (c.S is not null) return $"Ячейка {i + 1}: препятствие не ставится на особую ячейку";
                if (i <= busyUntil) return $"Ячейка {i + 1}: препятствие внутри участка особой ячейки";
            }
            if (c.S is null) continue;
            if (!LevelGenerator.EditorSpecials.TryGetValue(c.S, out var span)) return $"Ячейка {i + 1}: неизвестная особая ячейка";
            if (i <= busyUntil) return $"Ячейка {i + 1}: внутри участка прошлой особой ячейки";
            if (i + span >= cells.Count) return $"Ячейка {i + 1}: за ней нужно ещё {span} ячеек";
            busyUntil = i + span;
        }
        return ValidateObjects(body.Objects ?? [], cells.Count);
    }

    /// <summary>Объекты: известный вид, своя ячейка есть, недалеко от неё, разумный размер и короткое значение.</summary>
    private static string? ValidateObjects(List<LevelObject> objects, int cellCount)
    {
        if (objects.Count > GameRules.EditorMaxObjects) return $"Не больше {GameRules.EditorMaxObjects} объектов";
        foreach (var o in objects)
        {
            if (o.K is null || !LevelGenerator.EditorObjects.Contains(o.K)) return "Неизвестный объект";
            if (o.C < 0 || o.C >= cellCount) return "Объект привязан к ячейке, которой нет";
            if (!double.IsFinite(o.X) || !double.IsFinite(o.Y) || Math.Abs(o.X) > GameRules.EditorObjectReach || Math.Abs(o.Y) > GameRules.EditorObjectReach)
                return "Объект слишком далеко от своей ячейки";
            if (!double.IsFinite(o.S) || o.S < 0.25 || o.S > 4) return "Размер объекта от 0.25 до 4";
            if (o.V is { Length: > 40 }) return "Текст объекта не длиннее 40 символов";
            if (o.R is not (0 or 90 or 180 or 270)) return "Объект поворачивается только на 90°";
        }
        return null;
    }
}
