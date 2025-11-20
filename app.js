// Train no Punch — v1.1.1 (perf+import UX, no-WU full replace, sets+RPE)
// change: WU（ウォームアップ）機能を全撤去（生成/設定/保存/履歴表示）
// keep  : IDB+LS fallback, CSV/JSON import/export, charts, watchlist, RPE, 複数セット一括投入
// add   : 軽いパフォーマンス小技（idleで解析）、ドラッグ&ドロップ対応のインポートUX
// add   : セッション用ミニカレンダー（DOM描画＆クリックで日付選択）

const DB_NAME = 'trainpunch_v3';
const DB_VER  = 3;
let db;

// ===== tiny DOM helpers =====
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function showToast(msg){
  const t = $('#toast'); if(!t) return;
  t.textContent = String(msg || '');
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1400);
}
window.addEventListener('error', e=>{
  console.warn('[TP] Uncaught:', e?.error || e?.message || e);
  showToast('エラー: ' + (e?.message || '不明'));
});
window.addEventListener('unhandledrejection', e=>{
  console.warn('[TP] UnhandledRejection:', e?.reason);
  const msg = e?.reason?.message || String(e?.reason || '不明');
  showToast('エラー: ' + msg);
});

// --- date / calc ---
const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayStr = () => ymdLocal(new Date());
const esc      = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const e1rm     = (w,r) => Number(w||0) * (1 + (Number(r||0))/30);

// --- misc ---
const debounce = (fn,wait=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),wait); }; };
try{ if('scrollRestoration' in history) history.scrollRestoration = 'manual'; }catch(_){}

// ---- Hard Refresh ----
async function hardRefresh(){
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister().catch(()=>{})));
    }
    if('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k).catch(()=>{})));
    }
  }catch(e){ console.warn(e); }
  location.reload();
}

// ======================================================
// Storage layer: IndexedDB (primary) -> LocalStorage (fallback)
// ======================================================
let USE_LS = false;
const LS_KEY = 'trainpunch_ls';

function _lsLoad(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw){
      const obj = JSON.parse(raw);
      return {
        sessions : Array.isArray(obj.sessions) ? obj.sessions : [],
        sets     : Array.isArray(obj.sets) ? obj.sets : [],
        exercises: Array.isArray(obj.exercises) ? obj.exercises : [],
        prefs    : Array.isArray(obj.prefs) ? obj.prefs : []
      };
    }
  }catch(_){}
  return {sessions:[],sets:[],exercises:[],prefs:[]};
}
function _lsSave(d){ try{ localStorage.setItem(LS_KEY, JSON.stringify(d)); }catch(_){ } }
function _lsNextId(arr){ return (arr.reduce((m,x)=>Math.max(m,Number(x.id)||0),0)+1)||1; }

async function enableLocalStorageFallback(reason){
  USE_LS = true;
  console.warn('[TP] Fallback to LocalStorage:', reason);
  showToast('ローカル保存に切替（IDB不可）');
}

// ---- IndexedDB helpers ----
function openDB(){
  return new Promise((resolve,reject)=>{
    try{
      if(!('indexedDB' in window)) return reject(new Error('IndexedDB unsupported'));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e)=>{
        const d = req.result;
        if(!d.objectStoreNames.contains('exercises')){
          const s = d.createObjectStore('exercises',{keyPath:'id',autoIncrement:true});
          s.createIndex('name','name',{unique:true});
          s.createIndex('by_group','group',{unique:false});
        }else{
          const s = e.target.transaction.objectStore('exercises');
          if(!s.indexNames.contains('name')) s.createIndex('name','name',{unique:true});
          if(!s.indexNames.contains('by_group')) s.createIndex('by_group','group',{unique:false});
        }
        if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions',{keyPath:'id',autoIncrement:true});
        if(!d.objectStoreNames.contains('sets')){
          const s = d.createObjectStore('sets',{keyPath:'id',autoIncrement:true});
          s.createIndex('by_session','session_id',{unique:false});
          s.createIndex('by_date','date',{unique:false});
        }else{
          const s = e.target.transaction.objectStore('sets');
          if(!s.indexNames.contains('by_session')) s.createIndex('by_session','session_id',{unique:false});
          if(!s.indexNames.contains('by_date')) s.createIndex('by_date','date',{unique:false});
        }
        if(!d.objectStoreNames.contains('prefs')) d.createObjectStore('prefs',{keyPath:'key'});
      };
      req.onblocked  = ()=>{ console.warn('[TP] IDB open blocked'); showToast('DB更新待機中… 他のタブを閉じてください'); };
      req.onsuccess  = ()=>{ db=req.result; resolve(db); };
      req.onerror    = ()=>reject(req.error||new Error('open failed'));
    }catch(err){ reject(err); }
  });
}
const tx = (names,mode='readonly') => db.transaction(names,mode);

// ---- API wrappers (with auto-fallback) ----
async function put(store,val){
  if(USE_LS){
    const data=_lsLoad();
    if(store==='prefs'){
      const i=data.prefs.findIndex(p=>p.key===val.key);
      if(i>=0) data.prefs[i]=val; else data.prefs.push(val);
      _lsSave(data); return val.key;
    }
    const arr=data[store]; if(!Array.isArray(arr)) throw new Error('bad store');
    if(val.id==null) val.id=_lsNextId(arr);
    const i=arr.findIndex(x=>Number(x.id)===Number(val.id));
    if(i>=0) arr[i]=val; else arr.push(val);
    _lsSave(data); return val.id;
  }
  return new Promise((res,rej)=>{
    try{
      const r=tx([store],'readwrite').objectStore(store).put(val);
      r.onsuccess=()=>res(r.result);
      r.onerror  =()=>rej(r.error);
    }catch(err){ rej(err); }
  }).catch(async err=>{ await enableLocalStorageFallback(err?.message||err); return put(store,val); });
}
async function del_(store,key){
  if(USE_LS){
    const data=_lsLoad();
    if(store==='prefs'){ const i=data.prefs.findIndex(p=>p.key===key); if(i>=0) data.prefs.splice(i,1); _lsSave(data); return; }
    const arr=data[store]||[]; const idx=arr.findIndex(x=>Number(x.id)===Number(key)); if(idx>=0) arr.splice(idx,1); _lsSave(data); return;
  }
  return new Promise((res,rej)=>{
    try{
      const r=tx([store],'readwrite').objectStore(store).delete(key);
      r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
    }catch(err){ rej(err); }
  }).catch(async err=>{ await enableLocalStorageFallback(err?.message||err); return del_(store,key); });
}
const del = del_;
async function get(store,key){
  if(USE_LS){ const data=_lsLoad(); if(store==='prefs') return data.prefs.find(p=>p.key===key)||undefined; return (data[store]||[]).find(x=>Number(x.id)===Number(key)); }
  return new Promise((res,rej)=>{
    try{ const r=tx([store]).objectStore(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(err){ rej(err); }
  }).catch(async err=>{ await enableLocalStorageFallback(err?.message||err); return get(store,key); });
}
async function getAll(store){
  if(USE_LS){ const data=_lsLoad(); return (data[store]||[]).slice(); }
  return new Promise((res,rej)=>{
    try{ const r=tx([store]).objectStore(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }catch(err){ rej(err); }
  }).catch(async err=>{ await enableLocalStorageFallback(err?.message||err); return getAll(store); });
}

// safe indexGetAll
const indexGetAll=(store,idx,q)=>new Promise(async(res)=>{
  if(USE_LS){
    const data=_lsLoad(); const arr=(data[store]||[]).slice();
    const field=idx==='by_session'?'session_id':idx==='by_date'?'date':null;
    res(field?arr.filter(x=>x[field]===q):arr); return;
  }
  try{
    const os=tx([store]).objectStore(store); const names=os.indexNames;
    const hasIndex= names ? (typeof names.contains==='function'?names.contains(idx):Array.from(names).includes(idx)) : false;
    if(!hasIndex){
      const map={by_session:'session_id',by_date:'date'}; const field=map[idx]||null;
      const r=os.getAll(); r.onsuccess=()=>{ const rows=r.result||[]; res(field?rows.filter(x=>x[field]===q):rows); }; r.onerror=()=>res([]); return;
    }
    const r=os.index(idx).getAll(q); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]);
  }catch(_){ res([]); }
});

// ---- Data preset ----
const PARTS = ['胸','背中','肩','脚','腕'];
const EX_GROUPS = {
  '胸':['ベンチプレス','足上げベンチプレス','スミスマシンベンチプレス','インクラインダンベルプレス','インクラインマシンプレス','スミスマシンインクラインプレス','スミスマシンデクラインプレス','ディップス','ディップス（荷重）','ケーブルクロスオーバー','ペックフライ','チェストプレス'],
  '背中':['デッドリフト','ハーフデッドリフト','懸垂（チンニング）','ラットプルダウン','ラットプルダウン（ナロー）','ラットプルダウン（ちょーナロー）','ワイドラットプルダウン','スミスマシンベントオーバーロウ','ベントオーバーロウ','ローロウ','シーテッドロウ','Tバーロウ'],
  '肩':['ダンベルショルダープレス','スミスマシンショルダープレス','マシンショルダープレス','ケーブルフロントレイズ','サイドレイズ','ベンチサイドレイズ','ケーブルサイドレイズ','ケーブルリアレイズ','リアデルトイド'],
  '脚':['スクワット','バーベルスクワット','バックスクワット','レッグプレス','レッグカール','レッグエクステンション','インナーサイ','ルーマニアンデッドリフト','スティフレッグデッドリフト'],
  '腕':['バーベルカール','インクラインダンベルカール','インクラインダンベルカール（右）','インクラインダンベルカール（左）','ダンベルプリチャーカール（右）','ダンベルプリチャーカール（左）','ハンマーカール','スミスマシンナロープレス','ナロープレス','スカルクラッシャー','フレンチプレス','ケーブルプレスダウン','スミスJMプレス'],
};

// ---- UI state ----
let currentSession = {date:todayStr(),note:'',sets:[]};
let selectedPart='胸', tplSelectedPart='胸';

// NEW: セッション編集カードの表示状態
let sessionEditVisible = false;

// ---- Calendar state (Session tab) ----
let calYear  = null;       // 表示中の年
let calMonth = null;       // 0–11
let calSelectedDate = todayStr(); // 選択中の日付（YYYY-MM-DD）
let _calendarBound = false;

// watchlist
let watchlist=[]; let watchSelectedPart='胸';
let _watchChipsBound=false, _trendEventsBound=false;
const isWatched = id => Array.isArray(watchlist) && watchlist.includes(id);

// ===== NEW: Settings/Exercises chip filter state =====
let partFilterActive = null;           // null=全消し（初期は非表示）
let _partFilterBound  = false;

// undo stack
const undoStack=[];
function pushUndo(){ try{ undoStack.push(JSON.stringify(currentSession.sets)); if(undoStack.length>30) undoStack.shift(); }catch(_){ } }
function doUndo(){
  if(!undoStack.length){ showToast('戻すものがありません'); return; }
  const last=undoStack.pop();
  try{ currentSession.sets=JSON.parse(last)||[]; renderTodaySets(); showToast('戻しました'); }
  catch{ showToast('戻せませんでした'); }
}

// ========= 「導線の開いた感」スタンダード実装 =========
let _pendingSettingsFeel = false;

function prefersReducedMotion(){
  try{ return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(_){ return false; }
}

function activateTab(tab){
  const btn=document.querySelector(`.tabs button[data-tab="${tab}"]`);
  if(btn && !btn.classList.contains('active')) btn.click();
  return !!btn;
}

function openSettingsFeel(){
  const tabEl = $('#tab-settings'); if(!tabEl) return;
  try{
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    tabEl.scrollIntoView({block:'start', behavior});
  }catch(_){ window.scrollTo(0, tabEl.getBoundingClientRect().top + window.pageYOffset); }
  const ringTarget = $('#tab-settings .card') || tabEl;
  if(ringTarget){
    ringTarget.classList.add('flash-ring');
    setTimeout(()=> ringTarget.classList.remove('flash-ring'), 1300);
  }
  showToast('設定を開きました');
  const firstCtl = $('#darkToggle')
                || $('#tab-settings [autofocus]')
                || $('#tab-settings input, #tab-settings select, #tab-settings textarea, #tab-settings button, #tab-settings [href], #tab-settings [tabindex]:not([tabindex="-1"])');
  try{ firstCtl?.focus({preventScroll:true}); }catch(_){ firstCtl?.focus(); }
}

function queueOpenSettingsFeel(){
  requestAnimationFrame(()=>requestAnimationFrame(openSettingsFeel));
}

// =================== Init ===================
async function init(){
  // スクロール中は blur をOFF（body.scrolling付け外し）
  (function(){
    let _t;
    window.addEventListener('scroll',()=>{
      document.body.classList.add('scrolling');
      clearTimeout(_t);
      _t=setTimeout(()=>document.body.classList.remove('scrolling'),150);
    },{passive:true});
  })();

  $('#btnHardRefresh')?.addEventListener('click',async()=>{
    const b=$('#btnHardRefresh'); const old=b.textContent;
    b.disabled=true; b.textContent='更新…'; showToast('最新に更新します…'); await hardRefresh();
    b.textContent=old; b.disabled=false;
  });

  bindTabs();

  // タブアンカー対応
  const activateByTabName = (tab) => activateTab(tab);
  const applyHashTab = () => {
    if(location.hash && location.hash.startsWith('#tab-')){
      const tab = location.hash.slice(5);
      const ok = activateByTabName(tab);
      if(ok && tab==='settings'){ _pendingSettingsFeel = true; queueOpenSettingsFeel(); }
      return ok;
    }
    return false;
  };
  const hashApplied = applyHashTab();
  window.addEventListener('hashchange', applyHashTab);
  document.addEventListener('click', e=>{
    const a=e.target.closest('a[href]'); if(!a) return;
    try{
      const url=new URL(a.getAttribute('href'), location.href);
      if(url.hash === '#tab-settings'){
        _pendingSettingsFeel = true;
        if(activateTab('settings')) queueOpenSettingsFeel();
      }
    }catch(_){}
  }, {capture:true});

  try{ await openDB(); }catch(err){ await enableLocalStorageFallback(err?.message||err); }

  await ensureInitialExercises();

  // prefs (watchlist / theme / last tab)
  try{ watchlist = (await get('prefs','watchlist'))?.value || []; }catch(e){ console.warn(e); }

  const lastTab=(await get('prefs','last_tab'))?.value;
  if(!hashApplied && lastTab){
    const ok = activateTab(lastTab);
    if(ok && lastTab==='settings' && _pendingSettingsFeel){ queueOpenSettingsFeel(); }
  }

  // 念のためタイマーUIが残っていたら消す
  $('#btnTimer')?.remove();

  if($('#sessDate')) $('#sessDate').value=todayStr();

  bindSessionUI();

  // ★ 起動直後はセッション編集カードを隠す（Googleカレンダー風）
  setSessionEditVisible(false);

  initSessionCalendar();   // ★ カレンダー初期化

  bindCustomInsertUI();
  renderTplPartChips();
  await renderTplExSelect();

  bindHistoryUI();
  bindSettingsUI();
  await renderWatchUI();
  await renderTrendSelect();

  renderPartChips();
  await renderExSelect();
  renderTodaySets();
  renderHistory();
  renderAnalytics(); // idleタイミングで解析（小技）
  await renderExList();
  renderPartFilterChips();

  const dark=(await get('prefs','dark'))?.value || false;
  $('#darkToggle')?.setAttribute('checked', dark ? 'checked' : '');
  document.documentElement.dataset.theme= dark ? 'dark' : 'light';

  await renderWeeklySummary();
}

async function ensureInitialExercises(){
  const all=await getAll('exercises');
  if(all && all.length){
    const byName=Object.fromEntries(all.map(e=>[e.name,e]));
    for(const p of PARTS){
      for(const name of EX_GROUPS[p]){
        const hit=byName[name];
        if(hit && !hit.group) await put('exercises',{...hit,group:p});
      }
    }
    return;
  }
  for(const p of PARTS){ for(const name of EX_GROUPS[p]) await put('exercises',{name,group:p}); }
}

// =================== Tabs ===================
function bindTabs(){
  $$('.tabs button').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      $$('.tabs button').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      const tab=btn.dataset.tab;
      $$('.tab').forEach(s=>s.classList.remove('active'));
      $('#tab-'+tab)?.classList.add('active');
      put('prefs',{key:'last_tab',value:tab}).catch(()=>{});
      if(tab==='history') renderHistory();
      if(tab==='analytics') renderAnalytics();
      if(tab==='settings'){
        await renderExList(); renderPartFilterChips(); renderWatchUI();
        if(_pendingSettingsFeel){ _pendingSettingsFeel=false; queueOpenSettingsFeel(); }
      }
    });
  });
}

// =================== Session ===================
function renderPartChips(){ $$('#partChips .chip').forEach(ch=>{ ch.classList.toggle('active', ch.dataset.part===selectedPart); }); }

// NEW: セッション編集カードの表示/非表示
function setSessionEditVisible(visible){
  const card = $('#sessionEditCard');
  if(!card) return;
  sessionEditVisible = !!visible;
  card.style.display = visible ? '' : 'none';
}

function bindSessionUI(){
  const chips=$('#partChips');
  if(chips){
    chips.addEventListener('click',async e=>{
      const b=e.target.closest('.chip'); if(!b) return;
      selectedPart=b.dataset.part; renderPartChips(); await renderExSelect();
      $('#weight').value=''; $('#reps').value=''; $('#sets').value=''; $('#rpe') && ($('#rpe').value='');
    });
  }

  // 日付入力の手動変更 → カレンダー＆currentSessionに反映（スクロールはしない）
  const dateInput = $('#sessDate');
  if(dateInput && !dateInput._boundCalendar){
    dateInput.addEventListener('change',()=>{
      const val = dateInput.value || todayStr();
      onSessionDateSelected(val,{noScroll:true});
    });
    dateInput._boundCalendar = true;
  }

  // スマート入力（weight/reps/sets/@rpe）
  ['weight','reps','sets','rpe'].forEach(id=>{
    const el=$('#'+id);
    el?.addEventListener('input',handleSmartInput,{passive:true});
    el?.addEventListener('change',handleSmartInput);
    el?.addEventListener('paste',()=>setTimeout(handleSmartInput,0));
  });
  // Enterで追加
  $('#sets')?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnAddSet')?.click(); } });
  $('#rpe') ?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnAddSet')?.click(); } });

  $('#btnAddSet')?.addEventListener('click',async()=>{
    const exId=Number($('#exSelect').value);
    const weight=Number($('#weight').value);
    const reps=Number($('#reps').value);
    let setsN=Number($('#sets').value||'1');
    const rpeValRaw=$('#rpe')?.value?.trim();
    const rpeVal=(rpeValRaw===''||rpeValRaw==null)?null:Number(rpeValRaw);
    if(!Number.isFinite(setsN) || setsN<=0) setsN=1;

    if(!exId||!weight||!reps){ showToast('種目・重量・回数は必須です'); return; }

    let willPR=false;
    if(isWatched(exId)){
      const curE1=e1rm(weight,reps);
      const hist=(await getAll('sets')).filter(s=>s.exercise_id===exId && !s.wu);
      const histBest=Math.max(0,...hist.map(s=>e1rm(s.weight,s.reps)));
      const sessBest=Math.max(0,...currentSession.sets.filter(s=>s.exercise_id===exId).map(s=>e1rm(s.weight,s.reps)));
      const bestSoFar=Math.max(histBest,sessBest);
      willPR=curE1>bestSoFar;
    }

    pushUndo();
    const date=$('#sessDate').value; const now=Date.now();
    for(let i=0;i<setsN;i++){
      currentSession.sets.push({ temp_id:(crypto?.randomUUID?.()||now+'_'+Math.random().toString(16).slice(2)+'_'+i), exercise_id:exId, weight, reps, rpe:(Number.isFinite(rpeVal)?rpeVal:null), ts:now+i, date });
    }

    if(willPR){ showToast('e1RM更新！（ウォッチ）'); if('vibrate' in navigator) navigator.vibrate([60,40,60]); }

    $('#weight').value=''; $('#reps').value=''; $('#sets').value=''; $('#rpe') && ($('#rpe').value='');
    renderTodaySets();
  });

  $('#btnUndo')?.addEventListener('click',doUndo);

  $('#btnSaveSession')?.addEventListener('click',async()=>{
    if(!currentSession.sets.length){ showToast('セットがありません'); return; }
    const date=$('#sessDate').value; const note=$('#sessNote').value;
    pushUndo();
    const sessionId=await put('sessions',{date,note,created_at:Date.now()});
    for(const s of currentSession.sets){
      await put('sets',{session_id:sessionId,exercise_id:s.exercise_id,weight:s.weight,reps:s.reps,rpe:s.rpe,ts:s.ts,date});
    }
    currentSession={date:todayStr(),note:'',sets:[]};
    $('#sessDate').value=todayStr(); $('#sessNote').value='';
    calSelectedDate = $('#sessDate').value || todayStr();
    renderTodaySets();
    renderHistory();
    renderAnalytics();
    await renderWeeklySummary();
    await renderSessionCalendar();
    showToast('セッションを保存しました');
  });

  $('#btnTplCustom')?.addEventListener('click',applyCustomInsert);

  $('#exSelect')?.addEventListener('change',async()=>{
    const exId=Number($('#exSelect').value);
    if(!exId){ $('#weight').value=''; $('#reps').value=''; $('#sets').value=''; $('#rpe') && ($('#rpe').value=''); return; }
    const sets=(await getAll('sets')).filter(s=>s.exercise_id===exId && !s.wu).sort((a,b)=>b.ts-a.ts);
    if(sets[0]){ $('#weight').value=sets[0].weight; $('#reps').value=sets[0].reps; $('#sets').value=''; $('#rpe') && ($('#rpe').value=''); }
    else { $('#weight').value=''; $('#reps').value=''; $('#sets').value=''; $('#rpe') && ($('#rpe').value=''); }
  });
}

// ===== セッションカレンダー（Session Tab） =====
function initSessionCalendar(){
  const input = $('#sessDate');
  const base = (input && input.value) || todayStr();
  calSelectedDate = base;
  const d = new Date(base);
  if(!Number.isNaN(d.getTime())){
    calYear  = d.getFullYear();
    calMonth = d.getMonth();
  }else{
    const now = new Date();
    calYear  = now.getFullYear();
    calMonth = now.getMonth();
  }
  bindCalendarUI();
  renderSessionCalendar();
}

// options: {noScroll?:boolean}
function onSessionDateSelected(dateStr,options={}){
  if(!dateStr) dateStr = todayStr();
  calSelectedDate = dateStr;
  const d = new Date(dateStr);
  if(!Number.isNaN(d.getTime())){
    calYear  = d.getFullYear();
    calMonth = d.getMonth();
  }
  currentSession.date = dateStr;
  currentSession.sets.forEach(s => { s.date = dateStr; });
  const input = $('#sessDate');
  if(input && input.value !== dateStr) input.value = dateStr;

  // 日付を選択したタイミングでセッション編集カードを表示
  setSessionEditVisible(true);

  renderSessionCalendar();

  if(!options.noScroll){
    scrollToSessionEdit();
  }
}

function bindCalendarUI(){
  if(_calendarBound) return;
  const prev = $('#calPrevMonth');
  const next = $('#calNextMonth');
  const grid = $('#calGrid');

  function ensureMonthBase(){
    if(calYear != null && calMonth != null) return;
    const base = calSelectedDate || $('#sessDate')?.value || todayStr();
    const d = new Date(base);
    if(!Number.isNaN(d.getTime())){
      calYear  = d.getFullYear();
      calMonth = d.getMonth();
    }else{
      const now = new Date();
      calYear  = now.getFullYear();
      calMonth = now.getMonth();
    }
  }

  if(prev){
    prev.addEventListener('click',()=>{
      ensureMonthBase();
      calMonth--;
      if(calMonth < 0){ calMonth = 11; calYear--; }
      renderSessionCalendar();
    });
  }
  if(next){
    next.addEventListener('click',()=>{
      ensureMonthBase();
      calMonth++;
      if(calMonth > 11){ calMonth = 0; calYear++; }
      renderSessionCalendar();
    });
  }
  if(grid){
    grid.addEventListener('click',e=>{
      const cell = e.target.closest('.cal-cell[data-date]');
      if(!cell) return;
      const dateStr = cell.dataset.date;
      onSessionDateSelected(dateStr);   // ここで表示＋スクロール
    });
  }

  _calendarBound = true;
}

async function renderSessionCalendar(){
  const grid  = $('#calGrid');
  const label = $('#calMonthLabel');
  if(!grid || !label) return;

  let year  = calYear;
  let month = calMonth;

  if(year == null || month == null){
    const base = calSelectedDate || $('#sessDate')?.value || todayStr();
    const d = new Date(base);
    if(!Number.isNaN(d.getTime())){
      year  = d.getFullYear();
      month = d.getMonth();
    }else{
      const now = new Date();
      year  = now.getFullYear();
      month = now.getMonth();
    }
    calYear  = year;
    calMonth = month;
  }

  // ここでさらにガード：数値でなければ今日にフォールバック
  if(!Number.isFinite(year) || !Number.isFinite(month)){
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth();
    calYear = year;
    calMonth = month;
  }

  const first = new Date(year, month, 1);
  if(Number.isNaN(first.getTime())){
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth();
  }

  const firstFixed = new Date(year, month, 1);
  const firstDow   = firstFixed.getDay(); // 0(日)〜6(土)
  let daysInMonth  = new Date(year, month+1, 0).getDate();
  if(!Number.isFinite(daysInMonth) || daysInMonth <= 0) daysInMonth = 31;

  label.textContent = `${year}年${String(month+1).padStart(2,'0')}月`;

  const sessions = await getAll('sessions');
  const datesWithSession = new Set((sessions||[]).map(s=>s.date));

  const today = todayStr();
  const sel   = calSelectedDate || $('#sessDate')?.value || today;

  const cells = [];
  for(let i=0;i<firstDow;i++){
    cells.push('<div class="cal-cell cal-empty" aria-hidden="true"></div>');
  }
  for(let dNum=1; dNum<=daysInMonth; dNum++){
    const dateObj = new Date(year, month, dNum);
    const dateStr = ymdLocal(dateObj);
    const isToday = (dateStr === today);
    const isSel   = (dateStr === sel);
    const has     = datesWithSession.has(dateStr);
    const cls = ['cal-cell'];
    if(isToday) cls.push('is-today');
    if(isSel)   cls.push('is-selected');
    if(has)     cls.push('has-session');
    cells.push(
      `<div class="${cls.join(' ')}" data-date="${dateStr}" role="button" aria-label="${dateStr}">
        <span class="cal-date">${dNum}</span>
        ${has?'<span class="cal-dot"></span>':''}
      </div>`
    );
  }
  grid.innerHTML = cells.join('');

  console.log('[TP] renderSessionCalendar', {year,month,firstDow,daysInMonth});
}

function scrollToSessionEdit(){
  const card = $('#sessionEditCard');
  if(!card || !sessionEditVisible) return;
  try{
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    card.scrollIntoView({behavior, block:'start'});
  }catch(_){
    const rect = card.getBoundingClientRect();
    window.scrollTo(0, rect.top + window.pageYOffset - 12);
  }
}

// smart input（40x8x3@8 / 40*8*3@7.5 / 40x8 / 40*8）
function parseSmart(s){
  if(!s||typeof s!=='string') return null;
  const str=s.trim().replace(/＊/g,'*').replace(/×/g,'x').toLowerCase();
  const m=str.match(/^(\d+(?:\.\d+)?)\s*[x\*]\s*(\d+)(?:\s*[x\*]\s*(\d+))?(?:\s*@\s*(\d+(?:\.\d+)?))?$/);
  if(!m) return null;
  return {w:Number(m[1]), r:Number(m[2]), s:m[3]!==undefined?Number(m[3]):null, rp:m[4]!==undefined?Number(m[4]):null};
}
function handleSmartInput(e){
  const v=e?.target?.value ?? ''; const parsed=parseSmart(v); if(!parsed) return;
  $('#weight').value=String(parsed.w); $('#reps').value=String(parsed.r);
  if(parsed.s!=null) $('#sets').value=String(parsed.s);
  if(parsed.rp!=null && $('#rpe')) $('#rpe').value=String(parsed.rp);
  showToast('スマート入力を適用');
}

// ======== Custom insert ========
function renderTplPartChips(){ $$('#tplPartChips .chip').forEach(ch=>{ ch.classList.toggle('active',ch.dataset.part===tplSelectedPart); }); }
function bindCustomInsertUI(){
  const chips=$('#tplPartChips'); if(!chips) return;
  chips.addEventListener('click',async e=>{
    const b=e.target.closest('.chip'); if(!b) return;
    tplSelectedPart=b.dataset.part; renderTplPartChips(); await renderTplExSelect();
  });
}
async function renderTplExSelect(){
  const sel=$('#tplExCustom'); if(!sel) return;
  let exs=await getAll('exercises'); exs=exs.filter(e=>e.group===tplSelectedPart).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  sel.innerHTML=`<option value="">（選択する）</option>`+(exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')||'<option>オプションなし</option>');
  sel.value='';
}
async function renderExSelect(){
  let exs=await getAll('exercises'); exs=exs.filter(e=>e.group===selectedPart).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  const sel=$('#exSelect'); if(sel){
    const prev=sel.value||'';
    sel.innerHTML=`<option value="">（選択する）</option>`+(exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')||'<option>オプションなし</option>');
    if(prev && exs.some(e=>String(e.id)===prev)) sel.value=prev; else sel.value='';
  }
}

// today list
function renderTodaySets(){
  const ul=$('#todaySets'); if(!ul) return;
  if(!currentSession.sets.length){ ul.innerHTML='<li>まだありません</li>'; return; }
  ul.innerHTML=currentSession.sets.map(s=>{
    const rpe=(typeof s.rpe==='number' && !Number.isNaN(s.rpe))?` RPE${s.rpe}`:'';
    return `<li>
      <span><strong>${esc(exNameById(s.exercise_id))}</strong> ${s.weight}kg × ${s.reps}${rpe}</span>
      <span style="display:flex; gap:6px">
        <button class="ghost" data-act="edit" data-id="${s.temp_id}">編集</button>
        <button class="ghost" data-act="del"  data-id="${s.temp_id}">削除</button>
      </span>
    </li>`;
  }).join('');
  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click',async()=>{
      const id=b.dataset.id, act=b.dataset.act;
      const item=currentSession.sets.find(x=>x.temp_id===id); if(!item) return;
      if(act==='del'){ pushUndo(); currentSession.sets=currentSession.sets.filter(x=>x.temp_id!==id); renderTodaySets(); }
      if(act==='edit'){
        pushUndo(); currentSession.sets=currentSession.sets.filter(x=>x.temp_id!==id); renderTodaySets();
        const ex=(await getAll('exercises')).find(e=>e.id===item.exercise_id);
        if(ex && ex.group && ex.group!==selectedPart){ selectedPart=ex.group; renderPartChips(); await renderExSelect(); }
        $('#exSelect').value=String(item.exercise_id); $('#weight').value=String(item.weight); $('#reps').value=String(item.reps); $('#sets').value='1';
        if($('#rpe')) $('#rpe').value=(item.rpe!=null?String(item.rpe):'');
        showToast('編集用に読み込みました'); window.scrollTo({top:0,behavior:'smooth'});
      }
    });
  });
}
function exNameById(id){
  const opt=$('#exSelect')?.querySelector(`option[value="${id}"]`)||$('#tplExCustom')?.querySelector(`option[value="${id}"]`);
  return opt?opt.textContent:'種目';
}
async function applyCustomInsert(){
  const n=Number($('#tplCustomSets').value||'5');
  const r=Number($('#tplCustomReps').value||'5');
  const w=Number($('#tplCustomWeight').value||'0');
  const exId=Number($('#tplExCustom').value);
  if(!exId){ showToast('種目を選んでください'); return; }
  const date=$('#sessDate').value || todayStr(); const now=Date.now();
  pushUndo();
  for(let i=0;i<n;i++) currentSession.sets.push({ temp_id:(crypto?.randomUUID?.()||now+'_'+i), exercise_id:exId, weight:w, reps:r, rpe:null, ts:now+i, date });
  renderTodaySets(); showToast('カスタム投入しました');
}

// =================== History ===================
function bindHistoryUI(){
  $('#historyCount')?.addEventListener('change',renderHistory);
  $('#btnExport')?.addEventListener('click',exportCSV);

  const fileInput = $('#importFile');
  if(fileInput && !fileInput._bound){
    fileInput.addEventListener('change',importCSV);
    fileInput._bound = true;
  }

  // インポート用ドラッグ＆ドロップUX
  const drop = $('#importDrop');
  if(drop && !drop._bound){
    const prevent = ev => { ev.preventDefault(); ev.stopPropagation(); };

    drop.addEventListener('click',()=>{
      if(fileInput) fileInput.click();
    });

    ['dragenter','dragover'].forEach(type=>{
      drop.addEventListener(type,ev=>{
        prevent(ev);
        drop.classList.add('is-dragover');
        setImportStatus(null,'ファイルをドロップ',null);
      });
    });
    ['dragleave','dragend'].forEach(type=>{
      drop.addEventListener(type,ev=>{
        prevent(ev);
        drop.classList.remove('is-dragover');
        setImportStatus(null,'待機中',null);
      });
    });
    drop.addEventListener('drop',async ev=>{
      prevent(ev);
      drop.classList.remove('is-dragover');
      const files = ev.dataTransfer && ev.dataTransfer.files;
      if(!files || !files.length){
        setImportStatus('err','ファイルが見つかりません',null);
        showToast('ファイルが見つかりません');
        return;
      }
      const file = files[0];
      setImportStatus(null,'読み込み中…',file.name);
      try{
        await importCSVFromFile(file);
        setImportStatus('ok','インポート完了',file.name);
        showToast('インポート完了');
      }catch(err){
        console.error(err);
        setImportStatus('err','読み込みに失敗しました',file.name);
        showToast('インポート失敗: '+(err?.message||'不明なエラー'));
      }
    },false);

    drop._bound = true;
  }
}
function buildSessionDetailsHTML(sets,nameById){
  const rows = (sets||[]).filter(x=>!x.wu);
  if(!rows.length) return '<div class="small" style="margin-top:8px">セットがありません。</div>';
  const byEx=new Map();
  for(const s of rows){ if(!byEx.has(s.exercise_id)) byEx.set(s.exercise_id,[]); byEx.get(s.exercise_id).push(s); }
  const blocks=[...byEx.entries()]
    .sort((a,b)=>String(nameById[a[0]]||'').localeCompare(nameById[b[0]]||'','ja'))
    .map(([exId,arr])=>{
      arr.sort((a,b)=>a.ts-b.ts);
      const exName=nameById[exId]||`種目(${exId})`;
      const vol=arr.reduce((sum,x)=>sum+(Number(x.weight)||0)*(Number(x.reps)||0),0);
      const list=arr.map(x=>{
        const rpe=(typeof x.rpe==='number'&&!Number.isNaN(x.rpe))?`@${x.rpe}`:'';
        return `${x.weight}kg×${x.reps}${rpe}`;
      }).join('、 ');
      return `
        <div style="margin:8px 0; padding:8px; border:1px dashed ${'var(--line)'}; border-radius:10px">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <strong>${esc(exName)}</strong>
            <span class="badge">${arr.length}セット</span>
            <span class="badge">${Math.round(vol)}kg</span>
          </div>
          <div class="small" style="margin-top:6px; overflow-wrap:anywhere">${list}</div>
        </div>`;
    }).join('');
  return `<div style="margin-top:8px">${blocks}</div>`;
}
async function renderHistory(){
  const count=Number($('#historyCount')?.value||20);
  const sessions=(await getAll('sessions')).map(s=>{
    let created=(s && s.created_at!=null)?s.created_at:new Date(s.date).getTime();
    if(!Number.isFinite(created)) created=0;
    return {...s,created_at:created};
  }).sort((a,b)=>b.created_at-a.created_at).slice(0,count);

  const ul=$('#historyList'); if(!ul) return;
  ul.innerHTML='';
  const allEx=await getAll('exercises'); const nameById=Object.fromEntries(allEx.map(e=>[e.id,e.name])); ul._nameById=nameById;

  for(const s of sessions){
    const allSets=await indexGetAll('sets','by_session',s.id);
    const setsNoWU = allSets.filter(x=>!x.wu);
    const vol=setsNoWU.reduce((sum,x)=>sum+(Number(x.weight)||0)*(Number(x.reps)||0),0);
    const est=setsNoWU.length?Math.max(...setsNoWU.map(x=>e1rm(x.weight,x.reps))):0;
    const li=document.createElement('li');
    li.innerHTML=`
      <div>
        <strong>${s.date}</strong>
        <span class="badge">${Math.round(vol)}kg</span>
        <span class="badge">1RM推定:${Math.round(est)}kg</span>
        ${s.note?`<div class="small" style="margin-top:4px;color:var(--muted)">${esc(s.note)}</div>`:''}
      </div>
      <div style="display:flex; gap:6px">
        <button class="ghost" data-act="detail" data-id="${s.id}">詳細</button>
        <button class="ghost" data-act="note"   data-id="${s.id}">メモ</button>
        <button class="danger" data-act="del"   data-id="${s.id}">削除</button>
      </div>
      <div class="details" hidden></div>`;
    li._sets=setsNoWU; ul.appendChild(li);
  }
  if(!sessions.length) ul.innerHTML='<li>まだありません</li>';

  if(!ul._bound){
    ul.addEventListener('click',async e=>{
      const b=e.target.closest('button'); if(!b) return;
      const id=Number(b.dataset.id), act=b.dataset.act; const li=b.closest('li');
      if(act==='del'){ if(confirm('このセッションを削除しますか？')) await deleteSession(id); renderHistory(); }
      if(act==='note'){ await editSessionNote(id); renderHistory(); }
      if(act==='detail'){
        const box=li.querySelector('.details');
        if(box.hidden || !box._loaded){ box.innerHTML=buildSessionDetailsHTML(li._sets||[], ul._nameById||{}); box._loaded=true; box.hidden=false; }
        else box.hidden=true;
      }
    });
    ul._bound=true;
  }
}

// =================== Analytics ===================
function _resizeCanvas(canvas,targetHeight=260){
  const dpr=Math.max(1,window.devicePixelRatio||1);
  const rect=canvas.getBoundingClientRect(); const w=Math.max(200,Math.floor(rect.width)); const h=targetHeight;
  if(canvas.width!==w*dpr||canvas.height!==h*dpr){
    canvas.width=w*dpr; canvas.height=h*dpr; canvas.style.height=h+'px';
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  }
}
function _lastNDays(n){
  const base=new Date(); base.setHours(0,0,0,0);
  const days=[]; for(let i=n-1;i>=0;i--){ const d=new Date(base); d.setDate(base.getDate()-i); days.push({key:ymdLocal(d),label:`${d.getMonth()+1}/${d.getDate()}`}); }
  return days;
}
function _niceRange(min,max,ticksDesired=5){
  if(!isFinite(min)||!isFinite(max)) return {niceMin:0,niceMax:1,step:1};
  if(min===max){ const p=Math.max(1,Math.pow(10,Math.floor(Math.log10(Math.abs(max)||1)))); return {niceMin:Math.floor((min-p)/p)*p,niceMax:Math.ceil((max+p)/p)*p,step:p}; }
  const span=max-min; const raw=span/Math.max(2,ticksDesired); const mag=Math.pow(10,Math.floor(Math.log10(raw))); const norm=raw/mag;
  let step=(norm<=1)?1*mag:(norm<=2)?2*mag:(norm<=5)?5*mag:10*mag;
  const niceMin=Math.floor(min/step)*step; const niceMax=Math.ceil(max/step)*step; return {niceMin,niceMax,step};
}
// --- Bar ---
function _drawBarChart(canvas,days,totals,hoverIndex=-1){
  _resizeCanvas(canvas,260);
  const ctx=canvas.getContext('2d'); const W=canvas.getBoundingClientRect().width, H=260;
  const T=26,R=12,B=30;
  const maxV=Math.max(1,...totals); const {niceMin,niceMax,step}= _niceRange(0,maxV*1.08,5);
  const yFor=v=>(H-B)-((v-niceMin)/(niceMax-niceMin))*(H-B-T);

  ctx.font='12px system-ui';
  const yLabels=[]; for(let v=niceMin; v<=niceMax+1e-9; v+=step) yLabels.push(v);
  const widest=Math.max(...yLabels.map(v=>ctx.measureText(String(Math.round(v))).width));
  const L=Math.max(42,Math.ceil(widest)+14);

  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='#9993'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
  ctx.strokeStyle='#9992'; ctx.fillStyle='#9aa4b2'; ctx.textAlign='right'; ctx.textBaseline='middle';
  for(const v of yLabels){ const y=yFor(v); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-R,y); ctx.stroke(); ctx.fillText(String(Math.round(v)),L-6,y); }

  ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.font='12px system-ui';
  const innerW=W-L-R, stepX=innerW/days.length;
  for(let i=0;i<days.length;i++){ const x=L+i*stepX+stepX/2; ctx.fillStyle='#9aa4b2'; ctx.fillText(days[i].label,x,H-8); }

  if(totals.every(v=>v<=0)){
    ctx.fillStyle='#9aa4b2'; ctx.textAlign='center'; ctx.font='14px system-ui';
    ctx.fillText('まだデータがありません。セットを追加すると表示されます。', W/2, (H-B+T)/2);
    canvas._chartDims={L,step:stepX,barW:Math.min(32,stepX*0.58),W,H,T,B,max:niceMax}; canvas._days=days; canvas._totals=totals; return;
  }

  const barW=Math.min(32,stepX*0.58);
  for(let i=0;i<totals.length;i++){
    const v=totals[i]; const xC=L+i*stepX+stepX/2; const h=((v-niceMin)/(niceMax-niceMin))*(H-B-T); const x=xC-barW/2; const y=(H-B)-h;
    ctx.fillStyle=(i===hoverIndex)?'#0fb6a9':'#6cc7bf'; ctx.fillRect(Math.round(x)+0.5,Math.round(y),Math.round(barW),Math.round(h));
    if(v>0){ const yLabel=Math.max(T+12,y-6); ctx.fillStyle='#4a5568'; ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.fillText(String(Math.round(v)),xC,yLabel); }
  }
  canvas._chartDims={L,step:stepX,barW,W,H,T,B,max:niceMax}; canvas._days=days; canvas._totals=totals;
}
// --- Line ---
function _drawLineChart(canvas,labels,values,hoverIndex=-1){
  _resizeCanvas(canvas,260);
  const ctx=canvas.getContext('2d'); const W=canvas.getBoundingClientRect().width, H=260;
  const T=26,R=12,B=30; ctx.clearRect(0,0,W,H);
  if(values.length===0){
    const L=56; ctx.strokeStyle='#9993'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
    ctx.fillStyle='#9aa4b2'; ctx.textAlign='center'; ctx.font='14px system-ui';
    ctx.fillText('まだデータがありません。', W/2, (H-B+T)/2);
    canvas._trendDims={L,step:1,W,H,T,B,minV:0,maxV:1}; canvas._labels=labels; canvas._values=values; return;
  }
  const minV0=Math.min(...values), maxV0=Math.max(...values); const pad=Math.max(1,(maxV0-minV0)*0.10);
  const {niceMin,niceMax,step}= _niceRange(Math.max(0,minV0-pad),maxV0+pad,5);
  ctx.font='12px system-ui';
  const tickVals=[]; for(let v=niceMin; v<=niceMax+1e-9; v+=step) tickVals.push(v);
  const widest=Math.max(...tickVals.map(v=>ctx.measureText(String(Math.round(v))).width));
  const L=Math.max(56,Math.ceil(widest)+16);
  const innerW=W-L-R; const stepX=(labels.length<=1)?innerW:innerW/(labels.length-1);
  const yFor=v=>(H-B)-((v-niceMin)/(niceMax-niceMin))*(H-B-T);

  ctx.strokeStyle='#9993'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
  ctx.strokeStyle='#9992'; ctx.fillStyle='#9aa4b2'; ctx.textAlign='right'; ctx.textBaseline='middle';
  for(const v of tickVals){ const y=yFor(v); ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-R,y); ctx.stroke(); ctx.fillText(String(Math.round(v)),L-6,y); }

  ctx.textAlign='center'; ctx.textBaseline='alphabetic';
  const tickN=Math.min(6,labels.length);
  for(let i=0;i<labels.length;i++){
    if(i===0||i===labels.length-1||i%Math.ceil(labels.length/(tickN||1))===0){
      const x=L+i*stepX; ctx.fillStyle='#9aa4b2'; ctx.fillText(labels[i],x,H-8);
    }
  }

  ctx.strokeStyle='#0fb6a9'; ctx.lineWidth=2; ctx.beginPath();
  for(let i=0;i<values.length;i++){ const x=L+i*stepX, y=yFor(values[i]); (i?ctx.lineTo(x,y):ctx.moveTo(x,y)); }
  ctx.stroke();

  for(let i=0;i<values.length;i++){
    const x=L+i*stepX, y=yFor(values[i]);
    ctx.fillStyle=(i===hoverIndex)?'#0fb6a9':'#6cc7bf';
    ctx.beginPath(); ctx.arc(x,y,3.2,0,Math.PI*2); ctx.fill();
    if(i===hoverIndex){
      const tip=`${labels[i]}  ${Math.round(values[i])} kg`;
      const tw=ctx.measureText(tip).width+10, th=22;
      const tx=Math.min(W-R-tw,Math.max(L,x-tw/2));
      const ty=Math.max(T+6,Math.min(H-B-th-4,y-10-th));
      ctx.fillStyle='#0fb6a9'; ctx.fillRect(tx,ty,tw,th);
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='12px system-ui';
      ctx.fillText(tip,tx+tw/2,ty+th/2);
    }
  }
  canvas._trendDims={L,step:stepX,W,H,T,B,minV:niceMin,maxV:niceMax}; canvas._labels=labels; canvas._values=values;
}

let _chartEventsBound=false;
let _analyticsIdleHandle=null;

// パフォーマンス小技：解析は idle/短いtimeout にまとめて実行
async function renderAnalytics(immediate=false){
  if(immediate){
    if(_analyticsIdleHandle!=null){
      if('cancelIdleCallback' in window) cancelIdleCallback(_analyticsIdleHandle);
      else clearTimeout(_analyticsIdleHandle);
      _analyticsIdleHandle=null;
    }
    return _renderAnalyticsImpl();
  }
  if(_analyticsIdleHandle!=null) return;
  const runner = ()=>{ _analyticsIdleHandle=null; _renderAnalyticsImpl(); };
  if('requestIdleCallback' in window){
    _analyticsIdleHandle = requestIdleCallback(runner,{timeout:500});
  }else{
    _analyticsIdleHandle = setTimeout(runner,120);
  }
}

async function _renderAnalyticsImpl(){
  const canvas=$('#chart'); if(canvas){
    const allSets = await getAll('sets');
    const sets = allSets.filter(s => !s.wu);

    const days=_lastNDays(7);
    const totals=days.map(d=>sets
      .filter(s=>s.date===d.key)
      .reduce((sum,x)=>sum+(Number(x.weight)||0)*(Number(x.reps)||0),0)
    );
    _drawBarChart(canvas,days,totals,-1);
    if(!_chartEventsBound){
      const pickIndex=(evt)=>{ const r=canvas.getBoundingClientRect(); const x=(evt.touches?evt.touches[0].clientX:evt.clientX)-r.left; const dims=canvas._chartDims||{L:0,step:1}; const i=Math.floor((x-dims.L)/dims.step); return (i>=0 && i<(canvas._days?.length||0))?i:-1; };
      const redraw=(i=-1)=>_drawBarChart(canvas,canvas._days||[],canvas._totals||[],i);
      const onResize=debounce(()=>redraw(-1),120);
      canvas.addEventListener('mousemove',e=>redraw(pickIndex(e)));
      canvas.addEventListener('mouseleave',()=>redraw(-1));
      canvas.addEventListener('touchstart',e=>redraw(pickIndex(e)),{passive:true});
      canvas.addEventListener('touchmove', e=>redraw(pickIndex(e)),{passive:true});
      window.addEventListener('resize',onResize);
      _chartEventsBound=true;
    }
    const recentKeys=new Set(days.map(d=>d.key));
    const recentSets=sets.filter(s=>recentKeys.has(s.date));
    const total7=totals.reduce((a,b)=>a+b,0);
    const uniqEx=new Set(recentSets.map(s=>s.exercise_id)).size;
    const m=$('#metrics'); if(m) m.innerHTML=`<div>直近7日ボリューム</div><div>${Math.round(total7)} kg</div><div>種目数</div><div>${uniqEx} 種目</div>`;
    const legend=$('#legend'); if(legend) legend.innerHTML='';
  }
  await renderTrendSelect(); await renderTrendChart(); await renderWeeklySummary();
}

// === Trend helpers ===
async function renderTrendSelect(){
  const sel=$('#exTrendSelect'); if(!sel) return;
  const hint=$('#trendHint');
  const allEx=await getAll('exercises'); const nameById=Object.fromEntries(allEx.map(e=>[e.id,e.name]));
  if(!watchlist.length){
    sel.innerHTML=`<option value="">設定 → ウォッチ種目で追加してください</option>`;
    if(hint) hint.textContent='設定タブの「ウォッチ種目」で追加すると、ここで選べます。';
    return;
  }
  sel.innerHTML=watchlist.filter(id=>nameById[id]).map(id=>`<option value="${id}">${esc(nameById[id])}</option>`).join('');
  if(hint) hint.textContent='';
  if(!sel.value) sel.value=String(watchlist[0]);
  if(!sel._bound){ sel.addEventListener('change',renderTrendChart); $('#trendRange')?.addEventListener('change',renderTrendChart); sel._bound=true; }
}
async function renderTrendChart(){
  const canvas=$('#trendChart'); if(!canvas) return;
  const sel=$('#exTrendSelect'); const rangeSel=$('#trendRange');
  const exId=Number(sel?.value||0);
  const range=(rangeSel?.value||'10');

  const info=$('#trendInfo');
  if(!exId){ _drawLineChart(canvas,[],[]); if(info) info.innerHTML=''; return; }

  const setsAll=await getAll('sets');
  const rows=setsAll.filter(s=>s.exercise_id===exId && !s.wu);

  const byDate={};
  rows.forEach(s=>{ const v=e1rm(s.weight,s.reps); if(!byDate[s.date]||v>byDate[s.date]) byDate[s.date]=v; });
  const points=Object.entries(byDate).map(([date,v])=>({date,v,ts:new Date(date).getTime()})).sort((a,b)=>a.ts-b.ts);

  let data=points;
  if(range!=='all'){ const n=Number(range)||10; data=points.slice(-n); }

  const labels=data.map(p=>{ const d=new Date(p.ts); return `${d.getMonth()+1}/${d.getDate()}`; });
  const values=data.map(p=>p.v);

  _drawLineChart(canvas,labels,values,-1);

  if(!_trendEventsBound){
    const pickIndex=(evt)=>{ const r=canvas.getBoundingClientRect(); const x=(evt.touches?evt.touches[0].clientX:evt.clientX)-r.left; const dims=canvas._trendDims||{L:0,step:1}; const i=Math.round((x-dims.L)/dims.step); return (i>=0 && i<(canvas._labels?.length||0))?i:-1; };
    const redraw=(i=-1)=>_drawLineChart(canvas,canvas._labels||[],canvas._values||[],i);
    const onResize=debounce(()=>redraw(-1),120);
    canvas.addEventListener('mousemove',e=>redraw(pickIndex(e)));
    canvas.addEventListener('mouseleave',()=>redraw(-1));
    canvas.addEventListener('touchstart',e=>redraw(pickIndex(e)),{passive:true});
    canvas.addEventListener('touchmove', e=>redraw(pickIndex(e)),{passive:true});
    window.addEventListener('resize',onResize);
    _trendEventsBound=true;
  }

  const latest=values.length?values[values.length-1]:0;
  const best=Math.max(0,...values);
  if(info){ info.innerHTML=`<span class="badge">最新: ${Math.round(latest)} kg</span><span class="badge">ベスト: ${Math.round(best)} kg</span><span class="badge">データ: ${values.length} 回</span>`; }
}

// =================== Settings ===================
function bindSettingsUI(){
  $('#darkToggle')?.addEventListener('change',async e=>{
    const on=e.target.checked; document.documentElement.dataset.theme=on?'dark':'light'; await put('prefs',{key:'dark',value:on});
  });
  $('#btnNotif')?.addEventListener('click',async()=>{
    if(!('Notification' in window)){ showToast('この端末は通知に未対応'); return; }
    const perm=await Notification.requestPermission(); showToast(perm==='granted'?'通知を許可しました':'通知は許可されていません');
  });
  $('#btnCreateEx')?.addEventListener('click',async()=>{
    const name=$('#newExName').value.trim(); const part=$('#newExPart').value||undefined;
    if(!name) return;
    try{
      await put('exercises',{name,group:part}); $('#newExName').value='';
      await renderExList(); await renderExSelect(); await renderTplExSelect(); await renderWatchUI(); await renderTrendSelect();
      renderPartFilterChips();
      showToast('追加しました');
    }catch{ showToast('同名の種目があります'); }
  });
  $('#filterPart')?.addEventListener('change',async()=>{ await renderExList(); renderPartFilterChips(); });
  $('#btnWipe')?.addEventListener('click',async()=>{
    if(!confirm('本当に全データを削除しますか？')) return;
    if(USE_LS){ localStorage.removeItem(LS_KEY); }
    else{
      for(const s of ['sessions','sets','exercises']) await new Promise((res,rej)=>{ const r=tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    await ensureInitialExercises();
    await renderExList(); await renderExSelect(); await renderTplExSelect(); renderHistory(); renderAnalytics(); renderTodaySets(); await renderWatchUI(); await renderTrendSelect(); await renderWeeklySummary(); await renderSessionCalendar();
    renderPartFilterChips();
    showToast('全データを削除しました');
  });

  // JSON backup
  $('#btnExportJson')?.addEventListener('click',async()=>{
    const data={ sessions:await getAll('sessions'), sets:await getAll('sets'), exercises:await getAll('exercises'), prefs:await getAll('prefs') };
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='train_punch_backup.json'; a.click(); URL.revokeObjectURL(url);
  });
  $('#jsonIn')?.addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file) return;
    const data=JSON.parse(await file.text());
    if(USE_LS){
      const next={ sessions:Array.isArray(data.sessions)?data.sessions:[], sets:Array.isArray(data.sets)?data.sets:[], exercises:Array.isArray(data.exercises)?data.exercises:[], prefs:Array.isArray(data.prefs)?data.prefs:[] };
      _lsSave(next);
    }else{
      for(const s of ['sessions','sets','exercises','prefs']) await new Promise((res,rej)=>{ const r=tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
      for(const x of (data.exercises||[])) await put('exercises',x);
      for(const x of (data.sessions ||[])) await put('sessions',x);
      for(const x of (data.sets     ||[])) await put('sets',x);
      for(const x of (data.prefs    ||[])) await put('prefs',x);
    }
    await renderExList(); await renderExSelect(); await renderTplExSelect(); renderHistory(); renderAnalytics(); renderTodaySets(); await renderWatchUI(); await renderTrendSelect(); await renderWeeklySummary(); await renderSessionCalendar();
    renderPartFilterChips();
    showToast('復元しました'); e.target.value='';
  });
}

/* ===== NEW: 部位チップ（#partFilter）と表示切替 ===== */
function renderPartFilterChips(){
  const bar = $('#partFilter'); if(!bar) return;
  bar.innerHTML = PARTS.map(p=>`<button type="button" data-part="${p}" class="${p===partFilterActive?'is-active':''}">${p}</button>`).join('');
  if(!_partFilterBound){
    bar.addEventListener('click',e=>{
      const btn=e.target.closest('button'); if(!btn) return;
      const part=btn.dataset.part;
      partFilterActive = (partFilterActive===part) ? null : part;
      renderPartFilterChips();
      applyPartFilterVisibility();
    });
    _partFilterBound=true;
  }
  applyPartFilterVisibility();
}
function applyPartFilterVisibility(){
  const ul = document.querySelector('#exerciseList') || document.querySelector('#exList'); if(!ul) return;
  const lis = Array.from(ul.querySelectorAll('li'));
  if(!lis.length) return;
  lis.forEach(li=>{
    const p = li.dataset.part || '';
    li.style.display = partFilterActive ? (p===partFilterActive?'' : 'none') : 'none';
  });
}

/* 種目リストの描画（dataset.part 付与版） */
async function renderExList(){
  const filt=$('#filterPart')?.value||'all';
  let exs=await getAll('exercises'); if(filt!=='all') exs=exs.filter(e=>e.group===filt);
  exs.sort((a,b)=>(a.group||'').localeCompare(b.group||'','ja')||a.name.localeCompare(b.name,'ja'));

  const ul = document.querySelector('#exerciseList') || document.querySelector('#exList'); if(!ul) return;
  ul.innerHTML='';
  if(!exs.length){ ul.innerHTML='<li>まだありません</li>'; applyPartFilterVisibility(); return; }

  for(const e of exs){
    const li=document.createElement('li');
    li.dataset.part = e.group || '';
    li.innerHTML = `<span>${e.group?`<span class="badge" style="margin-right:8px">${esc(e.group)}</span>`:''}${esc(e.name)}</span><button class="ghost" data-id="${e.id}">削除</button>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click',async()=>{
      pushUndo(); await del('exercises',Number(b.dataset.id));
      await renderExList(); await renderExSelect(); await renderTplExSelect(); renderAnalytics(); await renderWatchUI(); await renderTrendSelect(); await renderWeeklySummary(); await renderSessionCalendar();
      renderPartFilterChips();
    });
  });

  applyPartFilterVisibility();
}

// ---- Watchlist UI ----
function renderWatchPartChips(){ $$('#watchPartChips .chip').forEach(ch=>{ ch.classList.toggle('active', ch.dataset.part===watchSelectedPart); }); }
function bindWatchPartChips(){
  const chips=$('#watchPartChips'); if(!chips||_watchChipsBound) return;
  chips.addEventListener('click',e=>{ const b=e.target.closest('.chip'); if(!b) return; watchSelectedPart=b.dataset.part; renderWatchPartChips(); renderWatchUI(); });
  _watchChipsBound=true;
}
async function renderWatchUI(){
  bindWatchPartChips(); renderWatchPartChips();
  const sel=$('#watchExSelect'); const list=$('#watchList');
  let exs=await getAll('exercises'); exs=exs.filter(e=>e.group===watchSelectedPart).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  if(sel){ sel.innerHTML=`<option value="">（選択する）</option>`+(exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')||'<option>オプションなし</option>'); sel.value=''; }
  if(list){
    const nameById=Object.fromEntries((await getAll('exercises')).map(e=>[e.id,e.name]));
    list.innerHTML=watchlist.length?watchlist.filter(id=>nameById[id]).map(id=>`<li><span>${esc(nameById[id])}</span><button class="ghost" data-id="${id}">削除</button></li>`).join(''):'<li>まだありません</li>';
    list.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click',async()=>{ const id=Number(b.dataset.id); watchlist=watchlist.filter(x=>x!==id); await put('prefs',{key:'watchlist',value:watchlist}); await renderWatchUI(); await renderTrendSelect(); await renderTrendChart(); await renderWeeklySummary(); });
    });
  }
  const addBtn=$('#btnWatchAdd');
  if(addBtn && !addBtn._bound){
    addBtn.addEventListener('click',async()=>{
      const id=Number($('#watchExSelect').value); if(!id){ showToast('種目を選んでください'); return; }
      if(!watchlist.includes(id)) watchlist.push(id);
      await put('prefs',{key:'watchlist',value:watchlist});
      await renderWatchUI(); await renderTrendSelect(); await renderTrendChart(); await renderWeeklySummary(); showToast('ウォッチに追加しました');
    });
    addBtn._bound=true;
  }
}

// =================== CSV ===================

// インポートステータス用の小ヘルパー
function setImportStatus(state,text,filename){
  const nameEl = $('.import-file-name');
  if(nameEl && filename) nameEl.textContent = filename;
  const statusEl = $('.import-status');
  if(!statusEl) return;
  statusEl.classList.remove('ok','err','warn');
  if(state && ['ok','err','warn'].includes(state)) statusEl.classList.add(state);
  const dot = statusEl.querySelector('.dot');
  if(text != null){
    if(dot){
      statusEl.textContent = '';
      statusEl.appendChild(dot);
      statusEl.appendChild(document.createTextNode(' '+text));
    }else{
      statusEl.textContent = text;
    }
  }
}

async function exportCSV(){
  const sessions=await getAll('sessions');
  const sets=await getAll('sets');
  const header1='##SESSIONS\nid,date,note\n';
  const lines1=sessions.map(s=>`${s.id},${s.date},${csvEscape(s.note||'')}`).join('\n');
  const header2='\n##SETS\nid,session_id,exercise_id,weight,reps,rpe,ts,date\n';
  const lines2=sets.map(s=>[s.id,s.session_id,s.exercise_id,s.weight,s.reps,(s.rpe??''),s.ts,s.date].join(',')).join('\n');
  const blob=new Blob([header1+lines1+header2+lines2],{type:'text/csv'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='train_punch_export.csv'; a.click(); URL.revokeObjectURL(url);
}

// 実際のCSV取り込み処理（入力元に依存しない）
async function importCSVFromFile(file){
  if(!file) throw new Error('ファイルが指定されていません');
  const text=await file.text();
  const parts=text.split('##SESSIONS'); const afterSessions=parts[1];
  if(!afterSessions) throw new Error('CSV形式が違います（##SESSIONSが見つかりません）');
  const segs=afterSessions.split('##SETS'); const sessionsPart=segs[0] ?? ''; const setsPart=segs[1] ?? '';
  const sLines=sessionsPart.split(/\r?\n/).slice(2).filter(Boolean);
  const setLines=setsPart.split(/\r?\n/).slice(2).filter(Boolean);

  if(USE_LS){
    const data=_lsLoad(); data.sessions=[]; data.sets=[];
    for(const line of sLines){
      const [id,date,note]=parseCSVRow(line);
      data.sessions.push({id:Number(id),date,note,created_at:new Date(date).getTime()});
    }
    for(const line of setLines){
      const [id,session_id,exercise_id,weight,reps,rpe,ts,date]=parseCSVRow(line);
      data.sets.push({id:Number(id),session_id:Number(session_id),exercise_id:Number(exercise_id),weight:Number(weight),reps:Number(reps),rpe:rpe?Number(rpe):null,ts:Number(ts),date});
    }
    _lsSave(data);
  }else{
    for(const s of ['sessions','sets']) await new Promise((res,rej)=>{ const r=tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    for(const line of sLines){
      const [id,date,note]=parseCSVRow(line);
      await put('sessions',{id:Number(id),date,note,created_at:new Date(date).getTime()});
    }
    for(const line of setLines){
      const [id,session_id,exercise_id,weight,reps,rpe,ts,date]=parseCSVRow(line);
      await put('sets',{id:Number(id),session_id:Number(session_id),exercise_id:Number(exercise_id),weight:Number(weight),reps:Number(reps),rpe:rpe?Number(rpe):null,ts:Number(ts),date});
    }
  }
  renderHistory(); renderAnalytics(); await renderWeeklySummary(); await renderSessionCalendar();
}

// input[type=file] 用のラッパー
async function importCSV(e){
  const file=e.target.files[0]; if(!file) return;
  setImportStatus(null,'読み込み中…',file.name);
  try{
    await importCSVFromFile(file);
    setImportStatus('ok','インポート完了',file.name);
    showToast('インポート完了');
  }catch(err){
    console.error(err);
    setImportStatus('err','読み込みに失敗しました',file.name);
    showToast('インポート失敗: '+(err?.message||'不明なエラー'));
  }finally{
    e.target.value='';
  }
}

function csvEscape(s){ const needs=/[",\n]/.test(s); return needs?'"'+String(s).replace(/"/g,'""')+'"':s; }
function parseCSVRow(row){
  const out=[]; let cur='',q=false;
  for(let i=0;i<row.length;i++){
    const c=row[i];
    if(q){ if(c=='"'){ if(row[i+1]=='"'){cur+='"'; i++;} else q=false; } else cur+=c; }
    else { if(c===','){ out.push(cur); cur=''; } else if(c=='"'){ q=true; } else cur+=c; }
  }
  out.push(cur); return out;
}

// =================== History ops ===================
async function deleteSession(id){
  const sets=await indexGetAll('sets','by_session',id);
  await Promise.all(sets.map(s=>del('sets',s.id)));
  await del('sessions',id);
  renderHistory(); renderAnalytics(); await renderWeeklySummary(); await renderSessionCalendar();
  showToast('セッションを削除しました');
}
async function editSessionNote(id){
  const s=await get('sessions',id);
  const next=prompt('メモを編集',s?.note||'');
  if(next===null) return;
  s.note=next; await put('sessions',s); renderHistory(); showToast('メモを更新しました');
}
async function duplicateSessionToToday(id){
  const src=await get('sessions',id);
  const today=todayStr();
  const newId=await put('sessions',{date:today,note:(src?.note||'')+' (複製)',created_at:Date.now()});
  const sets=await indexGetAll('sets','by_session',id);
  for(const x of sets.filter(s=>!s.wu)){ await put('sets',{session_id:newId,exercise_id:x.exercise_id,weight:x.weight,reps:x.reps,rpe:x.rpe,ts:Date.now(),date:today}); }
  renderHistory(); renderAnalytics(); await renderWeeklySummary(); await renderSessionCalendar(); showToast('今日に複製しました');
}

// ===== 週次サマリー =====
function _isoWeekKeyLocal(dateStr){
  const d0=new Date(dateStr); const d=new Date(d0.getFullYear(),d0.getMonth(),d0.getDate());
  const day=d.getDay()||7; d.setDate(d.getDate()+4-day);
  const yearStart=new Date(d.getFullYear(),0,1);
  const week=Math.ceil((((d - yearStart)/86400000) + 1)/7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}
async function renderWeeklySummary(){
  const el=document.getElementById('weekly-summary-body'); if(!el) return;
  const sets= (await getAll('sets')).filter(s=>!s.wu);
  if(!sets.length){ el.textContent='記録が見つかりません。入力するとここに今週の要約が出ます。'; return; }
  const map=new Map();
  for(const s of sets){ const k=_isoWeekKeyLocal(s.date); (map.get(k)||map.set(k,[]).get(k)).push(s); }
  const latestKey=[...map.keys()].sort().pop(); const arr=map.get(latestKey)||[];
  const totalVol=arr.reduce((sum,x)=>sum+(Number(x.weight)||0)*(Number(x.reps)||0),0);
  const rpes=arr.map(x=>x.rpe).filter(v=>typeof v==='number'&&!Number.isNaN(v));
  const avgRpe=rpes.length?(rpes.reduce((a,b)=>a+b,0)/rpes.length):null;
  let score=10;
  if(totalVol<=1000) score=2; else if(totalVol<=2000) score=4; else if(totalVol<=3000) score=6; else if(totalVol<=4000) score=8;
  const comment= score<=3?'基礎づくり週。次週は+10〜20%を目安に。' : score<=6?'標準負荷。フォームと睡眠を重視。' : score<=8?'やや高負荷。補助種目を整理して回復時間を。' : '高負荷。48–72hの回復と栄養を最優先。';
  el.innerHTML=`<div style="display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap">
      <strong>対象週：</strong><span>${latestKey}</span>
      <strong>合計ボリューム：</strong><span>${Math.round(totalVol)}</span>
      <strong>強度スコア：</strong><span style="font-size:1.25rem">${score}/10</span>
      ${avgRpe!=null?`<strong>平均RPE：</strong><span>${avgRpe.toFixed(1)}</span>`:''}
    </div><p style="margin-top:.5rem">${comment}</p>`;
}

// ==== DOM ready ====
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',init); } else { init(); }