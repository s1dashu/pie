# Ousia Task Engine

Ousia Task Engine is Ousia's unified surface for scheduled work, webhook intake, and future agent turns.

New tasks should use `tasks/<task-id>/task.json`. Link a task to a project with `task.json` `projectId`.
The engine keeps runtime files next to each spec:

```text
tasks/<task-id>/
  task.json
  state.json
  runs.jsonl
```

`task.json` is user-editable intent. `state.json` and `runs.jsonl` are engine-owned and should not be edited by hand.

Example `task.json`:

```json
{
  "version": 1,
  "id": "daily-review",
  "trigger": { "type": "cron", "cron": "0 9 * * *" },
  "action": {
    "type": "agent",
    "prompt": "Review open projects and decide what needs attention today."
  }
}
```

## Locations

Use this path for new task specs:

1. Task: `tasks/<task-id>/task.json`

Do not create new task specs under `projects/<project-id>/tasks/`. Keep `projects/` for workspace files; associate tasks to projects with `projectId`.

Ousia does not preserve the old workflow/wakeup file layout. Use `task.json` only.

## Runtime State

Each task directory contains:

1. `task.json`: declarative task definition.
2. `state.json`: latest engine state for this task, including `taskKey`, `currentRun`, `lastRun`, counters, and schedule markers such as `lastStartedScheduledFor` and `lastCompletedScheduledFor`.
3. `runs.jsonl`: append-only per-run history. Each run has a stable `runId` and `scheduledFor` value.

The engine also writes a summary view to `<agent-home>/runtime/task-engine-state.json` and an event stream to `<agent-home>/runtime/task-engine-events.jsonl`.

The engine uses a local single-instance lock under `<agent-home>/runtime/task-engine.lock` so two Ousia runtimes sharing the same home do not schedule the same task concurrently.

## Agent Tasks

Agent tasks deliver a prompt back into the assistant through the local gateway.

```json
{
  "version": 1,
  "id": "follow-up",
  "trigger": { "type": "once", "runAt": "2026-04-29T10:00:00+08:00" },
  "action": {
    "type": "agent",
    "prompt": "Follow up on the user's requested item."
  }
}
```

Supported triggers are `once`, `interval`, and `cron`.

## Exec Tasks

Exec tasks run a shell command and write the result to a sink.

```json
{
  "version": 1,
  "id": "runtime-health",
  "trigger": { "type": "interval", "everySec": 180 },
  "action": {
    "type": "exec",
    "command": "./run.sh",
    "timeoutSec": 30
  },
  "sink": {
      "type": "append_jsonl",
      "path": "runtime/runtime-health.jsonl"
  }
}
```

Supported sink types are `append_jsonl` and `write_json`.

## Runtime Files

Ousia Task Engine writes runtime state under `<agent-home>/runtime/`, including:

1. `task-engine-events.jsonl`
2. `task-engine-state.json`
3. `heartbeat.jsonl`
4. `heartbeat-latest.json`
5. `internal-turn-gateway.jsonl`
