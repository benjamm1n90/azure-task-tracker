using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskTrackerApi.Data;
using TaskTrackerApi.Models;

namespace TaskTrackerApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TasksController : ControllerBase
{
    private readonly TaskDbContext _db;
    private readonly ILogger<TasksController> _logger;

    public TasksController(TaskDbContext db, ILogger<TasksController> logger)
    {
        _db = db;
        _logger = logger;
    }

    // GET api/tasks
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TaskItem>>> GetAll()
    {
        _logger.LogInformation("Fetching all tasks");
        return await _db.Tasks.OrderByDescending(t => t.CreatedAtUtc).ToListAsync();
    }

    // GET api/tasks/5
    [HttpGet("{id:int}")]
    public async Task<ActionResult<TaskItem>> GetById(int id)
    {
        var task = await _db.Tasks.FindAsync(id);
        if (task is null)
        {
            _logger.LogWarning("Task {TaskId} not found", id);
            return NotFound();
        }
        return task;
    }

    // POST api/tasks
    [HttpPost]
    public async Task<ActionResult<TaskItem>> Create(TaskItem input)
    {
        var task = new TaskItem { Title = input.Title };
        _db.Tasks.Add(task);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Created task {TaskId}: {Title}", task.Id, task.Title);
        return CreatedAtAction(nameof(GetById), new { id = task.Id }, task);
    }

    // PUT api/tasks/5
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, TaskItem input)
    {
        var task = await _db.Tasks.FindAsync(id);
        if (task is null) return NotFound();

        task.Title = input.Title;
        task.IsComplete = input.IsComplete;
        await _db.SaveChangesAsync();
        _logger.LogInformation("Updated task {TaskId}", id);
        return NoContent();
    }

    // DELETE api/tasks/5
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var task = await _db.Tasks.FindAsync(id);
        if (task is null) return NotFound();

        _db.Tasks.Remove(task);
        await _db.SaveChangesAsync();
        _logger.LogInformation("Deleted task {TaskId}", id);
        return NoContent();
    }
}
