// Train no Punch — v1.1.4 (no-QuickInsert, perf+import UX, no-WU full replace, sets+RPE, fixed dark theme)
// change: WU（ウォームアップ）機能を全撤去（生成/設定/保存/履歴表示）
// change: クイック投入機能を全撤去（UI/JS）
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
  // index.html 側で __tpHardRefresh があればそれを優先
  try{
    if (typeof window !== 'undefined' && typeof window.__tpHardRefresh === 'function') {
      return window.__tpHardRefresh();
    }
  }catch(_){}

  // フォールバック：SW + Cache を全消し
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
          const s = d.objectStoreNames.contains('sets')
            ? e.target.transaction.objectStore('sets')
            : null;
          if(s){
            if(!s.indexNames.contains('by_session')) s.createIndex('by_session','session_id',{unique:false});
            if(!s.indexNames.contains('by_date')) s.createIndex('by_date','date',{unique:false});
          }
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
  if(USE_LS){
    const data=_lsLoad();
    if(store==='prefs') return data.prefs.find(p=>p.key===key)||undefined;
    return (data[store]||[]).find(x=>Number(x.id)===Number(key));
  }
  return new Promise((res,rej)=>{
    try{
      const r=tx([store]).objectStore(store).get(key);
      r.onsuccess=()=>res(r.result);
      r.onerror  =()=>rej(r.error);
    }catch(err){ rej(err); }
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
      const r=os.getAll();
      r.onsuccess=()=>{ const rows=r.result||[]; res(field?rows.filter(x=>x[field]===q):rows); };
      r.onerror  =()=>res([]);
      return;
    }
    const r=os.index(idx).getAll(q);
    r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]);
  }catch(_){ res([]); }
});

// ---- UI state ----
let currentSession = {date:todayStr(),note:'',sets:[]};
let selectedPart='胸';

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
  }catch(_){
    window.scrollTo(0, tabEl.getBoundingClientRect().top + window.pageYOffset);
  }
  const ringTarget = $('#tab-settings .card') || tabEl;
  if(ringTarget){
    ringTarget.classList.add('flash-ring');
    setTimeout(()=> ringTarget.classList.remove('flash-ring'), 1300);
  }
  showToast('設定を開きました');
  const firstCtl = $('#btnNotif')
                || $('#tab-settings [autofocus]')
                || $('#tab-settings input, #tab-settings select, #tab-settings textarea, #tab-settings button, #tab-settings [href], #tab-settings [tabindex]:not([tabindex="-1"])');
  try{ firstCtl?.focus({preventScroll:true}); }catch(_){ firstCtl?.focus(); }
}

function queueOpenSettingsFeel(){
  requestAnimationFrame(()=>requestAnimationFrame(openSettingsFeel));
}

// ==== Undo（簡易版）====
let _undoStack = [];
function pushUndo(){
  try{
    const snap = {
      currentSession: JSON.parse(JSON.stringify(currentSession)),
      selectedPart
    };
    _undoStack.push(snap);
    if(_undoStack.length > 50) _undoStack.shift();
  }catch(_){}
}
function doUndo(){
  const snap = _undoStack.pop();
  if(!snap){ showToast('戻せる操作がありません'); return; }
  currentSession   = snap.currentSession || {date:todayStr(),note:'',sets:[]};
  selectedPart     = snap.selectedPart   ?? selectedPart;
  renderPartChips();
  renderTodaySets();
  showToast('1つ前の状態に戻しました');
}

// =================== Init ===================
async function init(){
  // スクロール中は body.scrolling を付ける（モバイルのぼやけ防止）
  (function(){
    let _t;
    window.addEventListener('scroll',()=>{
      document.body.classList.add('scrolling');
      clearTimeout(_t);
      _t=setTimeout(()=>document.body.classList.remove('scrolling'),150);
    },{passive:true});
  })();

  // 設定タブの「キャッシュをリセット」
  $('#btnHardRefresh')?.addEventListener('click',async()=>{
    const b=$('#btnHardRefresh'); const old=b.textContent;
    b.disabled=true; b.textContent='リセット中…';
    showToast('キャッシュをリセットします…');
    await hardRefresh();
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

  // prefs (watchlist / last tab)
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

  // 起動直後はセッション編集カードを隠す
  setSessionEditVisible(false);

  initSessionCalendar();   // ★ カレンダー初期化

  bindHistoryUI();
  bindSettingsUI();
  await renderWatchUI();
  await renderTrendSelect();

  renderPartChips();
  await renderExSelect();
  renderTodaySets();
  renderHistory();
  renderAnalytics(); // idle タイミングで解析
  await renderExList();
  renderPartFilterChips();

  // テーマは固定でダーク
  document.documentElement.dataset.theme = 'dark';

  await renderWeeklySummary();

  // データステータス / 今日のワンポイント ローテーション開始
  startSettingsInfoRotation();
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

  // 日付入力の手動変更 → カレンダー＆currentSessionに反映
  const dateInput = $('#sessDate');
  if(dateInput && !dateInput._boundCalendar){
    dateInput.addEventListener('change',()=>{
      const val = dateInput.value || todayStr();
      onSessionDateSelected(val,{noScroll:true});
    });
    dateInput._boundCalendar = true;
  }

  // スマート入力
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
      currentSession.sets.push({
        temp_id:(crypto?.randomUUID?.()||now+'_'+Math.random().toString(16).slice(2)+'_'+i),
        exercise_id:exId,
        weight,
        reps,
        rpe:(Number.isFinite(rpeVal)?rpeVal:null),
        ts:now+i,
        date
      });
    }

    if(willPR){
      showToast('e1RM更新！（ウォッチ）');
      if('vibrate' in navigator) navigator.vibrate([60,40,60]);
    }

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

  $('#exSelect')?.addEventListener('change',async()=>{
    const exId=Number($('#exSelect').value);
    if(!exId){
      $('#weight').value=''; $('#reps').value=''; $('#sets').value=''; $('#rpe') && ($('#rpe').value='');
      return;
    }
    const sets=(await getAll('sets')).filter(s=>s.exercise_id===exId && !s.wu).sort((a,b)=>b.ts-a.ts);
    if(sets[0]){
      $('#weight').value=sets[0].weight; $('#reps').value=sets[0].reps; $('#sets').value=''; $('#rpe') && ($('#rpe').value='');
    }else{
      $('#weight').value=''; $('#reps').value=''; $('#sets').value=''; $('#rpe') && ($('#rpe').value='');
    }
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

  // 日付を選択したらセッション編集カードを表示
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
      onSessionDateSelected(dateStr);
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

  // 念のためガード
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
    calYear  = year;
    calMonth = month;
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

// smart input
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
      if(act==='del'){
        pushUndo();
        currentSession.sets=currentSession.sets.filter(x=>x.temp_id!==id);
        renderTodaySets();
      }
      if(act==='edit'){
        pushUndo();
        currentSession.sets=currentSession.sets.filter(x=>x.temp_id!==id);
        renderTodaySets();
        const ex=(await getAll('exercises')).find(e=>e.id===item.exercise_id);
        if(ex && ex.group && ex.group!==selectedPart){
          selectedPart=ex.group; renderPartChips(); await renderExSelect();
        }
        $('#exSelect').value=String(item.exercise_id);
        $('#weight').value=String(item.weight);
        $('#reps').value=String(item.reps);
        $('#sets').value='1';
        if($('#rpe')) $('#rpe').value=(item.rpe!=null?String(item.rpe):'');
        showToast('編集用に読み込みました');
        window.scrollTo({top:0,behavior:'smooth'});
      }
    });
  });
}
function exNameById(id){
  const opt=$('#exSelect')?.querySelector(`option[value="${id}"]`);
  return opt?opt.textContent:'種目';
}

// ========= 種目セレクト =========
async function renderExSelect(){
  const sel = $('#exSelect');
  if(!sel) return;
  let exs = await getAll('exercises');
  exs = exs
    .filter(e => !selectedPart || !e.group || e.group === selectedPart)
    .sort((a,b)=>(a.group||'').localeCompare(b.group||'','ja') || a.name.localeCompare(b.name,'ja'));
  const opts = ['<option value="">（選択する）</option>']
    .concat(exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`));
  sel.innerHTML = opts.join('');
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
  for(const s of rows){
    if(!byEx.has(s.exercise_id)) byEx.set(s.exercise_id,[]);
    byEx.get(s.exercise_id).push(s);
  }
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
  const allEx=await getAll('exercises');
  const nameById=Object.fromEntries(allEx.map(e=>[e.id,e.name]));
  ul._nameById=nameById;

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
    li._sets=setsNoWU;
    ul.appendChild(li);
  }
  if(!sessions.length) ul.innerHTML='<li>まだありません</li>';

  if(!ul._bound){
    ul.addEventListener('click',async e=>{
      const b=e.target.closest('button'); if(!b) return;
      const id=Number(b.dataset.id), act=b.dataset.act;
      const li=b.closest('li');
      if(act==='del'){
        if(confirm('このセッションを削除しますか？')) await deleteSession(id);
        renderHistory();
      }
      if(act==='note'){
        await editSessionNote(id);
        renderHistory();
      }
      if(act==='detail'){
        const box=li.querySelector('.details');
        if(box.hidden || !box._loaded){
          box.innerHTML=buildSessionDetailsHTML(li._sets||[], ul._nameById||{});
          box._loaded=true;
          box.hidden=false;
        }else{
          box.hidden=true;
        }
      }
    });
    ul._bound=true;
  }
}

// =================== Settings ===================
function bindSettingsUI(){
  $('#btnNotif')?.addEventListener('click',async()=>{
    if(!('Notification' in window)){ showToast('この端末は通知に未対応'); return; }
    const perm=await Notification.requestPermission();
    showToast(perm==='granted'?'通知を許可しました':'通知は許可されていません');
  });
  $('#btnCreateEx')?.addEventListener('click',async()=>{
    const name=$('#newExName').value.trim(); const part=$('#newExPart').value||undefined;
    if(!name) return;
    try{
      await put('exercises',{name,group:part}); $('#newExName').value='';
      await renderExList(); await renderExSelect(); await renderWatchUI(); await renderTrendSelect();
      renderPartFilterChips();
      showToast('追加しました');
    }catch{
      showToast('同名の種目があります');
    }
  });
  $('#filterPart')?.addEventListener('change',async()=>{ await renderExList(); renderPartFilterChips(); });
  $('#btnWipe')?.addEventListener('click',async()=>{
    if(!confirm('本当に全データを削除しますか？')) return;
    if(USE_LS){
      localStorage.removeItem(LS_KEY);
    }else{
      for(const s of ['sessions','sets','exercises'])
        await new Promise((res,rej)=>{
          const r=tx([s],'readwrite').objectStore(s).clear();
          r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
        });
    }
    await ensureInitialExercises();
    await renderExList(); await renderExSelect();
    renderHistory(); renderAnalytics(); renderTodaySets();
    await renderWatchUI(); await renderTrendSelect(); await renderWeeklySummary(); await renderSessionCalendar();
    renderPartFilterChips();
    showToast('全データを削除しました');
  });

  // JSON backup
  $('#btnExportJson')?.addEventListener('click',async()=>{
    const data={
      sessions:await getAll('sessions'),
      sets:await getAll('sets'),
      exercises:await getAll('exercises'),
      prefs:await getAll('prefs')
    };
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='train_punch_backup.json'; a.click();
    URL.revokeObjectURL(url);
  });
  $('#jsonIn')?.addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file) return;
    const data=JSON.parse(await file.text());
    if(USE_LS){
      const next={
        sessions : Array.isArray(data.sessions)?data.sessions:[],
        sets     : Array.isArray(data.sets)?data.sets:[],
        exercises: Array.isArray(data.exercises)?data.exercises:[],
        prefs    : Array.isArray(data.prefs)?data.prefs:[]
      };
      _lsSave(next);
    }else{
      for(const s of ['sessions','sets','exercises','prefs'])
        await new Promise((res,rej)=>{
          const r=tx([s],'readwrite').objectStore(s).clear();
          r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
        });
      for(const x of (data.exercises||[])) await put('exercises',x);
      for(const x of (data.sessions ||[])) await put('sessions',x);
      for(const x of (data.sets     ||[])) await put('sets',x);
      for(const x of (data.prefs    ||[])) await put('prefs',x);
    }
    await renderExList(); await renderExSelect();
    renderHistory(); renderAnalytics(); renderTodaySets();
    await renderWatchUI(); await renderTrendSelect(); await renderWeeklySummary(); await renderSessionCalendar();
    renderPartFilterChips();
    showToast('復元しました');
    e.target.value='';
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
      pushUndo();
      await del('exercises',Number(b.dataset.id));
      await renderExList(); await renderExSelect(); renderAnalytics();
      await renderWatchUI(); await renderTrendSelect(); await renderWeeklySummary(); await renderSessionCalendar();
      renderPartFilterChips();
    });
  });

  applyPartFilterVisibility();
}

// ---- Watchlist UI ----
function renderWatchPartChips(){ $$('#watchPartChips .chip').forEach(ch=>{ ch.classList.toggle('active', ch.dataset.part===watchSelectedPart); }); }
function bindWatchPartChips(){
  const chips=$('#watchPartChips'); if(!chips||_watchChipsBound) return;
  chips.addEventListener('click',e=>{
    const b=e.target.closest('.chip'); if(!b) return;
    watchSelectedPart=b.dataset.part;
    renderWatchPartChips();
    renderWatchUI();
  });
  _watchChipsBound=true;
}
async function renderWatchUI(){
  bindWatchPartChips(); renderWatchPartChips();
  const sel=$('#watchExSelect'); const list=$('#watchList');
  let exs=await getAll('exercises'); exs=exs.filter(e=>e.group===watchSelectedPart).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  if(sel){
    sel.innerHTML=`<option value="">（選択する）</option>`+(exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')||'<option>オプションなし</option>');
    sel.value='';
  }
  if(list){
    const nameById=Object.fromEntries((await getAll('exercises')).map(e=>[e.id,e.name]));
    list.innerHTML=watchlist.length
      ? watchlist.filter(id=>nameById[id]).map(id=>`<li><span>${esc(nameById[id])}</span><button class="ghost" data-id="${id}">削除</button></li>`).join('')
      : '<li>まだありません</li>';
    list.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click',async()=>{
        const id=Number(b.dataset.id);
        watchlist=watchlist.filter(x=>x!==id);
        await put('prefs',{key:'watchlist',value:watchlist});
        await renderWatchUI(); await renderTrendSelect(); await renderTrendChart(); await renderWeeklySummary();
      });
    });
  }
  const addBtn=$('#btnWatchAdd');
  if(addBtn && !addBtn._bound){
    addBtn.addEventListener('click',async()=>{
      const id=Number($('#watchExSelect').value); if(!id){ showToast('種目を選んでください'); return; }
      if(!watchlist.includes(id)) watchlist.push(id);
      await put('prefs',{key:'watchlist',value:watchlist});
      await renderWatchUI(); await renderTrendSelect(); await renderTrendChart(); await renderWeeklySummary();
      showToast('ウォッチに追加しました');
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
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='train_punch_export.csv'; a.click();
  URL.revokeObjectURL(url);
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
      data.sets.push({
        id:Number(id),
        session_id:Number(session_id),
        exercise_id:Number(exercise_id),
        weight:Number(weight),
        reps:Number(reps),
        rpe:rpe?Number(rpe):null,
        ts:Number(ts),
        date
      });
    }
    _lsSave(data);
  }else{
    for(const s of ['sessions','sets'])
      await new Promise((res,rej)=>{
        const r=tx([s],'readwrite').objectStore(s).clear();
        r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
      });
    for(const line of sLines){
      const [id,date,note]=parseCSVRow(line);
      await put('sessions',{id:Number(id),date,note,created_at:new Date(date).getTime()});
    }
    for(const line of setLines){
      const [id,session_id,exercise_id,weight,reps,rpe,ts,date]=parseCSVRow(line);
      await put('sets',{
        id:Number(id),
        session_id:Number(session_id),
        exercise_id:Number(exercise_id),
        weight:Number(weight),
        reps:Number(reps),
        rpe:rpe?Number(rpe):null,
        ts:Number(ts),
        date
      });
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
    if(q){
      if(c=='"'){
        if(row[i+1]=='"'){cur+='"'; i++;} else q=false;
      }else cur+=c;
    }else{
      if(c===','){ out.push(cur); cur=''; }
      else if(c=='"'){ q=true; }
      else cur+=c;
    }
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
  s.note=next; await put('sessions',s);
  renderHistory();
  showToast('メモを更新しました');
}
async function duplicateSessionToToday(id){
  const src=await get('sessions',id);
  const today=todayStr();
  const newId=await put('sessions',{date:today,note:(src?.note||'')+' (複製)',created_at:Date.now()});
  const sets=await indexGetAll('sets','by_session',id);
  for(const x of sets.filter(s=>!s.wu)){
    await put('sets',{
      session_id:newId,
      exercise_id:x.exercise_id,
      weight:x.weight,
      reps:x.reps,
      rpe:x.rpe,
      ts:Date.now(),
      date:today
    });
  }
  renderHistory(); renderAnalytics(); await renderWeeklySummary(); await renderSessionCalendar();
  showToast('今日に複製しました');
}

/* ===== Analytics / Trend / Weekly summary ===== */

let _trendChartInstance = null;

// ウォッチ種目からプルダウンを作る
async function renderTrendSelect(){
  const sel = $('#trendExSelect');
  if(!sel) return;

  const allEx = await getAll('exercises');
  const nameById = Object.fromEntries(allEx.map(e => [e.id, e.name]));

  const prev = sel.value || '';

  const opts = [];
  opts.push('<option value="">ウォッチ種目から選択</option>');
  if (Array.isArray(watchlist)) {
    for (const id of watchlist) {
      if (!nameById[id]) continue;
      opts.push(`<option value="${id}">${esc(nameById[id])}</option>`);
    }
  }
  sel.innerHTML = opts.join('');

  if (prev && watchlist.includes(Number(prev))) {
    sel.value = prev;
  } else if (!sel.value && watchlist.length) {
    sel.value = String(watchlist[0]);
  }

  if (!_trendEventsBound) {
    sel.addEventListener('change', () => {
      renderTrendChart();
    });
    _trendEventsBound = true;
  }

  await renderTrendChart();
}

// 選択されたウォッチ種目の推定1RMトレンドを描画
async function renderTrendChart(){
  const canvas = $('#trendChart');
  if (!canvas) return;

  const sel  = $('#trendExSelect');
  const exId = Number(sel?.value || 0);

  const ctx = canvas.getContext('2d');

  if (_trendChartInstance) {
    _trendChartInstance.destroy();
    _trendChartInstance = null;
  }

  if (!exId) {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const allSets = (await getAll('sets')).filter(s => !s.wu && s.exercise_id === exId);
  if (!allSets.length) {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const byDate = new Map();
  for (const s of allSets) {
    const d   = s.date || ymdLocal(new Date(s.ts || Date.now()));
    const v   = e1rm(s.weight, s.reps);
    const cur = byDate.get(d);
    if (cur == null || v > cur) byDate.set(d, v);
  }

  const dates  = Array.from(byDate.keys()).sort();
  const values = dates.map(d => Math.round(byDate.get(d)));

  if (typeof Chart === 'undefined' || !ctx) return;

  _trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: '推定1RM',
        data: values,
        tension: 0.25,
        pointRadius: 3,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          }
        },
        y: {
          beginAtZero: false
        }
      }
    }
  });
}

// 直近1週間分のボリュームなどを集計して表示
async function renderWeeklySummary(){
  const box = $('#weeklySummary');
  if (!box) return;

  const [sets, exercises] = await Promise.all([
    getAll('sets'),
    getAll('exercises')
  ]);

  const allSets = (sets || []).filter(s => !s.wu);
  if (!allSets.length) {
    box.innerHTML = '<p class="small muted">記録を保存するとここに1週間分のサマリーが表示されます。</p>';
    return;
  }

  const exById = Object.fromEntries(exercises.map(e => [e.id, e]));

  const today = new Date();
  const days  = [];
  const dayMap = new Map();

  for (let i = 6; i >= 0; i--) {
    const d     = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key   = ymdLocal(d);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    const obj = {
      key,
      label,
      vol: 0,
      sets: 0,
      sessions: new Set(),
      byPart: {}
    };
    days.push(obj);
    dayMap.set(key, obj);
  }

  for (const s of allSets) {
    const day = dayMap.get(s.date);
    if (!day) continue;

    const vol = (Number(s.weight) || 0) * (Number(s.reps) || 0);
    day.vol  += vol;
    day.sets += 1;
    if (s.session_id != null) day.sessions.add(s.session_id);

    const ex   = exById[s.exercise_id];
    const part = ex?.group || 'その他';
    day.byPart[part] = (day.byPart[part] || 0) + vol;
  }

  const rowsHtml = days.map(day => {
    const main = day.sets
      ? `${Math.round(day.vol)}kg ／ ${day.sets}セット ／ ${day.sessions.size}セッション`
      : '記録なし';

    const partsStr = Object.entries(day.byPart)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([p, v]) => `${p}:${Math.round(v)}kg`)
      .join('、 ');

    return `
      <div class="weekly-row">
        <div class="weekly-date">${day.label}</div>
        <div class="weekly-main small">${main}</div>
        ${partsStr ? `<div class="weekly-sub small muted">${partsStr}</div>` : ''}
      </div>
    `;
  }).join('');

  box.innerHTML = `
    <div class="weekly-grid">
      ${rowsHtml}
    </div>
  `;
}

// 解析タブ全体を更新するラッパー
async function renderAnalytics(){
  await renderTrendSelect();
  await renderWeeklySummary();
}

/* ===== Settings info card（データステータス / 今日のワンポイント）===== */

let _settingsInfoMode = 'status';   // 'status' | 'tip'
let _settingsInfoTimer = null;

function pickDailyTip(){
  if(!SETTINGS_TIPS.length) return '';
  const today = new Date();
  const seed = today.getFullYear()*10000 + (today.getMonth()+1)*100 + today.getDate();
  const idx = seed % SETTINGS_TIPS.length;
  return SETTINGS_TIPS[idx];
}

// ★ カレンダーで選択している日付だけの件数
async function buildDataStatusText(){
  const [sessions, sets] = await Promise.all([
    getAll('sessions'),
    getAll('sets')
  ]);

  const selectedDate =
    calSelectedDate ||
    $('#sessDate')?.value ||
    todayStr();

  const daySessions = sessions.filter(s => s.date === selectedDate);
  const daySets     = sets.filter(s => !s.wu && s.date === selectedDate);
  const dayExCount  = new Set(daySets.map(s => s.exercise_id)).size;

  const parts = [];
  parts.push(`日付 ${selectedDate}`);
  parts.push(`セッション ${daySessions.length}件`);
  parts.push(`セット ${daySets.length}本`);
  if(dayExCount > 0) parts.push(`種目 ${dayExCount}種`);

  if(Array.isArray(watchlist) && watchlist.length){
    parts.push(`ウォッチ ${watchlist.length}種目`);
  }

  return parts.join(' ／ ');
}

async function refreshSettingsInfoNow(mode){
  const card  = $('#dataStatusCard');
  const title = $('#dataStatusTitle');
  const body  = $('#dataStatusBody');
  if(!card || !title || !body) return;

  const m = mode || _settingsInfoMode || 'status';

  if(m === 'status'){
    _settingsInfoMode = 'status';
    title.textContent = 'データステータス';
    body.textContent  = '読み込み中…';

    const fallbackTimer = setTimeout(()=>{
      if(body.textContent === '読み込み中…'){
        body.textContent = 'まだ記録がありません。最初のセッションを保存してみましょう。';
      }
    }, 3500);

    try{
      const text = await buildDataStatusText();
      clearTimeout(fallbackTimer);
      body.textContent = text || 'まだ記録がありません。最初のセッションを保存してみましょう。';
    }catch(err){
      console.warn('[TP] settings info status error', err);
      clearTimeout(fallbackTimer);
      body.textContent = 'ステータスの取得に失敗しました。';
    }
  }else{
    _settingsInfoMode = 'tip';
    title.textContent = '今日のワンポイント';
    body.textContent  = pickDailyTip() || '今日のポイントは、無理をしないで継続すること。';
  }
}

function startSettingsInfoRotation(){
  const card = $('#dataStatusCard');
  if(!card) return;

  if(_settingsInfoTimer){
    clearInterval(_settingsInfoTimer);
    _settingsInfoTimer = null;
  }

  refreshSettingsInfoNow('status');

  _settingsInfoTimer = setInterval(()=>{
    const next = (_settingsInfoMode === 'status') ? 'tip' : 'status';
    refreshSettingsInfoNow(next);
  }, 10000);
}

// ==== DOM ready ====
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}