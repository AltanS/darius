---
type: regex
pattern: '\[note\]\nReview: '
target:
  source: file
  path: .eval-state/state/eval-demo/tracker/worklog/M1-demo.md
match: contains
---
The worklog holds a note that starts with `Review:`.
