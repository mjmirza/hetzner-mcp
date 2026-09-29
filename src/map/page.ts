/**
 * The map page. One self-contained HTML document, no external requests, all data drawn
 * with DOM APIs (textContent) so a resource name can never inject markup.
 * The client script avoids backticks so it can live inside this template.
 */
export function renderPage(nonce: string): string {
  return PAGE.replace(/__NONCE__/g, nonce);
}

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hetzner Infra Map</title>
<style nonce="__NONCE__">
:root{
  --bg:oklch(0.975 0.004 60);--panel:oklch(1 0 0);--ink:oklch(0.22 0.01 50);--muted:oklch(0.52 0.01 50);
  --line:oklch(0.88 0.006 60);--grid:oklch(0.93 0.004 60);--card:oklch(1 0 0);
  --acc:oklch(0.55 0.21 25);--acc-ink:oklch(1 0 0);--acc-soft:oklch(0.95 0.03 25);--acc-mid:oklch(0.86 0.08 25);
  --edge:oklch(0.68 0.01 50);--warn:oklch(0.55 0.21 25);
  --c-account:oklch(0.955 0.006 60);--c-project:oklch(0.99 0.002 60);--c-net:oklch(0.965 0.012 60);--c-loc:oklch(0.975 0.004 60);
}
:root[data-theme="dark"]{
  --bg:oklch(0.19 0.006 50);--panel:oklch(0.22 0.006 50);--ink:oklch(0.94 0.004 60);--muted:oklch(0.68 0.008 60);
  --line:oklch(0.32 0.008 50);--grid:oklch(0.25 0.006 50);--card:oklch(0.25 0.006 50);
  --acc:oklch(0.66 0.19 25);--acc-ink:oklch(0.16 0.01 50);--acc-soft:oklch(0.30 0.05 25);--acc-mid:oklch(0.42 0.10 25);
  --edge:oklch(0.55 0.01 50);--warn:oklch(0.72 0.17 25);
  --c-account:oklch(0.21 0.006 50);--c-project:oklch(0.235 0.006 50);--c-net:oklch(0.26 0.012 50);--c-loc:oklch(0.245 0.006 50);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);overscroll-behavior:none;
  font-family:Inter,"DM Sans","Geist",ui-sans-serif,sans-serif;font-size:14px}
.app{display:grid;grid-template-columns:1fr 380px;height:100vh}
.stage{position:relative;overflow:hidden;background-image:radial-gradient(var(--grid) 1px,transparent 1px);background-size:22px 22px}
svg{width:100%;height:100%;display:block;cursor:grab;touch-action:none}
svg.panning{cursor:grabbing}
.toolbar{position:absolute;left:16px;top:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:2}
.toolbar input,.toolbar select{height:36px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:0 12px;font:inherit}
.toolbar input{width:220px}
button{height:36px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:0 12px;font:inherit;cursor:pointer}
button:hover{background:var(--acc-soft)}
button:focus-visible,input:focus-visible,select:focus-visible,g.node:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
button.primary{background:var(--acc);color:var(--acc-ink);border-color:var(--acc)}
.brand-actions{display:flex;gap:6px;align-items:center}.hint{margin-top:14px}
.side{background:var(--panel);border-left:1px solid var(--line);overflow:auto;padding:20px}
.brand{display:flex;justify-content:space-between;align-items:center;gap:8px}
.brand h1{font-size:15px;margin:0;font-weight:650;letter-spacing:.01em}
.pill{font-size:11px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:999px;border:1px solid var(--line)}
.pill.sample{background:var(--acc);color:var(--acc-ink);border-color:var(--acc)}
.total{margin:18px 0 4px;font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:12px;line-height:1.5}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:24px 0 10px;font-weight:650}
.row{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;padding:6px 0;cursor:pointer;border-radius:8px}
.row:hover{background:var(--acc-soft)}
.bar{grid-column:1/-1;height:6px;border-radius:6px;background:var(--grid);overflow:hidden}
.bar>i{display:block;height:100%;background:var(--acc)}
.money{font-variant-numeric:tabular-nums;font-weight:600}
.finding{border:1px solid var(--acc-mid);background:var(--acc-soft);border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer;line-height:1.45}
.finding b{font-variant-numeric:tabular-nums}
.finding.soft{border-color:var(--line);background:transparent}
.detail{border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px}
.detail dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:10px 0 0;font-size:13px}
.detail dt{color:var(--muted)}
.detail dd{margin:0;word-break:break-word}
.empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:var(--muted);padding:24px;pointer-events:none}
.empty b{display:block;color:var(--ink);font-size:18px;margin-bottom:6px}
text{fill:var(--ink)}
.t-muted{fill:var(--muted)}
.t-badge{font-size:10px;font-weight:700;letter-spacing:.08em;fill:var(--muted)}
.t-money{font-weight:650;font-variant-numeric:tabular-nums}
.box{stroke:var(--line);stroke-width:1}
.card{fill:var(--card);stroke:var(--line)}
.card.flag{stroke:var(--warn);stroke-width:1.5}
.card.sel{stroke:var(--acc);stroke-width:2.5}
.chip{fill:var(--grid);stroke:none}
.chip.flag{fill:var(--acc-soft);stroke:var(--warn)}
path.edge{fill:none;stroke:var(--edge);stroke-width:1.4;opacity:.75}
path.edge.hot{stroke:var(--acc);stroke-width:2.2;opacity:1}
.dim{opacity:.18}
g.node{cursor:pointer}
@media (max-width:900px){.app{grid-template-columns:1fr;grid-template-rows:62vh auto;height:auto}.side{border-left:0;border-top:1px solid var(--line)}}
@media (prefers-reduced-motion:no-preference){g.node .card{transition:stroke .15s}}
</style>
</head>
<body>
<div class="app">
  <main class="stage" id="stage" aria-label="Infrastructure canvas">
    <div class="toolbar">
      <input id="q" type="search" placeholder="Search resources" aria-label="Search resources">
      <select id="proj" aria-label="Filter by project"><option value="">All projects</option></select>
      <button id="fit" type="button" title="Fit to screen (F)">Fit</button>
      <button id="zin" type="button" aria-label="Zoom in">+</button>
      <button id="zout" type="button" aria-label="Zoom out">&#8722;</button>
      <button id="refresh" type="button" class="primary">Refresh</button>
    </div>
    <svg id="svg" role="img" aria-label="Diagram of your Hetzner infrastructure"><g id="world"><g id="boxes"></g><g id="edges"></g><g id="cards"></g></g></svg>
    <div class="empty" id="empty" hidden></div>
  </main>
  <aside class="side" aria-label="Costs and details">
    <div class="brand"><h1>Hetzner Infra Map</h1><span class="brand-actions"><span class="pill" id="src">LIVE</span><button id="theme" type="button" aria-label="Toggle dark mode">Dark</button></span></div>
    <div class="total" id="total">&#8230;</div>
    <div class="sub" id="totalSub">Loading your infrastructure</div>
    <div id="detail"></div>
    <div id="findings"></div>
    <h2>Cost by project</h2><div id="byProject"></div>
    <h2>Cost by resource type</h2><div id="byKind"></div>
    <h2>Top cost drivers</h2><div id="drivers"></div>
    <h2>How to read this</h2><div class="sub" id="caveats"></div>
    <div class="sub hint">Buttons. drag to pan, scroll to zoom, F to fit, click a resource for details.</div>
  </aside>
</div>
<script nonce="__NONCE__">
(function(){
var NS="http://www.w3.org/2000/svg";
var KIND={account:"ACCOUNT",project:"PROJECT",location:"LOCATION",network:"NETWORK",server:"SERVER",volume:"VOLUME",firewall:"FIREWALL",load_balancer:"LOAD BALANCER",floating_ip:"FLOATING IP",primary_ip:"PRIMARY IP",snapshot:"SNAPSHOT",backup:"BACKUP",storage_box:"STORAGE BOX",robot_server:"DEDICATED",certificate:"CERTIFICATE",placement_group:"PLACEMENT"};
var CONTAINERS={account:1,project:1,location:1,network:1};
var CHIP_PARENT={server:1};
var state={g:null,pos:{},sel:null,view:{x:40,y:80,k:1},q:"",proj:""};
var $=function(id){return document.getElementById(id)};
function el(tag,attrs,text){var e=document.createElementNS(NS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;return e}
function h(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function money(v,cur){if(v==null)return "not priced";return new Intl.NumberFormat("en-DE",{style:"currency",currency:cur||"EUR",maximumFractionDigits:2}).format(v)}
function clip(s,n){s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s}

try{var saved=localStorage.getItem("hzmap-theme");if(saved==="dark")document.documentElement.dataset.theme="dark"}catch(e){}
function syncTheme(){$("theme").textContent=document.documentElement.dataset.theme==="dark"?"Light":"Dark"}
$("theme").onclick=function(){var d=document.documentElement;d.dataset.theme=d.dataset.theme==="dark"?"light":"dark";try{localStorage.setItem("hzmap-theme",d.dataset.theme)}catch(e){}syncTheme()};
syncTheme();

/* ---------- layout ---------- */
var CARD_W=224,GAP=18,PAD=18,HEAD=40,COLS=3,ROW_MAX=2600;
function children(id){return state.g.nodes.filter(function(n){return n.parent===id&&visible(n)})}
function chipsOf(n){return CHIP_PARENT[n.kind]?children(n.id).filter(function(c){return !CONTAINERS[c.kind]}):[]}
function cardH(n){return 78+chipsOf(n).length*24}
function measure(n,x,y){
  if(!CONTAINERS[n.kind]){var hh=cardH(n);state.pos[n.id]={x:x,y:y,w:CARD_W,h:hh,card:true};return {w:CARD_W,h:hh}}
  var kids=children(n.id),conts=kids.filter(function(k){return CONTAINERS[k.kind]}),leaves=kids.filter(function(k){return !CONTAINERS[k.kind]});
  if(n.kind==="project"){conts.sort(function(a,b){return (a.kind==="network"?0:1)-(b.kind==="network"?0:1)})}
  var cx=x+PAD,cy=y+HEAD,rowH=0,maxW=0,rowX=cx;
  for(var i=0;i<conts.length;i++){
    var m=measure(conts[i],rowX,cy);
    if(rowX>cx&&rowX+m.w-cx>ROW_MAX){cy+=rowH+GAP;rowX=cx;rowH=0;m=measure(conts[i],rowX,cy)}
    rowX+=m.w+GAP;rowH=Math.max(rowH,m.h);maxW=Math.max(maxW,rowX-GAP-cx)}
  if(conts.length)cy+=rowH+GAP;
  if(leaves.length){
    var cols=Math.min(COLS,leaves.length),colH=[];for(var c=0;c<cols;c++)colH.push(cy);
    leaves.sort(function(a,b){return (b.monthly||0)-(a.monthly||0)});
    leaves.forEach(function(lf){var c=colH.indexOf(Math.min.apply(null,colH));var lx=cx+c*(CARD_W+GAP);var mm=measure(lf,lx,colH[c]);colH[c]+=mm.h+GAP});
    cy=Math.max.apply(null,colH);maxW=Math.max(maxW,cols*(CARD_W+GAP)-GAP)}
  var w=Math.max(maxW+PAD*2,CARD_W+PAD*2),hgt=Math.max(cy-y+PAD-(leaves.length||conts.length?GAP:0),HEAD+PAD);
  state.pos[n.id]={x:x,y:y,w:w,h:hgt};return {w:w,h:hgt}}

function layout(){
  state.pos={};var x=0,y=0,rowH=0;
  state.g.nodes.filter(function(n){return n.kind==="account"&&(!state.proj||state.g.nodes.some(function(p){return p.kind==="project"&&p.account===n.account&&p.project===state.proj}))}).forEach(function(a){var m=measure(a,x,y);
    if(x>0&&x+m.w>3200){x=0;y+=rowH+48;rowH=0;m=measure(a,x,y)}x+=m.w+48;rowH=Math.max(rowH,m.h)});
}

/* ---------- render ---------- */
function projectOf(n){return n.project||""}
function visible(n){
  if(state.proj&&n.kind!=="account"&&projectOf(n)!==state.proj&&n.kind!=="robot_server")return false;
  if(state.proj&&n.kind==="robot_server")return false;
  return true}
function matches(n){if(!state.q)return true;var q=state.q.toLowerCase();return (n.label+" "+(KIND[n.kind]||"")+" "+JSON.stringify(n.details)).toLowerCase().indexOf(q)>=0}
function heat(n){var max=state.g.totals.topDrivers.length?state.g.totals.topDrivers[0].monthly:0;if(!max||!n.monthly)return 0;return Math.min(1,n.monthly/max)}

function draw(){
  var boxes=$("boxes"),cards=$("cards"),edges=$("edges");boxes.textContent="";cards.textContent="";edges.textContent="";
  var byId={};state.g.nodes.forEach(function(n){byId[n.id]=n});
  state.g.nodes.forEach(function(n){
    var p=state.pos[n.id];if(!p||!visible(n))return;
    if(!p.card){
      var fill={account:"var(--c-account)",project:"var(--c-project)",network:"var(--c-net)",location:"var(--c-loc)"}[n.kind];
      boxes.appendChild(el("rect",{x:p.x,y:p.y,width:p.w,height:p.h,rx:n.kind==="account"?20:14,fill:fill,"class":"box","stroke-dasharray":n.kind==="network"?"5 4":""}));
      boxes.appendChild(el("text",{x:p.x+PAD,y:p.y+17,"class":"t-badge"},KIND[n.kind]));
      var title=n.label;
      if(n.kind==="project"||n.kind==="account"){var tot=sumFor(n);title+="   "+money(tot,state.g.currency)+" / month"}
      if(n.kind==="network"&&n.details.ip_range)title+="   "+n.details.ip_range;
      boxes.appendChild(el("text",{x:p.x+PAD,y:p.y+33,"font-weight":"650","font-size":n.kind==="account"?"15":"13"},title));
      return}
    if(byId[n.parent]&&CHIP_PARENT[byId[n.parent].kind])return;
    var g=el("g",{"class":"node",tabindex:"0",role:"button","aria-label":(KIND[n.kind]||n.kind)+" "+n.label+", "+money(n.monthly,state.g.currency)+" per month"});
    g.dataset.id=n.id;
    var hot=heat(n);
    var rect=el("rect",{x:p.x,y:p.y,width:p.w,height:p.h,rx:12,"class":"card"+(n.flags.some(function(f){return f.kind!=="info"})?" flag":"")+(state.sel===n.id?" sel":"")});
    if(hot>0)rect.style.fill="color-mix(in oklch, var(--acc-soft) "+Math.round(20+hot*80)+"%, var(--card))";
    g.appendChild(rect);
    g.appendChild(el("text",{x:p.x+14,y:p.y+20,"class":"t-badge"},KIND[n.kind]+(n.flags.some(function(f){return f.kind==="risk"})?"  ▲ RISK":n.flags.some(function(f){return f.kind==="waste"})?"  ● IDLE":"")));
    g.appendChild(el("text",{x:p.x+p.w-14,y:p.y+20,"text-anchor":"end","class":"t-money","font-size":"12"},n.monthly==null?"":money(n.monthly,state.g.currency)));
    g.appendChild(el("text",{x:p.x+14,y:p.y+42,"font-weight":"650","font-size":"14"},clip(n.label,26)));
    var sub=[n.details.type,n.location,n.status].filter(Boolean).join(" · ");
    g.appendChild(el("text",{x:p.x+14,y:p.y+61,"class":"t-muted","font-size":"12"},clip(sub,32)));
    chipsOf(n).forEach(function(c,i){
      var cy=p.y+74+i*24;
      var cg=el("g",{"class":"node",tabindex:"0",role:"button","aria-label":(KIND[c.kind]||c.kind)+" "+c.label});cg.dataset.id=c.id;
      cg.appendChild(el("rect",{x:p.x+10,y:cy,width:p.w-20,height:20,rx:6,"class":"chip"+(c.flags.some(function(f){return f.kind!=="info"})?" flag":"")}));
      cg.appendChild(el("text",{x:p.x+18,y:cy+14,"font-size":"11"},clip((c.kind==="volume"?"▣ ":"◎ ")+c.label+(c.details.size_gb?"  "+c.details.size_gb+" GB":""),28)));
      cg.appendChild(el("text",{x:p.x+p.w-18,y:cy+14,"text-anchor":"end","font-size":"11","class":"t-money"},c.monthly?money(c.monthly,state.g.currency):""));
      g.appendChild(cg)});
    if(!matches(n))g.setAttribute("class","node dim");
    cards.appendChild(g)});
  state.g.edges.forEach(function(e){
    var a=anchor(e.from,byId),b=anchor(e.to,byId);if(!a||!b||!a.card||!b.card||a===b)return;
    if(!visible(byId[e.from])||!visible(byId[e.to]))return;
    var d,ax=a.x+a.w/2,bx=b.x+b.w/2,ay=a.y+a.h/2,by=b.y+b.h/2;
    if(Math.abs(by-ay)>Math.abs(bx-ax)){var y1=by>ay?a.y+a.h:a.y,y2=by>ay?b.y:b.y+b.h,dy=(y2-y1)/2;
      d="M"+ax+","+y1+" C"+ax+","+(y1+dy)+" "+bx+","+(y2-dy)+" "+bx+","+y2}
    else{var x1=bx>ax?a.x+a.w:a.x,x2=bx>ax?b.x:b.x+b.w,dx=(x2-x1)/2;
      d="M"+x1+","+ay+" C"+(x1+dx)+","+ay+" "+(x2-dx)+","+by+" "+x2+","+by}
    var path=el("path",{d:d,"class":"edge"+(state.sel&&(e.from===state.sel||e.to===state.sel)?" hot":"")});
    path.appendChild(el("title",{},e.kind));edges.appendChild(path)});
  applyView()}

function anchor(id,byId){var n=byId[id];if(!n)return null;var p=state.pos[id];if(p&&p.card&&!(byId[n.parent]&&CHIP_PARENT[byId[n.parent].kind]))return p;
  if(n&&byId[n.parent]&&CHIP_PARENT[byId[n.parent].kind])return state.pos[n.parent];return p}
function sumFor(c){return state.g.nodes.filter(function(n){return !CONTAINERS[n.kind]&&(c.kind==="account"?n.account===c.account:(n.project===c.project&&n.account===c.account))}).reduce(function(s,n){return s+(n.monthly||0)},0)}

/* ---------- pan and zoom ---------- */
function applyView(){$("world").setAttribute("transform","translate("+state.view.x+","+state.view.y+") scale("+state.view.k+")")}
function zoomAt(f,cx,cy){var v=state.view,k=Math.min(3,Math.max(.15,v.k*f));v.x=cx-(cx-v.x)*(k/v.k);v.y=cy-(cy-v.y)*(k/v.k);v.k=k;applyView()}
function fit(){var xs=[],ys=[];for(var id in state.pos){var p=state.pos[id];xs.push(p.x,p.x+p.w);ys.push(p.y,p.y+p.h)}
  if(!xs.length)return;var r=$("svg").getBoundingClientRect();var W=Math.max.apply(null,xs)-Math.min.apply(null,xs),H=Math.max.apply(null,ys)-Math.min.apply(null,ys);
  var k=Math.min(1.2,Math.min((r.width-80)/W,(r.height-140)/H));state.view={k:k,x:40-Math.min.apply(null,xs)*k,y:90-Math.min.apply(null,ys)*k};applyView()}
var svg=$("svg"),drag=null;
svg.addEventListener("pointerdown",function(ev){if(ev.target.closest("g.node"))return;drag={x:ev.clientX,y:ev.clientY,vx:state.view.x,vy:state.view.y};svg.classList.add("panning");svg.setPointerCapture(ev.pointerId)});
svg.addEventListener("pointermove",function(ev){if(!drag)return;state.view.x=drag.vx+ev.clientX-drag.x;state.view.y=drag.vy+ev.clientY-drag.y;applyView()});
svg.addEventListener("pointerup",function(){drag=null;svg.classList.remove("panning")});
svg.addEventListener("wheel",function(ev){ev.preventDefault();var r=svg.getBoundingClientRect();zoomAt(ev.deltaY<0?1.1:1/1.1,ev.clientX-r.left,ev.clientY-r.top)},{passive:false});
svg.addEventListener("click",function(ev){var g=ev.target.closest("g.node");if(g){ev.stopPropagation();select(g.dataset.id)}});
svg.addEventListener("keydown",function(ev){var g=ev.target.closest&&ev.target.closest("g.node");if(g&&(ev.key==="Enter"||ev.key===" ")){ev.preventDefault();select(g.dataset.id)}});
document.addEventListener("keydown",function(ev){if(ev.target.tagName==="INPUT")return;if(ev.key==="f"||ev.key==="F")fit();if(ev.key==="+"||ev.key==="=")zoomBy(1.2);if(ev.key==="-")zoomBy(1/1.2);if(ev.key==="Escape")select(null)});
function zoomBy(f){var r=svg.getBoundingClientRect();zoomAt(f,r.width/2,r.height/2)}
$("zin").onclick=function(){zoomBy(1.2)};$("zout").onclick=function(){zoomBy(1/1.2)};$("fit").onclick=fit;
$("q").oninput=function(e){state.q=e.target.value;draw()};
$("proj").onchange=function(e){state.proj=e.target.value;layout();draw();fit()};

/* ---------- side panel ---------- */
function focusNode(id){select(id);var p=state.pos[id];var byParent=state.g.nodes.filter(function(n){return n.id===id})[0];if(!p&&byParent)p=state.pos[byParent.parent];if(!p)return;
  var r=svg.getBoundingClientRect();state.view.k=Math.max(state.view.k,.9);state.view.x=r.width/2-(p.x+p.w/2)*state.view.k;state.view.y=r.height/2-(p.y+p.h/2)*state.view.k;applyView()}
function select(id){state.sel=id;draw();renderDetail()}
function renderDetail(){var box=$("detail");box.textContent="";if(!state.sel)return;var n=state.g.nodes.filter(function(x){return x.id===state.sel})[0];if(!n)return;
  var d=h("div","detail");d.appendChild(h("div","t-badge sub",KIND[n.kind]));var t=h("div",null,n.label);t.style.fontWeight="700";t.style.fontSize="16px";d.appendChild(t);
  var m=h("div","money",money(n.monthly,state.g.currency)+(n.monthly!=null?" per month":""));m.style.marginTop="6px";d.appendChild(m);
  if(n.costNote)d.appendChild(h("div","sub",n.costNote));
  n.flags.forEach(function(f){d.appendChild(h("div","finding"+(f.kind==="info"?" soft":""),f.text+(f.monthly?"  ("+money(f.monthly,state.g.currency)+" a month)":"")))});
  var dl=h("dl");var rows=[["Project",n.project],["Account",n.account],["Location",n.location],["Status",n.status]];
  for(var k in n.details)rows.push([k.replace(/_/g," "),n.details[k]]);
  var links=state.g.edges.filter(function(e){return e.from===n.id||e.to===n.id}).map(function(e){var o=e.from===n.id?e.to:e.from;var on=state.g.nodes.filter(function(x){return x.id===o})[0];return e.kind+" "+(on?on.label:o)});
  if(links.length)rows.push(["Connections",links.join(", ")]);
  rows.forEach(function(r){if(r[1]==null||r[1]==="")return;dl.appendChild(h("dt",null,r[0]));dl.appendChild(h("dd",null,String(r[1])))});
  d.appendChild(dl);var close=h("button",null,"Close");close.style.marginTop="12px";close.onclick=function(){select(null)};d.appendChild(close);box.appendChild(d)}
function bars(target,rows,max){var c=$(target);c.textContent="";rows.forEach(function(r){var row=h("div","row");row.tabIndex=0;row.appendChild(h("span",null,r.label));row.appendChild(h("span","money",r.value));
  var b=h("div","bar"),i=document.createElement("i");i.style.width=(max?Math.max(2,100*r.n/max):0)+"%";b.appendChild(i);row.appendChild(b);
  if(r.onClick){row.onclick=r.onClick;row.onkeydown=function(e){if(e.key==="Enter")r.onClick()}}c.appendChild(row)});if(!rows.length)c.appendChild(h("div","sub","Nothing billed yet."))}
function side(){var g=state.g,cur=g.currency;
  $("src").textContent=g.source==="sample"?"SAMPLE":"LIVE";$("src").className="pill"+(g.source==="sample"?" sample":"");
  $("total").textContent=money(g.totals.monthly,cur);
  $("totalSub").textContent="Estimated per month across "+g.totals.byProject.length+" project(s). "+g.vatNote+" Updated "+new Date(g.generatedAt).toLocaleTimeString("en-GB")+".";
  var fc=$("findings");fc.textContent="";
  var groups=[["risk","Risks to fix"],["waste","Money you can save"],["info","Good to know"]];
  groups.forEach(function(gr){var items=g.totals.findings.filter(function(f){return f.kind===gr[0]});
    fc.appendChild(h("h2",null,gr[1]+(items.length?"  ("+items.length+")":"")));
    if(gr[0]==="waste"&&items.length){var sum=items.reduce(function(s,f){return s+(f.monthly||0)},0);fc.appendChild(h("div","sub","About "+money(sum,cur)+" a month, "+money(sum*12,cur)+" a year."))}
    if(!items.length){fc.appendChild(h("div","sub",gr[0]==="risk"?"Nothing risky found.":gr[0]==="waste"?"Nothing idle or orphaned.":"Nothing to note."));return}
    items.forEach(function(f){var d=h("div","finding"+(f.kind==="info"?" soft":""));d.tabIndex=0;d.setAttribute("role","button");
      if(f.monthly)d.appendChild(h("b",null,money(f.monthly,cur)+"  "));
      d.appendChild(document.createTextNode(f.title+(f.project?"  ("+f.project+")":"")));
      d.onclick=function(){focusNode(f.nodeId)};d.onkeydown=function(e){if(e.key==="Enter")focusNode(f.nodeId)};fc.appendChild(d)})});
  var mp=g.totals.byProject[0]?g.totals.byProject[0].monthly:0;
  bars("byProject",g.totals.byProject.map(function(p){return {label:p.project+"  · "+p.account+(p.error?"  (unreadable)":""),value:money(p.monthly,cur),n:p.monthly,onClick:function(){$("proj").value=p.project;state.proj=p.project;layout();draw();fit()}}}),mp);
  var mk=g.totals.byKind[0]?g.totals.byKind[0].monthly:0;
  bars("byKind",g.totals.byKind.filter(function(k){return k.monthly>0}).map(function(k){return {label:(KIND[k.kind]||k.kind).toLowerCase()+"  ×"+k.count,value:money(k.monthly,cur),n:k.monthly}}),mk);
  var md=g.totals.topDrivers[0]?g.totals.topDrivers[0].monthly:0;
  bars("drivers",g.totals.topDrivers.map(function(d){return {label:d.label+"  · "+(KIND[d.kind]||d.kind).toLowerCase(),value:money(d.monthly,cur),n:d.monthly,onClick:function(){focusNode(d.nodeId)}}}),md);
  var cv=$("caveats");cv.textContent="";g.caveats.forEach(function(c){cv.appendChild(h("p",null,c))});
  var sel=$("proj"),keep=sel.value;while(sel.options.length>1)sel.remove(1);g.totals.byProject.forEach(function(p){var o=document.createElement("option");o.value=p.project;o.textContent=p.project;sel.appendChild(o)});sel.value=keep}

function empty(){var e=$("empty");var real=state.g.nodes.filter(function(n){return !CONTAINERS[n.kind]}).length;
  if(real){e.hidden=true;return}e.hidden=false;e.textContent="";e.appendChild(h("b",null,"No resources yet"));
  e.appendChild(h("div",null,state.g.caveats[0]||"This project is empty. Create a server and refresh, or run: npx hetzner-mcp map --demo"))}

function load(force){$("refresh").disabled=true;$("totalSub").textContent="Reading your projects from the Hetzner API";
  fetch("/api/graph"+(force?"?refresh=1":""),{headers:{"X-Hzmap":"1"}}).then(function(r){return r.json()}).then(function(g){if(g.error)throw new Error(g.error);state.g=g;layout();side();draw();empty();fit()})
  .catch(function(err){$("total").textContent="Unavailable";$("totalSub").textContent=String(err.message||err)})
  .finally(function(){$("refresh").disabled=false})}
$("refresh").onclick=function(){load(true)};
window.addEventListener("resize",function(){if(state.g)applyView()});
load(false);
})();
</script>
</body>
</html>`;
