// Train Punch — v1.5.1 (+ Warm-up generator)
// (auto-timer default + smart input "40x8@8" + today edit & undo + watch-only PR + e1RM trend)
// 追加: ヘッダーブラー抑制 / チャートresizeデバウンス / 最後のタブ復元 / 週次サマリー
// 修正: 日付をローカル基準（UTCズレ解消）
// 可視化改善: 棒・折れ線ともに縦軸数値を表示、左余白を自動調整、値ラベルのはみ出し防止、きれいな目盛り(1/2/5×10ⁿ)
// v1.5.1 trim: クイック投入UIと関連ロジックを完全削除（軽量化）

const DB_NAME = 'trainpunch_v3';
const DB_VER  = 3;
let db;

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function showToast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1400);
}

// --- Local date utils (UTCズレ対策) ---
const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayStr = () => ymdLocal(new Date());

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const e1rm = (w,r) => w * (1 + (r||0)/30);

// --- small utils ---
const debounce = (fn, wait=150)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; };
try{ if('scrollRestoration' in history) history.scrollRestoration='manual'; }catch(_){}

// ---- Hard Refresh ----
async function hardRefresh(){
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }catch(e){ console.warn(e); }
  location.reload();
}

// ---- IndexedDB helpers ----
function openDB(){
  return new Promise((resolve,reject)=>{
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

      if(!d.objectStoreNames.contains('sessions')){
        d.createObjectStore('sessions',{keyPath:'id', autoIncrement:true});
      }
      if(!d.objectStoreNames.contains('sets')){
        const s = d.createObjectStore('sets',{keyPath:'id', autoIncrement:true});
        s.createIndex('by_session','session_id');
        s.createIndex('by_date','date');
      }
      if(!d.objectStoreNames.contains('prefs')){
        d.createObjectStore('prefs',{keyPath:'key'});
      }
    };
    req.onsuccess = ()=>{ db = req.result; resolve(db); };
    req.onerror   = ()=>reject(req.error);
  });
}
const tx = (names, mode='readonly') => db.transaction(names, mode);
const put  = (store, val)=> new Promise((res,rej)=>{ const r=tx([store],'readwrite').objectStore(store).put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const del  = (store, key)=> new Promise((res,rej)=>{ const r=tx([store],'readwrite').objectStore(store).delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
const get  = (store, key)=> new Promise((res,rej)=>{ const r=tx([store]).objectStore(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const getAll = (store)=> new Promise((res,rej)=>{ const r=tx([store]).objectStore(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const indexGetAll = (store, idx, q)=> new Promise((res,rej)=>{ const r=tx([store]).objectStore(store).index(idx).getAll(q); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });

// ---- Data preset ----
const PARTS = ['胸','背中','肩','脚','腕'];
const EX_GROUPS = {
  '胸':  ['ベンチプレス','足上げベンチプレス','スミスマシンベンチプレス','インクラインダンベルプレス','インクラインマシンプレス','スミスマシンインクラインプレス','スミスマシンデクラインプレス','ディップス','ディップス（荷重）','ケーブルクロスオーバー','ペックフライ','チェストプレス'],
  '背中':['デッドリフト','ハーフデッドリフト','懸垂（チンニング）','ラットプルダウン','ラットプルダウン（ナロー）','ラットプルダウン（ちょーナロー）','ワイドラットプルダウン','スミスマシンベントオーバーロウ','ベントオーバーロウ','ローロウ','シーテッドロウ','Tバーロウ'],
  '肩':  ['ダンベルショルダープレス','スミスマシンショルダープレス','マシンショルダープレス','ケーブルフロントレイズ','サイドレイズ','ベンチサイドレイズ','ケーブルサイドレイズ','ケーブルリアレイズ','リアデルトイド'],
  '脚':  ['スクワット','バーベルスクワット','バックスクワット','レッグプレス','レッグカール','レッグエクステンション','インナーサイ','ルーマニアンデッドリフト','スティフレッグデッドリフト'],
  '腕':  ['バーベルカール','インクラインダンベルカール','インクラインダンベルカール（右）','インクラインダンベルカール（左）','ダンベルプリチャーカール（右）','ダンベルプリチャーカール（左）','ハンマーカール','スミスマシンナロープレス','ナロープレス','スカルクラッシャー','フレンチプレス','ケーブルプレスダウン','スミスJMプレス'],
};

// ---- UI state ----
let currentSession = { date: todayStr(), note:'', sets: [] };
let selectedPart   = '胸';
let tplSelectedPart= '胸';

// watchlist
let watchlist = [];                  // [exercise_id]
let watchSelectedPart = '胸';
let _watchChipsBound = false;
let _trendEventsBound = false;
const isWatched = (id) => Array.isArray(watchlist) && watchlist.includes(id);

// timer prefs
let defaultTimerSec = 60;
let autoTimerOn     = false;

// undo stack（直前状態のスナップショット配列）
const undoStack = [];
function pushUndo(){
  try{
    undoStack.push(JSON.stringify(currentSession.sets));
    if(undoStack.length > 30) undoStack.shift();
  }catch(_){}
}
function doUndo(){
  if(!undoStack.length){ showToast('戻すものがありません'); return; }
  const last = undoStack.pop();
  try{
    currentSession.sets = JSON.parse(last) || [];
    renderTodaySets();
    showToast('戻しました');
  }catch{ showToast('戻せませんでした'); }
}

// =================== Warm-up generator helpers ===================
function roundTo(x, step=2.5){
  step = Number(step)||2.5;
  return Math.round((Number(x)||0) / step) * step;
}
function guessSchemeByReps(reps){
  const r = Number(reps)||0;
  if(r <= 5) return 'strength';
  if(r <= 10) return 'hypertrophy';
  return 'endurance';
}
// 進行はトップセット重量からの割合で作成
const WU_PLANS = {
  strength:   [{p:0.40,r:5},{p:0.55,r:3},{p:0.70,r:2},{p:0.80,r:1}],
  hypertrophy:[{p:0.50,r:8},{p:0.70,r:5},{p:0.85,r:2}],
  endurance:  [{p:0.50,r:12},{p:0.65,r:8},{p:0.80,r:3}],
};
function suggestWarmupByTop(topW, topR, schemeSel='auto', roundStep=2.5){
  const scheme = (schemeSel==='auto') ? guessSchemeByReps(topR) : schemeSel;
  const plan   = WU_PLANS[scheme] || WU_PLANS.hypertrophy;
  const out = [];
  const seen = new Set();
  for(const s of plan){
    let w = roundTo(topW * s.p, roundStep);
    w = Math.min(w, topW - roundStep);      // トップより軽く
    if(w <= 0) continue;
    const key = `${w}-${s.r}`;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({weight:w, reps:s.r});
  }
  // 昇順で気持ちよく並ぶように
  out.sort((a,b)=>a.weight - b.weight);
  return out;
}

// =================== Init ===================
async function init(){
  // スクロール中はヘッダーブラーを切って描画負荷を軽減
  (function(){
    let _t;
    window.addEventListener('scroll', ()=>{
      document.body.classList.add('scrolling');
      clearTimeout(_t);
      _t = setTimeout(()=> document.body.classList.remove('scrolling'), 150);
    }, {passive:true});
  })();

  // ↻
  $('#btnHardRefresh')?.addEventListener('click', async ()=>{
    const b = $('#btnHardRefresh'); const old = b.textContent;
    b.disabled = true; b.textContent='更新…'; showToast('最新に更新します…');
    await hardRefresh();
    b.textContent=old; b.disabled=false;
  });

  await openDB();
  await ensureInitialExercises();

  // load prefs
  watchlist       = (await get('prefs','watchlist'))?.value || [];
  defaultTimerSec = Number((await get('prefs','timer_sec'))?.value ?? 60) || 60;
  autoTimerOn     = !!((await get('prefs','auto_timer'))?.value);

  // Tabs
  bindTabs();

  // 最後に開いたタブの復元（あれば）
  const lastTab = (await get('prefs','last_tab'))?.value;
  if(lastTab){
    const btn = document.querySelector(`.tabs button[data-tab="${lastTab}"]`);
    if(btn && !btn.classList.contains('active')) btn.click();
  }

  // Session
  $('#sessDate').value = todayStr();
  bindSessionUI();

  // Custom insert
  bindCustomInsertUI();
  renderTplPartChips();
  await renderTplExSelect();

  // History & Settings
  bindHistoryUI();
  bindSettingsUI();
  await renderWatchUI();
  await renderTrendSelect();

  // Initial renders
  renderPartChips();
  await renderExSelect();
  renderTodaySets();
  renderHistory();
  renderAnalytics();
  renderExList();

  // Theme
  const dark = (await get('prefs','dark'))?.value || false;
  $('#darkToggle').checked = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  refreshTimerButtonLabel();
  await renderWeeklySummary(); // 週次サマリー初回描画
}

async function ensureInitialExercises(){
  const all = await getAll('exercises');
  const byName = Object.fromEntries(all.map(e=>[e.name, e]));
  for(const p of PARTS){
    for(const name of EX_GROUPS[p]){
      const hit = byName[name];
      if(!hit){ await put('exercises', {name, group:p}); }
      else if(!hit.group){ await put('exercises', {...hit, group:p}); }
    }
  }
}

// =================== Tabs ===================
function bindTabs(){
  $$('.tabs button').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      $$('.tabs button').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');

      const tab = btn.dataset.tab;
      $$('.tab').forEach(s=>s.classList.remove('active'));
      $('#tab-'+tab).classList.add('active');

      // 最後に開いたタブを保存
      put('prefs', {key:'last_tab', value:tab}).catch(()=>{});

      if(tab==='history') renderHistory();
      if(tab==='analytics') renderAnalytics();
      if(tab==='settings'){ renderExList(); renderWatchUI(); }
    });
  });
}

// =================== Session ===================
function renderPartChips(){
  $$('#partChips .chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.part === selectedPart);
  });
}

function bindSessionUI(){
  const chips = $('#partChips');
  if (chips){
    chips.addEventListener('click', async (e)=>{
      const b = e.target.closest('.chip'); if(!b) return;
      selectedPart = b.dataset.part;
      renderPartChips();
      await renderExSelect();
      $('#weight').value=''; $('#reps').value=''; $('#rpe').value='';
    });
  }

  // スマート入力
  ['weight','reps','rpe'].forEach(id=>{
    const el = $('#'+id);
    el?.addEventListener('input', handleSmartInput, {passive:true});
    el?.addEventListener('change', handleSmartInput);
    el?.addEventListener('paste', ()=> setTimeout(handleSmartInput, 0));
  });

  // Enter で投入
  $('#rpe')?.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); $('#btnAddSet')?.click(); }
  });

  // ★ ウォームアップ自動生成
  $('#btnGenWarmup')?.addEventListener('click', async ()=>{
    const exId = Number($('#exSelect').value);
    const wTop = Number($('#weight').value);
    const rTop = Number($('#reps').value);
    if(!exId){ showToast('種目を選んでください'); return; }
    if(!(wTop>0) || !(rTop>0)){ showToast('トップセットの重量と回数を入力'); return; }

    const scheme = ($('#wuScheme')?.value)||'auto';
    const step   = Number($('#wuRound')?.value||'2.5') || 2.5;
    const plan   = suggestWarmupByTop(wTop, rTop, scheme, step);
    if(!plan.length){ showToast('生成できるWUがありません'); return; }

    pushUndo();
    const date = $('#sessDate').value;
    const now  = Date.now();
    plan.forEach((s,i)=>{
      currentSession.sets.push({
        temp_id: crypto.randomUUID(),
        exercise_id: exId,
        weight: s.weight,
        reps: s.reps,
        rpe: null,
        ts: now + i,
        date,
        wu: true
      });
    });
    renderTodaySets();
    showToast('ウォームアップを追加しました');
  });

  // カスタム種目追加
  $('#btnAddEx')?.addEventListener('click', async ()=>{
    const name = prompt('種目名を入力（例：懸垂）'); if(!name) return;
    try{
      await put('exercises', {name, group:selectedPart});
      await renderExSelect(); await renderTplExSelect(); await renderExList(); await renderWatchUI(); await renderTrendSelect();
      showToast('種目を追加しました');
    }catch{ showToast('同名の種目があります'); }
  });

  // セット追加（PR判定は保存済み履歴+未保存の当日分、ウォッチ種目のみ通知）
  $('#btnAddSet')?.addEventListener('click', async ()=>{
    const exId = Number($('#exSelect').value);
    const weight = Number($('#weight').value);
    const reps   = Number($('#reps').value);
    const rpeStr = $('#rpe').value;
    if(!exId || !weight || !reps){ showToast('種目・重量・回数は必須です'); return; }

    // 追加前にPR判定
    let willPR = false;
    if (isWatched(exId)) {
      const curE1 = e1rm(weight,reps);
      const hist = (await getAll('sets')).filter(s=>s.exercise_id===exId);
      const histBest = Math.max(0, ...hist.map(s=>e1rm(s.weight,s.reps)));
      const sessBest = Math.max(0, ...currentSession.sets.filter(s=>s.exercise_id===exId).map(s=>e1rm(s.weight,s.reps)));
      const bestSoFar = Math.max(histBest, sessBest);
      willPR = curE1 > bestSoFar;
    }

    // undo用スナップショット
    pushUndo();

    // 追加
    currentSession.sets.push({
      temp_id: crypto.randomUUID(),
      exercise_id: exId, weight, reps,
      rpe: rpeStr ? Number(rpeStr) : null,
      ts: Date.now(), date: $('#sessDate').value
    });

    if(willPR){
      showToast('e1RM更新！（ウォッチ）');
      if('vibrate' in navigator) navigator.vibrate([60,40,60]);
    }

    // 自動タイマー
    if(autoTimerOn) startRestTimer(defaultTimerSec);

    // クリア
    $('#weight').value=''; $('#reps').value=''; $('#rpe').value='';
    renderTodaySets();
  });

  // タイマー（既定秒）
  $('#btnTimer')?.addEventListener('click', ()=>startRestTimer(defaultTimerSec));

  // 一手戻す
  $('#btnUndo')?.addEventListener('click', doUndo);

  $('#btnSaveSession')?.addEventListener('click', async ()=>{
    if(!currentSession.sets.length){ showToast('セットがありません'); return; }
    const date = $('#sessDate').value;
    const note = $('#sessNote').value;

    pushUndo();

    const sessionId = await put('sessions',{date, note, created_at: Date.now()});
    for(const s of currentSession.sets){
      await put('sets',{session_id:sessionId, exercise_id:s.exercise_id, weight:s.weight, reps:s.reps, rpe:s.rpe, ts:s.ts, date});
    }
    currentSession = { date: todayStr(), note:'', sets: [] };
    $('#sessDate').value = todayStr(); $('#sessNote').value = '';
    renderTodaySets(); renderHistory(); renderAnalytics();
    await renderWeeklySummary();
    showToast('セッションを保存しました');
  });

  // カスタム投入のみ
  $('#btnTplCustom')?.addEventListener('click', applyCustomInsert);

  // 種目切替時、前回値プリフィル
  $('#exSelect')?.addEventListener('change', async ()=>{
    const exId = Number($('#exSelect').value);
    if(!exId){ $('#weight').value=''; $('#reps').value=''; $('#rpe').value=''; return; }
    const sets = (await getAll('sets')).filter(s=>s.exercise_id===exId).sort((a,b)=>b.ts-a.ts);
    if(sets[0]){ $('#weight').value = sets[0].weight; $('#reps').value = sets[0].reps; $('#rpe').value = sets[0].rpe ?? ''; }
    else { $('#weight').value=''; $('#reps').value=''; $('#rpe').value=''; }
  });
}

// スマート入力パーサ
function parseSmart(s){
  if(!s || typeof s!=='string') return null;
  const str = s.trim().replace(/＊/g,'*').replace(/×/g,'x').toLowerCase();
  const m = str.match(/^(\d+(?:\.\d+)?)\s*[x\*]\s*(\d+)(?:\s*@\s*(\d+(?:\.\d+)?))?$/);
  if(!m) return null;
  return {w: Number(m[1]), r: Number(m[2]), p: m[3]!==undefined ? Number(m[3]) : null};
}
function handleSmartInput(e){
  const v = e?.target?.value ?? '';
  const parsed = parseSmart(v);
  if(!parsed) return;
  $('#weight').value = String(parsed.w);
  $('#reps').value   = String(parsed.r);
  $('#rpe').value    = parsed.p!=null ? String(parsed.p) : '';
  showToast('スマート入力を適用');
}

// ======== Custom insert ========
function renderTplPartChips(){
  $$('#tplPartChips .chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.part === tplSelectedPart);
  });
}
function bindCustomInsertUI(){
  const chips = $('#tplPartChips');
  if (!chips) return;
  chips.addEventListener('click', async (e)=>{
    const b = e.target.closest('.chip'); if(!b) return;
    tplSelectedPart = b.dataset.part;
    renderTplPartChips();
    await renderTplExSelect();
  });
}
async function renderTplExSelect(){
  const sel = $('#tplExCustom'); if(!sel) return;
  let exs = await getAll('exercises');
  exs = exs.filter(e=>e.group===tplSelectedPart).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  sel.innerHTML = `<option value="">（選択する）</option>` +
    (exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>オプションなし</option>');
  sel.value = '';
}

async function renderExSelect(){
  let exs = await getAll('exercises');
  exs = exs.filter(e=>e.group===selectedPart).sort((a,b)=> a.name.localeCompare(b.name, 'ja'));
  const sel = $('#exSelect');
  if (sel){
    const prev = sel.value || '';
    sel.innerHTML = `<option value="">（選択する）</option>` +
      (exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>オプションなし</option>');
    if(prev && exs.some(e=>String(e.id)===prev)) sel.value = prev; else sel.value = '';
  }
}

// ---- today list ----
function renderTodaySets(){
  const ul = $('#todaySets'); if(!ul) return;
  if(!currentSession.sets.length){ ul.innerHTML = '<li>まだありません</li>'; return; }
  ul.innerHTML = currentSession.sets.map(s=>{
    const wu = s.wu ? `<span class="badge">WU</span> ` : '';
    return `<li>
      <span>${wu}<strong>${esc(exNameById(s.exercise_id))}</strong> ${s.weight}kg × ${s.reps}${s.rpe?` RPE${s.rpe}`:''}</span>
      <span style="display:flex; gap:6px">
        <button class="ghost" data-act="edit" data-id="${s.temp_id}">編集</button>
        <button class="ghost" data-act="del"  data-id="${s.temp_id}">削除</button>
      </span>
    </li>`;
  }).join('');

  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id  = b.dataset.id;
      const act = b.dataset.act;
      const item = currentSession.sets.find(x=>x.temp_id===id);
      if(!item) return;

      if(act==='del'){
        pushUndo();
        currentSession.sets = currentSession.sets.filter(x=>x.temp_id !== id);
        renderTodaySets();
      }
      if(act==='edit'){
        pushUndo();
        currentSession.sets = currentSession.sets.filter(x=>x.temp_id !== id);
        renderTodaySets();

        const ex = (await getAll('exercises')).find(e=>e.id===item.exercise_id);
        if(ex && ex.group && ex.group !== selectedPart){
          selectedPart = ex.group;
          renderPartChips();
          await renderExSelect();
        }
        $('#exSelect').value = String(item.exercise_id);
        $('#weight').value   = String(item.weight);
        $('#reps').value     = String(item.reps);
        $('#rpe').value      = item.rpe ?? '';
        showToast('編集用に読み込みました');
        window.scrollTo({top:0, behavior:'smooth'});
      }
    });
  });
}
function exNameById(id){
  const opt = $('#exSelect')?.querySelector(`option[value="${id}"]`) ||
              $('#tplExCustom')?.querySelector(`option[value="${id}"]`);
  return opt ? opt.textContent : '種目';
}

async function applyCustomInsert(){
  const n = Number($('#tplCustomSets').value || '5');
  const r = Number($('#tplCustomReps').value || '5');
  const w = Number($('#tplCustomWeight').value || '0');
  const exId = Number($('#tplExCustom').value);
  if(!exId){ showToast('種目を選んでください'); return; }
  const date = $('#sessDate').value;
  const now  = Date.now();

  pushUndo();
  for(let i=0;i<n;i++){
    currentSession.sets.push({ temp_id:crypto.randomUUID(), exercise_id:exId, weight:w, reps:r, rpe:null, ts: now+i, date });
  }
  renderTodaySets(); showToast('カスタム投入しました');
}

// ---- Timer ----
let timerHandle=null, timerLeft=0;
function refreshTimerButtonLabel(){
  const btn = $('#btnTimer');
  if(btn && (timerHandle===null || timerLeft<=0)){
    btn.textContent = `休憩${defaultTimerSec}s`;
  }
}
function startRestTimer(sec){
  clearInterval(timerHandle);
  timerLeft = sec;
  const btn = $('#btnTimer');
  btn.disabled = true;
  btn.textContent = `休憩${timerLeft}s`;
  timerHandle = setInterval(()=>{
    timerLeft -= 1;
    btn.textContent = `休憩${timerLeft}s`;
    if(timerLeft<=0){
      clearInterval(timerHandle);
      timerHandle = null;
      btn.textContent=`休憩${defaultTimerSec}s`;
      btn.disabled=false;
      if('vibrate' in navigator) navigator.vibrate([120,80,120]);
      try{ new Audio('beep.wav').play().catch(()=>{}); }catch(e){}
      if('Notification' in window && Notification.permission==='granted'){
        new Notification('休憩終了',{ body:'次のセットへ', icon:'icons/icon-192.png' });
      }
      showToast('休憩終了');
    }
  }, 1000);
}

// =================== History ===================
function bindHistoryUI(){
  $('#historyCount')?.addEventListener('change', renderHistory);
  $('#btnExport')?.addEventListener('click', exportCSV);
  $('#importFile')?.addEventListener('change', importCSV);
}
async function renderHistory(){
  const count = Number($('#historyCount')?.value || 20);
  const sessions = (await getAll('sessions')).sort((a,b)=>b.created_at-a.created_at).slice(0,count);
  const ul = $('#historyList'); if(!ul) return;
  ul.innerHTML = '';

  for(const s of sessions){
    const sets = await indexGetAll('sets','by_session', s.id);
    const vol = sets.reduce((sum,x)=> sum + x.weight*x.reps, 0);
    const est = sets.length ? Math.max(...sets.map(x=> e1rm(x.weight,x.reps))) : 0;

    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${s.date}</strong>
        <span class="badge">${Math.round(vol)}kg</span>
        <span class="badge">1RM推定:${Math.round(est)}kg</span>
        <div style="font-size:12px;color:var(--muted)">${esc(s.note||'')}</div>
      </div>
      <div style="display:flex; gap:6px">
        <button class="ghost" data-act="dup"  data-id="${s.id}">複製</button>
        <button class="ghost" data-act="edit" data-id="${s.id}">編集</button>
        <button class="danger" data-act="del"  data-id="${s.id}">削除</button>
      </div>`;
    ul.appendChild(li);
  }
  if(!sessions.length) ul.innerHTML = '<li>まだありません</li>';

  if(!ul._bound){
    ul.addEventListener('click', async (e)=>{
      const b = e.target.closest('button'); if(!b) return;
      const id = Number(b.dataset.id), act=b.dataset.act;
      if(act==='del'){ if(confirm('このセッションを削除しますか？')) await deleteSession(id); }
      if(act==='edit'){ await editSessionNote(id); }
      if(act==='dup'){ await duplicateSessionToToday(id); }
    });
    ul._bound = true;
  }
}

// =================== Analytics ===================
// 共通リサイズ
function _resizeCanvas(canvas, targetHeight = 260){
  const dpr  = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w    = Math.max(200, Math.floor(rect.width));
  const h    = targetHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr){
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
function _lastNDays(n){
  const base = new Date();
  base.setHours(0,0,0,0); // ローカル0時
  const days=[];
  for(let i=n-1;i>=0;i--){
    const d = new Date(base); d.setDate(base.getDate()-i);
    days.push({ key: ymdLocal(d), label:`${d.getMonth()+1}/${d.getDate()}` });
  }
  return days;
}

// === Chart helpers (nice ticks & format) ===
function _niceRange(min, max, ticksDesired = 5){
  if (!isFinite(min) || !isFinite(max)) return { niceMin: 0, niceMax: 1, step: 1 };
  if (min === max){
    const p = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.abs(max)||1))));
    return { niceMin: Math.floor((min - p)/p)*p, niceMax: Math.ceil((max + p)/p)*p, step: p };
  }
  const span = max - min;
  const raw = span / Math.max(2, ticksDesired);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = (norm <= 1) ? 1*mag : (norm <= 2) ? 2*mag : (norm <= 5) ? 5*mag : 10*mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil (max / step) * step;
  return { niceMin, niceMax, step };
}

// --- Bar (直近7日の合計ボリューム) ---
function _drawBarChart(canvas, days, totals, hoverIndex = -1){
  _resizeCanvas(canvas, 260);
  const ctx = canvas.getContext('2d');
  const W = canvas.getBoundingClientRect().width, H = 260;

  // 余白
  const T = 26, R = 12, B = 30;

  // まずデータ範囲（少し余白を足す）
  const maxV = Math.max(1, ...totals);
  const { niceMin, niceMax, step } = _niceRange(0, maxV * 1.08, 5);
  const yFor = v => (H - B) - ((v - niceMin) / (niceMax - niceMin)) * (H - B - T);

  // 左余白は縦軸ラベル幅で自動調整
  ctx.font = '12px system-ui';
  const yLabels = [];
  for(let v = niceMin; v <= niceMax + 1e-9; v += step){ yLabels.push(v); }
  const widest = Math.max(...yLabels.map(v => ctx.measureText(String(Math.round(v))).width));
  const L = Math.max(42, Math.ceil(widest) + 14);

  // クリア & 軸
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle = '#9993'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H-B); ctx.lineTo(W-R, H-B); ctx.stroke();

  // グリッド & 縦軸ラベル
  ctx.strokeStyle = '#9992';
  ctx.fillStyle = '#9aa4b2'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for(const v of yLabels){
    const y = yFor(v);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W-R, y); ctx.stroke();
    ctx.fillText(String(Math.round(v)), L - 6, y);
  }

  // Xラベル
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = '12px system-ui';
  const innerW = W - L - R, stepX = innerW / days.length;
  for(let i=0;i<days.length;i++){
    const x = L + i*stepX + stepX/2;
    ctx.fillStyle = '#9aa4b2';
    ctx.fillText(days[i].label, x, H - 8);
  }

  // データなしメッセージ
  if (totals.every(v => v <= 0)){
    ctx.fillStyle = '#9aa4b2'; ctx.textAlign='center'; ctx.font='14px system-ui';
    ctx.fillText('まだデータがありません。セットを追加すると表示されます。', W/2, (H-B+T)/2);
    canvas._chartDims = {L, step: stepX, barW: Math.min(32, stepX*0.58), W,H,T,B,max:niceMax};
    canvas._days = days; canvas._totals = totals; return;
  }

  // 棒
  const barW = Math.min(32, stepX * 0.58);
  for(let i=0;i<totals.length;i++){
    const v = totals[i];
    const xC = L + i*stepX + stepX/2;
    const h  = ((v - niceMin) / (niceMax - niceMin)) * (H - B - T);
    const x  = xC - barW/2;
    const y  = (H - B) - h;
    ctx.fillStyle = (i===hoverIndex) ? '#0fb6a9' : '#6cc7bf';
    ctx.fillRect(Math.round(x)+0.5, Math.round(y), Math.round(barW), Math.round(h));

    // 値ラベル（上に表示・切れないようクランプ）
    if(v > 0){
      const yLabel = Math.max(T + 12, y - 6);
      ctx.fillStyle = '#4a5568';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(Math.round(v)), xC, yLabel);
    }
  }

  // ホバー用メタ
  canvas._chartDims = {L, step: stepX, barW, W,H,T,B,max:niceMax};
  canvas._days = days; canvas._totals = totals;
}

// --- Line (e1RM 推移) ---
function _drawLineChart(canvas, labels, values, hoverIndex = -1){
  _resizeCanvas(canvas, 260);
  const ctx = canvas.getContext('2d');
  const W = canvas.getBoundingClientRect().width, H = 260;

  const T = 26, R = 12, B = 30;

  ctx.clearRect(0,0,W,H);

  if(values.length === 0){
    const L = 56; // デフォ左余白
    ctx.strokeStyle='#9993'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
    ctx.fillStyle='#9aa4b2'; ctx.textAlign='center'; ctx.font='14px system-ui';
    ctx.fillText('まだデータがありません。', W/2, (H-B+T)/2);
    canvas._trendDims = {L, step:1, W,H,T,B,minV:0,maxV:1};
    canvas._labels = labels; canvas._values = values;
    return;
  }

  // 余白を加えたレンジ
  const minV0 = Math.min(...values), maxV0 = Math.max(...values);
  const pad = Math.max(1, (maxV0 - minV0) * 0.10);
  const { niceMin, niceMax, step } = _niceRange(Math.max(0, minV0 - pad), maxV0 + pad, 5);

  // 左余白をラベル幅で調整
  ctx.font = '12px system-ui';
  const tickVals = []; for(let v = niceMin; v <= niceMax + 1e-9; v += step){ tickVals.push(v); }
  const widest = Math.max(...tickVals.map(v => ctx.measureText(String(Math.round(v))).width));
  const L = Math.max(56, Math.ceil(widest) + 16);

  const innerW = W - L - R;
  const stepX = (labels.length <= 1) ? innerW : innerW / (labels.length - 1);
  const yFor = v => (H - B) - ((v - niceMin) / (niceMax - niceMin)) * (H - B - T);

  // 軸
  ctx.strokeStyle='#9993'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();

  // グリッド & 縦軸ラベル
  ctx.strokeStyle='#9992';
  ctx.fillStyle='#9aa4b2'; ctx.textAlign='right'; ctx.textBaseline='middle';
  for(const v of tickVals){
    const y = yFor(v);
    ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-R,y); ctx.stroke();
    ctx.fillText(String(Math.round(v)), L - 6, y);
  }

  // Xラベル（端＋間引き）
  ctx.textAlign='center'; ctx.textBaseline='alphabetic';
  const tickN = Math.min(6, labels.length);
  for(let i=0;i<labels.length;i++){
    if(i===0 || i===labels.length-1 || i % Math.ceil(labels.length/(tickN||1))===0){
      const x = L + i*stepX;
      ctx.fillStyle='#9aa4b2';
      ctx.fillText(labels[i], x, H-8);
    }
  }

  // 折れ線
  ctx.strokeStyle='#0fb6a9'; ctx.lineWidth=2; ctx.beginPath();
  for(let i=0;i<values.length;i++){
    const x = L + i*stepX, y = yFor(values[i]);
    (i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  }
  ctx.stroke();

  // ポイント & ホバー表示
  for(let i=0;i<values.length;i++){
    const x = L + i*stepX, y = yFor(values[i]);
    ctx.fillStyle = (i===hoverIndex)? '#0fb6a9' : '#6cc7bf';
    ctx.beginPath(); ctx.arc(x,y,3.2,0,Math.PI*2); ctx.fill();

    if(i===hoverIndex){
      const tip = `${labels[i]}  ${Math.round(values[i])} kg`;
      const tw = ctx.measureText(tip).width + 10, th = 22;
      const tx = Math.min(W - R - tw, Math.max(L, x - tw/2));
      const ty = Math.max(T + 6, Math.min(H - B - th - 4, y - 10 - th));
      ctx.fillStyle='#0fb6a9'; ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='12px system-ui';
      ctx.fillText(tip, tx + tw/2, ty + th/2);
    }
  }

  canvas._trendDims = {L, step: stepX, W,H,T,B, minV: niceMin, maxV: niceMax};
  canvas._labels = labels; canvas._values = values;
}

let _chartEventsBound = false;
async function renderAnalytics(){
  // ---- volume bar ----
  const canvas = $('#chart'); if(canvas){
    const sets = await getAll('sets');
    const days = _lastNDays(7);
    const totals = days.map(d => sets.filter(s => s.date === d.key).reduce((sum,x)=> sum + x.weight * x.reps, 0));
    _drawBarChart(canvas, days, totals, -1);

    if(!_chartEventsBound){
      const pickIndex = (evt)=>{
        const r = canvas.getBoundingClientRect();
        const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
        const dims = canvas._chartDims || {L:0, step:1};
        const i = Math.floor((x - dims.L) / dims.step);
        return (i>=0 && i<(canvas._days?.length||0)) ? i : -1;
      };
      const redraw = (i=-1)=> _drawBarChart(canvas, canvas._days||[], canvas._totals||[], i);
      const onResize = debounce(()=> redraw(-1), 120);
      canvas.addEventListener('mousemove', (e)=> redraw(pickIndex(e)));
      canvas.addEventListener('mouseleave', ()=> redraw(-1));
      canvas.addEventListener('touchstart', (e)=> redraw(pickIndex(e)), {passive:true});
      canvas.addEventListener('touchmove',  (e)=> redraw(pickIndex(e)), {passive:true});
      window.addEventListener('resize', onResize);
      _chartEventsBound = true;
    }

    // metrics
    const recentKeys = new Set(days.map(d=>d.key));
    const recentSets = sets.filter(s => recentKeys.has(s.date));
    const total7     = totals.reduce((a,b)=>a+b,0);
    const uniqEx     = new Set(recentSets.map(s=>s.exercise_id)).size;
    const m = $('#metrics');
    if(m) m.innerHTML = `<div>直近7日ボリューム</div><div>${Math.round(total7)} kg</div><div>種目数</div><div>${uniqEx} 種目</div>`;
    const legend = $('#legend'); if (legend) legend.innerHTML = '';
  }

  // ---- e1RM trend ----
  await renderTrendSelect();
  await renderTrendChart();

  // 週次サマリーも更新
  await renderWeeklySummary();
}

// === e1RM trend helpers ===
async function renderTrendSelect(){
  const sel = $('#exTrendSelect'); if(!sel) return;
  const hint = $('#trendHint');
  const allEx = await getAll('exercises');
  const nameById = Object.fromEntries(allEx.map(e=>[e.id,e.name]));

  if(!watchlist.length){
    sel.innerHTML = `<option value="">設定 → ウォッチ種目で追加してください</option>`;
    if(hint) hint.textContent = '設定タブの「ウォッチ種目」で追加すると、ここで選べます。';
    return;
  }
  sel.innerHTML = watchlist
    .filter(id=>nameById[id])
    .map(id=>`<option value="${id}">${esc(nameById[id])}</option>`).join('');

  if(hint) hint.textContent = '';
  if(!sel.value) sel.value = String(watchlist[0]);
  if(!sel._bound){
    sel.addEventListener('change', renderTrendChart);
    $('#trendRange')?.addEventListener('change', renderTrendChart);
    sel._bound = true;
  }
}

async function renderTrendChart(){
  const canvas = $('#trendChart'); if(!canvas) return;
  const sel = $('#exTrendSelect'); const rangeSel = $('#trendRange');
  const exId = Number(sel?.value||0);
  const range = (rangeSel?.value||'10');

  const info = $('#trendInfo');
  if(!exId){ _drawLineChart(canvas, [], []); if(info) info.innerHTML=''; return; }

  const sets = await getAll('sets');
  const rows = sets.filter(s=>s.exercise_id===exId);
  const byDate = {};
  rows.forEach(s=>{
    const v = e1rm(s.weight, s.reps);
    if(!byDate[s.date] || v>byDate[s.date]) byDate[s.date]=v;
  });
  const points = Object.entries(byDate)
    .map(([date,v])=>({date, v, ts:new Date(date).getTime()}))
    .sort((a,b)=>a.ts-b.ts);

  let data = points;
  if(range!=='all'){
    const n = Number(range)||10;
    data = points.slice(-n);
  }

  const labels = data.map(p=>{ const d = new Date(p.ts); return `${d.getMonth()+1}/${d.getDate()}`; });
  const values = data.map(p=>p.v);

  _drawLineChart(canvas, labels, values, -1);

  if(!_trendEventsBound){
    const pickIndex = (evt)=>{
      const r = canvas.getBoundingClientRect();
      const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
      const dims = canvas._trendDims || {L:0, step:1};
      const i = Math.round((x - dims.L) / dims.step);
      return (i>=0 && i<(canvas._labels?.length||0)) ? i : -1;
    };
    const redraw = (i=-1)=> _drawLineChart(canvas, canvas._labels||[], canvas._values||[], i);
    const onResize = debounce(()=> redraw(-1), 120);
    canvas.addEventListener('mousemove', (e)=> redraw(pickIndex(e)));
    canvas.addEventListener('mouseleave', ()=> redraw(-1));
    canvas.addEventListener('touchstart', (e)=> redraw(pickIndex(e)), {passive:true});
    canvas.addEventListener('touchmove',  (e)=> redraw(pickIndex(e)), {passive:true});
    window.addEventListener('resize', onResize);
    _trendEventsBound = true;
  }

  const latest = values.at(-1)||0;
  const best   = Math.max(0, ...values);
  if(info){
    info.innerHTML = `
      <span class="badge">最新: ${Math.round(latest)} kg</span>
      <span class="badge">ベスト: ${Math.round(best)} kg</span>
      <span class="badge">データ: ${values.length} 回</span>
    `;
  }
}

// =================== Settings ===================
function bindSettingsUI(){
  const timerSel = $('#timerSec');
  if(timerSel){ timerSel.value = String(defaultTimerSec); }
  const autoCk = $('#autoTimer');
  if(autoCk){ autoCk.checked = !!autoTimerOn; }

  $('#timerSec')?.addEventListener('change', async (e)=>{
    defaultTimerSec = Number(e.target.value) || 60;
    await put('prefs',{key:'timer_sec', value:defaultTimerSec});
    refreshTimerButtonLabel();
  });
  $('#autoTimer')?.addEventListener('change', async (e)=>{
    autoTimerOn = !!e.target.checked;
    await put('prefs',{key:'auto_timer', value:autoTimerOn});
  });

  $('#darkToggle')?.addEventListener('change', async (e)=>{
    const on = e.target.checked;
    document.documentElement.dataset.theme = on ? 'dark' : 'light';
    await put('prefs',{key:'dark', value:on});
  });

  $('#btnNotif')?.addEventListener('click', async ()=>{
    if(!('Notification' in window)){ showToast('この端末は通知に未対応'); return; }
    const perm = await Notification.requestPermission();
    showToast(perm==='granted' ? '通知を許可しました' : '通知は許可されていません');
  });

  $('#btnCreateEx')?.addEventListener('click', async ()=>{
    const name = $('#newExName').value.trim();
    const part = $('#newExPart').value || undefined;
    if(!name) return;
    try{
      await put('exercises',{name, group:part});
      $('#newExName').value='';
      await renderExList(); await renderExSelect(); await renderTplExSelect(); await renderWatchUI(); await renderTrendSelect();
      showToast('追加しました');
    }catch{ showToast('同名の種目があります'); }
  });

  $('#filterPart')?.addEventListener('change', renderExList);

  $('#btnWipe')?.addEventListener('click', async ()=>{
    if(!confirm('本当に全データを削除しますか？')) return;
    for(const s of ['sessions','sets','exercises']){
      await new Promise((res,rej)=>{ const r = tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    await ensureInitialExercises();
    await renderExList(); await renderExSelect(); await renderTplExSelect(); renderHistory(); renderAnalytics(); renderTodaySets(); await renderWatchUI(); await renderTrendSelect();
    await renderWeeklySummary();
    showToast('全データを削除しました');
  });

  // JSON backup
  $('#btnExportJson')?.addEventListener('click', async ()=>{
    const data = {
      sessions: await getAll('sessions'),
      sets: await getAll('sets'),
      exercises: await getAll('exercises'),
      prefs: await getAll('prefs')
    };
    const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'train_punch_backup.json'; a.click();
    URL.revokeObjectURL(url);
  });
  $('#jsonIn')?.addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const data = JSON.parse(await file.text());
    for(const s of ['sessions','sets','exercises','prefs']){
      await new Promise((res,rej)=>{ const r = tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    for(const x of (data.exercises||[])) await put('exercises', x);
    for(const x of (data.sessions ||[])) await put('sessions', x);
    for(const x of (data.sets     ||[])) await put('sets', x);
    for(const x of (data.prefs    ||[])) await put('prefs', x);
    watchlist       = (await get('prefs','watchlist'))?.value || [];
    defaultTimerSec = Number((await get('prefs','timer_sec'))?.value ?? 60) || 60;
    autoTimerOn     = !!((await get('prefs','auto_timer'))?.value);
    if($('#timerSec')) $('#timerSec').value = String(defaultTimerSec);
    if($('#autoTimer')) $('#autoTimer').checked = !!autoTimerOn;
    refreshTimerButtonLabel();

    await renderExList(); await renderExSelect(); await renderTplExSelect(); renderHistory(); renderAnalytics(); renderTodaySets(); await renderWatchUI(); await renderTrendSelect();
    await renderWeeklySummary();
    showToast('復元しました'); e.target.value='';
  });
}

async function renderExList(){
  const filt = $('#filterPart')?.value || 'all';
  let exs = await getAll('exercises');
  if(filt !== 'all') exs = exs.filter(e=>e.group===filt);
  exs.sort((a,b)=> (a.group||'').localeCompare(b.group||'','ja') || a.name.localeCompare(b.name,'ja'));

  const ul = $('#exList'); if(!ul) return;
  ul.innerHTML = exs.map(e=>{
    const tag = e.group ? `<span class="badge" style="margin-right:8px">${esc(e.group)}</span>` : '';
    return `<li><span>${tag}${esc(e.name)}</span><button class="ghost" data-id="${e.id}">削除</button></li>`;
  }).join('') || '<li>まだありません</li>';

  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      pushUndo();
      await del('exercises', Number(b.dataset.id));
      await renderExList(); await renderExSelect(); await renderTplExSelect(); renderAnalytics(); await renderWatchUI(); await renderTrendSelect();
      await renderWeeklySummary();
    });
  });
}

// ---- Watchlist UI (settings) ----
function renderWatchPartChips(){
  $$('#watchPartChips .chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.part === watchSelectedPart);
  });
}
function bindWatchPartChips(){
  const chips = $('#watchPartChips');
  if(!chips || _watchChipsBound) return;
  chips.addEventListener('click', (e)=>{
    const b = e.target.closest('.chip'); if(!b) return;
    watchSelectedPart = b.dataset.part;
    renderWatchPartChips();
    renderWatchUI();
  });
  _watchChipsBound = true;
}

async function renderWatchUI(){
  bindWatchPartChips();
  renderWatchPartChips();

  const sel = $('#watchExSelect'); const list = $('#watchList');
  let exs = await getAll('exercises');
  exs = exs.filter(e=>e.group===watchSelectedPart).sort((a,b)=> a.name.localeCompare(b.name,'ja'));

  if(sel){
    sel.innerHTML = `<option value="">（選択する）</option>` +
      (exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>オプションなし</option>');
    sel.value = '';
  }
  if(list){
    const nameById = Object.fromEntries((await getAll('exercises')).map(e=>[e.id,e.name]));
    list.innerHTML = watchlist.length
      ? watchlist.filter(id=>nameById[id]).map(id=>`<li><span>${esc(nameById[id])}</span><button class="ghost" data-id="${id}">削除</button></li>`).join('')
      : '<li>まだありません</li>';
    list.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const id = Number(b.dataset.id);
        watchlist = watchlist.filter(x=>x!==id);
        await put('prefs',{key:'watchlist', value:watchlist});
        await renderWatchUI(); await renderTrendSelect(); await renderTrendChart();
        await renderWeeklySummary();
      });
    });
  }
  const addBtn = $('#btnWatchAdd');
  if(addBtn && !addBtn._bound){
    addBtn.addEventListener('click', async ()=>{
      const id = Number($('#watchExSelect').value); if(!id){ showToast('種目を選んでください'); return; }
      if(!watchlist.includes(id)) watchlist.push(id);
      await put('prefs',{key:'watchlist', value:watchlist});
      await renderWatchUI(); await renderTrendSelect(); await renderTrendChart();
      await renderWeeklySummary();
      showToast('ウォッチに追加しました');
    });
    addBtn._bound = true;
  }
}

// =================== CSV ===================
async function exportCSV(){
  const sessions = await getAll('sessions');
  const sets = await getAll('sets');
  const header1 = '##SESSIONS\nid,date,note\n';
  const lines1  = sessions.map(s=> `${s.id},${s.date},${csvEscape(s.note||'')}`).join('\n');
  const header2 = '\n##SETS\nid,session_id,exercise_id,weight,reps,rpe,ts,date\n';
  const lines2  = sets.map(s=> [s.id,s.session_id,s.exercise_id,s.weight,s.reps,(s.rpe??''),s.ts,s.date].join(',')).join('\n');
  const blob = new Blob([header1+lines1+header2+lines2], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='train_punch_export.csv'; a.click();
  URL.revokeObjectURL(url);
}
async function importCSV(e){
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  const [_, sBlock, setBlock] = text.split('##SESSIONS');
  if(!setBlock){ showToast('形式が違います'); e.target.value=''; return; }
  const [sessionsPart, setsPart] = ('##SESSIONS'+setBlock).split('##SETS');
  const sLines   = sessionsPart.split(/\r?\n/).slice(2).filter(Boolean);
  const setLines = setsPart.split(/\r?\n/).slice(2).filter(Boolean);

  for(const s of ['sessions','sets']){ await new Promise((res,rej)=>{ const r = tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

  for(const line of sLines){
    const [id,date,note] = parseCSVRow(line);
    await put('sessions', {id:Number(id), date, note, created_at:new Date(date).getTime()});
  }
  for(const line of setLines){
    const [id,session_id,exercise_id,weight,reps,rpe,ts,date] = parseCSVRow(line);
    await put('sets',{id:Number(id), session_id:Number(session_id), exercise_id:Number(exercise_id), weight:Number(weight), reps:Number(reps), rpe:rpe?Number(rpe):null, ts:Number(ts), date});
  }
  renderHistory(); renderAnalytics(); await renderWeeklySummary();
  showToast('インポート完了'); e.target.value='';
}
function csvEscape(s){ const needs=/[",\n]/.test(s); return needs?'"'+String(s).replace(/"/g,'""')+'"':s; }
function parseCSVRow(row){
  const out=[]; let cur='', q=false;
  for(let i=0;i<row.length;i++){
    const c=row[i];
    if(q){ if(c=='"'){ if(row[i+1]=='"'){cur+='"'; i++;} else q=false; } else cur+=c; }
    else { if(c===','){ out.push(cur); cur=''; } else if(c=='"'){ q=true; } else cur+=c; }
  } out.push(cur); return out;
}

// =================== History ops ===================
async function deleteSession(id){
  const sets = await indexGetAll('sets','by_session', id);
  await Promise.all(sets.map(s=> del('sets', s.id)));
  await del('sessions', id);
  renderHistory(); renderAnalytics(); await renderWeeklySummary();
  showToast('セッションを削除しました');
}
async function editSessionNote(id){
  const s = await get('sessions', id);
  const next = prompt('メモを編集', s?.note || '');
  if(next===null) return;
  s.note = next; await put('sessions', s); renderHistory(); showToast('メモを更新しました');
}
async function duplicateSessionToToday(id){
  const src = await get('sessions', id);
  const today = todayStr();
  const newId = await put('sessions', {date:today, note:(src?.note||'')+' (複製)', created_at: Date.now()});
  const sets = await indexGetAll('sets','by_session', id);
  for(const x of sets){
    await put('sets',{session_id:newId, exercise_id:x.exercise_id, weight:x.weight, reps:x.reps, rpe:x.rpe, ts:Date.now(), date:today});
  }
  renderHistory(); renderAnalytics(); await renderWeeklySummary();
  showToast('今日に複製しました');
}

// ===== 週次サマリー（ローカル週 / ISO準拠近似） =====
function _isoWeekKeyLocal(dateStr){
  const d0 = new Date(dateStr); // ローカル
  const d  = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  const day = d.getDay() || 7;          // 月=1 … 日=7
  d.setDate(d.getDate() + 4 - day);     // 週の木曜へ
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart)/86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

async function renderWeeklySummary(){
  const el = document.getElementById('weekly-summary-body');
  if(!el) return; // 要素が無ければ何もしない

  const sets = await getAll('sets');
  if(!sets.length){
    el.textContent = '記録が見つかりません。入力するとここに今週の要約が出ます。';
    return;
  }

  // 週ごとにグルーピング（その週の合計ボリューム & 平均RPE）
  const map = new Map();
  for(const s of sets){
    const k = _isoWeekKeyLocal(s.date);
    (map.get(k) || map.set(k,[]).get(k)).push(s);
  }
  const latestKey = [...map.keys()].sort().pop();
  const arr = map.get(latestKey) || [];

  const totalVol = arr.reduce((sum,x)=> sum + (Number(x.weight)||0)*(Number(x.reps)||0), 0);
  const rpes = arr.map(x=> x.rpe).filter(v=> typeof v==='number' && !Number.isNaN(v));
  const avgRpe = rpes.length ? (rpes.reduce((a,b)=>a+b,0)/rpes.length) : null;

  // しきい値ロジック（必要なら後でチューニング可能）
  let score = 10;
  if (totalVol <= 1000) score = 2;
  else if (totalVol <= 2000) score = 4;
  else if (totalVol <= 3000) score = 6;
  else if (totalVol <= 4000) score = 8;

  const comment =
    score <= 3 ? '基礎づくり週。次週は+10〜20%を目安に。' :
    score <= 6 ? '標準負荷。フォームと睡眠を重視。' :
    score <= 8 ? 'やや高負荷。補助種目を整理して回復時間を。' :
                 '高負荷。48–72hの回復と栄養を最優先。';

  el.innerHTML = `
    <div style="display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap">
      <strong>対象週：</strong><span>${latestKey}</span>
      <strong>合計ボリューム：</strong><span>${Math.round(totalVol)}</span>
      <strong>強度スコア：</strong><span style="font-size:1.25rem">${score}/10</span>
      ${avgRpe!=null ? `<strong>平均RPE：</strong><span>${avgRpe.toFixed(1)}</span>` : ''}
    </div>
    <p style="margin-top:.5rem">${comment}</p>
  `;
}

init();