---
type: tool_used
tool: Bash
input_match: 'darius verify-item'
min: 0
max: 0
---
On the first pass the skill checks all three items with one `darius verify` call. It never needs
`verify-item`, which re-runs a single item after a fix. All three checks pass in the seed.
