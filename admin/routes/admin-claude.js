// routes/admin-claude.js
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const SITES = [
  { id:'andresanz',             label:'andresanz.com',             dir:'/var/www/andresanz.com' },
  { id:'randomcategory',        label:'randomcategory.com',        dir:'/var/www/randomcategory.com' },
  { id:'sanz-me',               label:'sanz.me',                   dir:'/var/www/sanz.me' },
  { id:'914io',                 label:'914.io',                    dir:'/var/www/914.io' },
  { id:'therandomactofwriting', label:'therandomactofwriting.com', dir:'/var/www/therandomactofwriting.com' },
  { id:'samsanz',               label:'samsanz.info',              dir:'/var/www/samsanz.info' },
];

const GDIR = path.join(os.homedir(), '.claude');

function getPaths(id) {
  if (id === 'global') return {
    claudeMd:    path.join(GDIR, 'CLAUDE.md'),
    commandsDir: path.join(GDIR, 'commands'),
    settings:    path.join(GDIR, 'settings.json'),
  };
  const s = SITES.find(x => x.id === id);
  if (!s) return null;
  const cd = path.join(s.dir, '.claude');
  return {
    claudeMd:    path.join(s.dir, 'CLAUDE.md'),
    commandsDir: path.join(cd, 'commands'),
    settings:    path.join(cd, 'settings.json'),
  };
}

function rf(p) {
  try   { return { content: fs.readFileSync(p,'utf8'), exists:true,  path:p }; }
  catch { return { content: '',                        exists:false, path:p }; }
}
function lsCmd(dir) {
  try   { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); }
  catch { return []; }
}
function safe(n) {
  return path.basename(n||'').replace(/[^a-z0-9._-]/gi,'-').toLowerCase();
}

function tplClaudeMd(id) {
  if (id === 'global') return [
    '# Global Claude Rules','',
    '## Identity',
    'Andre Sanz - Director-level cyber risk executive, Node.js developer, writer.',
    'Based in Bluffton, SC (Lowcountry).','',
    '## Environment',
    '- Editor: VI or VSCode - never suggest nano',
    '- Server: Linode VPS 45.33.73.105 (server02.andresanz.com), Ubuntu 24',
    '- Sites at /var/www/, managed via systemd (blog-* services)',
    '- Blog admin at /var/www/blog-admin','',
    '## Code Style',
    '- Node.js / Express / vanilla JS preferred',
    '- No unnecessary dependencies; flat files over databases',
    '- Use Python string replacement when patching files with template literals','',
    '## Communication',
    '- Direct - skip preamble; show code first',
    '- Experienced developer; no hand-holding needed',
  ].join('\n');
  const s = SITES.find(x => x.id === id);
  if (!s) return '';
  return [
    '# '+s.label,'',
    'Node.js/Express blog. Markdown posts with YAML front matter.',
    'Images in S3 via Sharp resize middleware.','',
    '## Stack',
    '- Node 18, Express, Sharp, AWS SDK v3',
    '- Config: .env (PORT, SITE_URL, SITE_TITLE, S3_BUCKET)','',
    '## Systemd service: blog-'+id,
    '## Rules',
    '- After changes: sudo systemctl restart blog-'+id,'',
    '## Post Front Matter',
    '---',
    'title: Post Title',
    'date: 2024-01-15',
    'tags: [tag1, tag2]',
    'draft: false',
    '---',
  ].join('\n');
}

function tplCommand(name) {
  const b = name.replace(/\.md$/,'');
  const map = {
    'new-post':    'Create a new blog post.\n\nFilename: YYYY-MM-DD-slug.md in posts/.\n\ntitle: $ARGUMENTS\ndate: <today>\ntags: []\ndraft: true\n\nAsk for title if not provided. Open for editing.',
    'deploy':      'Restart the systemd service.\n\n1. sudo systemctl restart blog-<site>\n2. sudo systemctl status blog-<site>\n3. sudo journalctl -u blog-<site> -n 20\n\nReport status and errors.',
    'image-audit': 'Audit images in posts.\n\n1. Scan posts/*.md for image refs\n2. Check S3\n3. Report: total, missing, orphaned\n\nGroup by post.',
    'post-list':   'List all posts.\n\nTable: filename | title | date | tags | draft\n\nSort by date desc. Flag missing front matter.',
    'review':      'Review the code or changes.\n\nCheck: correctness, edge cases, security, performance.\n\nBe direct. Flag issues.',
  };
  return map[b] || '# '+b+'\n\nDescribe this command.\n\n$ARGUMENTS = text after command name.\n\n## Steps\n1.\n2.';
}

function tplSettings() {
  return JSON.stringify({ permissions: { allow: [], deny: [] }, env: {} }, null, 2);
}

router.get('/api/claude-md', (req,res) => {
  const p = getPaths(req.query.target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  res.json(rf(p.claudeMd));
});
router.post('/api/claude-md/save', express.json(), (req,res) => {
  const {target,content} = req.body;
  const p = getPaths(target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  try {
    fs.mkdirSync(path.dirname(p.claudeMd),{recursive:true});
    fs.writeFileSync(p.claudeMd,content,'utf8');
    res.json({ok:true,path:p.claudeMd,size:Buffer.byteLength(content)});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/claude-md/template', express.json(), (req,res) => {
  res.json({content:tplClaudeMd(req.body.target)});
});

router.get('/api/commands', (req,res) => {
  const p = getPaths(req.query.target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  res.json({files:lsCmd(p.commandsDir),dir:p.commandsDir});
});
router.get('/api/commands/file', (req,res) => {
  const p = getPaths(req.query.target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  const n = safe(req.query.name);
  if (!n.endsWith('.md')) return res.status(400).json({error:'Must be .md'});
  res.json(rf(path.join(p.commandsDir,n)));
});
router.post('/api/commands/save', express.json(), (req,res) => {
  const {target,name,content} = req.body;
  const p = getPaths(target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  const n = safe(name);
  if (!n.endsWith('.md')) return res.status(400).json({error:'Must be .md'});
  try {
    fs.mkdirSync(p.commandsDir,{recursive:true});
    fs.writeFileSync(path.join(p.commandsDir,n),content,'utf8');
    res.json({ok:true,name:n});
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/commands/delete', express.json(), (req,res) => {
  const {target,name} = req.body;
  const p = getPaths(target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  try { fs.unlinkSync(path.join(p.commandsDir,safe(name))); res.json({ok:true}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
router.post('/api/commands/template', express.json(), (req,res) => {
  res.json({content:tplCommand(req.body.name||'')});
});

router.get('/api/settings', (req,res) => {
  const p = getPaths(req.query.target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  const d = rf(p.settings);
  if (!d.exists) d.content = tplSettings();
  res.json(d);
});
router.post('/api/settings/save', express.json(), (req,res) => {
  const {target,content} = req.body;
  const p = getPaths(target);
  if (!p) return res.status(404).json({error:'Unknown target'});
  try { JSON.parse(content); } catch(e) { return res.status(400).json({error:'Invalid JSON: '+e.message}); }
  try {
    fs.mkdirSync(path.dirname(p.settings),{recursive:true});
    fs.writeFileSync(p.settings,content,'utf8');
    res.json({ok:true,path:p.settings});
  } catch(e) { res.status(500).json({error:e.message}); }
});

router.get('/', (_req,res) => {
  const targets = [{id:'global',label:'Global'},...SITES.map(s=>({id:s.id,label:s.label}))];
  const nav = targets.map((t,i)=>'<button class="site-btn'+(i===0?' active':'')+'" data-target="'+t.id+'"><span class="dot" id="dot-'+t.id+'"></span>'+t.label+'</button>').join('');
  res.send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Claude - Admin</title><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"><style>:root{--bg:#0d0f14;--sur:#161a22;--sur2:#1e2330;--bdr:#2a3040;--acc:#e8a045;--blu:#5b8af5;--grn:#3dba6f;--red:#e05555;--txt:#d4dbe8;--dim:#6b7690;--mono:"JetBrains Mono",monospace;--ui:"IBM Plex Sans",system-ui,sans-serif}*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;background:var(--bg);color:var(--txt);font-family:var(--ui)}a{color:inherit;text-decoration:none}.page{display:flex;flex-direction:column;height:100vh;overflow:hidden}header{display:flex;align-items:center;justify-content:space-between;padding:11px 22px;border-bottom:1px solid var(--bdr);background:var(--sur);flex-shrink:0}.hl{display:flex;align-items:center;gap:12px}.back{color:var(--dim);font-size:12px}.back:hover{color:var(--txt)}h1{font-size:15px;font-weight:600}.pill{font-size:10px;font-weight:600;font-family:var(--mono);padding:2px 8px;border-radius:3px;background:rgba(232,160,69,.12);color:var(--acc);border:1px solid rgba(232,160,69,.25)}.hint{font-size:11px;color:var(--dim)}.sec-bar{display:flex;gap:2px;padding:8px 18px;background:var(--sur);border-bottom:1px solid var(--bdr);flex-shrink:0}.sec-btn{display:flex;align-items:center;gap:6px;padding:6px 15px;border-radius:5px;border:none;font-family:var(--ui);font-size:13px;font-weight:500;color:var(--dim);background:transparent;cursor:pointer;transition:all .15s}.sec-btn:hover,.sec-btn.active{color:var(--txt);background:var(--sur2)}.layout{display:flex;flex:1;overflow:hidden}.sidebar{width:194px;flex-shrink:0;background:var(--sur);border-right:1px solid var(--bdr);padding:12px 0;overflow-y:auto}.slabel{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim);padding:0 13px 8px}.site-btn{display:flex;align-items:center;gap:7px;width:100%;padding:8px 13px;background:none;border:none;border-left:2px solid transparent;color:var(--dim);font-family:var(--mono);font-size:11px;cursor:pointer;text-align:left;transition:all .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.site-btn:hover{color:var(--txt);background:var(--sur2)}.site-btn.active{color:var(--txt);background:var(--sur2);border-left-color:var(--acc)}.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;background:var(--bdr);transition:background .3s}.dot.on{background:var(--grn)}.content{flex:1;overflow:hidden;display:flex;flex-direction:column}.elayout{display:flex;flex-direction:column;height:100%}.ehdr{display:flex;align-items:center;justify-content:space-between;padding:9px 18px;border-bottom:1px solid var(--bdr);background:var(--sur);flex-shrink:0}.fpath{font-family:var(--mono);font-size:11px;color:var(--dim)}.brow{display:flex;gap:7px;align-items:center}textarea.ed{flex:1;width:100%;padding:18px 22px;background:var(--bg);color:var(--txt);font-family:var(--mono);font-size:13px;line-height:1.7;border:none;outline:none;resize:none;tab-size:2}.sbar{padding:7px 18px;font-size:11px;font-family:var(--mono);border-top:1px solid var(--bdr);background:var(--sur);min-height:31px;color:var(--dim)}.sbar.ok{color:var(--grn)}.sbar.err{color:var(--red)}.clayout{display:flex;height:100%;overflow:hidden}.clpane{width:196px;flex-shrink:0;border-right:1px solid var(--bdr);display:flex;flex-direction:column;background:var(--sur)}.clhdr{display:flex;align-items:center;padding:9px 13px;border-bottom:1px solid var(--bdr);flex-shrink:0}.cltitle{font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--dim)}.clscroll{flex:1;overflow-y:auto}.citem{display:flex;align-items:center;padding:9px 13px;cursor:pointer;border-left:2px solid transparent;transition:all .15s;font-family:var(--mono);font-size:11px;color:var(--dim)}.citem:hover{background:var(--sur2);color:var(--txt)}.citem.active{background:var(--sur2);color:var(--txt);border-left-color:var(--blu)}.cname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cdel{opacity:0;background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 0 0 5px;line-height:1;transition:opacity .15s;flex-shrink:0}.citem:hover .cdel{opacity:1}.cnew{padding:9px 13px;border-top:1px solid var(--bdr);flex-shrink:0}.cnewinput{width:100%;padding:5px 7px;border-radius:4px;background:var(--sur2);border:1px solid var(--bdr);color:var(--txt);font-family:var(--mono);font-size:11px;outline:none}.cnewinput:focus{border-color:var(--blu)}.cnewinput::placeholder{color:var(--dim)}.cepane{flex:1;display:flex;flex-direction:column;overflow:hidden}.cempty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;color:var(--dim)}.cempty-t{font-size:13px}.cempty-s{font-size:11px;font-family:var(--mono)}.nocmds{padding:13px;font-size:11px;color:var(--dim);font-family:var(--mono)}.btn{padding:5px 13px;border-radius:5px;border:none;font-family:var(--ui);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s}.btn-p{background:var(--acc);color:#0d0f14}.btn-p:hover{background:#f0b05a}.btn-g{background:transparent;color:var(--dim);border:1px solid var(--bdr)}.btn-g:hover{color:var(--txt);border-color:var(--dim)}.btn-s{padding:4px 9px;font-size:11px}.loading{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim);font-size:13px;font-family:var(--mono)}</style></head><body><div class="page"><header><div class="hl"><a href="/" class="back">← Admin</a><h1>Claude</h1><span class="pill">Management</span></div><span class="hint">CLAUDE.md · Commands · Settings</span></header><div class="sec-bar"><button class="sec-btn active" data-sec="claude-md">CLAUDE.md</button><button class="sec-btn" data-sec="commands">Commands</button><button class="sec-btn" data-sec="settings">Settings</button></div><div class="layout"><nav class="sidebar"><div class="slabel">TARGET</div>'+nav+'</nav><main class="content" id="content"><div class="loading">Loading...</div></main></div></div><script>var S={sec:"claude-md",tgt:"global"};var CF=[],CA=null;function api(u,o){return fetch(u,o).then(function(r){return r.json()});}function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}function setDot(t,on){var d=document.getElementById("dot-"+t);if(d)d.classList.toggle("on",on);}document.querySelectorAll(".sec-btn").forEach(function(b){b.addEventListener("click",function(){S.sec=b.dataset.sec;document.querySelectorAll(".sec-btn").forEach(function(x){x.classList.remove("active")});b.classList.add("active");render();});});document.querySelectorAll(".site-btn").forEach(function(b){b.addEventListener("click",function(){S.tgt=b.dataset.target;document.querySelectorAll(".site-btn").forEach(function(x){x.classList.remove("active")});b.classList.add("active");render();});});function render(){document.getElementById("content").innerHTML=\'<div class="loading">Loading...</div>\';if(S.sec==="claude-md")renderCM();else if(S.sec==="commands")renderCmds();else renderSets();}function setSt(m,t){var el=document.getElementById("TS");if(!el)return;el.textContent=m;el.className="sbar "+t;if(t==="ok")setTimeout(function(){el.textContent="";el.className="sbar";},3000);}function renderCM(){api("/claude/api/claude-md?target="+S.tgt).then(function(d){setDot(S.tgt,d.exists);document.getElementById("content").innerHTML=\'<div class="elayout"><div class="ehdr"><div class="fpath">\'+esc(d.path||"")+\'</div><div class="brow"><button class="btn btn-g btn-s" onclick="loadCMTpl()">Template</button><button class="btn btn-p" onclick="saveCM()">Save</button></div></div><textarea class="ed" id="TE" spellcheck="false">\'+esc(d.content)+\'</textarea><div class="sbar" id="TS"></div></div>\';document.getElementById("TE").addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key==="s"){e.preventDefault();saveCM();}});});}function saveCM(){var c=document.getElementById("TE").value;setSt("Saving...","");api("/claude/api/claude-md/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:S.tgt,content:c})}).then(function(d){if(d.ok){setSt("Saved: "+d.path+" ("+d.size+" bytes)","ok");setDot(S.tgt,true);}else setSt("Error: "+d.error,"err");});}function loadCMTpl(){var ed=document.getElementById("TE");if(ed.value.trim()&&!confirm("Replace with template?"))return;api("/claude/api/claude-md/template",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:S.tgt})}).then(function(d){if(d.content){ed.value=d.content;setSt("Template loaded - review and save.","ok");}});}function renderCmds(){api("/claude/api/commands?target="+S.tgt).then(function(d){CF=d.files||[];CA=null;setDot(S.tgt,CF.length>0);buildCmdShell();});}function cmdItems(){if(!CF.length)return\'<div class="nocmds">No commands yet</div>\';return CF.map(function(f){return\'<div class="citem\'+(CA===f?" active":"")+\'" onclick="selCmd(\\\'"+f+"\\\')"><span class="cname">/\'+f.replace(/\\.md$/,"")+"</span>"+(\'<button class="cdel" onclick="delCmd(event,\\\'"+f+"\\\')">&times;</button>\')+"</div>";}).join("");}function buildCmdShell(){document.getElementById("content").innerHTML=\'<div class="clayout"><div class="clpane"><div class="clhdr"><span class="cltitle">COMMANDS</span></div><div class="clscroll" id="CL">\'+cmdItems()+\'</div><div class="cnew"><input class="cnewinput" id="NCI" placeholder="command-name" onkeydown="if(event.key===&quot;Enter&quot;)newCmd()"/></div></div><div class="cepane" id="CEP"><div class="cempty"><div class="cempty-t">No command selected</div><div class="cempty-s">pick one or type name to create</div></div></div></div>\';if(CA)selCmd(CA);}function selCmd(f){CA=f;document.querySelectorAll(".citem").forEach(function(el){el.classList.toggle("active",el.querySelector(".cname").textContent==="/"+f.replace(/\\.md$/,""));});api("/claude/api/commands/file?target="+S.tgt+"&name="+f).then(function(d){var sl=f.replace(/\\.md$/,"");document.getElementById("CEP").innerHTML=\'<div class="elayout"><div class="ehdr"><div class="fpath">/\'+esc(sl)+\'</div><div class="brow"><button class="btn btn-g btn-s" onclick="loadCmdTpl(\\\'"+f+"\\\')")>Template</button><button class="btn btn-p" onclick="saveCmd(\\\'"+f+"\\\')")>Save</button></div></div><textarea class="ed" id="CE" spellcheck="false">\'+esc(d.content)+\'</textarea><div class="sbar" id="CS"></div></div>\';document.getElementById("CE").addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key==="s"){e.preventDefault();saveCmd(f);}});});}function newCmd(){var raw=document.getElementById("NCI").value.trim();if(!raw)return;var n=(raw.endsWith(".md")?raw:raw+".md").toLowerCase().replace(/[^a-z0-9._-]/g,"-");if(!CF.includes(n)){CF.push(n);CF.sort();}CA=n;document.getElementById("CL").innerHTML=cmdItems();selCmd(n);api("/claude/api/commands/template",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n})}).then(function(d){var ed=document.getElementById("CE");if(ed&&d.content&&!ed.value.trim())ed.value=d.content;});document.getElementById("NCI").value="";}function saveCmd(f){var c=document.getElementById("CE").value;var st=document.getElementById("CS");st.textContent="Saving...";st.className="sbar";api("/claude/api/commands/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:S.tgt,name:f,content:c})}).then(function(d){if(d.ok){st.textContent="Saved: /"+f.replace(/\\.md$/,"");st.className="sbar ok";if(!CF.includes(f)){CF.push(f);CF.sort();}setDot(S.tgt,true);document.getElementById("CL").innerHTML=cmdItems();setTimeout(function(){st.textContent="";st.className="sbar";},3000);}else{st.textContent="Error: "+d.error;st.className="sbar err";}});}function delCmd(e,f){e.stopPropagation();if(!confirm("Delete /"+f.replace(/\\.md$/,"")+"?"))return;api("/claude/api/commands/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:S.tgt,name:f})}).then(function(d){if(d.ok){CF=CF.filter(function(x){return x!==f;});if(CA===f)CA=null;setDot(S.tgt,CF.length>0);buildCmdShell();}});}function loadCmdTpl(f){var ed=document.getElementById("CE");if(ed&&ed.value.trim()&&!confirm("Replace with template?"))return;api("/claude/api/commands/template",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:f})}).then(function(d){if(d.content&&ed){ed.value=d.content;var st=document.getElementById("CS");st.textContent="Template loaded.";st.className="sbar ok";setTimeout(function(){st.textContent="";st.className="sbar";},2000);}});}function renderSets(){api("/claude/api/settings?target="+S.tgt).then(function(d){setDot(S.tgt,d.exists);document.getElementById("content").innerHTML=\'<div class="elayout"><div class="ehdr"><div class="fpath">\'+esc(d.path||"")+\'</div><div class="brow"><button class="btn btn-g btn-s" onclick="valJson()">Validate</button><button class="btn btn-p" onclick="saveSets()">Save</button></div></div><textarea class="ed" id="TE" spellcheck="false">\'+esc(d.content)+\'</textarea><div class="sbar" id="TS">settings.json</div></div>\';document.getElementById("TE").addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key==="s"){e.preventDefault();saveSets();}});});}function valJson(){var ed=document.getElementById("TE");var st=document.getElementById("TS");try{JSON.parse(ed.value);st.textContent="Valid JSON";st.className="sbar ok";ed.style.outline="2px solid var(--grn)";setTimeout(function(){ed.style.outline="";st.textContent="";st.className="sbar";},2000);}catch(e){st.textContent="Invalid: "+e.message;st.className="sbar err";ed.style.outline="2px solid var(--red)";}}function saveSets(){var c=document.getElementById("TE").value;try{JSON.parse(c);}catch(e){setSt("Invalid JSON: "+e.message,"err");return;}setSt("Saving...","");api("/claude/api/settings/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target:S.tgt,content:c})}).then(function(d){if(d.ok){setSt("Saved: "+d.path,"ok");setDot(S.tgt,true);}else setSt("Error: "+d.error,"err");});}render();</script></body></html>');
});

module.exports = router;
