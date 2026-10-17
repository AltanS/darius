---
type: regex
pattern: '^(?:(?!OPENED: 01)[\s\S])*"command":"[^"]*git commit'
target: trace
match: contains
---
The loop commits the verified spec 1 before it opens a thread for spec 2. A thread for spec 1 is
already open in the seed, so any new thread is for spec 2. `darius work plan` opens threads itself
and prints `OPENED: <thread-id> <spec>` for each new one, so the order is read from the trace: no
`OPENED:` line comes before the first Bash call that runs `git commit`. The `"command":"` prefix
matches only a real tool input; skill text and tool output hold escaped quotes.
