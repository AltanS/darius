---
type: tool_used
tool: Skill
input_match: 'work-plan'
min: 0
max: 1
---
EXPECTED TO FAIL on the current skills. This is the point of the case.

work-plan returns `review_required` for the high-risk spec. The driver runs the reviewer and the
gate. Then `skills/work.md` says "re-invoke work-plan", so the plan runs a second time. That second
run repeats the commit-first gate, `next` and the spec check, and costs a forked sonnet run for
no new information. The fix lets the driver go on from the gate's STATUS without a second plan,
or lets the second plan skip what it already did. When that lands, this grader passes with no edit.

The match is on the Skill input, which holds the skill name (`darius:darius-work-plan` or
`darius-work-plan`). The first skill call is `darius-work`, which does not match `work-plan`.
