---
type: tool_used
tool: Agent
input_match: 'turn_budget:'
min: 1
---
The delegation envelope carries a turn budget (`turn_budget: 60` in `skills/work.md` since 0.102.0).
A builder agent that loops on a failing check burns turns with nothing to stop it; with the budget
it stops, writes a `Budget:` note and returns `blocked`.

The Agent input is JSON, and the envelope is a string in its `prompt` field, so a line break shows
as `\n` and `turn_budget:` stays in one piece.
