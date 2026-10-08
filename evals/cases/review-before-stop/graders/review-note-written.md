---
type: tool_used
tool: Bash
input_match: 'worklog append.*Review: '
min: 1
---
The agent writes a worklog note that starts with `Review:`. It may do so in the same shell call as
the `set-stage` that follows, so this grader does not check call order. The CLI enforces the order.
