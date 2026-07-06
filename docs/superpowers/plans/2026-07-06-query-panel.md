# Query Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "ask the brain" panel inside `brain-map.html` that runs the CLI's `retrieve()` via a new `/query` endpoint and shows candidates + the answer section, with graph zoom on candidate click.

**Architecture:** Server-side retrieval (spec approach A). `retrieve()` gains structured output (`candidates`, `answer`) alongside its unchanged CLI text. `serve()` gains `GET /query`. `buildMap()`'s generated HTML gains the panel UI. Everything lives in `brain.js`; `brain-map.html` is generated, never hand-edited.

**Tech Stack:** Node stdlib only (`http`, `fs`, `path`). Vanilla JS/CSS in the generated map. Zero dependencies.

Spec: `docs/superpowers/specs/2026-07-06-query-panel-design.md`

## Global Constraints

- Zero npm dependencies; all changes in the single file `brain.js`.
- CLI text output of `node brain.js "question"` must be byte-identical to before.
- `pick` must be guarded the same way `/file` guards paths: only paths present in the index.
- All user/query content rendered in the browser goes through `textContent`, never `innerHTML`.
- Match existing code style: compact, dense, `ponytail:` comments for deliberate shortcuts.
- Test = `node brain.js test` (the built-in hermetic self-test; there is no test framework).

---

### Task 1: Structured output from `retrieve()` (+ `pick`)

**Files:**
- Modify: `brain.js:204-233` (`retrieve()`)
- Modify: `brain.js:512-542` (`test()` — add assertions)

**Interfaces:**
- Consumes: existing `tokens()`, `loadIndex()`, `scoreEntry()`, `bestSection()`.
- Produces: `retrieve(question, opts)` now returns `{ text, hit, candidates, answer }`:
  - `candidates`: up to 3 of `{ name, layer, path, desc, score }`, score > 0 only.
  - `answer`: `{ path, head, body, pointer }` or `null` when no match. `pointer` = followed pointer target path or `null`; when a pointer is followed, `path` is the pointer target (where `body` came from).
  - `opts.pick` (string path): force the answer entry to the ranked entry with that path; falls back to top if not found. Candidates stay query-ranked.
  - `text` and `hit` unchanged.

- [ ] **Step 1: Write the failing assertions**

In `test()` (brain.js:512), insert after the `t2` assertion (`'scoring failed, got: '` line, brain.js:534) and before the cost-proof comment:

```js
  // structured output for the /query panel
  const t3 = retrieve('zorptangle');
  assert(Array.isArray(t3.candidates) && t3.candidates[0] && t3.candidates[0].name === 'brain-selftest-beta', 'candidates failed: ' + JSON.stringify(t3.candidates));
  assert(typeof t3.candidates[0].score === 'number' && t3.candidates[0].score > 0, 'candidate score missing');
  assert(t3.answer && t3.answer.body.includes('zorptangle'), 'answer body failed');
  const t4 = retrieve('zorptangle', { pick: t1.hit.path });
  assert(t4.answer && t4.answer.path === t1.hit.path, 'pick failed, got: ' + (t4.answer && t4.answer.path));
  const t5 = retrieve('qqqqzzzzgibberish');
  assert(t5.answer === null && t5.candidates.length === 0, 'no-match shape failed: ' + JSON.stringify(t5.candidates));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node brain.js test`
Expected: `AssertionError` — `candidates failed: undefined` (retrieve doesn't return `candidates` yet).

- [ ] **Step 3: Implement structured output**

Replace the whole `retrieve()` function (brain.js:204-233) with:

```js
function retrieve(question, opts = {}) {
  const toks = tokens(question);
  const entries = loadIndex();
  const ranked = entries.map(e => ({ e, s: scoreEntry(e, toks) })).sort((a, b) => b.s - a.s);
  const candidates = ranked.slice(0, 3).filter(r => r.s > 0)
    .map(r => ({ name: r.e.name, layer: r.e.layer, path: r.e.path, desc: r.e.desc, score: r.s }));
  const top = (opts.pick && ranked.find(r => r.e.path === opts.pick)) || ranked[0];
  const out = [];
  if (!top || (top.s === 0 && !opts.pick)) {
    out.push('no index match for: ' + toks.join(' ') + '  (try `node brain.js index` to rescan)');
    return { text: out.join('\n'), hit: null, candidates, answer: null };
  }
  out.push('candidates: ' + ranked.slice(0, 3).map(r => `${r.e.name}(${r.s})`).join('  '));
  const e = top.e;
  if (!fs.existsSync(e.path)) { // apps/routines have no file — the index line IS the answer
    out.push(`📍 ${e.layer} | ${e.name}`, e.desc);
    return { text: out.join('\n'), hit: e, candidates, answer: { path: e.path, head: '(index)', body: e.desc, pointer: null } };
  }
  let sec = bestSection(e.path, toks), pointer = null;
  out.push(`📍 ${e.path} § ${sec.head}`);
  // follow one pointer if the section is basically just a pointer
  const ptr = sec.body.match(/\[\[([\w-]+)\]\]/) || sec.body.match(/\(([^()\s]+\.md)\)/);
  if (ptr && sec.body.trim().length < 240) {
    let target = null;
    if (ptr[1].endsWith('.md')) { const p = path.resolve(path.dirname(e.path), ptr[1]); if (fs.existsSync(p)) target = p; }
    else { const t = entries.find(x => x.name === ptr[1]); if (t && fs.existsSync(t.path)) target = t.path; }
    if (target) { sec = bestSection(target, toks); out.push(`↪ pointer → ${target} § ${sec.head}`); pointer = target; }
  }
  out.push('---', sec.body.trim().slice(0, 3500));
  if (opts.stats) out.push('---', `evidence: ${Math.min(sec.body.trim().length, 3500)} chars (whole file: ${read(e.path).length} chars)`);
  return { text: out.join('\n'), hit: e, candidates, answer: { path: pointer || e.path, head: sec.head, body: sec.body.trim().slice(0, 3500), pointer } };
}
```

This is the existing function with four additions: `candidates` computed from `ranked`, `top` respects `opts.pick`, `pointer` captured when followed, and the three `return`s carry `candidates` + `answer`. Every `out.push` line is identical to before — CLI text unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node brain.js test`
Expected: `PASS — <N> entries indexed` + the cost-proof line.

- [ ] **Step 5: Verify CLI output is unchanged**

Run: `node brain.js "ponytail"`
Expected: same format as before — `candidates:` line, `📍 path § head`, `---`, section body, `---`, `evidence:` line.

- [ ] **Step 6: Commit**

```bash
git add brain.js
git commit -m "feat: structured candidates/answer output from retrieve(), with pick override"
```

---

### Task 2: `GET /query` endpoint in `serve()`

**Files:**
- Modify: `brain.js:545-574` (`serve()` — add one route)

**Interfaces:**
- Consumes: `retrieve(q, { pick })` from Task 1; existing `loadIndex()`, `send()` helper inside the request handler.
- Produces: `GET /query?q=<question>[&pick=<path>]` → `200` JSON `{ candidates, answer, hit }` where `hit` is the answering entry's path (or `null`) — the client uses it to mark the active chip. Empty/missing `q` → `400` JSON `{ error: "missing q" }`. Unindexed `pick` is ignored (falls back to top-ranked).

- [ ] **Step 1: Add the route**

In `serve()`'s request handler, insert between the `/file` branch (ends brain.js:557 with `}`) and the `/browse` branch (`else if (req.method === 'GET' && u.pathname === '/browse')`):

```js
    else if (req.method === 'GET' && u.pathname === '/query') {
      const q = (u.searchParams.get('q') || '').trim();
      if (!q) send(400, JSON.stringify({ error: 'missing q' }));
      else {
        const pick = u.searchParams.get('pick') || '';
        // same guard as /file: pick must be a path the brain already indexes
        const r = retrieve(q, loadIndex().some(e => e.path === pick) ? { pick } : {});
        send(200, JSON.stringify({ candidates: r.candidates, answer: r.answer, hit: r.hit ? r.hit.path : null }));
      }
    }
```

- [ ] **Step 2: Verify with curl**

```bash
node brain.js serve 7399 > /dev/null 2>&1 &
sleep 1
curl -s 'http://localhost:7399/query?q=ponytail'
curl -s 'http://localhost:7399/query?q=ponytail&pick=/nonexistent'
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:7399/query'
kill %1
```

Expected, in order:
1. JSON with `"candidates":[...]` (non-empty, each with `name/layer/path/desc/score`), `"answer":{...}` with non-empty `body`, `"hit":"/..."`.
2. Same JSON as 1 (bad pick ignored, falls back to top).
3. `400`

- [ ] **Step 3: Run the self-test (regression)**

Run: `node brain.js test`
Expected: `PASS`

- [ ] **Step 4: Commit**

```bash
git add brain.js
git commit -m "feat: GET /query endpoint serving structured retrieval"
```

---

### Task 3: "Ask the brain" panel in the generated map

**Files:**
- Modify: `brain.js:300-509` (`mapHtml()` — CSS, HTML, JS additions)
- Regenerate: `brain-map.html` (via `node brain.js map` — never hand-edit)

**Interfaces:**
- Consumes: `GET /query?q=&pick=` JSON `{ candidates, answer, hit }` from Task 2; existing client globals `N` (nodes, each with `.path`), `sel`, `center(n)`, `SERVED`, `#fbhint`.
- Produces: UI only — no exports.

- [ ] **Step 1: Add CSS**

In the `<style>` block of `mapHtml()`, after the `#panel .seg button.on` rule (brain.js:312), insert:

```css
  #ask{background:#0b0d12;border:1px solid #2c333c;color:#dde3ea;padding:7px 10px;border-radius:7px;width:100%;box-sizing:border-box;outline:none}
  #ares{display:none;margin-top:8px;font-size:12px}
  #ares .chips{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
  #ares .chip{background:#0b0d12;border:1px solid #2c333c;border-radius:12px;padding:2px 8px;cursor:pointer;font-size:11px}
  #ares .chip.on{background:#e8eaed;color:#111;font-weight:600}
  #ares .ahead{font-size:10px;word-break:break-all;opacity:.6;margin-bottom:4px}
  #ares .abody{background:#0b0d12;border:1px solid #2c333c;border-radius:7px;padding:8px;white-space:pre-wrap;word-break:break-word;max-height:38vh;overflow:auto;font-size:11px}
```

- [ ] **Step 2: Add HTML**

In the `#panel` markup (brain.js:325), directly after `<input id="q" placeholder="search… ( / , Enter opens)">`, insert:

```html
    <div class="cap">ask the brain</div><input id="ask" placeholder="ask… (Enter)">
    <div id="ares"><div class="chips"></div><div class="ahead"></div><div class="abody"></div></div>
```

- [ ] **Step 3: Generalize the serve-mode hint**

The hint is reused by both attach and ask. Change the `#fbhint` line (brain.js:331) from:

```html
    <div id="fbhint">attaching needs serve mode:<br>run <b>node brain.js serve</b> then open <b>http://localhost:7373</b></div>
```

to:

```html
    <div id="fbhint">this needs serve mode:<br>run <b>node brain.js serve</b> then open <b>http://localhost:7373</b></div>
```

- [ ] **Step 4: Add the client JS**

In the `<script>` of `mapHtml()`, after the `const SERVED=...` line (brain.js:482), insert:

```js
  // --- ask the brain: server-side retrieve via /query; chip click re-picks + zooms the node ---
  const ask=document.getElementById('ask'),ares=document.getElementById('ares');
  let lastQ='';
  async function runQuery(q,pickPath){
    const j=await(await fetch('/query?q='+encodeURIComponent(q)+(pickPath?'&pick='+encodeURIComponent(pickPath):''))).json();
    ares.style.display='block';
    const chips=ares.querySelector('.chips'),head=ares.querySelector('.ahead'),body=ares.querySelector('.abody');
    chips.innerHTML='';
    const active=pickPath||j.hit||'';
    (j.candidates||[]).forEach(c=>{const el=document.createElement('span');
      el.className='chip'+(c.path===active?' on':'');el.textContent=c.name+' · '+c.score;
      el.onclick=()=>{runQuery(lastQ,c.path);const n=N.find(n=>n.path===c.path);if(n){sel=n;center(n)}};
      chips.appendChild(el)});
    if(j.answer){head.textContent='📍 '+j.answer.path+' § '+(j.answer.head||'')+(j.answer.pointer?'  ↪ pointer':'');body.textContent=j.answer.body}
    else{head.textContent='';body.textContent='no index match for: '+q}
  }
  ask.onkeydown=e=>{if(e.key!=='Enter')return;const v=ask.value.trim();if(!v)return;
    if(!SERVED){document.getElementById('fbhint').style.display='block';return}
    lastQ=v;runQuery(v)};
```

Notes for the implementer:
- `N`, `sel`, `center` already exist in this script scope. Assigning `sel=n` draws the white highlight ring (see the `n===sel` branch in `draw()`); `center(n)` pans the camera to it.
- `textContent` everywhere for query/answer content — never `innerHTML` (the cleared `chips.innerHTML=''` on an empty string is fine).
- This block must stay AFTER the `SERVED` const — it reads it.
- Remember `mapHtml()` is a template literal: any backslash in regex/strings you add would need escaping, but this block contains none.

- [ ] **Step 5: Regenerate the map and check the HTML**

```bash
node brain.js map
grep -c 'id="ask"' brain-map.html
grep -c 'this needs serve mode' brain-map.html
```

Expected: `mapped <N> nodes -> brain-map.html`, then `1`, then `1`.

- [ ] **Step 6: Verify live in the browser**

```bash
node brain.js serve 7399
```

Open `http://localhost:7399` and check:
1. Type a question (e.g. `ponytail`) in "ask the brain", press Enter → up to 3 chips + `📍 path § head` + section body appear; top chip is highlighted.
2. Click a non-active chip → answer re-renders from that file, graph pans to and rings that node.
3. Query gibberish (`qqqqzzzz`) → "no index match for: qqqqzzzz".

Then Ctrl-C the server, open `brain-map.html` directly from disk (`file://`), type a question, press Enter → the serve-mode hint appears, no fetch error in console.

- [ ] **Step 7: Run the self-test (regression)**

Run: `node brain.js test`
Expected: `PASS`

- [ ] **Step 8: Commit**

```bash
git add brain.js brain-map.html
git commit -m "feat: ask-the-brain query panel in brain-map with graph zoom"
```
