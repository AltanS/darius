---
type: regex
pattern: '"type":"tool_use"[^\n]*?"parent_tool_use_id":"(toolu_\w+)"(?:[\s\S]*?"type":"tool_use"[^\n]*?"parent_tool_use_id":"\1"){4}'
target: trace
match: not_contains
---
No builder makes more than 4 tool calls: the budget of 3, plus one for the `Budget:` note. A builder
that ignores the budget writes all eight files in one go, which is 8 calls.

The trace has one line per message. A tool call of a subagent is a line with a `tool_use` block and
a `parent_tool_use_id` that names the Agent call that started the subagent (the main thread has
`null`). The pattern captures that id on one tool call, then needs 4 more tool calls with the same
id, 5 in all. It must not match. A tool_use inside a prompt text is JSON-escaped (`\"type\"`), so it
does not count.
