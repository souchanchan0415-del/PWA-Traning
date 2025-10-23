// Train Punch — responsive + reliable (v1.3.1)

const DB_NAME = 'trainpunch_v3';
const DB_VER  = 3; // exercises に group index
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

// ---- Data preset (部位分類) ----
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

// =================== Init ===================
async function init(){
  await openDB();
  await ensureInitialExercises();

  // Tabs
  bindTabs();

  // Session
  $('#sessDate').value = todayStr();
  bindSessionUI();

  // History & Settings
  bindHistoryUI();
  bindSettingsUI();

  // Initial renders
  renderPartChips();
  await renderExSelect();          // part フィルタ反映
  renderTodaySets();
  renderHistory();
  renderAnalytics();
  renderExList();

  // Theme
  const dark = (await get('prefs','dark'))?.value || false;
  $('#darkToggle').checked = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// =================== Tabs ===================
function bindTabs(){
  $$('.tabs button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tabs button').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');

      const tab = btn.dataset.tab;
      $$('.tab').forEach(s=>s.classList.remove('active'));
      $('#tab-'+tab).classList.add('active');

      if(tab==='history') renderHistory();
      if(tab==='analytics') renderAnalytics();
      if(tab==='settings') renderExList();
    });
  });
}

// =================== Session ===================
function renderPartChips(){
  // set active visual
  $$('#partChips .chip').forEach(ch=>{
    ch.classList.toggle('active', ch.dataset.part === selectedPart);
  });
}

function bindSessionUI(){
  // part chips
  $('#partChips').addEventListener('click', async (e)=>{
    const b = e.target.closest('.chip');
    if(!b) return;
    selectedPart = b.dataset.part;
    renderPartChips();
    await renderExSelect();
  });

  // add custom exercise (bind to current part)
  $('#btnAddEx').addEventListener('click', async ()=>{
    const name = prompt('種目名を入力（例：懸垂）');
    if(!name) return;
    try{
      await put('exercises', {name, group:selectedPart});
      await renderExSelect();
      await renderExList();
      showToast('種目を追加しました');
    }catch(e){
      showToast('同名の種目があります');
    }
  });

  // set add
  $('#btnAddSet').addEventListener('click', ()=>{
    const exId = Number($('#exSelect').value);
    const weight = Number($('#weight').value);
    const reps   = Number($('#reps').value);
    const rpeStr = $('#rpe').value;
    if(!exId || !weight || !reps){ showToast('種目・重量・回数は必須です'); return; }
    currentSession.sets.push({
      temp_id: crypto.randomUUID(),
      exercise_id: exId, weight, reps,
      rpe: rpeStr ? Number(rpeStr) : null,
      ts: Date.now(), date: $('#sessDate').value
    });
    $('#weight').value=''; $('#reps').value=''; $('#rpe').value='';
    renderTodaySets();
  });

  $('#btnTimer').addEventListener('click', ()=>startRestTimer(60));

  $('#btnSaveSession').addEventListener('click', async ()=>{
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
    showToast('セッションを保存しました');
  });

  // Quick insert & custom insert
  $('#btnTplApply').addEventListener('click', applyQuickInsert);
  $('#btnTplCustom').addEventListener('click', applyCustomInsert);

  // 初回の履歴テンプレ描画
  buildHistoryTemplates();
}

async function renderExSelect(){
  // 種目は「選択中の部位」だけを列挙
  let exs = await getAll('exercises');
  exs = exs.filter(e=>e.group===selectedPart).sort((a,b)=> a.name.localeCompare(b.name, 'ja'));

  // main selector
  const sel = $('#exSelect');
  sel.innerHTML = exs.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('') || '<option>オプションなし</option>';

  // template selectors
  const sel2 = $('#tplExCustom');
  sel2.innerHTML = (await getAll('exercises')).sort((a,b)=>a.name.localeCompare(b.name,'ja'))
                  .map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');

  // 履歴テンプレ用の種目は buildHistoryTemplates() が別で描く
}

// ---- today list ----
function renderTodaySets(){
  const ul = $('#todaySets');
  if(!currentSession.sets.length){
    ul.innerHTML = '<li>まだありません</li>';
    return;
  }
  ul.innerHTML = currentSession.sets.map(s=>{
    return `<li>
      <span><strong>${esc(exNameById(s.exercise_id))}</strong> ${s.weight}kg × ${s.reps}${s.rpe?` RPE${s.rpe}`:''}</span>
      <button class="ghost" data-id="${s.temp_id}">削除</button>
    </li>`;
  }).join('');
  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.dataset.id;
      currentSession.sets = currentSession.sets.filter(x=>x.temp_id !== id);
      renderTodaySets();
    });
  });
}

function exNameById(id){
  const opt = $('#tplExCustom').querySelector(`option[value="${id}"]`) || $('#exSelect').querySelector(`option[value="${id}"]`);
  return opt ? opt.textContent : '種目';
}

// ---- Quick insert from history ----
async function buildHistoryTemplates(){
  const sets = await getAll('sets');
  const exs  = await getAll('exercises');
  const nameById = Object.fromEntries(exs.map(e=>[e.id, e.name]));

  // used exercises
  const used = [...new Set(sets.map(s=>s.exercise_id))].map(id=>({id, name:nameById[id] || `#${id}`})).filter(x=>x.name);
  used.sort((a,b)=> a.name.localeCompare(b.name,'ja'));

  $('#tplExFromHist').innerHTML = used.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('') || '<option>履歴がありません</option>';

  // patterns map: "sets×reps"
  const freq = {};
  sets.forEach(s=>{
    const key = `${s.reps}`;
    freq[key] = (freq[key]||0)+1;
  });
  const patterns = Object.entries(freq)
    .sort((a,b)=> b[1]-a[1])
    .slice(0,8)
    .map(([reps])=>`5×${reps}`); // セット数は5をデフォルトで付与（使いやすさ優先）

  $('#tplPattern').innerHTML = patterns.map(p=>`<option>${p}</option>`).join('') || '<option>パターンなし</option>';
}

async function applyQuickInsert(){
  const exId = Number($('#tplExFromHist').value);
  const patt = ($('#tplPattern').value || '5×5').split('×').map(Number); // [set,reps]
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
    currentSession.sets.push({
      temp_id: crypto.randomUUID(),
      exercise_id: exId, weight, reps, rpe:null, ts: now+i, date
    });
  }
  renderTodaySets();
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
  $('#historyCount').addEventListener('change', renderHistory);
  $('#btnExport').addEventListener('click', exportCSV);
  $('#importFile').addEventListener('change', importCSV);
}
async function renderHistory(){
  const count = Number($('#historyCount').value || 20);
  const sessions = (await getAll('sessions')).sort((a,b)=>b.created_at-a.created_at).slice(0,count);
  const ul = $('#historyList'); ul.innerHTML = '';

  for(const s of sessions){
    const sets = await indexGetAll('sets','by_session', s.id);
    const vol = sets.reduce((sum,x)=> sum + x.weight*x.reps, 0);
    const est = sets.length ? Math.max(...sets.map(x=> x.weight*(1 + x.reps/30))) : 0;

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
async function renderAnalytics(){
  const sets = await getAll('sets');
  const exMap = Object.fromEntries((await getAll('exercises')).map(e=>[e.id,e.name]));
  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for(let i=6;i>=0;i--){ const d = new Date(today.getTime() - i*86400000); days.push({key:d.toISOString().slice(0,10), label:`${d.getMonth()+1}/${d.getDate()}`}); }

  const perEx = {};
  for(const s of sets){
    if(!days.find(d=>d.key===s.date)) continue;
    const name = exMap[s.exercise_id] || '不明';
    perEx[name] ??= {};
    perEx[name][s.date] = (perEx[name][s.date]||0) + s.weight*s.reps;
  }

  const canvas = $('#chart'); const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W=canvas.width, H=canvas.height, L=40, B=28, T=10, R=10;
  ctx.strokeStyle='#445'; ctx.fillStyle='#99a'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();

  let max = 1;
  Object.values(perEx).forEach(m => days.forEach(d => max = Math.max(max, m[d.key]||0)));
  const colors = ['#0fb6a9','#42a5f5','#ab47bc','#ef5350','#ffb300','#26a69a'];
  let idx=0;

  const legend = $('#legend'); legend.innerHTML='';
  Object.keys(perEx).forEach(name=>{
    const color = colors[idx++ % colors.length];
    const pts = days.map((d,i)=>({ x:L+(i*(W-L-R)/(days.length-1)), y:(H-B) - ((perEx[name][d.key]||0)/max)*(H-B-T) }));
    ctx.strokeStyle=color;
    ctx.beginPath(); pts.forEach((p,i)=> i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.stroke();
    pts.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); });

    const chip = document.createElement('div'); chip.className='chip'; chip.textContent=name; chip.style.borderColor='transparent'; chip.style.background=color; chip.style.color='#fff';
    legend.appendChild(chip);
  });

  ctx.fillStyle='#aab'; ctx.textAlign='center'; ctx.font='12px system-ui';
  days.forEach((d,i)=> ctx.fillText(d.label, L+(i*(W-L-R)/(days.length-1)), H-8) );

  const total7 = Object.values(perEx).reduce((sum,map)=> sum + days.reduce((a,d)=>a+(map[d.key]||0),0), 0);
  $('#metrics').innerHTML = `
    <div>直近7日ボリューム</div><div>${Math.round(total7)} kg</div>
    <div>種目数</div><div>${Object.keys(perEx).length} 種目</div>
  `;
}

// =================== Settings ===================
function bindSettingsUI(){
  // theme
  $('#darkToggle').addEventListener('change', async (e)=>{
    const on = e.target.checked;
    document.documentElement.dataset.theme = on ? 'dark' : 'light';
    await put('prefs',{key:'dark', value:on});
  });

  // notifications
  $('#btnNotif').addEventListener('click', async ()=>{
    if(!('Notification' in window)){ showToast('この端末は通知に未対応'); return; }
    const perm = await Notification.requestPermission();
    showToast(perm==='granted' ? '通知を許可しました' : '通知は許可されていません');
  });

  // add exercise (with part)
  $('#btnCreateEx').addEventListener('click', async ()=>{
    const name = $('#newExName').value.trim();
    const part = $('#newExPart').value || undefined;
    if(!name) return;
    try{
      await put('exercises',{name, group:part});
      $('#newExName').value='';
      await renderExList();
      await renderExSelect();
      showToast('追加しました');
    }catch(e){
      showToast('同名の種目があります');
    }
  });

  // filter
  $('#filterPart').addEventListener('change', renderExList);

  // wipe
  $('#btnWipe').addEventListener('click', async ()=>{
    if(!confirm('本当に全データを削除しますか？')) return;
    for(const s of ['sessions','sets','exercises']){
      await new Promise((res,rej)=>{ const r = tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    await ensureInitialExercises();
    await renderExList(); await renderExSelect(); renderHistory(); renderAnalytics(); renderTodaySets();
    showToast('全データを削除しました');
  });

  // JSON backup
  $('#btnExportJson').addEventListener('click', async ()=>{
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
  $('#jsonIn').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const data = JSON.parse(await file.text());
    for(const s of ['sessions','sets','exercises','prefs']){
      await new Promise((res,rej)=>{ const r = tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    for(const x of (data.exercises||[])) await put('exercises', x);
    for(const x of (data.sessions ||[])) await put('sessions', x);
    for(const x of (data.sets     ||[])) await put('sets', x);
    for(const x of (data.prefs    ||[])) await put('prefs', x);
    await renderExList(); await renderExSelect(); renderHistory(); renderAnalytics(); renderTodaySets();
    showToast('復元しました');
    e.target.value='';
  });
}

async function renderExList(){
  const filt = $('#filterPart').value || 'all';
  let exs = await getAll('exercises');
  if(filt !== 'all') exs = exs.filter(e=>e.group===filt);
  exs.sort((a,b)=> (a.group||'').localeCompare(b.group||'','ja') || a.name.localeCompare(b.name,'ja'));

  const ul = $('#exList');
  ul.innerHTML = exs.map(e=>{
    const tag = e.group ? `<span class="badge" style="margin-right:8px">${esc(e.group)}</span>` : '';
    return `<li><span>${tag}${esc(e.name)}</span><button class="ghost" data-id="${e.id}">削除</button></li>`;
  }).join('') || '<li>まだありません</li>';

  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      await del('exercises', Number(b.dataset.id));
      await renderExList(); await renderExSelect(); renderAnalytics();
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
  renderHistory(); renderAnalytics(); showToast('セッションを削除しました');
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
  renderHistory(); renderAnalytics(); showToast('今日に複製しました');
}

init(); // 起動