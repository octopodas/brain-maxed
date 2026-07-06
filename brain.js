#!/usr/bin/env node
// brain.js — deterministic second-brain engine. Zero deps, zero model calls.
// The model is invoked exactly once, at the end, with evidence attached.
//
//   node brain.js "which tts voice do we use"   retrieve: score index -> open ONE file -> ONE section
//   node brain.js index                          rescan workspace -> INDEX.md
//   node brain.js remember "fact" [--name slug]  store memory file + index line
//   node brain.js map                            regenerate brain-map.html
//   node brain.js test                           self-check + token-cost proof

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const HOME = os.homedir();
const INDEX = path.join(ROOT, 'INDEX.md');
const MEMDIR = path.join(ROOT, 'memory');
const PROJECTS = path.join(ROOT, 'projects.json'); // attached external projects, persisted
const SOURCES = {
  userMemory: path.join(HOME, '.claude', 'memory'),
  // Claude Code stores per-project memory under ~/.claude/projects/<abs-path-with-slashes-as-dashes>/memory
  projectMemory: path.join(HOME, '.claude', 'projects', ROOT.replace(/\//g, '-'), 'memory'),
  brainMemory: MEMDIR,
  skills: path.join(HOME, '.claude', 'skills'),
  claudeJson: path.join(HOME, '.claude.json'),
  plugins: path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'),
  extras: path.join(ROOT, 'extras.md'),
};

const STOP = new Set(('a an the is are was were be been being do does did done we i you it they he she of in on at to for with from by about as and or but not no what which who whom when where why how use used using our my your their its this that these those have has had can could should would will shall may might me us them there here get got find found tell show any all some one same please just like really actually').split(' '));

// ---------- shared ----------
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const clean = s => String(s).replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, 160);
const tokens = q => (q.toLowerCase().match(/[a-z0-9][a-z0-9-]+/g) || []).filter(t => !STOP.has(t) && t.length > 1);
const wordRe = t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}
function describeMd(text) {
  const fm = frontmatter(text);
  if (fm.description) return fm.description;
  const body = text.replace(/^---\n[\s\S]*?\n---/, '');
  for (const line of body.split('\n')) {
    const l = line.replace(/^#+\s*/, '').trim();
    if (l) return l;
  }
  return '';
}

// ---------- external projects ----------
function loadProjects() {
  try { return JSON.parse(read(PROJECTS)).projects || []; } catch { return []; }
}
function setProject(dir, on) {
  dir = path.resolve(dir);
  if (on && !fs.statSync(dir).isDirectory()) throw new Error('not a directory: ' + dir);
  const next = on ? [...new Set([...loadProjects(), dir])] : loadProjects().filter(p => p !== dir);
  fs.writeFileSync(PROJECTS, JSON.stringify({ projects: next }, null, 2) + '\n');
  return next;
}
function walkMd(dir, depth = 0, out = []) {
  if (depth > 3 || out.length >= 200) return out; // ponytail: 200 files/project cap, raise if a real project needs more
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (out.length >= 200) break;
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !/^(node_modules|dist|build|out|coverage|vendor|venv)$/.test(e.name)) walkMd(path.join(dir, e.name), depth + 1, out);
    } else if (e.name.endsWith('.md')) out.push(path.join(dir, e.name));
  }
  return out;
}

// ---------- index ----------
function scanEntries() {
  const entries = []; // {layer, name, path, desc}
  const addDir = (dir, layer) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      const p = path.join(dir, f);
      entries.push({ layer, name: f.replace(/\.md$/, ''), path: p, desc: clean(describeMd(read(p))) });
    }
  };
  addDir(SOURCES.userMemory, 'memory');
  addDir(SOURCES.projectMemory, 'memory');
  addDir(SOURCES.brainMemory, 'memory');

  for (const proj of loadProjects()) {
    const pname = path.basename(proj);
    for (const f of walkMd(proj))
      entries.push({ layer: 'project', name: pname + '/' + path.relative(proj, f).replace(/\.md$/, ''), path: f, desc: clean(describeMd(read(f))) });
  }

  if (fs.existsSync(SOURCES.skills)) {
    for (const d of fs.readdirSync(SOURCES.skills)) {
      const p = path.join(SOURCES.skills, d, 'SKILL.md');
      if (fs.existsSync(p)) entries.push({ layer: 'skill', name: d, path: p, desc: clean(describeMd(read(p))) });
    }
  }

  try {
    const cj = JSON.parse(read(SOURCES.claudeJson));
    const apps = new Map();
    for (const name of Object.keys(cj.mcpServers || {})) apps.set(name, 'global MCP server');
    for (const [proj, v] of Object.entries(cj.projects || {}))
      for (const name of Object.keys(v.mcpServers || {}))
        if (!apps.has(name)) apps.set(name, 'project MCP server (' + path.basename(proj) + ')');
    for (const [name, desc] of apps) entries.push({ layer: 'app', name, path: 'mcp:' + name, desc });
  } catch { }

  try {
    const pl = JSON.parse(read(SOURCES.plugins));
    const seen = new Set();
    for (const key of Object.keys(pl.plugins || {})) {
      const name = key.split('@')[0];
      if (!seen.has(name)) { seen.add(name); entries.push({ layer: 'app', name, path: 'plugin:' + name, desc: 'Claude Code plugin' }); }
    }
  } catch { }

  // extras.md: layers code can't scan from disk (claude.ai connectors, daemons). "## apps" / "## routines", lines: name | desc
  let section = '';
  for (const line of read(SOURCES.extras).split('\n')) {
    const h = line.match(/^##\s+(\w+)/);
    if (h) { section = h[1].toLowerCase(); continue; }
    const m = line.match(/^-\s*([^|]+)\|(.+)$/);
    if (m && (section === 'apps' || section === 'routines'))
      entries.push({ layer: section === 'apps' ? 'app' : 'routine', name: m[1].trim(), path: 'extras.md', desc: clean(m[2]) });
  }
  try {
    const cron = require('child_process').execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    for (const line of cron.split('\n'))
      if (line.trim() && !line.startsWith('#'))
        entries.push({ layer: 'routine', name: 'cron: ' + line.trim().split(/\s+/).slice(5).join(' ').slice(0, 40), path: 'crontab', desc: clean(line) });
  } catch { }
  return entries;
}

function writeIndex() {
  const entries = scanEntries();
  const lines = ['# Brain Index', '<!-- generated by `node brain.js index` on ' + new Date().toISOString().slice(0, 10) + ' — one line per source: layer | name | path | description -->', ''];
  for (const e of entries) lines.push(`- ${e.layer} | ${e.name} | ${e.path} | ${e.desc}`);
  fs.writeFileSync(INDEX, lines.join('\n') + '\n');
  return entries;
}

function loadIndex() {
  if (!fs.existsSync(INDEX)) return writeIndex();
  const entries = [];
  for (const line of read(INDEX).split('\n')) {
    const m = line.match(/^-\s*([^|]+)\|([^|]+)\|([^|]+)\|(.*)$/);
    if (m) entries.push({ layer: m[1].trim(), name: m[2].trim(), path: m[3].trim(), desc: m[4].trim() });
  }
  return entries;
}

// ---------- retrieve ----------
function scoreEntry(e, toks) {
  let s = 0;
  for (const t of toks) {
    const re = wordRe(t);
    if (re.test(e.name)) s += 4;
    if (re.test(e.desc)) s += 2;
    if (re.test(e.path)) s += 1;
  }
  return s;
}

function sections(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---/, '');
  const heads = [...body.matchAll(/^#{1,6}\s+.*$/gm)];
  if (!heads.length) return [{ head: '(top)', body }];
  const out = [];
  if (heads[0].index > 0) out.push({ head: '(intro)', body: body.slice(0, heads[0].index) });
  heads.forEach((h, i) => out.push({ head: h[0].replace(/^#+\s*/, ''), body: body.slice(h.index, heads[i + 1] ? heads[i + 1].index : undefined) }));
  return out;
}

function bestSection(file, toks) {
  const secs = sections(read(file));
  let best = secs[0], bs = -1;
  for (const s of secs) {
    let sc = 0;
    for (const t of toks) {
      const re = wordRe(t);
      if (re.test(s.head)) sc += 3;
      sc += Math.min((s.body.match(new RegExp(wordRe(t).source, 'gi')) || []).length, 5);
    }
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}

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

// ---------- remember ----------
function remember(fact, slug) {
  fs.mkdirSync(MEMDIR, { recursive: true });
  slug = slug || tokens(fact).slice(0, 5).join('-') || 'memory-' + Date.now();
  const file = path.join(MEMDIR, slug + '.md');
  fs.writeFileSync(file, `---\nname: ${slug}\ndate: ${new Date().toISOString().slice(0, 10)}\n---\n\n${fact}\n`);
  const line = `- memory | ${slug} | ${file} | ${clean(fact)}`;
  const idx = fs.existsSync(INDEX) ? read(INDEX).split('\n') : ['# Brain Index', ''];
  const existing = idx.findIndex(l => l.includes(`| ${slug} |`));
  if (existing >= 0) idx[existing] = line; else idx.push(line);
  fs.writeFileSync(INDEX, idx.join('\n').replace(/\n*$/, '\n'));
  return file;
}

// ---------- map ----------
// ponytail: skill departments are rough keyword buckets, refine when they misfile something you care about
function dept(e) {
  if (e.layer === 'project') return e.name.split('/')[0];
  if (e.layer === 'memory') {
    if (e.path.startsWith(MEMDIR)) return 'brain memory';
    return e.path.includes(path.join('.claude', 'projects')) ? 'project memory' : 'user memory';
  }
  if (e.layer === 'app') return e.path.startsWith('plugin:') ? 'plugins' : e.path.startsWith('mcp:') ? 'mcp servers' : 'connectors';
  if (e.layer === 'routine') return 'routines';
  const n = e.name;
  if (/hyperframe|video|motion|caption|slideshow|remotion|talking|faceless|explainer|launch|music|recut|media|banana|stitch/.test(n)) return 'media & video';
  if (/monetization|undergradly|widget|esy|compliance|analytics|writing|articles|sponsored|graphify/.test(n)) return 'sites & content';
  if (/brainstorm|debug|test-driven|plan|review|worktree|branch|subagent|superpower|verification|skill|dispatch|executing|finishing|ponytail|fusion|agy|humanizer/.test(n)) return 'dev process';
  return 'other skills';
}

function buildMap() {
  const entries = loadIndex();
  const nodes = entries.map((e, i) => {
    const onDisk = e.path.startsWith('/') && fs.existsSync(e.path);
    let folder = e.path.split(/[:.]/)[0]; // mcp / plugin / extras / crontab
    if (onDisk) {
      const d = path.dirname(e.path);
      folder = path.basename(d) === e.name ? path.basename(path.dirname(d)) : path.basename(path.dirname(d)) + '/' + path.basename(d);
    }
    return {
      id: i, name: e.name, layer: e.layer, dept: dept(e), folder, desc: e.desc, path: e.path,
      project: e.layer === 'project' ? e.name.split('/')[0] : 'core',
      size: onDisk ? fs.statSync(e.path).size : 0,
      preview: onDisk ? read(e.path).slice(0, 1200) : '',
    };
  });
  const links = [];
  const byName = new Map(nodes.map(n => [n.name, n]));
  for (const n of nodes) { // memory cross-links via [[slug]]
    if (n.layer !== 'memory' || !fs.existsSync(n.path)) continue;
    for (const m of read(n.path).matchAll(/\[\[([\w-]+)\]\]/g)) {
      const t = byName.get(m[1]);
      if (t && t.id !== n.id) links.push({ s: n.id, t: t.id });
    }
  }
  for (const r of nodes.filter(n => n.layer === 'routine')) // routine -> skill it invokes
    for (const s of nodes.filter(n => n.layer === 'skill'))
      if (wordRe(s.name).test(r.desc)) links.push({ s: r.id, t: s.id });
  const html = mapHtml(JSON.stringify({ nodes, links, projects: loadProjects() }).replace(/<\//g, '<\\/'));
  fs.writeFileSync(path.join(ROOT, 'brain-map.html'), html);
  return nodes.length;
}

// concentric-rings layout: core -> SKILLS rings -> MEMORY disc w/ dept hubs -> ROUTINES ring -> APPLICATIONS ring
function mapHtml(data) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>brain-maxed</title><style>
  html,body{margin:0;height:100%;background:#07080c;color:#dde3ea;font:14px/1.45 system-ui,sans-serif;overflow:hidden}
  #c{display:block;cursor:grab}
  #side{position:fixed;left:0;top:0;bottom:0;width:300px;background:#12151cee;border-right:1px solid #2c333c;padding:16px;display:none;overflow:auto}
  #side h2{margin:0 0 4px;font-size:16px} #side .layer{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.7}
  #side .path{font-size:11px;word-break:break-all;opacity:.6;margin:8px 0} #side a{color:#6cb2ff}
  #panel{position:fixed;right:16px;top:16px;width:250px;background:#12151cdd;border:1px solid #2c333c;border-radius:10px;padding:14px}
  #q{background:#0b0d12;border:1px solid #2c333c;color:#dde3ea;padding:7px 10px;border-radius:7px;width:100%;box-sizing:border-box;outline:none}
  #panel label{display:flex;gap:6px;align-items:center;font-size:12px;margin-top:10px;opacity:.85}
  #panel .cap{font-size:10px;letter-spacing:.12em;opacity:.55;margin:12px 0 5px;text-transform:uppercase}
  #panel .seg{display:flex;gap:6px} #panel .seg button{flex:1;background:#0b0d12;border:1px solid #2c333c;color:#aab3bd;padding:5px 0;border-radius:7px;font-size:12px;cursor:pointer}
  #panel .seg button.on{background:#e8eaed;color:#111;font-weight:600}
  #side pre{font-size:11px;background:#0b0d12;border:1px solid #2c333c;border-radius:7px;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:55vh;overflow:auto}
  #plist label{display:flex;gap:6px;align-items:center;font-size:12px;margin:4px 0;opacity:.9}
  #plist .x{margin-left:auto;cursor:pointer;opacity:.5;font-size:11px} #plist .x:hover{opacity:1;color:#e06a6a}
  button.wide{width:100%;margin-top:8px;background:#0b0d12;border:1px solid #2c333c;color:#aab3bd;padding:6px 0;border-radius:7px;cursor:pointer;font-size:12px}
  #fb{display:none;margin-top:8px;border:1px solid #2c333c;border-radius:7px;padding:8px;background:#0b0d12}
  #fbpath{font-size:10px;word-break:break-all;opacity:.6;margin-bottom:6px}
  #fbdirs{max-height:180px;overflow:auto;font-size:12px}
  #fbdirs div{padding:3px 6px;border-radius:5px;cursor:pointer} #fbdirs div:hover{background:#1c2230}
  #fbhint{display:none;font-size:11px;opacity:.65;margin-top:8px;line-height:1.5}
  #legend{position:fixed;left:12px;bottom:12px;font-size:12px;opacity:.85} #legend span{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 12px}
  </style></head><body>
  <canvas id="c"></canvas>
  <div id="panel"><input id="q" placeholder="search… ( / , Enter opens)">
    <div class="cap">layout</div><div class="seg" id="lay"><button data-v="rings" class="on">Rings</button><button data-v="force">Force</button></div>
    <div class="cap">view</div><div class="seg" id="view"><button data-v="dept" class="on">Departments</button><button data-v="folder">Folders</button></div>
    <div class="cap">projects</div><div id="plist"></div>
    <button id="attBtn" class="wide">+ attach project…</button>
    <div id="fb"><div id="fbpath"></div><div id="fbdirs"></div><div class="seg" style="margin-top:8px"><button id="fbok">attach this folder</button><button id="fbx">close</button></div></div>
    <div id="fbhint">attaching needs serve mode:<br>run <b>node brain.js serve</b> then open <b>http://localhost:7373</b></div>
    <label><input type="checkbox" id="names"> file names</label></div>
  <div id="legend">rings:<span style="background:#5aa9e6"></span>applications<span style="background:#e6c229"></span>routines<span style="background:#b08ae0"></span>memory<span style="background:#ff8a3d"></span>skills</div>
  <div id="side"></div>
  <script>
  const DATA=${data};
  const RA=490,RR=414,RDISC=344,RHUB=225,RS=[96,128,160];
  const LAYERC={app:'#5aa9e6',routine:'#e6c229',skill:'#ff8a3d'};
  const DEPTC=['#57c7a3','#e05fc4','#5a8de6','#e6c229','#b07ae0'];
  const cv=document.getElementById('c'),cx=cv.getContext('2d');
  let W,H;function rs(){W=cv.width=innerWidth;H=cv.height=innerHeight}rs();onresize=rs;
  const N=DATA.nodes;let hubs=[];
  const PROJECTS=['core',...new Set(N.filter(n=>n.project!=='core').map(n=>n.project))];
  const PROJPATH={};(DATA.projects||[]).forEach(p=>PROJPATH[p.split('/').pop()]=p);
  let checked={};try{checked=JSON.parse(localStorage.brainProj||'{}')}catch(e){}
  PROJECTS.forEach(p=>{if(!(p in checked))checked[p]=true});
  const vis=n=>checked[n.project]!==false;
  let layoutMode='rings',view='dept',sel=null,filter='',showNames=false,alpha=0,discR=RDISC; // alpha: force-sim heat, cools to full stop; discR: memory disc grows with node count
  const gk=n=>view==='dept'?n.dept:n.folder; // grouping key: semantic department or disk folder
  function ring(arr,R){arr.forEach((n,i)=>{const a=i/arr.length*2*Math.PI-Math.PI/2;n.x=Math.cos(a)*R;n.y=Math.sin(a)*R})}
  function layout(){
    hubs=[];discR=RDISC;
    const V=N.filter(vis);
    N.forEach(n=>{n.r=n.layer==='app'?14:n.layer==='routine'?6:n.layer==='skill'?4:3.5+Math.min(4,Math.log2((n.size||1)/1024+1))});
    if(layoutMode==='force'){
      const groups=[...new Set(V.map(gk))];
      groups.forEach((g,i)=>{const a=i/groups.length*2*Math.PI-Math.PI/2,c=DEPTC[i%DEPTC.length];
        hubs.push({name:g,key:g,x:Math.cos(a)*300,y:Math.sin(a)*300,c:c,count:V.filter(n=>gk(n)===g).length})});
      V.forEach(n=>{const h=hubs.find(h=>h.key===gk(n));n.x=h.x+(Math.random()-.5)*140;n.y=h.y+(Math.random()-.5)*140;n.vx=0;n.vy=0});
      alpha=1;
      return}
    ring(V.filter(n=>n.layer==='app'),RA);
    ring(V.filter(n=>n.layer==='routine'),RR);
    const sk=V.filter(n=>n.layer==='skill'),per=Math.ceil(sk.length/RS.length);
    sk.forEach((n,i)=>{const ri=Math.floor(i/per),cnt=Math.min(per,sk.length-ri*per),a=(i%per)/cnt*2*Math.PI+ri*.35-Math.PI/2;
      n.x=Math.cos(a)*RS[ri];n.y=Math.sin(a)*RS[ri]});
    // memory + attached projects: each group gets an angular sector sized to its file count,
    // filled as an even annulus at uniform spacing so dots never clump; disc grows to contain them.
    const mems=V.filter(n=>n.layer==='memory'||n.layer==='project'),groups=[...new Set(mems.map(gk))],total=Math.max(1,mems.length);
    const r0=RHUB+40,rMax=RR-26,arcGap=30,radStep=30;
    let th0=-Math.PI/2;
    groups.forEach((d,di)=>{const c=DEPTC[di%DEPTC.length],files=mems.filter(n=>gk(n)===d),frac=files.length/total;
      const spanTh=2*Math.PI*frac*0.9,thc=th0+Math.PI*frac; // slice proportional to count; thc = its centre
      hubs.push({name:d,key:d,x:Math.cos(thc)*RHUB,y:Math.sin(thc)*RHUB,c:c,count:files.length});
      let i=0,r=r0;
      while(i<files.length){const cap=Math.max(1,Math.floor(spanTh*r/arcGap)),cnt=Math.min(cap,files.length-i),stepA=arcGap/r;
        for(let k=0;k<cnt;k++,i++){const n=files[i],a=thc+(k-(cnt-1)/2)*stepA;n.c=c;n.x=Math.cos(a)*r;n.y=Math.sin(a)*r}
        discR=Math.max(discR,r+22);r=Math.min(rMax,r+radStep)} // ponytail: last ring piles at rMax if a group exceeds the disc
      th0+=2*Math.PI*frac});
  }
  layout();
  let cam={x:0,y:0,z:Math.min(W,H)/(2*(RA+70))};
  // ponytail: O(n²) repulsion, fine for a few hundred nodes; quadtree past ~1k
  function tick(){const V=N.filter(vis);
    for(let i=0;i<V.length;i++){const a=V[i],h=hubs.find(h=>h.key===gk(a));
      if(h){a.vx+=(h.x-a.x)*.004;a.vy+=(h.y-a.y)*.004}
      for(let j=i+1;j<V.length;j++){const b=V[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+.01;
        if(d2<3600){const f=40/d2;a.vx+=dx*f;a.vy+=dy*f;b.vx-=dx*f;b.vy-=dy*f}}}
    DATA.links.forEach(l=>{const a=N[l.s],b=N[l.t];if(!vis(a)||!vis(b))return;
      const dx=b.x-a.x,dy=b.y-a.y;a.vx+=dx*.002;a.vy+=dy*.002;b.vx-=dx*.002;b.vy-=dy*.002});
    V.forEach(n=>{if(n===dragN)return;n.vx*=.6;n.vy*=.6;
      const s=Math.hypot(n.vx,n.vy);if(s>2.5){n.vx*=2.5/s;n.vy*=2.5/s}
      n.x+=n.vx*alpha;n.y+=n.vy*alpha});
    alpha=alpha<.01?0:alpha*.99}
  function hex(x,y,r){cx.beginPath();for(let i=0;i<6;i++){const a=Math.PI/6+i*Math.PI/3;cx[i?'lineTo':'moveTo'](x+Math.cos(a)*r,y+Math.sin(a)*r)}cx.closePath()}
  function diamond(x,y,r){cx.beginPath();cx.moveTo(x,y-r);cx.lineTo(x+r,y);cx.lineTo(x,y+r);cx.lineTo(x-r,y);cx.closePath()}
  function spaced(s){return s.toUpperCase().split('').join(' ')}
  const T=(x,y)=>[W/2+cam.x+x*cam.z,H/2+cam.y+y*cam.z]; // world → screen px
  const hit=(r,l)=>{for(const p of l)if(r[0]<p[0]+p[2]&&r[0]+r[2]>p[0]&&r[1]<p[1]+p[3]&&r[1]+r[3]>p[1])return true;return false};
  function draw(){cx.clearRect(0,0,W,H);cx.save();cx.translate(W/2+cam.x,H/2+cam.y);cx.scale(cam.z,cam.z);
    if(layoutMode==='force'&&alpha)tick();
    if(layoutMode==='rings'){
    // memory disc
    const g=cx.createRadialGradient(0,0,RS[2],0,0,discR);g.addColorStop(0,'#191129');g.addColorStop(1,'#0c0918');
    cx.fillStyle=g;cx.beginPath();cx.arc(0,0,discR,0,7);cx.fill();
    // guide rings
    cx.lineWidth=1.4;cx.strokeStyle='#3d6a99';cx.beginPath();cx.arc(0,0,RA,0,7);cx.stroke();
    cx.strokeStyle='#8a7420';cx.beginPath();cx.arc(0,0,RR,0,7);cx.stroke();
    cx.setLineDash([2,7]);cx.strokeStyle='#7a4a22';RS.forEach(r=>{cx.beginPath();cx.arc(0,0,r,0,7);cx.stroke()});cx.setLineDash([]);
    }
    // links
    cx.strokeStyle='#ffffff12';cx.lineWidth=1;
    hubs.forEach(h=>{cx.beginPath();cx.moveTo(0,0);cx.lineTo(h.x,h.y);cx.stroke()});
    cx.strokeStyle='#ffffff22';
    DATA.links.forEach(l=>{if(!vis(N[l.s])||!vis(N[l.t]))return;cx.beginPath();cx.moveTo(N[l.s].x,N[l.s].y);cx.lineTo(N[l.t].x,N[l.t].y);cx.stroke()});
    // nodes
    const labelCands=[];
    N.forEach(n=>{if(!vis(n))return;
      const dim=filter&&!(n.name+n.desc).toLowerCase().includes(filter);cx.globalAlpha=dim?.1:1;
      const c=n.c||LAYERC[n.layer]||'#999';cx.fillStyle=c;cx.shadowColor=c;cx.shadowBlur=dim?0:9;
      if(n.layer==='app'){hex(n.x,n.y,n.r);cx.fillStyle='#0d1420';cx.fill();cx.strokeStyle=c;cx.lineWidth=1.6;cx.stroke();
        cx.shadowBlur=0;cx.fillStyle=c;cx.font='bold 11px system-ui';cx.textAlign='center';cx.textBaseline='middle';
        cx.fillText(n.name[0].toUpperCase(),n.x,n.y+1);cx.textBaseline='alphabetic'}
      else if(n.layer==='routine'){cx.beginPath();cx.arc(n.x,n.y,n.r+4,0,7);cx.strokeStyle=c;cx.lineWidth=1.4;cx.stroke();
        cx.beginPath();cx.arc(n.x,n.y,n.r-2,0,7);cx.fill()}
      else if(n.layer==='skill'){diamond(n.x,n.y,n.r+1);cx.fill()}
      else{cx.beginPath();cx.arc(n.x,n.y,n.r,0,7);cx.fill()}
      cx.shadowBlur=0;
      if(n===sel){cx.strokeStyle='#fff';cx.lineWidth=2;cx.beginPath();cx.arc(n.x,n.y,n.r+6,0,7);cx.stroke()}
      if(!dim&&(showNames||cam.z>.9||n.layer==='app'||n.layer==='routine'||n===sel||filter)){
        const prio=n===sel?1e4:filter?9e3:n.layer==='app'?800:n.layer==='routine'?700:100+Math.min(80,Math.log2((n.size||1)/512+1)*12);
        labelCands.push({n,prio})}
      cx.globalAlpha=1});
    // group hubs (with file counts)
    hubs.forEach(h=>{cx.fillStyle=h.c;cx.shadowColor=h.c;cx.shadowBlur=12;cx.beginPath();cx.arc(h.x,h.y,9,0,7);cx.fill();cx.shadowBlur=0});
    // core
    cx.fillStyle='#ffb057';cx.shadowColor='#ffb057';cx.shadowBlur=16;cx.beginPath();cx.arc(0,0,12,0,7);cx.fill();cx.shadowBlur=0;
    cx.restore();
    // labels: screen-space, fixed size, greedy declutter by priority — no overlap; more reveal as you zoom in
    // ponytail: O(k²) collision test; k is viewport-culled, fine for a few hundred labels (grid index past ~1k)
    cx.textAlign='center';cx.textBaseline='alphabetic';
    const placed=[];
    const put=(txt,sx,sy,font,color,always)=>{cx.font=font;const w=cx.measureText(txt).width,h=+font.match(/(\\d+)px/)[1];
      const r=[sx-w/2-3,sy-h,w+6,h+5];if(!always&&(sx<-60||sx>W+60||sy<0||sy>H+18||hit(r,placed)))return;
      placed.push(r);cx.fillStyle=color;cx.fillText(txt,sx,sy)};
    let p=T(0,0);put('CLAUDE.MD',p[0],p[1]+32,'bold 14px system-ui','#f0e6d8',true);
    if(layoutMode==='rings'){
      p=T(0,-RA);put(spaced('applications'),p[0],p[1]-6,'600 18px system-ui','#7db4e8',true);
      p=T(0,-RR);put(spaced('routines'),p[0],p[1]-6,'600 18px system-ui','#e6c229',true);
      p=T(0,-discR);put(spaced('memory'),p[0],p[1]+42,'600 18px system-ui','#b08ae0',true);
      p=T(0,-RS[2]);put(spaced('skills'),p[0],p[1]-6,'600 18px system-ui','#ff8a3d',true)}
    hubs.forEach(h=>{p=T(h.x,h.y);put(h.name.toUpperCase()+' · '+h.count,p[0],p[1]+19,'bold 13px system-ui',h.c,true)});
    labelCands.sort((a,b)=>b.prio-a.prio);
    for(const c of labelCands){const n=c.n;p=T(n.x,n.y);put(n.name,p[0],p[1]+n.r*cam.z+12,'12px system-ui',n===sel?'#ffffff':'#aeb7c1',false)}
    requestAnimationFrame(draw)}
  draw();
  function pick(mx,my){const x=(mx-W/2-cam.x)/cam.z,y=(my-H/2-cam.y)/cam.z;return N.find(n=>vis(n)&&(n.x-x)**2+(n.y-y)**2<(n.r+5)**2)}
  function openSide(n){sel=n;const s=document.getElementById('side');
    if(!n){s.style.display='none';return}
    s.style.display='block';
    s.innerHTML='<div class=layer>'+n.layer+' · '+n.dept+' · '+n.folder+'</div><h2>'+n.name+'</h2><p>'+(n.desc||'')+'</p><div class=path>'+n.path+'</div>'
      +(n.path.startsWith('/')?'<a href="'+(SERVED?'/file?p='+encodeURIComponent(n.path):'file://'+n.path)+'" target="_blank" rel="noopener">open file</a>':'')
      +(n.preview?'<pre></pre>':'');
    if(n.preview)s.querySelector('pre').textContent=n.preview+(n.size>1200?'\\n…':'')}
  function center(n){cam.x=-n.x*cam.z;cam.y=-n.y*cam.z}
  let drag=null,dragN=null;
  cv.onmousedown=e=>{dragN=pick(e.clientX,e.clientY)||null;drag={x:e.clientX,y:e.clientY,moved:false}};
  onmousemove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(dragN){dragN.x+=dx/cam.z;dragN.y+=dy/cam.z;if(layoutMode==='force')alpha=Math.max(alpha,.3)}else{cam.x+=dx;cam.y+=dy}
    if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;drag.x=e.clientX;drag.y=e.clientY};
  onmouseup=e=>{if(drag&&!drag.moved)openSide(pick(e.clientX,e.clientY));drag=null;dragN=null};
  cv.onwheel=e=>{e.preventDefault();cam.z=Math.max(.15,Math.min(5,cam.z*(e.deltaY<0?1.1:.9)))};
  const q=document.getElementById('q');q.oninput=e=>filter=e.target.value.toLowerCase();
  q.onkeydown=e=>{if(e.key==='Enter'&&filter){const n=N.find(n=>vis(n)&&(n.name+n.desc).toLowerCase().includes(filter));if(n){openSide(n);center(n)}}};
  onkeydown=e=>{if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus()}};
  document.getElementById('names').onchange=e=>showNames=e.target.checked;
  function seg(id,fn){document.getElementById(id).querySelectorAll('button').forEach(b=>b.onclick=()=>{
    document.getElementById(id).querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');fn(b.dataset.v)})}
  seg('lay',v=>{layoutMode=v;layout()});
  seg('view',v=>{view=v;layout()});
  // --- external projects: checkboxes (union / exclude) + folder-browser attach, persisted server-side in projects.json ---
  const SERVED=location.protocol.indexOf('http')===0;
  function renderProjects(){const pl=document.getElementById('plist');pl.innerHTML='';
    PROJECTS.forEach(p=>{const l=document.createElement('label'),cb=document.createElement('input');
      cb.type='checkbox';cb.checked=checked[p]!==false;
      cb.onchange=()=>{checked[p]=cb.checked;localStorage.brainProj=JSON.stringify(checked);layout()};
      l.appendChild(cb);l.appendChild(document.createTextNode(p+' · '+N.filter(n=>n.project===p).length));
      if(p!=='core'&&SERVED){const x=document.createElement('span');x.className='x';x.textContent='✕';x.title='detach';
        x.onclick=async ev=>{ev.preventDefault();await fetch('/detach',{method:'POST',body:JSON.stringify({dir:PROJPATH[p]})});location.reload()};
        l.appendChild(x)}
      pl.appendChild(l)})}
  renderProjects();
  let fbdir=null;
  document.getElementById('attBtn').onclick=()=>{
    if(!SERVED){document.getElementById('fbhint').style.display='block';return}
    document.getElementById('fb').style.display='block';browse(fbdir)};
  async function browse(dir){
    const j=await(await fetch('/browse'+(dir?'?dir='+encodeURIComponent(dir):''))).json();
    if(j.error)return;
    fbdir=j.dir;document.getElementById('fbpath').textContent=j.dir;
    const box=document.getElementById('fbdirs');box.innerHTML='';
    const up=document.createElement('div');up.textContent='⬑ ..';up.onclick=()=>browse(j.parent);box.appendChild(up);
    j.dirs.forEach(d=>{const e=document.createElement('div');e.textContent='📁 '+d;e.onclick=()=>browse(j.dir.replace(/\\/$/,'')+'/'+d);box.appendChild(e)})}
  document.getElementById('fbok').onclick=async()=>{
    const r=await fetch('/attach',{method:'POST',body:JSON.stringify({dir:fbdir})});
    if(r.ok)location.reload()};
  document.getElementById('fbx').onclick=()=>document.getElementById('fb').style.display='none';
  </script></body></html>`;
}

// ---------- test ----------
function test() {
  const assert = require('assert');
  // Hermetic: the self-test writes its own multi-section memory files, so it passes on any
  // machine and never depends on — or reveals — the user's real notes.
  // Lead with a unique codeword (lands in the 160-char index description so the scorer can see it),
  // then filler sections so retrieval returns one section, not the whole file.
  const mk = (code, topic, key) =>
    'Distinctive marker ' + code + ' for the brain self-test, found by its unique codeword.\n\n' +
    '## ' + topic + '\n' + key + '\n\n' +
    '## Background\nFiller so the note has several sections; retrieval should return one section, not the whole ' +
    'file. Padding here makes the whole-file size clearly larger than a single section, so the cost proof stays positive.\n\n' +
    '## Footnotes\nMore trailing filler in its own section — again just padding the whole-file size.';
  const fx = [
    ['brain-selftest-alpha', mk('quokkazebra', 'Codeword', 'The alpha fixture codeword is quokkazebra, verifying the remember roundtrip end to end.')],
    ['brain-selftest-beta', mk('zorptangle', 'Retrieval', 'The beta fixture codeword is zorptangle, near notes on deterministic retrieval.')],
  ];
  const paths = fx.map(([slug, body]) => remember(body, slug));
  const entries = writeIndex();
  assert(entries.length >= 2, 'index too small: ' + entries.length);
  const t1 = retrieve('quokkazebra');
  assert(t1.hit && t1.hit.name === 'brain-selftest-alpha', 'retrieval failed, got: ' + (t1.hit && t1.hit.name));
  const t2 = retrieve('zorptangle');
  assert(t2.hit && t2.hit.name === 'brain-selftest-beta', 'scoring failed, got: ' + (t2.hit && t2.hit.name));
  // structured output for the /query panel
  const t3 = retrieve('zorptangle');
  assert(Array.isArray(t3.candidates) && t3.candidates[0] && t3.candidates[0].name === 'brain-selftest-beta', 'candidates failed: ' + JSON.stringify(t3.candidates));
  assert(typeof t3.candidates[0].score === 'number' && t3.candidates[0].score > 0, 'candidate score missing');
  assert(t3.answer && t3.answer.body.includes('zorptangle'), 'answer body failed');
  const t4 = retrieve('zorptangle', { pick: t1.hit.path });
  assert(t4.answer && t4.answer.path === t1.hit.path, 'pick failed, got: ' + (t4.answer && t4.answer.path));
  const t5 = retrieve('qqqqzzzzgibberish');
  assert(t5.answer === null && t5.candidates.length === 0, 'no-match shape failed: ' + JSON.stringify(t5.candidates));
  // cost proof: evidence handed to the model vs reading whole files the default way
  const full = read(t1.hit.path).length + read(t2.hit.path).length;
  const evid = t1.text.length + t2.text.length;
  paths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  writeIndex();
  console.log('PASS —', entries.length, 'entries indexed');
  console.log(`cost proof: brain hands the model ~${evid} chars of evidence; reading both whole files = ${full} chars (${Math.round((1 - evid / full) * 100)}% less)`);
}

// ---------- serve ----------
function serve(port) {
  writeIndex(); buildMap();
  require('http').createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (req.method === 'GET' && u.pathname === '/') send(200, read(path.join(ROOT, 'brain-map.html')), 'text/html');
    else if (req.method === 'GET' && u.pathname === '/file') {
      // only serve files the brain already indexes — guards against path traversal
      const p = u.searchParams.get('p') || '';
      const allowed = loadIndex().some(e => e.path === p);
      if (allowed && fs.existsSync(p)) send(200, read(p), (p.endsWith('.html') ? 'text/html' : 'text/plain') + '; charset=utf-8');
      else send(404, 'not found', 'text/plain');
    }
    else if (req.method === 'GET' && u.pathname === '/browse') {
      const dir = path.resolve(u.searchParams.get('dir') || HOME);
      try {
        const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => e.name).sort();
        send(200, JSON.stringify({ dir, parent: path.dirname(dir), dirs, attached: loadProjects() }));
      } catch (e) { send(400, JSON.stringify({ error: String(e.message || e) })); }
    } else if (req.method === 'POST' && (u.pathname === '/attach' || u.pathname === '/detach')) {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        try {
          setProject(JSON.parse(b).dir, u.pathname === '/attach');
          writeIndex(); buildMap();
          send(200, '{"ok":true}');
        } catch (e) { send(400, JSON.stringify({ error: String(e.message || e) })); }
      });
    } else send(404, '{}');
  }).listen(port, () => console.log('brain UI at http://localhost:' + port + '  (attach/detach live here; Ctrl-C to stop)'));
}

// ---------- cli ----------
const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) console.log('usage: brain.js "question" | index | remember "fact" [--name slug] | map | attach <dir> | detach <dir> | serve [port] | test');
else if (cmd === 'index') console.log('indexed', writeIndex().length, 'entries -> INDEX.md');
else if (cmd === 'attach' || cmd === 'detach') {
  const list = setProject(rest[0] || '', cmd === 'attach');
  console.log('projects:', list.length ? list.join('  ') : '(none)');
  console.log('indexed', writeIndex().length, 'entries; mapped', buildMap(), 'nodes');
} else if (cmd === 'serve') serve(+rest[0] || 7373);
else if (cmd === 'remember') {
  const ni = rest.indexOf('--name');
  const slug = ni >= 0 ? rest.splice(ni, 2)[1] : undefined;
  console.log('stored -> ' + remember(rest.join(' '), slug));
} else if (cmd === 'map') console.log('mapped', buildMap(), 'nodes -> brain-map.html');
else if (cmd === 'test') test();
else console.log(retrieve([cmd, ...rest].join(' '), { stats: true }).text);
