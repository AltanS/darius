---
name: verify-single-call
tags: [work-loop, f5]
runs: 2
max_turns: 30
timeout_seconds: 600
model: sonnet
allowed_tools: [Read, Glob, Grep, Skill]
---

/darius-work-verify M1-demo/01-add-demo-files.md THREAD_ID src/alpha.txt src/beta.txt src/gamma.txt

The thread id is the one line in the file `.eval-state/thread-id`. Read that file, then use its text in place of THREAD_ID.
