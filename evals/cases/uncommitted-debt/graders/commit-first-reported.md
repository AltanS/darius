---
type: regex
pattern: '\\?"status\\?":\\?"commit_first|STATUS: commit_first'
target: trace
match: contains
---
The plan answered `commit_first`, so the debt was seen, not stumbled on. `darius work plan --json`
prints `"status":"commit_first"` (escaped in the trace), its text form prints `STATUS: commit_first`.
