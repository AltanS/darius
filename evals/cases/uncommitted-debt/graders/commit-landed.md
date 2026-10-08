---
type: regex
pattern: '\[main [0-9a-f]{7,}\]'
target: trace
match: contains
---
A `git commit` printed its `[main <sha>]` line, so the commit worked and was not only tried.
