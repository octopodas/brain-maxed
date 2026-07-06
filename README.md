# brain-maxed

A deterministic second brain for your agentic workspace. Plain code answers "where is that fact?" — the model only sees the final evidence. One file (`brain.js`), no dependencies, no server.

It indexes your memories (`~/.claude/memory`, `./memory`), all skills, MCP servers, plugins, connectors, and routines into `INDEX.md` — one line per source — then retrieves by scoring that index without opening files.

## Requirements

Node.js. Nothing else.

## Commands

All commands run from this folder.

### Ask a question

```bash
node brain.js "which tts voice do we use"
```

Strips your question to keywords, scores every index line **without opening any files**, opens the single best file, and prints the single best section — plus where it came from:

```
candidates: tts-voices(9)  audio-pipeline(4)  ...
📍 ~/.claude/skills/tts-voices/SKILL.md § Voices
---
<the answer section>
```

If the best section is just a pointer (`[[slug]]` or a `.md` link), it follows it once automatically.

### Store a memory

```bash
node brain.js remember "we deploy on Tuesdays after standup" --name deploy-cadence
```

Writes `memory/report-cadence.md` and its index line in one step. `--name` is optional — without it the slug is built from the first keywords. Re-using a name overwrites (that's how you update a fact).

### Rebuild the index

```bash
node brain.js index
```

Rescans everything on disk. Run after adding/removing skills, MCP servers, or memory files. Safe to run anytime — the index is always regenerated from reality, so it can't drift.

### Regenerate + open the map

```bash
node brain.js map && xdg-open brain-map.html
```

Draws your whole agentic OS as concentric rings, like the source video: **CLAUDE.MD** core → orange **skills** rings → purple **memory** disc with department hubs (with file counts) → gold **routines** ring → outer blue **applications** ring of hexagons. Routines link to the skills they invoke.

In the map:

- drag the canvas to pan, scroll to zoom, drag a node to move it
- click a node → sidebar with description, path, **open file** link (opens the file in a new tab — served through the app in serve mode, direct `file://` otherwise), and the file's content preview (read a skill without leaving the view)
- labels auto-declutter: they never overlap each other and stay a fixed readable size — zoom in and more of them appear as nodes spread apart (works in both Rings and Force)
- `/` focuses search, typing filters, **Enter** opens and centers the best match
- **Layout** toggle: Rings / Force · **View** toggle: Departments / Folders (semantic grouping vs disk location)

### Attach an external project

```bash
node brain.js attach ~/projects/handbook   # index its markdown into the brain
node brain.js detach ~/projects/handbook   # remove it
```

Walks the project for `.md` artifacts (skips `node_modules`, hidden dirs, build output; capped at 200 files/project) and adds them to the index and the map, where the project appears as its own department sector in the memory disc — sized in proportion to its file count and spread as an even, uniformly-spaced annulus, with the disc growing to contain it. Attachments persist in `projects.json`. Attached docs become retrievable like everything else: `node brain.js "onboarding checklist"`.

### Serve mode (attach from the UI)

```bash
node brain.js serve        # http://localhost:7373  (or: node brain.js serve 9090)
```

Serves the map with live controls: **+ attach project…** opens a folder browser — navigate to any folder and attach it without touching the CLI; **✕** next to a project detaches it. Under **projects** every attached project (and core) has a checkbox: all checked = union view, uncheck to exclude one from the presentation. Checkbox state persists in the browser; the attachment list itself lives in `projects.json`.

Opened as a plain file (`brain-map.html`), the checkboxes still work — only attach/detach and the ask-the-brain panel need serve mode.

### Self-test

```bash
node brain.js test
```

Verifies known questions hit the right files, the remember-roundtrip works, and prints the cost proof (evidence chars handed to the model vs whole-file chars).

## Files

| File | What it is |
|---|---|
| `brain.js` | the whole engine |
| `INDEX.md` | generated catalogue — `layer \| name \| path \| description`, one line per source |
| `memory/` | facts stored via `remember` |
| `extras.md` | hand-maintained apps/routines invisible to disk scans (claude.ai connectors, daemons) — edit, then reindex |
| `brain-map.html` | generated graph view — open locally |
| `CLAUDE.md` | routing note so Claude Code sessions use the brain instead of grepping |

## Claude Code integration

You normally don't run anything yourself: routing notes in this repo's `CLAUDE.md` and your global `~/.claude/CLAUDE.md` tell every session to call `brain.js` before grep/glob-hunting for workspace facts, and to store new durable facts with `remember`.

## License

MIT — see [LICENSE](LICENSE).
