---
type: tool_order
before:
  tool: Bash
  input_match: 'worklog append.*Review:'
after:
  tool: Bash
  input_match: 'set-stage \S+ reviewed'
---
The `Review:` note is written before the thread is stamped `reviewed`.
