// Train Punch — responsive + reliable (v1.3.5) + e1RM View

const DB_NAME = 'trainpunch_v3';
const DB_VER  = 3;
let db;

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function showToast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1400);
}
const todayStr = () => new Date().toISOString().slice(0,10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const e1rm = (w,r)=> (w>0 && r>0) ? (w * (1 + r/30)) : 0;

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
  }catch(e){ console.warn('hardRefresh failed:', e); }
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

async function ensureInitialExercises(){
  const all = await getAll('exercises');
  const byName = Object.fromEntries(all.map(e=>[e.name, e]));
  for(const p of PARTS){
    for(const name of EX_GROUPS[p]){
      const hit = byName[name];
      if(!hit){
        await put('exercises', {name, group:p});
      }else if(!hit.group){
        await put('exercises', {...hit, group:p});
      }
    }
  }
}

// ---- UI state ----
let currentSession = { date: todayStr(), note:'', sets: [] };
let selectedPart = '胸';
let tplSelectedPart = '胸';

// ========= Helpers: Prefill & PR =========
async function getLastSetForExercise(exId){
  const sets = await getAll('sets');
  return sets.filter(s=>s.exercise_id===exId).sort((a,b)=> b.ts - a.ts)[0] || null;
}
async function prefillLastForExercise(exId){
  if(!exId) return;
  const last = await getLastSetForExercise(exId);
  if(last){
    $('#weight').value = last.weight ?? '';
    $('#reps').value   = last.reps   ?? '';
    $('#rpe').value    = (last.rpe ?? '') === null ? '' : (last.rpe ?? '');
  }
}
async function checkAndNotifyPR(exId, weight, reps){
  const newE = e1rm(weight, reps);
  if(newE <= 0) return;
  const all = await getAll('sets');
  const prevSaved = all.filter(s=>s.exercise_id===exId).reduce((m,s)=> Math.max(m, e1rm(s.weight, s.reps)), 0);
  const prevInSession = currentSession.sets.filter(s=>s.exercise_id===exId).reduce((m,s)=> Math.max(m, e1rm(s.weight, s.reps)), 0);
  const prevBest = Math.max(prevSaved, prevInSession);
  if(newE > prevBest){
    showToast(`PR！ e1RM ${Math.round(prevBest)} → ${Math.round(newE)} kg`);
    try{ if('vibrate' in navigator) navigator.vibrate([180,80,180]); }catch(e){}
  }
}

// =================== Init ===================
async function init(){
  // ↻
  $('#btnHardRefresh')?.addEventListener('click', async ()=>{
    const b = $('#btnHardRefresh'); const old=b.textContent;
    b.disabled = true; b.textContent = '更新…';
    showToast('最新に更新します…');
    await hardRefresh();
    b.textContent = old; b.disabled = false;
  });

  await openDB();
  await ensureInitialExercises();

  bindTabs();

  $('#sessDate').value = todayStr();
  bindSessionUI();

  bindCustomInsertUI();
  renderTplPartChips();
  await renderTplExSelect();

  bindHistoryUI();
  bindSettingsUI();

  renderPartChips();
  await renderExSelect();    // （プリフィルもここで）
  renderTodaySets();
  renderHistory();
  renderAnalytics();
  await renderE1RMView();    // ★ 追加
  renderExList();

  const dark = (await get('prefs','dark'))?.value || false;
  $('#darkToggle').checked = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
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

      if(tab==='history') renderHistory();
      if(tab==='analytics'){ renderAnalytics(); await renderE1RMView(); } // ★ e1RM更新
      if(tab==='settings') renderExList();
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
      await renderExSelect(); // 再描画 → プリフィル
    });
  }

  $('#exSelect')?.addEventListener('change', async ()=>{
    const exId = Number($('#exSelect').value);
    await prefillLastForExercise(exId);
  });

  $('#btnAddEx')?.addEventListener('click', async ()=>{
    const name = prompt('種目名を入力（例：懸垂）');
    if(!name) return;
    try{
      await put('exercises', {name, group:selectedPart});
      await renderExSelect();
      await renderTplExSelect();
      await renderExList();
      await renderE1RMExerciseList(); // ★ e1RMの種目リスト更新
      showToast('種目を追加しました');
    }catch(e){ showToast('同名の種目があります'); }
  });

  $('#btnAddSet')?.addEventListener('click', async ()=>{
    const exId = Number($('#exSelect').value);
    const weight = Number($('#weight').value);
    const reps   = Number($('#reps').value);
    const rpeStr = $('#rpe').value;
    if(!exId || !weight || !reps){ showToast('種目・重量・回数は必須です'); return; }

    await checkAndNotifyPR(exId, weight, reps);

    currentSession.sets.push({
      temp_id: crypto.randomUUID(),
      exercise_id: exId, weight, reps,
      rpe: rpeStr ? Number(rpeStr) : null,
      ts: Date.now(), date: $('#sessDate').value
    });
    $('#weight').value=''; $('#reps').value=''; $('#rpe').value='';
    renderTodaySets();
    await renderE1RMView(); // ★ 追加
  });

  $('#btnTimer')?.addEventListener('click', ()=>startRestTimer(60));

  $('#btnSaveSession')?.addEventListener('click', async ()=>{
    if(!currentSession.sets.length){ showToast('セットがありません'); return; }
    const date = $('#sessDate').value;
    const note = $('#sessNote').value;
    const sessionId = await put('sessions',{date, note, created_at: Date.now()});
    for(const s of currentSession.sets){
      await put('sets',{session_id:sessionId, exercise_id:s.exercise_id, weight:s.weight, reps:s.reps, rpe:s.rpe, ts:s.ts, date});
    }
    currentSession = { date: todayStr(), note:'', sets: [] };
    $('#sessDate').value = todayStr(); $('#sessNote').value = '';
    renderTodaySets(); renderHistory(); renderAnalytics();
    await renderE1RMView(); // ★ 追加
    showToast('セッションを保存しました');
  });

  $('#btnTplApply')?.addEventListener('click', applyQuickInsert);
  $('#btnTplCustom')?.addEventListener('click', applyCustomInsert);

  buildHistoryTemplates();
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
  sel.innerHTML = exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>オプションなし</option>';
}

async function renderExSelect(){
  let exs = await getAll('exercises');
  exs = exs.filter(e=>e.group===selectedPart).sort((a,b)=> a.name.localeCompare(b.name, 'ja'));
  const sel = $('#exSelect');
  if (sel){
    sel.innerHTML = exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>オプションなし</option>';
    const curId = Number(sel.value);
    if(curId) await prefillLastForExercise(curId);
  }
}

// ---- today list ----
function renderTodaySets(){
  const ul = $('#todaySets');
  if(!ul) return;
  if(!currentSession.sets.length){
    ul.innerHTML = '<li>まだありません</li>'; return;
  }
  ul.innerHTML = currentSession.sets.map(s=>{
    return `<li>
      <span><strong>${esc(exNameById(s.exercise_id))}</strong> ${s.weight}kg × ${s.reps}${s.rpe?` RPE${s.rpe}`:''}</span>
      <button class="ghost" data-id="${s.temp_id}">削除</button>
    </li>`;
  }).join('');
  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id = b.dataset.id;
      const removed = currentSession.sets.find(x=>x.temp_id===id);
      currentSession.sets = currentSession.sets.filter(x=>x.temp_id !== id);
      renderTodaySets();
      if(removed){ await renderE1RMView(); } // ★ 追加
    });
  });
}

function exNameById(id){
  const opt = $('#tplExCustom')?.querySelector(`option[value="${id}"]`) || $('#exSelect')?.querySelector(`option[value="${id}"]`);
  return opt ? opt.textContent : '種目';
}

// ---- Quick insert ----
async function buildHistoryTemplates(){
  const sets = await getAll('sets');
  const exs  = await getAll('exercises');
  const nameById = Object.fromEntries(exs.map(e=>[e.id, e.name]));
  const used = [...new Set(sets.map(s=>s.exercise_id))].map(id=>({id, name:nameById[id] || `#${id}`})).filter(x=>x.name);
  used.sort((a,b)=> a.name.localeCompare(b.name,'ja'));
  const sel = $('#tplExFromHist');
  if (sel){
    sel.innerHTML = used.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('') || '<option>履歴がありません</option>';
  }
  const freq = {};
  sets.forEach(s=>{ const key = `${s.reps}`; freq[key] = (freq[key]||0)+1; });
  const patterns = Object.entries(freq).sort((a,b)=> b[1]-a[1]).slice(0,8).map(([reps])=>`5×${reps}`);
  const pattSel = $('#tplPattern');
  if (pattSel){
    pattSel.innerHTML = patterns.map(p=>`<option>${p}</option>`).join('') || '<option>パターンなし</option>';
  }
}

async function applyQuickInsert(){
  const exId = Number($('#tplExFromHist').value);
  const patt = ($('#tplPattern').value || '5×5').split('×').map(Number);
  const useLast = $('#tplUseLastW').checked;
  if(!exId){ showToast('種目を選択してください'); return; }
  let weight = 0;
  if(useLast){
    const sets = (await getAll('sets')).filter(s=>s.exercise_id===exId).sort((a,b)=>b.ts-a.ts);
    if(sets[0]) weight = sets[0].weight;
  }
  const date = $('#sessDate').value;
  const now  = Date.now();
  const [nSet, reps] = patt;
  for(let i=0;i<(nSet||5);i++){
    currentSession.sets.push({ temp_id: crypto.randomUUID(), exercise_id: exId, weight, reps, rpe:null, ts: now+i, date });
  }
  renderTodaySets();
  await renderE1RMView(); // ★
  showToast('クイック投入しました');
}

async function applyCustomInsert(){
  const n = Number($('#tplCustomSets').value || '5');
  const r = Number($('#tplCustomReps').value || '5');
  const w = Number($('#tplCustomWeight').value || '0');
  const exId = Number($('#tplExCustom').value);
  if(!exId){ showToast('種目を選んでください'); return; }
  const date = $('#sessDate').value;
  const now  = Date.now();
  for(let i=0;i<n;i++){
    currentSession.sets.push({ temp_id:crypto.randomUUID(), exercise_id:exId, weight:w, reps:r, rpe:null, ts: now+i, date });
  }
  renderTodaySets();
  await renderE1RMView(); // ★
  showToast('カスタム投入しました');
}

// ---- Timer ----
let timerHandle=null, timerLeft=0;
function startRestTimer(sec){
  clearInterval(timerHandle);
  timerLeft = sec;
  const btn = $('#btnTimer');
  btn.disabled = true;
  timerHandle = setInterval(()=>{
    btn.textContent = `休憩${--timerLeft}s`;
    if(timerLeft<=0){
      clearInterval(timerHandle);
      btn.textContent='休憩60s';
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
    const est = sets.length ? Math.max(...sets.map(x=> e1rm(x.weight, x.reps))) : 0;
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

// =================== Analytics（既存バー） ===================
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
  const today = new Date(); today.setHours(0,0,0,0);
  const days=[];
  for(let i=n-1;i>=0;i--){
    const d = new Date(today.getTime() - i*86400000);
    days.push({ key:d.toISOString().slice(0,10), label:`${d.getMonth()+1}/${d.getDate()}` });
  }
  return days;
}
function _drawBarChart(canvas, days, totals, hoverIndex=-1){
  _resizeCanvas(canvas, 260);
  const ctx = canvas.getContext('2d');
  const W = canvas.getBoundingClientRect().width;
  const H = 260;
  const L=42, R=10, T=18, B=28;

  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle = '#9993';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H-B); ctx.lineTo(W-R, H-B); ctx.stroke();

  const innerW = W - L - R;
  const step   = innerW / days.length;
  const barW   = Math.min(32, step * 0.58);

  const max = Math.max(1, Math.max(...totals));
  const gridLines = 4;
  ctx.fillStyle = '#9aa4b2';
  ctx.font = '12px system-ui'; ctx.textAlign='center';
  for(let i=0;i<days.length;i++){
    const x = L + i*step + step/2;
    ctx.fillText(days[i].label, x, H-8);
  }
  ctx.strokeStyle='#9992';
  for(let g=1; g<=gridLines; g++){
    const y = T + (H-B-T)* (g/gridLines);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W-R, y); ctx.stroke();
  }

  if (totals.every(v => v <= 0)){
    ctx.fillStyle = '#9aa4b2'; ctx.textAlign='center'; ctx.font = '14px system-ui';
    ctx.fillText('まだデータがありません。セットを追加すると表示されます。', W/2, (H-B+T)/2);
    canvas._chartDims = {L, step, W, H, T, B}; canvas._days = days; canvas._totals = totals; return;
  }

  for(let i=0;i<totals.length;i++){
    const xC   = L + i*step + step/2;
    const x    = xC - barW/2;
    const h    = (totals[i]/max)*(H-B-T);
    const y    = (H-B) - h;
    const hover = (i===hoverIndex);
    const color = hover ? '#0fb6a9' : '#6cc7bf';
    ctx.fillStyle = color; ctx.fillRect(x, y, barW, h);

    if (hover){
      const tip = Math.round(totals[i]) + ' kg';
      const tw  = ctx.measureText(tip).width + 10;
      const th  = 22;
      const tx  = Math.min(W-R-tw, Math.max(L, xC - tw/2));
      const ty  = y - 8 - th;
      ctx.fillStyle='#0fb6a9'; ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font = '12px system-ui';
      ctx.fillText(tip, tx + tw/2, ty + th/2);
    }
  }
  canvas._chartDims = {L, step, W, H, T, B};
  canvas._days = days; canvas._totals = totals;
}

let _chartEventsBound = false;
async function renderAnalytics(){
  const canvas = $('#chart'); if(!canvas) return;
  const sets = await getAll('sets');
  const days = _lastNDays(7);
  const totals = days.map(d => sets.filter(s => s.date === d.key).reduce((sum,x)=> sum + x.weight * x.reps, 0));
  _drawBarChart(canvas, days, totals, -1);

  const recentKeys = new Set(days.map(d=>d.key));
  const recentSets = sets.filter(s => recentKeys.has(s.date));
  const total7     = totals.reduce((a,b)=>a+b,0);
  const uniqEx     = new Set(recentSets.map(s=>s.exercise_id)).size;
  $('#metrics').innerHTML = `
    <div>直近7日ボリューム</div><div>${Math.round(total7)} kg</div>
    <div>種目数</div><div>${uniqEx} 種目</div>
  `;
  const legend = $('#legend'); if (legend) legend.innerHTML = '';

  if(!_chartEventsBound){
    const pickIndex = (evt)=>{
      const r = canvas.getBoundingClientRect();
      const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
      const dims = canvas._chartDims || {L:0, step:1};
      const i = Math.floor((x - dims.L) / dims.step);
      return (i>=0 && i<(canvas._days?.length||0)) ? i : -1;
    };
    const redraw = (i=-1)=> _drawBarChart(canvas, canvas._days||[], canvas._totals||[], i);

    canvas.addEventListener('mousemove', (e)=> redraw(pickIndex(e)));
    canvas.addEventListener('mouseleave', ()=> redraw(-1));
    canvas.addEventListener('touchstart', (e)=> redraw(pickIndex(e)), {passive:true});
    canvas.addEventListener('touchmove',  (e)=> redraw(pickIndex(e)), {passive:true});
    window.addEventListener('resize', ()=> redraw(-1));
    _chartEventsBound = true;
  }
}

// =================== Analytics: e1RM View ===================
async function renderE1RMExerciseList(){
  const sel = $('#e1rmExSelect'); if(!sel) return;
  const exs = (await getAll('exercises')).slice().sort((a,b)=> a.name.localeCompare(b.name,'ja'));
  sel.innerHTML = exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>種目なし</option>';

  // 直前の選択を復元
  const prefEx = (await get('prefs','e1rm_ex'))?.value;
  if(prefEx && sel.querySelector(`option[value="${prefEx}"]`)) sel.value = String(prefEx);
}

function _dateKeyToLabel(key){ // 'YYYY-MM-DD' → 'M/D'
  const [y,m,d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

function _drawLineChart(canvas, labels, values, hoverIndex=-1){
  _resizeCanvas(canvas, 260);
  const ctx = canvas.getContext('2d');
  const W = canvas.getBoundingClientRect().width;
  const H = 260;
  const L=42, R=12, T=18, B=28;

  ctx.clearRect(0,0,W,H);

  // 軸・グリッド
  ctx.strokeStyle = '#9993';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H-B); ctx.lineTo(W-R, H-B); ctx.stroke();

  const innerW = W - L - R;
  const n = Math.max(1, labels.length);
  const step = innerW / Math.max(1, n-1);

  const maxV = Math.max(1, ...values);
  const pad  = maxV * 0.08;
  const vMax = maxV + pad;

  // Xラベル
  ctx.fillStyle = '#9aa4b2';
  ctx.font = '12px system-ui';
  ctx.textAlign='center';
  const labelStep = Math.ceil(n/8);
  labels.forEach((lb,i)=>{
    if(i % labelStep !== 0) return;
    const x = L + i*step;
    ctx.fillText(lb, x, H-8);
  });

  // Yグリッド
  ctx.strokeStyle = '#9992';
  const gridLines = 4;
  for(let g=1; g<=gridLines; g++){
    const y = T + (H-B-T)* (g/gridLines);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W-R, y); ctx.stroke();
  }

  if (!values.length || values.every(v=>v<=0)){
    ctx.fillStyle = '#9aa4b2'; ctx.textAlign='center'; ctx.font = '14px system-ui';
    ctx.fillText('この種目のデータがありません', W/2, (H-B+T)/2);
    canvas._lineDims = {L, step, W, H, T, B, n};
    canvas._labels = labels; canvas._values = values;
    return;
  }

  // 折れ線
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#6cc7bf';
  ctx.beginPath();
  for(let i=0;i<n;i++){
    const x = L + i*step;
    const y = (H-B) - (values[i]/vMax)*(H-B-T);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // ポイント & ホバー
  for(let i=0;i<n;i++){
    const x = L + i*step;
    const y = (H-B) - (values[i]/vMax)*(H-B-T);
    ctx.beginPath();
    ctx.arc(x,y, i===hoverIndex?4:3, 0, Math.PI*2);
    ctx.fillStyle = i===hoverIndex ? '#0fb6a9' : '#6cc7bf';
    ctx.fill();

    if(i===hoverIndex){
      const tip = `${values[i] ? Math.round(values[i]) : 0} kg`;
      const tw  = ctx.measureText(tip).width + 10;
      const th  = 22;
      const tx  = Math.min(W-R-tw, Math.max(L, x - tw/2));
      const ty  = y - 10 - th;
      ctx.fillStyle='#0fb6a9'; ctx.fillRect(tx, ty, tw, th);
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='12px system-ui';
      ctx.fillText(tip, tx + tw/2, ty + th/2);
    }
  }

  canvas._lineDims = {L, step, W, H, T, B, n};
  canvas._labels = labels;
  canvas._values = values;
}

let _lineEventsBound = false;
async function renderE1RMView(){
  const sel = $('#e1rmExSelect');
  const canvas = $('#e1rmChart');
  const metrics = $('#e1rmMetrics');
  if(!canvas || !metrics) return;

  // 初期：種目リスト埋める（初回や種目追加後）
  if(sel && !sel._ready){
    await renderE1RMExerciseList();
    // 範囲復元
    const prefRange = (await get('prefs','e1rm_range'))?.value || '90';
    if($('#e1rmRange')) $('#e1rmRange').value = String(prefRange);

    // 変更ハンドラ
    sel.addEventListener('change', async ()=>{
      await put('prefs',{key:'e1rm_ex', value:Number(sel.value)||null});
      await renderE1RMView();
    });
    $('#e1rmRange')?.addEventListener('change', async (e)=>{
      await put('prefs',{key:'e1rm_range', value:e.target.value});
      await renderE1RMView();
    });
    sel._ready = true;
  }

  // 現在の選択
  const exId = Number(sel?.value || 0);
  const range = ($('#e1rmRange')?.value) || '90';

  // データ抽出（選択種目のみ）
  const sets = await getAll('sets');
  let target = sets.filter(s=> s.exercise_id === exId);

  // 期間フィルタ（日付キーで判定）
  if(range !== 'all'){
    const days = Number(range);
    const from = new Date(); from.setHours(0,0,0,0);
    from.setDate(from.getDate() - days + 1);
    const fromKey = from.toISOString().slice(0,10);
    target = target.filter(s => s.date >= fromKey);
  }

  // 日別の最大e1RM
  const byDate = {};
  for(const s of target){
    const val = e1rm(s.weight, s.reps);
    if(!byDate[s.date] || val>byDate[s.date]) byDate[s.date]=val;
  }
  const entries = Object.entries(byDate).sort((a,b)=> a[0].localeCompare(b[0]));
  const labels = entries.map(([d])=> _dateKeyToLabel(d));
  const values = entries.map(([_,v])=> v);

  // 指標
  const bestIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
  const best = bestIdx>=0 ? Math.round(values[bestIdx]) : 0;
  const bestDate = bestIdx>=0 ? entries[bestIdx][0] : '-';
  const last = values.length ? Math.round(values[values.length-1]) : 0;

  metrics.innerHTML = `
    <div>ベスト e1RM</div><div>${best} kg（${bestDate}）</div>
    <div>直近 e1RM</div><div>${last} kg</div>
  `;

  // 描画
  _drawLineChart(canvas, labels, values, -1);

  if(!_lineEventsBound){
    const pickIndex = (evt)=>{
      const r = canvas.getBoundingClientRect();
      const dims = canvas._lineDims || {L:0, step:1, n:0};
      const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
      const i = Math.round((x - dims.L) / dims.step);
      return (i>=0 && i<dims.n) ? i : -1;
    };
    const redraw = (i=-1)=> _drawLineChart(canvas, canvas._labels||[], canvas._values||[], i);

    canvas.addEventListener('mousemove', (e)=> redraw(pickIndex(e)));
    canvas.addEventListener('mouseleave', ()=> redraw(-1));
    canvas.addEventListener('touchstart', (e)=> redraw(pickIndex(e)), {passive:true});
    canvas.addEventListener('touchmove',  (e)=> redraw(pickIndex(e)), {passive:true});
    window.addEventListener('resize', ()=> redraw(-1));
    _lineEventsBound = true;
  }
}

// =================== Settings ===================
function bindSettingsUI(){
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
      await renderExList();
      await renderExSelect();
      await renderTplExSelect();
      await renderE1RMExerciseList(); // ★
      showToast('追加しました');
    }catch(e){ showToast('同名の種目があります'); }
  });
  $('#filterPart')?.addEventListener('change', renderExList);
  $('#btnWipe')?.addEventListener('click', async ()=>{
    if(!confirm('本当に全データを削除しますか？')) return;
    for(const s of ['sessions','sets','exercises']){
      await new Promise((res,rej)=>{ const r = tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    await ensureInitialExercises();
    await renderExList(); await renderExSelect(); await renderTplExSelect();
    renderHistory(); renderAnalytics(); renderTodaySets();
    await renderE1RMExerciseList(); await renderE1RMView(); // ★
    showToast('全データを削除しました');
  });
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
    await renderExList(); await renderExSelect(); await renderTplExSelect();
    renderHistory(); renderAnalytics(); renderTodaySets();
    await renderE1RMExerciseList(); await renderE1RMView(); // ★
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
      await del('exercises', Number(b.dataset.id));
      await renderExList();
      await renderExSelect();
      await renderTplExSelect();
      await renderE1RMExerciseList(); await renderE1RMView(); // ★
      renderAnalytics();
    });
  });
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
  renderHistory(); renderAnalytics(); showToast('インポート完了'); e.target.value='';
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
  renderHistory(); renderAnalytics(); await renderE1RMView(); showToast('セッションを削除しました');
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
  const newId = await put('sessions', {date:today, note:(src?.note||'')+' (複製)', created_at:Date.now()});
  const sets = await indexGetAll('sets','by_session', id);
  for(const x of sets){
    await put('sets',{session_id:newId, exercise_id:x.exercise_id, weight:x.weight, reps:x.reps, rpe:x.rpe, ts:Date.now(), date:today});
  }
  renderHistory(); renderAnalytics(); await renderE1RMView(); showToast('今日に複製しました');
}

init();