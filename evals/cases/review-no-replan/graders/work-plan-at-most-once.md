---
type: regex
pattern: '(?:"command":"[^"\n]*darius work plan|"skill":"[^"\n]*work-plan")[^\n]*"parent_tool_use_id":null(?:(?!darius worklog dispatch|set-stage \S+ dispatched)[\s\S])*(?:"command":"[^"\n]*darius work plan|"skill":"[^"\n]*work-plan")[^\n]*"parent_tool_use_id":null'
target: trace
match: not_contains
---
The loop plans at most once before it dispatches. work-plan returns `review_required` for the
high-risk spec with the tasks prepared. The driver runs the reviewer and the gate, and on `ready`
dispatches from the saved tasks. A second plan before the dispatch would repeat the commit-first
gate, `next` and the spec check for no new information. A plan after the commit is the normal
next round of the loop, so it is allowed.

A plan is a main-thread Bash call that runs `darius work plan`, or a main-thread Skill call of
`darius-work-plan`. Both count together. Each trace line is one message, and a main-thread message
has `"parent_tool_use_id":null`, so the `darius work plan` call inside a forked `darius-work-plan`
is not counted twice. The pattern matches two such plans with no dispatch between them; it must
not match.
