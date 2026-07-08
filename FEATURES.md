# Features

Every capability of brain-maxed, mapped to where it lives in the code.

| # | Feature | Where it lives |
|---|---|---|
| 1 | Maps the whole workspace into one second-brain system | `INDEX.md` — every source: memories, skills, MCP servers, plugins, connectors, routines |
| 2 | Four-layer view: applications / routines / memory / skills | `brain-map.html` rings (blue hexes / gold circled dots / purple disc / orange diamonds) |
| 3 | Departments with visible file counts | hub labels show `NAME · count`; skill/memory grouping in `dept()` |
| 4 | Departments vs actual folder structure | VIEW toggle: Departments / Folders (regroups by disk location) |
| 5 | Layout switching without lag, draggable nodes | LAYOUT toggle Rings / Force + draggable nodes |
| 6 | Applications ring shows what's connected | blue outer ring from `~/.claude.json` + plugins + `extras.md` connectors |
| 7 | Routines connected to the skills they invoke | routine→skill links by name reference (e.g. `analytics daemon → analytics`) |
| 8 | Open a file on disk straight from the view | sidebar `open file` link |
| 9 | Read a file's content straight from the view | sidebar embeds first 1.2KB of every file node |
| 10 | Search that replaces the file explorer | `/` focuses search, typing filters, Enter opens + centers best match |
| 11 | Selected node stands out | pulsing selection ring |
| 12 | Readable text at any zoom or screen size | +/− font-size controls scale panel and side-pane text; panel resizable by dragging its left edge |
| 13 | Ask a full question without leaving the map | **ask the brain** panel (serve mode): scored candidate chips + answer body, click a chip to re-pick and zoom to it |
| 14 | Attach outside projects without touching the CLI | serve mode: **+ attach project…** folder browser, ✕ to detach, per-project checkboxes to include/exclude from the view |
| 15 | brain.js deterministic retrieval: keywords → score index without opening files → one file → one section → follow one pointer → model last | `brain.js` retrieve path |
| 16 | One-step memory store, no model | `node brain.js remember "fact" --name slug` |
| 17 | Enumerate matches instead of one answer | leading `list` query → newest-first index dump |
| 18 | Small always-true index, routing note in claude md | `INDEX.md` + routing notes in project & global CLAUDE.md |
| 19 | Prove it: same questions, default session vs brain, compare tokens/time | `node brain.js test` (deterministic proof) |

Not built: cosmetic sliders/animation tuning beyond what's needed (YAGNI until asked).
