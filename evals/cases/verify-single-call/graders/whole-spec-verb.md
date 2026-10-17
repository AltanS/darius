---
type: tool_used
tool: Bash
input_match: 'darius (?:work )?verify '
min: 1
---
The skill runs a whole-spec verb at least once: `darius work verify <spec>` (since 0.102.0), or
`darius verify <spec>`. The trailing space keeps `darius verify-item` from matching.
