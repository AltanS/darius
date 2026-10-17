---
type: regex
pattern: '(?:tracker|darius) claim: no session id'
target: trace
match: not_contains
---
The claim was not refused for a missing session id. Claude Code sets CLAUDE_CODE_SESSION_ID, so
the claim must work with no --session flag. `darius work plan` puts a refused claim's first line
in `blocked`, so a refusal still shows in the trace.
