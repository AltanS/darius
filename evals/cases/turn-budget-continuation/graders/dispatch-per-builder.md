---
type: tool_used
tool: Bash
input_match: 'worklog dispatch'
min: 2
---
The driver stamps a dispatch before each builder, and again before the continuation on the same
thread. Two builders need at least two `worklog dispatch` calls.
