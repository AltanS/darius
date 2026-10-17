---
type: regex
pattern: 'set-stage: \S+ → verified'
target: trace
match: contains
---
The delegated work landed and was verified, so the thread reached at least `verified`. The CLI
prints this line only when the stamp was accepted, which needs ledger evidence for the spec.
Later stages (`committed`, `reviewed`) pass through `verified`, so this line covers them too.
