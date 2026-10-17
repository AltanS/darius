---
type: tool_used
tool: Agent
input_match: 'turn_budget:'
min: 1
---
EXPECTED TO FAIL on the current skills. This is the point of the case.

The delegation envelope in `skills/work.md` has no turn budget yet. A builder agent that loops
on a failing check burns turns with nothing to stop it. The fix adds a `turn_budget:` field to the
envelope, so the Agent call carries it. When that lands, this grader passes with no edit.

The Agent input is JSON, and the envelope is a string in its `prompt` field, so a line break shows
as `\n` and `turn_budget:` stays in one piece.
