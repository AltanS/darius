---
type: tool_used
tool: Bash
input_match: '\b(cat|grep|sed|head|tail)\s(?:[^"\\|;&]|\\[^n])*M1-demo(?:[^"\\|;&]|\\[^n])*\.md'
min: 0
max: 0
---
The skill reads the checklist with `darius show <spec> --json`, never from the spec file. No Bash
call may run `cat`, `grep`, `sed`, `head` or `tail` on a spec file of the tracker tree. The Bash
input is JSON: the match stops at a pipe, a `;`, an `&` or a `\n`, so `cat .eval-state/thread-id;
darius verify M1-demo/...md` does not count, and `grep -n \"Command\" M1-demo/...md` does.
