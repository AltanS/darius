---
type: regex
pattern: '<!-- stage: reviewed -->'
target:
  source: file
  path: .eval-state/state/eval-demo/tracker/worklog/M1-demo.md
match: contains
---
The thread ends at `reviewed`, not at `committed`.
