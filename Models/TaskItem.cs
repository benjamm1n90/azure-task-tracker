namespace TaskTrackerApi.Models;

public class TaskItem
{
    public int Id { get; set; }

    public string Title { get; set; } = string.Empty;

    public bool IsComplete { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
