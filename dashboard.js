"use strict";

const WEB_APP_URL="https://script.google.com/macros/s/AKfycbwveP6XYC6ygqYXKqRQalQ-EEb3xJq-QCF09Ifk6RVbRdKABafKHcOZa5RgBcdcY7tl/exec";
const PIN_SHA256="8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"; // 123456
const SESSION_KEY="endfield_protocol_authorized";
const AUTO_REFRESH_MS=10000;

const ACCOUNTS=[
  {slug:"muzaka",name:"Muzaka",uid:"4468761606",server:"Asia",level:60,avatar:"M"},
  {slug:"orion",name:"Orion",uid:"4896434342",server:"Asia",level:57,avatar:"O"},
  {slug:"naskara",name:"Naskara",uid:"4367542843",server:"Asia",level:42,avatar:"N"}
];

const state={
  selectedSlug:localStorage.getItem("endfield_selected_account")||ACCOUNTS[0].slug,
  view:"dashboard",refreshing:false,checkingIn:false,statusData:null,timer:null
};

const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const selectedAccount=()=>ACCOUNTS.find(a=>a.slug===state.selectedSlug)||ACCOUNTS[0];
const esc=v=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");

function nowWib(){return new Date().toLocaleString("id-ID",{timeZone:"Asia/Jakarta",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})}
function formatTime(v){if(!v)return"—";const d=new Date(v);return Number.isNaN(d.getTime())?"—":d.toLocaleString("id-ID",{timeZone:"Asia/Jakarta",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})+" WIB"}
async function sha256Text(v){const bytes=new TextEncoder().encode(v);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("")}

function setAuthorized(ok){$("#loginLayer").hidden=ok;if(ok){sessionStorage.setItem(SESSION_KEY,"1");resumeBackgroundVideo()}else sessionStorage.removeItem(SESSION_KEY)}

$("#pinInput").addEventListener("input",e=>{e.target.value=e.target.value.replace(/\D/g,"").slice(0,6);$("#loginMessage").className="login-message";$("#loginMessage").textContent="STATUS: AWAITING AUTHORIZATION"});
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();const input=$("#pinInput"),msg=$("#loginMessage"),btn=$("#loginButton");if(!/^\d{6}$/.test(input.value)){msg.textContent="ACCESS DENIED: PIN wajib 6 digit.";msg.classList.add("error");return}btn.disabled=true;msg.textContent="AUTHENTICATING...";try{if(await sha256Text(input.value)!==PIN_SHA256){input.value="";msg.textContent="ACCESS DENIED: PIN salah.";msg.classList.add("error");return}setAuthorized(true);input.value="";showToast("success","Access granted","Dashboard operator berhasil dibuka.");await refreshAllCards(true)}finally{btn.disabled=false}});
$("#logoutButton").addEventListener("click",()=>{setAuthorized(false);$("#pinInput").value="";$("#loginMessage").textContent="STATUS: SESSION CLOSED"});

function renderAccountList(){
  $("#accountMiniList").innerHTML=ACCOUNTS.map(a=>`<button class="account-mini ${a.slug===state.selectedSlug?"active":""}" data-account="${esc(a.slug)}"><span class="account-mini-name">${esc(a.name)}</span><span class="account-mini-meta">UID ${esc(a.uid)}<br>${a.server} • Lv.${a.level}</span></button>`).join("");
  $$(".account-mini").forEach(btn=>btn.addEventListener("click",async()=>{state.selectedSlug=btn.dataset.account;localStorage.setItem("endfield_selected_account",state.selectedSlug);renderSelectedAccount();closeSidebar();await refreshSelectedCards(true)}));
}

function renderSelectedAccount(){const a=selectedAccount(),i=ACCOUNTS.findIndex(x=>x.slug===a.slug);$("#profileAvatar").textContent=a.avatar;$("#profileName").textContent=a.name;$("#profileLevel").textContent=`Authority Lv.${a.level}`;$("#profileUid").textContent=a.uid;$("#profileServer").textContent=a.server;$("#accountOrdinal").textContent=String(i+1).padStart(2,"0");$("#accountLevel").textContent=a.level;$("#syncSelectedAccount").textContent=a.name;renderAccountList()}

function setView(view){state.view=view;$("#dashboardView").hidden=view!=="dashboard";$("#profilesView").hidden=view!=="profiles";$$(".nav-button[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("#topbarViewName").textContent=view==="dashboard"?"Control Panel / Dashboard":"Control Panel / Operator Profiles";closeSidebar();if(view==="profiles"){renderProfilesView();refreshProfilesViewImages()}}
$$(".nav-button[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
function closeSidebar(){$("#sidebar").classList.remove("open")}
$("#mobileMenuButton").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));

function cardUrl(a,kind,buster){return `./cards/${encodeURIComponent(a.slug)}/${kind}.png?v=${buster}`}
function preload(url){return new Promise((res,rej)=>{const i=new Image();i.decoding="async";i.onload=()=>res(url);i.onerror=()=>rej(new Error(`Gagal memuat ${url}`));i.src=url})}
function setLoading(kind){const p=kind==="profile"?$("#profilePlaceholder"):$("#livePlaceholder"),img=kind==="profile"?$("#profileCardImage"):$("#liveCardImage"),st=kind==="profile"?$("#profileCardStatus"):$("#liveCardStatus");img.classList.remove("ready");p.hidden=false;p.classList.add("loading");p.textContent=kind==="profile"?"Loading Profile Card...":"Loading Live Stats Card...";st.textContent="Loading"}
function applyImage(kind,url){const p=kind==="profile"?$("#profilePlaceholder"):$("#livePlaceholder"),img=kind==="profile"?$("#profileCardImage"):$("#liveCardImage"),st=kind==="profile"?$("#profileCardStatus"):$("#liveCardStatus");img.src=url;img.classList.add("ready");p.hidden=true;p.classList.remove("loading");st.textContent="Ready"}
function applyError(kind){const p=kind==="profile"?$("#profilePlaceholder"):$("#livePlaceholder"),img=kind==="profile"?$("#profileCardImage"):$("#liveCardImage"),st=kind==="profile"?$("#profileCardStatus"):$("#liveCardStatus");img.classList.remove("ready");p.hidden=false;p.classList.remove("loading");p.textContent="Card belum tersedia dari GitHub Pages.";st.textContent="Unavailable"}

async function fetchStatus(b){try{const r=await fetch(`./cards/status.json?v=${b}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);state.statusData=await r.json();return state.statusData}catch(e){console.warn(e);return null}}
function updateOverview(status){$("#lastGeneratedAt").textContent=formatTime(status?.updated_at);$("#lastBrowserRefresh").textContent=nowWib()+" WIB";$("#cacheBadge").textContent=status?.updated_at?"Cached • latest":"Cached • unavailable";const a=status?.accounts?.[state.selectedSlug],ok=!!(a?.profile&&a?.live);$("#syncStateShort").textContent=ok?"OK":"WARN";const dot=$("#serviceHealthDot");dot.className=ok?"ok":a?"warn":"error";$("#serviceHealthText").textContent=ok?"All cards online":a?"Partial availability":"Status unavailable"}

async function refreshSelectedCards(manual=false){const a=selectedAccount(),b=`${Date.now()}-${Math.random()}`;setLoading("profile");setLoading("live");const pu=cardUrl(a,"profile",b),lu=cardUrl(a,"live",b);const [pr,lr,status]=await Promise.all([preload(pu).then(()=>true).catch(()=>false),preload(lu).then(()=>true).catch(()=>false),fetchStatus(b)]);pr?applyImage("profile",pu):applyError("profile");lr?applyImage("live",lu):applyError("live");updateOverview(status);if(manual)showToast(pr&&lr?"success":"warning","Dashboard refreshed",pr&&lr?`${a.name}: Profile Card dan Live Stats sudah dimuat ulang.`:`${a.name}: sebagian card belum tersedia.`)}

function setRefreshDisabled(v){["#refreshButton","#profilesRefreshButton","#sidebarRefreshButton"].forEach(s=>{if($(s))$(s).disabled=v});$("#toolbarInfo").textContent=v?"Mengambil card terbaru...":"Auto-refresh card setiap 10 detik."}
async function refreshAllCards(manual=false){if(state.refreshing)return;state.refreshing=true;setRefreshDisabled(true);const b=`${Date.now()}-${Math.random()}`,req=[];for(const a of ACCOUNTS)for(const kind of["profile","live"]){const url=cardUrl(a,kind,b);req.push({a,kind,url,p:preload(url)})}try{const [results,status]=await Promise.all([Promise.allSettled(req.map(x=>x.p)),fetchStatus(b)]);const current=selectedAccount();results.forEach((r,i)=>{if(req[i].a.slug===current.slug&&r.status==="fulfilled")applyImage(req[i].kind,req[i].url)});updateOverview(status);refreshProfilesViewImages();if(manual){const ok=results.filter(r=>r.status==="fulfilled").length;showToast(ok===req.length?"success":"warning","All cards refreshed",`${ok}/${req.length} card terbaru berhasil dimuat.`)}}finally{state.refreshing=false;setRefreshDisabled(false)}}

function renderProfilesView(){$("#profilesViewGrid").innerHTML=ACCOUNTS.map((a,i)=>`<article class="profile-row"><section class="panel profile-row-summary"><h3>${esc(a.name)}</h3><p>UID ${a.uid}<br>Server ${a.server}<br>Authority Lv.${a.level}</p></section><section class="panel"><header class="panel-header"><div><h2>Profile Card</h2><small>${a.name}</small></div><span>${String(i+1).padStart(2,"0")}-P</span></header><div class="image-panel-body"><div class="image-frame profile-image-frame"><img class="profile-row-image all-profile-image" data-slug="${a.slug}" alt="${a.name} Profile Card"></div></div></section><section class="panel"><header class="panel-header"><div><h2>Live Stats</h2><small>${a.name}</small></div><span>${String(i+1).padStart(2,"0")}-L</span></header><div class="live-body"><div class="image-frame live-image-frame"><img class="profile-row-image all-live-image" data-slug="${a.slug}" alt="${a.name} Live Stats"></div></div></section></article>`).join("")}
function refreshProfilesViewImages(){const b=`${Date.now()}-${Math.random()}`;$$(".all-profile-image").forEach(img=>{const a=ACCOUNTS.find(x=>x.slug===img.dataset.slug);if(a)img.src=cardUrl(a,"profile",b)});$$(".all-live-image").forEach(img=>{const a=ACCOUNTS.find(x=>x.slug===img.dataset.slug);if(a)img.src=cardUrl(a,"live",b)})}

function setCheckinDisabled(v){["#checkinButton","#profilesCheckinButton","#sidebarCheckinButton"].forEach(s=>{if($(s))$(s).disabled=v})}
function clean(v){return String(v||"").replace(/\*\*/g,"").replace(/\*/g,"").replace(/✅|❌|☑️|⚠️/g,"").trim()}
function summarize(r){if(!r?.success||!Array.isArray(r.data))return{type:"error",title:"Check-in failed",message:r?.message||"Respons Google Apps Script tidak valid."};const rows=r.data.map(x=>({name:x.accountName||"Unknown",text:clean(x.statusMsg||"Tidak ada status."),error:!!x.isError}));const hasError=rows.some(x=>x.error),allAlready=rows.length&&rows.every(x=>/sudah pernah|already/i.test(x.text)&&!x.error);if(hasError)return{type:"error",title:"Some accounts failed",message:rows.map(x=>`${x.error?"✕":"✓"} ${x.name}: ${x.text}`).join("\n")};if(allAlready)return{type:"info",title:"Already checked in today",message:rows.map(x=>`${x.name}: sudah check-in.`).join("\n")};return{type:"success",title:"Check-in completed",message:rows.map(x=>`${x.name}: ${x.text}`).join("\n")}}
async function runCheckin(){if(state.checkingIn)return;state.checkingIn=true;setCheckinDisabled(true);showToast("info","Check-in processing","Menghubungkan seluruh akun ke layanan attendance Endfield.",3500);try{const r=await fetch(`${WEB_APP_URL}?action=run&t=${Date.now()}`,{redirect:"follow",cache:"no-store"});if(!r.ok)throw new Error(`HTTP ${r.status}`);const s=summarize(await r.json());showToast(s.type,s.title,s.message,8000);setTimeout(()=>refreshAllCards(false),1200)}catch(e){showToast("error","Check-in failed",e?.message||"Tidak dapat terhubung ke Google Apps Script.",8000)}finally{state.checkingIn=false;setCheckinDisabled(false)}}
["#checkinButton","#profilesCheckinButton","#sidebarCheckinButton"].forEach(s=>$(s).addEventListener("click",runCheckin));
["#refreshButton","#profilesRefreshButton","#sidebarRefreshButton"].forEach(s=>$(s).addEventListener("click",()=>refreshAllCards(true)));

function showToast(type,title,message,duration=6000){const t=document.createElement("article"),cls=type==="info"?"":type,icon=type==="success"?"✓":type==="warning"?"!":type==="error"?"✕":"ⓘ";t.className=`toast ${cls}`.trim();t.innerHTML=`<button class="toast-close" aria-label="Tutup">×</button><div class="toast-title"><span>${icon}</span><span>${esc(title)}</span></div><div class="toast-message">${esc(message)}</div><div class="toast-progress" style="animation-duration:${duration}ms"></div>`;$("#toastRegion").appendChild(t);const remove=()=>{t.style.opacity="0";t.style.transform="translateX(12px)";t.style.transition=".18s";setTimeout(()=>t.remove(),180)};t.querySelector(".toast-close").addEventListener("click",remove);setTimeout(remove,duration)}

async function resumeBackgroundVideo(){const v=$("#backgroundVideo");if(!v)return;v.style.display="block";v.style.visibility="visible";v.style.opacity=".11";try{await v.play()}catch{}}
function startAutoRefresh(){if(state.timer)clearInterval(state.timer);state.timer=setInterval(()=>{if(document.visibilityState==="visible"&&sessionStorage.getItem(SESSION_KEY)==="1")refreshAllCards(false)},AUTO_REFRESH_MS)}

async function init(){renderSelectedAccount();renderProfilesView();setView("dashboard");startAutoRefresh();resumeBackgroundVideo();const ok=sessionStorage.getItem(SESSION_KEY)==="1";setAuthorized(ok);if(ok)await refreshAllCards(false);document.addEventListener("visibilitychange",()=>{if(!document.hidden){resumeBackgroundVideo();if(sessionStorage.getItem(SESSION_KEY)==="1")refreshAllCards(false)}});window.addEventListener("focus",resumeBackgroundVideo)}
init();
