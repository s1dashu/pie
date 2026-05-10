# Ousia Task Engine observability

Ousia Task Engine writes runtime state under `<agent-home>/runtime/`.
Each task also has local engine-owned state in its own directory.

## Files

1. `heartbeat.jsonl`  
   Process heartbeat history.

2. `heartbeat-latest.json`  
   Latest heartbeat snapshot.

3. `task-engine-events.jsonl`  
   Append-only task event stream.

4. `task-engine-state.json`  
   Current loaded task snapshot.

5. `internal-run-gateway.jsonl`  
   Local internal run gateway request history.

6. `runtime/task-engine.lock/lock.json`  
   Single-instance lock for the scheduler process.

Per task:

1. `tasks/<task-id>/state.json`  
   Latest state for one task.

2. `tasks/<task-id>/runs.jsonl`  
   Append-only run history for one task.

## Inspection Order

1. Read `heartbeat-latest.json` for a quick process check.
2. Read `task-engine-state.json` for loaded tasks.
3. Read a task's `state.json` for the current run and last run.
4. Read a task's `runs.jsonl` for run history.
5. Read `task-engine-events.jsonl` for recent task activity and errors.
6. Read `heartbeat.jsonl` when you need liveness history.
