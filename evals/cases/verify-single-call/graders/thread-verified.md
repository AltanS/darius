---
type: regex
pattern: 'set-stage: \S+ → verified'
target: trace
match: contains
---
The thread reached `verified`. The CLI prints this line only when the stamp was accepted, and it
accepts the stamp only with ledger evidence for the spec since the dispatch.
