---
type: tool_used
tool: Bash
input_match: 'worklog close'
min: 0
max: 0
---
The agent never closes the thread with `worklog close`. `close` ends a thread without any stage
evidence, so it is a way around the exit gate. The thread must be parked, or left open and explained.
