#!/usr/bin/env python3
"""Build a card-art checkoff artifact from a staged JSON list.

Staged entries: {template, name, slug, dims, url, preview(data-uri), flag, source}.
    python3 tools/build_review.py <staged.json> <out.html> "<Title>"
"""
import json, sys

TPL = r'''<title>__TITLE__</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
:root{--ground:#F1F3F6;--surface:#FFFFFF;--surface-2:#F8FAFC;--panel:#EEF1F5;--ink:#14161C;--muted:#616878;--faint:#8A90A0;--hairline:#E2E5EC;--accent:#3A54D6;--accent-ink:#FFF;--ok:#0E9F6E;--ok-ink:#0A6E4C;--ok-soft:#E6F6EF;--ok-ring:#12b07c;--flag:#A9690A;--flag-soft:#FBF0DA;--shadow:0 1px 2px rgba(20,22,28,.05),0 8px 24px rgba(20,22,28,.06);--shadow-sel:0 2px 6px rgba(14,159,110,.18),0 10px 30px rgba(14,159,110,.14);}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#0E1017;--surface:#161A22;--surface-2:#1C212B;--panel:#20262F;--ink:#EDEFF4;--muted:#9AA1B1;--faint:#6C7486;--hairline:#2A303C;--accent:#7E97FF;--accent-ink:#0E1017;--ok:#33CD95;--ok-ink:#8DE9C7;--ok-soft:#122A22;--ok-ring:#2FCB92;--flag:#E1A852;--flag-soft:#2C2413;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.34);--shadow-sel:0 2px 8px rgba(47,203,146,.22),0 12px 32px rgba(0,0,0,.4);}}
:root[data-theme="dark"]{--ground:#0E1017;--surface:#161A22;--surface-2:#1C212B;--panel:#20262F;--ink:#EDEFF4;--muted:#9AA1B1;--faint:#6C7486;--hairline:#2A303C;--accent:#7E97FF;--accent-ink:#0E1017;--ok:#33CD95;--ok-ink:#8DE9C7;--ok-soft:#122A22;--ok-ring:#2FCB92;--flag:#E1A852;--flag-soft:#2C2413;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.34);--shadow-sel:0 2px 8px rgba(47,203,146,.22),0 12px 32px rgba(0,0,0,.4);}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font-family:"Hanken Grotesk",system-ui,sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--hairline)}
.bar{max-width:1240px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.brand{display:flex;flex-direction:column;gap:2px;margin-right:auto}
h1{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:22px;letter-spacing:-.02em;margin:0;line-height:1.05}
.brand p{margin:0;color:var(--muted);font-size:12.5px}
.count{display:flex;align-items:baseline;gap:7px;padding:8px 15px;border-radius:11px;background:var(--ok-soft);border:1px solid color-mix(in srgb,var(--ok) 30%,transparent)}
.count b{font-family:"Bricolage Grotesque",sans-serif;font-size:21px;color:var(--ok-ink);line-height:1}
.count span{color:var(--muted);font-size:12.5px}
.btns{display:flex;gap:8px;flex-wrap:wrap}
button{font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border-radius:10px;padding:9px 15px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);transition:transform .06s,background .15s,border-color .15s}
button:hover{background:var(--surface-2);border-color:color-mix(in srgb,var(--ink) 20%,var(--hairline))}
button:active{transform:translateY(1px)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent}
button.primary:hover{background:color-mix(in srgb,var(--accent) 88%,#000)}
main{max-width:1240px;margin:0 auto;padding:22px 24px 120px}
.note{display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:14px 16px;margin-bottom:22px;color:var(--muted);font-size:13.5px;box-shadow:var(--shadow)}
.note b{color:var(--ink)}.note .k{color:var(--ok-ink);font-weight:700}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
.chip{font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:99px;border:1px solid var(--hairline);background:var(--surface);color:var(--muted);cursor:pointer;transition:all .12s}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--ground);border-color:var(--ink)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:16px}
.card{position:relative;background:var(--surface);border:1px solid var(--hairline);border-radius:15px;overflow:hidden;cursor:pointer;box-shadow:var(--shadow);transition:transform .1s,box-shadow .18s,border-color .18s;outline:none}
.card:hover{transform:translateY(-2px)}.card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card[aria-checked="true"]{border-color:var(--ok-ring);box-shadow:var(--shadow-sel)}
.card[aria-checked="true"]::after{content:"";position:absolute;inset:0;border-radius:15px;border:1.5px solid var(--ok-ring);pointer-events:none}
.thumb{aspect-ratio:1.585;background:linear-gradient(45deg,var(--panel) 25%,transparent 25%,transparent 75%,var(--panel) 75%) 0 0/16px 16px,linear-gradient(45deg,var(--panel) 25%,var(--surface-2) 25%,var(--surface-2) 75%,var(--panel) 75%) 8px 8px/16px 16px;display:flex;align-items:center;justify-content:center;padding:16px;border-bottom:1px solid var(--hairline)}
.thumb img{max-width:100%;max-height:100%;object-fit:contain;border-radius:7px;box-shadow:0 3px 10px rgba(0,0,0,.16)}
.card[aria-checked="false"] .thumb img{opacity:.6;filter:saturate(.8)}
.tick{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--surface);border:1.5px solid var(--hairline);color:transparent;transition:all .15s;z-index:2}
.card[aria-checked="true"] .tick{background:var(--ok);border-color:var(--ok);color:#fff}.tick svg{width:15px;height:15px}
.badges{position:absolute;top:10px;left:10px;z-index:2;display:flex;gap:5px}
.bdg{font-size:10px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;padding:4px 7px;border-radius:6px;background:var(--panel);color:var(--muted);border:1px solid var(--hairline)}
.bdg.flag{background:var(--flag-soft);color:var(--flag);border-color:color-mix(in srgb,var(--flag) 34%,transparent)}
.meta{padding:12px 14px 14px;display:flex;flex-direction:column;gap:5px}
.name{font-weight:600;font-size:14px;line-height:1.25;letter-spacing:-.01em}
.tid{font-size:11.5px;color:var(--ok-ink);font-weight:600}
.srow{display:flex;justify-content:space-between;align-items:center;gap:8px}
.slug{font-size:11px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dims{font-size:10.5px;color:var(--faint);flex-shrink:0}
.overlay{position:fixed;inset:0;z-index:40;background:rgba(10,12,18,.5);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;padding:24px}
.overlay.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--hairline);border-radius:16px;box-shadow:var(--shadow);width:min(680px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden}
.modal header{position:static;background:var(--surface);border-bottom:1px solid var(--hairline)}
.mhead{padding:16px 20px;display:flex;align-items:center;gap:12px}.mhead h2{font-family:"Bricolage Grotesque",sans-serif;font-size:16px;margin:0;flex:1}
.modal textarea{flex:1;margin:0;border:none;resize:none;padding:16px 20px;background:var(--surface-2);color:var(--ink);font-family:"JetBrains Mono",monospace;font-size:12.5px;line-height:1.55;min-height:320px;outline:none}
.mfoot{padding:14px 20px;border-top:1px solid var(--hairline);display:flex;gap:10px;align-items:center}.mfoot .hint{color:var(--muted);font-size:12.5px;margin-right:auto}
.iconbtn{width:34px;height:34px;padding:0;display:grid;place-items:center}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media(max-width:560px){.bar{padding:14px 16px}main{padding:18px 16px 120px}}
</style>
<header><div class="bar">
<div class="brand"><h1>__TITLE__</h1><p>__SUB__</p></div>
<div class="count"><b id="n">0</b><span>of <span id="total">0</span> selected</span></div>
<div class="btns"><button id="all">Select all</button><button id="none">Clear</button><button id="export" class="primary">Export JSON</button></div>
</div></header>
<main>
<div class="note"><span style="font-size:17px;line-height:1">&#9989;</span><div>__NOTE__</div></div>
<div class="filters" id="filters"></div><div class="grid" id="grid"></div>
</main>
<div class="overlay" id="overlay"><div class="modal"><header><div class="mhead"><h2>Accepted &middot; <span id="jn">0</span></h2><button class="iconbtn" id="close" aria-label="Close">&times;</button></div></header>
<textarea id="json" readonly spellcheck="false"></textarea>
<div class="mfoot"><span class="hint">Paste this back into the chat.</span><button id="copy" class="primary">Copy</button></div></div></div>
<script>
const DATA=__PAYLOAD__;const KEY="__KEY__";
const grid=document.getElementById("grid");let sel=new Set(DATA.map(d=>d.template));
try{const s=localStorage.getItem(KEY);if(s)sel=new Set(JSON.parse(s));}catch(e){}
let filter="all";
const CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
function issuers(){const m={};DATA.forEach(d=>{const i=d.template.split("/")[0];m[i]=(m[i]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function renderFilters(){const f=document.getElementById("filters");const p=[`<button class="chip" data-f="all" aria-pressed="true">All &middot; ${DATA.length}</button>`];for(const[i,c]of issuers())p.push(`<button class="chip" data-f="${i}" aria-pressed="false">${i} &middot; ${c}</button>`);f.innerHTML=p.join("");f.querySelectorAll(".chip").forEach(ch=>ch.onclick=()=>{filter=ch.dataset.f;f.querySelectorAll(".chip").forEach(x=>x.setAttribute("aria-pressed",x===ch));render()})}
function render(){const items=DATA.filter(d=>filter==="all"||d.template.split("/")[0]===filter);grid.innerHTML=items.map(d=>{const on=sel.has(d.template);return `<div class="card" role="checkbox" tabindex="0" aria-checked="${on}" data-t="${d.template}"><div class="badges"><span class="bdg">${d.source}</span>${d.flag?'<span class="bdg flag">verify variant</span>':''}</div><span class="tick">${CHECK}</span><div class="thumb"><img loading="lazy" src="${d.preview}" alt="${d.name}"></div><div class="meta"><div class="name">${d.name}</div><div class="tid mono">${d.template}</div><div class="srow"><span class="slug mono">${d.slug}</span><span class="dims mono">${d.dims}</span></div></div></div>`}).join("");grid.querySelectorAll(".card").forEach(c=>{const t=c.dataset.t;const tog=()=>{sel.has(t)?sel.delete(t):sel.add(t);c.setAttribute("aria-checked",sel.has(t));save();count()};c.onclick=tog;c.onkeydown=e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();tog()}}});count()}
function count(){document.getElementById("n").textContent=sel.size;document.getElementById("total").textContent=DATA.length}
function save(){try{localStorage.setItem(KEY,JSON.stringify([...sel]))}catch(e){}}
function buildJSON(){const r=DATA.filter(d=>sel.has(d.template)).map(d=>({template:d.template,slug:d.slug,url:d.url,source:d.source}));return JSON.stringify({accept:r},null,2)}
document.getElementById("all").onclick=()=>{DATA.forEach(d=>sel.add(d.template));save();render()};
document.getElementById("none").onclick=()=>{sel.clear();save();render()};
const ov=document.getElementById("overlay");
document.getElementById("export").onclick=()=>{document.getElementById("json").value=buildJSON();document.getElementById("jn").textContent=sel.size;ov.classList.add("open")};
document.getElementById("close").onclick=()=>ov.classList.remove("open");ov.onclick=e=>{if(e.target===ov)ov.classList.remove("open")};
document.getElementById("copy").onclick=async()=>{const t=document.getElementById("json");t.select();try{await navigator.clipboard.writeText(t.value)}catch(e){document.execCommand("copy")}const b=document.getElementById("copy");b.textContent="Copied ✓";setTimeout(()=>b.textContent="Copy",1400)};
document.addEventListener("keydown",e=>{if(e.key==="Escape")ov.classList.remove("open")});
renderFilters();render();
</script>'''

def main():
    staged=json.load(open(sys.argv[1])); out=sys.argv[2]; title=sys.argv[3]
    staged.sort(key=lambda d:(d['template'].split('/')[0], d['template']))
    nflag=sum(1 for d in staged if d.get('flag'))
    sub=f"{len(staged)} candidates &middot; pre-vetted clean &middot; check the keepers, export JSON"
    note=(f'These <b>{len(staged)}</b> passed a visual pass &mdash; each read as a <b class="k">bare face</b> '
          f'(no specimen name, no promo badge, trimmed). All start selected; <b>uncheck</b> what you don&rsquo;t want. '
          f'The <b>source</b> tag shows where each came from; <b style="color:var(--flag)">verify variant</b> ({nflag}) marks a '
          f'business/personal sibling match &mdash; glance before keeping. Export builds JSON to paste back.')
    html=(TPL.replace("__TITLE__",title).replace("__SUB__",sub).replace("__NOTE__",note)
             .replace("__PAYLOAD__",json.dumps(staged,ensure_ascii=False))
             .replace("__KEY__","plancards.review."+out.split('/')[-1].replace('.','_')))
    open(out,"w",encoding="utf-8").write(html)
    print(f"wrote {out}  ({len(html)/1024:.0f} KB, {len(staged)} cards, {nflag} flagged)")

if __name__=="__main__": main()
