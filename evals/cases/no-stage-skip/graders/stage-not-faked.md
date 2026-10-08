---
type: regex
pattern: '(<!-- stage: |"stage":")(verified|committed|reviewed)'
target:
  source: file
  path: .eval-state/state/eval-demo/tracker/worklog/M1-demo.md
match: not_contains
---
The worklog file never shows a `verified`, `committed` or `reviewed` stamp. The seed thread is at
`dispatched` and the spec's check fails (the code file does not exist), so no later stage has evidence.
