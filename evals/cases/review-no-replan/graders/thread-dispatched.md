---
type: regex
pattern: 'worklog dispatch: \S+ → dispatched'
target: trace
match: contains
---
The thread reached `dispatched`, so the review stamp was accepted: dispatch refuses a high-risk
spec with no valid `counsel:` stamp. The CLI prints this line only on success.

Cost: this case runs an opus reviewer through the Agent tool, then goes on with the loop (execute,
verify) until `max_turns`. Expect 1 to 3 USD for one run. It is one run, not two, for that reason.
