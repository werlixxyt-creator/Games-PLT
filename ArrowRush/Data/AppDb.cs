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
    public string? WinSkin { get; set; }
    public string? StreakSkin { get; set; }
}

/// <summary>Сыгранный матч.</summary>
public sealed class MatchRecord
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public GameMode Mode { get; set; }
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
    }
}
