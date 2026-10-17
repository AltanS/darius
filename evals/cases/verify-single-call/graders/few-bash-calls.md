---
type: tool_used
tool: Bash
min: 1
max: 8
---
The whole verification takes at most 8 Bash calls, forked skill calls included: two scans, one
`verify`, the Artifacts entry, the index rebuild, the stamp, and a little slack. A skill that
verifies item by item, or that reads the spec by hand, goes over.
