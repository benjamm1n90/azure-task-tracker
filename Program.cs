using Azure.Identity;
using Microsoft.EntityFrameworkCore;
using TaskTrackerApi.Data;

var builder = WebApplication.CreateBuilder(args);

// ---- Secrets: Azure Key Vault ---------------------------------------------
// In Production, App Service's managed identity reads secrets straight out of
// Key Vault, so no connection string or password ever lives in config files
// or environment variables that a human could see. Locally (no KeyVaultUri
// configured) this block is skipped and we fall back to User Secrets / appsettings.Development.json.
var keyVaultUri = builder.Configuration["KeyVaultUri"];
if (!string.IsNullOrEmpty(keyVaultUri))
{
    builder.Configuration.AddAzureKeyVault(
        new Uri(keyVaultUri),
        new DefaultAzureCredential());
}

// ---- Data: Azure SQL Database via EF Core ---------------------------------
// EnableRetryOnFailure adds automatic retry-with-backoff for the kinds of
// brief, self-resolving network blips that are normal when talking to a
// cloud database (DNS hiccups, a serverless tier waking from auto-pause,
// a container that just cold-started) — without this, any one-off blip
// surfaces as a 500 to the caller instead of quietly succeeding on retry.
builder.Services.AddDbContext<TaskDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("TaskDb"),
        sqlOptions => sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 5,
            maxRetryDelay: TimeSpan.FromSeconds(10),
            errorNumbersToAdd: null)));

// ---- Observability: Azure Monitor / Application Insights ------------------
// Reads APPLICATIONINSIGHTS_CONNECTION_STRING from App Service configuration
// automatically; this call just turns the SDK on so every request, dependency
// call (e.g. SQL queries) and exception is captured.
builder.Services.AddApplicationInsightsTelemetry();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

// Simple liveness/readiness endpoint — also shows up nicely as an Application
// Insights availability check target later on.
app.MapGet("/healthz", () => Results.Ok(new { status = "healthy", utc = DateTime.UtcNow }));

app.Run();
