---
type: regex
pattern: '"command":"[^"]*git commit[\s\S]*OPENED: 01'
target: trace
match: contains
---
After the commit the loop plans again and opens the thread for spec 2. Without this grader a run
that commits and then stops would pass `commit-before-new-work`.
