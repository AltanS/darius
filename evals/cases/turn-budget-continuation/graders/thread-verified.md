---
type: regex
pattern: 'set-stage: \S+ → verified'
target: trace
match: contains
---
The continuation finished the work: all eight files exist, `darius work verify` passed, and the
thread reached `verified`. The CLI prints this line only when the stamp was accepted, which needs
ledger evidence for the spec since the dispatch. Later stages pass through `verified`, so this
line covers them too.
