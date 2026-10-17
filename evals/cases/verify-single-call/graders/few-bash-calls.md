---
type: tool_used
tool: Bash
min: 1
max: 4
---
The whole verification takes at most 4 Bash calls, forked skill calls included. `darius work verify`
does the scans, `verify`, the index rebuild, the Artifacts entry and the stamp in one call, so a
run needs one or two calls and a little slack. A skill that verifies item by item, or that reads
the spec by hand, goes over.
