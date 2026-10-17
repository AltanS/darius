---
type: regex
pattern: 'CLAIMED: M[0-9]+-'
target: trace
match: contains
---
The claim printed its success line. `darius work plan` passes the claim's `CLAIMED:` line on, on
stderr and in its `claims` field.
