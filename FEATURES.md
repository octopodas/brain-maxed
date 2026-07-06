# Features extracted from the source video (VoKiKvgpk78)

Every capability the author describes or demos, mapped to its implementation here.
Transcript: captured via yt-dlp auto-subs; principles doc: `Second Brain - Principles and Starter Prompts.pdf`.

| # | Feature described in the video | Where it lives here |
|---|---|---|
| 1 | Maps the whole workspace into one second-brain system | `INDEX.md` — every source: memories, skills, MCP servers, plugins, connectors, routines |
| 2 | Four-layer view: applications / routines / memory / skills | `brain-map.html` rings (blue hexes / gold circled dots / purple disc / orange diamonds) |
| 3 | Departments with visible file counts ("business vs content vs personal") | hub labels show `NAME · count`; skill/memory grouping in `dept()` |
| 4 | Departments vs actual folder structure | VIEW toggle: Departments / Folders (regroups by disk location) |
| 5 | Layout switching without lag ("changing layouts, moving nodes around") | LAYOUT toggle Rings / Force + draggable nodes; verified 51fps in Chrome |
| 6 | Applications ring shows what's connected (spot missing / disconnectable apps) | blue outer ring from `~/.claude.json` + plugins + `extras.md` connectors |
| 7 | Routines connected to the skills they invoke (Hermes → daily-log skill) | routine→skill links by name reference (`analytics daemon → analytics`) |
| 8 | Open a file on the device straight from the view | sidebar `open file` file:// link |
| 9 | Read a skill's content straight from the view | sidebar embeds first 1.2KB of every file node |
| 10 | Search that replaces the file explorer (find → open) | `/` focuses search, typing filters, Enter opens + centers best match |
| 11 | Reload under 10 seconds (author's /goal) | static single file, measured 21ms navigation |
| 12 | brain.js deterministic retrieval: keywords → score index without opening files → one file → one section → follow one pointer → model last | `brain.js` retrieve path |
| 13 | One-step memory store, no model | `node brain.js remember "fact" --name slug` |
| 14 | Small always-true index, routing note in claude md | `INDEX.md` + routing notes in project & global CLAUDE.md |
| 15 | Prove it: same questions, default session vs brain, compare tokens/time | `node brain.js test` (deterministic proof) + live A/B prompts in CLAUDE.md |

Not reproduced (deliberately): the author's 35,466-file corpus (a fresh workspace starts with a handful of memory files — the structure fills as `remember` gets used), and his Obsidian-scale hex/ring-spin cosmetic sliders (YAGNI until asked).
