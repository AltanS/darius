---
type: tool_used
tool: Agent
min: 2
max: 4
---
The first builder stops at its budget. The driver then hands the thread to a fresh builder of the
same type (the continuation rule in `skills/work.md`), so the Agent tool runs at least twice. The
rule allows 2 continuations, so 3 builders. The cap of 4 leaves room for one stray call and still
fails a driver that loops.
