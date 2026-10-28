using ArrowRush.Data;
using ArrowRush.Game;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;

var builder = WebApplication.CreateBuilder(args);

// Railway (и другие хостинги) передают порт через переменную PORT.
// Локально переменной нет — тогда работают настройки из launchSettings.json.
var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

// Railway принимает HTTPS и проксирует к нам по HTTP — доверяем его заголовкам,
// чтобы cookie входа помечалась как Secure.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

// База данных и аккаунты
builder.Services.AddAppDatabase(builder.Configuration);
builder.Services.AddDataProtection().PersistKeysToDbContext<AppDb>().SetApplicationName("ArrowRush");

builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme).AddIdentityCookies();
builder.Services.AddAuthorization();
builder.Services
    .AddIdentityCore<AppUser>(o =>
    {
        o.Password.RequiredLength = AccountEndpoints.MinPasswordLength;
        o.Password.RequireDigit = false;
        o.Password.RequireLowercase = false;
        o.Password.RequireUppercase = false;
        o.Password.RequireNonAlphanumeric = false;
        o.User.AllowedUserNameCharacters = ""; // проверяем сами, чтобы разрешить кириллицу
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
    })
    .AddEntityFrameworkStores<AppDb>()
    .AddSignInManager();

builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "arrowrush.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.ExpireTimeSpan = TimeSpan.FromDays(30);
    o.SlidingExpiration = true;
    // это API, а не сайт со страницей входа — вместо редиректа просто 401/403
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});

builder.Services.AddSignalR();
builder.Services.AddSingleton<MatchManager>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<MatchManager>());

var app = builder.Build();

app.EnsureDatabase();

app.UseForwardedHeaders();
app.UseDefaultFiles();   // отдаёт wwwroot/index.html на "/"
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapAccount();
app.MapHub<GameHub>("/hub");
app.MapGet("/health", () => Results.Ok("ok"));

app.Run();
