---
type: regex
pattern: 'set-stage: \S+ → reviewed'
target: trace
match: contains
---
The thread ends at `reviewed`, not at `committed`. The CLI prints this line only when the stamp
was accepted, and it accepts `reviewed` only after a `Review:` note that follows the commit stamp,
so it also proves the note came first. The worklog file is not read: after the last spec the loop
may archive the milestone, which distills the worklog.
