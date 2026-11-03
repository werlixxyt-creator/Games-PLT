using ArrowRush.Game;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ArrowRush.Data;

/// <summary>Аккаунт игрока. Ник — это UserName, пароль хранится только в виде хеша.</summary>
public sealed class AppUser : IdentityUser
{
    public DateTime CreatedAt { get; set; }

    /// <summary>Надетые скины (Id из <see cref="Skins"/>), null — по умолчанию.</summary>
    public string? SliderSkin { get; set; }
    public string? HeroSkin { get; set; }
    public string? WinSkin { get; set; }
    public string? StreakSkin { get; set; }

    /// <summary>Подпись «о себе» в профиле.</summary>
    public string? About { get; set; }
    /// <summary>Цвет аватара из <see cref="AccountEndpoints.AvatarColors"/>, null — первый из них.</summary>
    public string? AvatarColor { get; set; }
}

/// <summary>Заявка в друзья от From к To; принятая заявка — это дружба. На пару игроков одна запись.</summary>
public sealed class Friendship
{
    public required string FromId { get; set; }
    public AppUser From { get; set; } = null!;
    public required string ToId { get; set; }
    public AppUser To { get; set; } = null!;
    public bool Accepted { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>Полученная награда за задание; Period — номер дня или недели (см. <see cref="Rewards"/>).</summary>
public sealed class RewardClaim
{
    public required string UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public required string TaskId { get; set; }
    public required string Period { get; set; }
    public int Stars { get; set; }
    public DateTime ClaimedAt { get; set; }
}

/// <summary>
/// Уровень из редактора. Cells — ячейки автора в JSON (см. <see cref="EditorCell"/>).
/// Черновик автор может менять; каждая правка увеличивает Revision и снимает Verified.
/// Опубликовать можно только пройденный (Verified) уровень, и после этого он не меняется.
/// Plays и Clears — сколько раз в опубликованный играли и проходили другие игроки.
/// </summary>
public sealed class CustomLevel
{
    public int Id { get; set; }
    public required string AuthorId { get; set; }
    public AppUser Author { get; set; } = null!;
    public required string Name { get; set; }
    public string? About { get; set; }
    public bool Fast { get; set; }
    public Difficulty Difficulty { get; set; } = Difficulty.Normal;
    public required string Theme { get; set; }
    public required string Cells { get; set; }
    public int CellCount { get; set; }
    public int Revision { get; set; }
    public bool Verified { get; set; }
    public bool Published { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public int Plays { get; set; }
    public int Clears { get; set; }
    public int Likes { get; set; }
}

/// <summary>Лайк уровня: один от игрока. Число лайков хранится и в самом уровне, чтобы по нему сортировать.</summary>
public sealed class LevelLike
{
    public required string UserId { get; set; }
    public AppUser User { get; set; } = null!;
    public int LevelId { get; set; }
    public CustomLevel Level { get; set; } = null!;
}

/// <summary>Сыгранный матч.</summary>
public sealed class MatchRecord
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public GameMode Mode { get; set; }
    /// <summary>Быстрый темп (нажатия) или обычный (удержание).</summary>
    public bool Fast { get; set; }
    public Difficulty Difficulty { get; set; } = Difficulty.Normal;
    public DateTime PlayedAt { get; set; }
    public double Duration { get; set; }
    public int SliderCount { get; set; }
    public required string EndReason { get; set; }
    public List<MatchParticipant> Participants { get; set; } = [];
}

/// <summary>Результат одного участника матча (человека или бота).</summary>
public sealed class MatchParticipant
{
    public int Id { get; set; }
    public int MatchRecordId { get; set; }
    public MatchRecord Match { get; set; } = null!;

    /// <summary>null — бот.</summary>
    public string? UserId { get; set; }
    public AppUser? User { get; set; }

    /// <summary>Ник на момент матча.</summary>
    public required string Name { get; set; }
    public bool IsBot { get; set; }
    /// <summary>Победа: в командных режимах она есть и у напарника, который сам не финишировал.</summary>
    public bool Won { get; set; }
    public int Place { get; set; }
    public double? FinishTime { get; set; }
    public int Sliders { get; set; }
    public bool Left { get; set; }
}

public sealed class AppDb(DbContextOptions<AppDb> options)
    : IdentityUserContext<AppUser>(options), IDataProtectionKeyContext
{
    public DbSet<MatchRecord> Matches => Set<MatchRecord>();
    public DbSet<MatchParticipant> MatchParticipants => Set<MatchParticipant>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<RewardClaim> RewardClaims => Set<RewardClaim>();
    public DbSet<CustomLevel> CustomLevels => Set<CustomLevel>();
    public DbSet<LevelLike> LevelLikes => Set<LevelLike>();

    /// <summary>Ключи шифрования cookie — в базе, чтобы после перезапуска сервера не разлогинивало.</summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<MatchRecord>(e =>
        {
            e.Property(m => m.Code).HasMaxLength(16);
            e.Property(m => m.EndReason).HasMaxLength(32);
        });

        b.Entity<MatchParticipant>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(32);
            e.HasIndex(p => p.UserId);
            e.HasOne(p => p.User).WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<Friendship>(e =>
        {
            e.HasKey(f => new { f.FromId, f.ToId });
            e.HasIndex(f => f.ToId);
            e.HasOne(f => f.From).WithMany().HasForeignKey(f => f.FromId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(f => f.To).WithMany().HasForeignKey(f => f.ToId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RewardClaim>(e =>
        {
            e.HasKey(c => new { c.UserId, c.TaskId, c.Period });
            e.HasOne(c => c.User).WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<CustomLevel>(e =>
        {
            e.HasIndex(l => l.AuthorId);
            e.HasIndex(l => l.Published);
            e.HasOne(l => l.Author).WithMany().HasForeignKey(l => l.AuthorId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<LevelLike>(e =>
        {
            e.HasKey(l => new { l.UserId, l.LevelId });
            e.HasIndex(l => l.LevelId);
            e.HasOne(l => l.User).WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(l => l.Level).WithMany().HasForeignKey(l => l.LevelId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
