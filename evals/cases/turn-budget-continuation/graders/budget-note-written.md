---
type: tool_used
tool: Bash
input_match: 'worklog append[^\n]*Budget:'
min: 1
---
A builder with `turn_budget: 3` cannot write eight files with one Write call each. At its budget it
stops and appends a worklog note that starts with `Budget:`. The builder's Bash calls are in the
trace (with a non-null `parent_tool_use_id`), so the append shows as a Bash input.
