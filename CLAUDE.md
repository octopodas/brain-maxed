# brain-maxed — second brain

Deterministic memory engine. Check the index first, open files second, invoke the model last.

## Retrieval routing (every session)

- Any "what did we decide / which X do we use / where is Y" question about the workspace: run `node brain.js "the question"` BEFORE any Grep/Glob/Read over memory or skills. It scores `INDEX.md` without opening files, opens ONE file, returns ONE section.
- Enumeration ("list recent plans in X"): lead the query with `list` — returns ALL matching index entries newest-first instead of one section.
- Store a new durable fact: `node brain.js remember "the fact" --name slug` (writes `memory/<slug>.md` + index line, no model needed).
- After adding/removing skills, MCP servers, or memory files: `node brain.js index` to rescan, `node brain.js map` to refresh the visual.
- Connectors/daemons not on disk live in `extras.md` — edit it, then reindex.

## Files

- `brain.js` — the whole engine (retrieve / index / remember / map / test), zero deps
- `INDEX.md` — generated catalogue, one line per source: `layer | name | path | description`
- `memory/` — facts stored via `remember`
- `extras.md` — manually maintained apps/routines invisible to disk scans
- `brain-map.html` — generated graph of the agentic OS (open locally; regenerate with `map`)

## Prove it (principle 5)

`node brain.js test` is the deterministic check. For a live comparison, ask the same workspace question in a fresh default session and in one that follows this routing, then compare `/context` message tokens and wall time. Expected: the brain wins on facts buried inside files; the always-loaded index means simple lookups are near-instant either way.
