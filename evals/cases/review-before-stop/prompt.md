---
name: review-before-stop
tags: [work-loop, f4]
runs: 2
max_turns: 30
timeout_seconds: 600
model: sonnet
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

/darius-work continue
