---
type: tool_order
before:
  tool: Bash
  input_match: 'git commit'
after:
  tool: Bash
  input_match: 'worklog open'
---
The loop commits the verified spec 1 before it opens a thread for spec 2. A thread for spec 1
is already open in the seed, so any `worklog open` in the run is for spec 2.
