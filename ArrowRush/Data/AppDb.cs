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
    }
}
