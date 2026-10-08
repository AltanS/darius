---
type: regex
pattern: 'set-stage: \S+ → committed'
target: trace
match: contains
---
`worklog set-stage ... committed` printed its success line. The CLI accepts that stamp only for a real
commit that touches an artifact. The skills commit with `git commit -q`, so a `[main <sha>]` line never
shows in the trace.
