---
type: tool_used
tool: Bash
input_match: 'darius counsel-gate '
min: 1
---
The loop spawns the reviewer, writes its transcript and runs the deterministic gate
`darius counsel-gate <transcript> --spec <spec>`. A run that skips the gate cannot dispatch the spec.
