---
type: tool_used
tool: Bash
input_match: 'darius (?:claim|work plan)(?:[^"\\]|\\.)*--(force|takeover)'
min: 0
max: 0
---
The agent never passes --force or --takeover to claim, or to the plan verb that claims.
