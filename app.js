// Train Punch - PWA core with body-part tabs + dropdown exercise
const DB_NAME = 'trainpunch_v2';
const DB_VER  = 3; // exercises に group index
let db;

// util
const $ = s=>document.querySelector(s);
function showToast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1500); }
function todayStr(){ const d=new Date(); return d.toISOString().slice(0,10); }
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e)=>{
      const d = req.result;
      if(!d.objectStoreNames.contains('exercises')){
        const s = d.createObjectStore('exercises',{keyPath:'id', autoIncrement:true});
        s.createIndex('name','name',{unique:true});
        s.createIndex('by_group','group',{unique:false});
      }else{
        const s = e.target.transaction.objectStore('exercises');
        if(!s.indexNames.contains('name')) s.createIndex('name','name',{unique:true});
        if(!s.indexNames.contains('by_group')) s.createIndex('by_group','group',{unique:false});
      }
      if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions',{keyPath:'id', autoIncrement:true});
      if(!d.objectStoreNames.contains('sets')){
        const s = d.createObjectStore('sets',{keyPath:'id', autoIncrement:true});
        s.createIndex('by_session','session_id');
        s.createIndex('by_date','date');
      }
      if(!d.objectStoreNames.contains('prefs')) d.createObjectStore('prefs',{keyPath:'key'});
    };
    req.onsuccess=()=>{ db=req.result; resolve(db); };
    req.onerror =()=>reject(req.error);
  });
}
function tx(names, mode='readonly'){ return db.transaction(names, mode); }
async function put(store, val){ return new Promise((res,rej)=>{ const r=tx([store],'readwrite').objectStore(store).put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function getAll(store){ return new Promise((res,rej)=>{ const r=tx([store]).objectStore(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function del(store, key){ return new Promise((res,rej)=>{ const r=tx([store],'readwrite').objectStore(store).delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
async function indexGetAll(store, index, q){ return new Promise((res,rej)=>{ const r=tx([store]).objectStore(store).index(index).getAll(q); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function get(store, key){ return new Promise((res,rej)=>{ const r=tx([store]).objectStore(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

// ====== 初期種目（部位付き） ======
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
  const byName = Object.fromEntries(all.map(e=>[e.name,e]));
  for (const p of PARTS){
    for (const n of EX_GROUPS[p]){
      const hit = byName[n];
      if(!hit) await put('exercises',{name:n, group:p});
      else if(!hit.group) await put('exercises',{...hit, group:p});
    }
  }
}

let currentSession = { date: todayStr(), note:'', sets: [] };

async function init(){
  await openDB();
  await ensureInitialExercises();

  $('#sessDate').value = todayStr();
  bindTabs();
  bindSessionUI();
  bindHistoryUI();
  bindSettingsUI();

  await renderExSelect();
  renderTodaySets();
  renderHistory();
  renderAnalytics();

  const dark = (await get('prefs','dark'))?.value || false;
  $('#darkToggle').checked = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

// ===== Tabs =====
function bindTabs(){
  document.querySelectorAll('nav.tabs button').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const tab=b.dataset.tab;
      document.querySelectorAll('section.tab').forEach(s=>s.classList.remove('active'));
      $('#tab-'+tab).classList.add('active');
      if(tab==='analytics') renderAnalytics();
      if(tab==='history')   renderHistory();
    });
  });
}

// ===== Session =====
function getActivePart(){
  const act = $('#partTabs button.active');
  return act ? act.dataset.part : null; // null -> 全部
}
function bindSessionUI(){
  // 部位タブ：常に文字表示。クリックで active 切替
  $('#partTabs')?.addEventListener('click', (e)=>{
    const b = e.target.closest('button'); if(!b) return;
    $('#partTabs').querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    renderExSelect();
  });

  // 種目追加（選択中の部位を付与）
  $('#btnAddEx').addEventListener('click', async ()=>{
    const name = prompt('種目名を入力（例：懸垂）');
    if(!name) return;
    try{
      await put('exercises',{name, group:getActivePart() || undefined});
      await renderExSelect(); renderExList();
      showToast('種目を追加');
    }catch(_){ showToast('同名の種目があります'); }
  });

  // セット追加
  $('#btnAddSet').addEventListener('click', ()=>{
    const exId = Number($('#exSelect').value);
    const weight = Number($('#weight').value);
    const reps = Number($('#reps').value);
    const rpe = $('#rpe').value ? Number($('#rpe').value) : null;
    if(!exId || !weight || !reps){ showToast('種目・重量・回数は必須'); return; }
    currentSession.sets.push({ temp_id: crypto.randomUUID(), exercise_id: exId, weight, reps, rpe, ts: Date.now(), date: $('#sessDate').value });
    $('#weight').value=''; $('#reps').value=''; $('#rpe').value='';
    renderTodaySets();
  });

  $('#btnTimer').addEventListener('click', ()=>startRestTimer(60));

  $('#btnSaveSession').addEventListener('click', async ()=>{
    if(currentSession.sets.length===0){ showToast('セットがありません'); return; }
    const date=$('#sessDate').value, note=$('#sessNote').value;
    const sessionId = await put('sessions',{date, note, created_at: Date.now()});
    for(const s of currentSession.sets){
      await put('sets',{session_id: sessionId, exercise_id: s.exercise_id, weight: s.weight, reps: s.reps, rpe: s.rpe, ts: s.ts, date});
    }
    currentSession = { date: todayStr(), note:'', sets: [] };
    $('#sessDate').value = todayStr(); $('#sessNote').value='';
    renderTodaySets(); renderHistory(); renderAnalytics();
    showToast('セッションを保存しました');
  });

  // 種目セレクトの選択中テキスト
  $('#exSelect').addEventListener('change', ()=>{
    const name = $('#exSelect').selectedOptions[0]?.textContent || '—';
    $('#exSelectedText').textContent = `選択中：${name}`;
  });
}

// 部位で絞って select を再生成
async function renderExSelect(){
  const part = getActivePart(); // null=全部
  let exs = await getAll('exercises');
  if(part) exs = exs.filter(e=>e.group===part);
  exs.sort((a,b)=> a.name.localeCompare(b.name,'ja'));
  const sel=$('#exSelect'); sel.innerHTML='';
  exs.forEach(e=>{
    const o=document.createElement('option');
    o.value=e.id; o.textContent=e.name; sel.appendChild(o);
  });
  // 何もなければプレースホルダ
  if(!exs.length){
    const o=document.createElement('option');
    o.textContent='（この部位の種目は未登録）'; o.value='';
    sel.appendChild(o);
  }
  // テキスト更新
  const name = sel.selectedOptions[0]?.textContent || '—';
  $('#exSelectedText').textContent = `選択中：${name}`;

  // クイック/カスタムの種目セレクトも同様に更新（簡易連動）
  ['tplExFromHist','tplExCustom'].forEach(id=>{
    const s = $('#'+id); if(!s) return;
    s.innerHTML = sel.innerHTML;
  });
}

function renderTodaySets(){
  const ul = $('#todaySets');
  if(currentSession.sets.length===0){ ul.innerHTML='<li>まだありません</li>'; return; }
  const nameMap = Object.fromEntries([...$('#exSelect').options].map(o=>[Number(o.value), o.textContent]));
  ul.innerHTML = currentSession.sets.map(s=>{
    const name = nameMap[s.exercise_id] || '種目';
    return `<li><span><strong>${escapeHTML(name)}</strong> ${s.weight}kg x ${s.reps}${s.rpe?` RPE${s.rpe}`:''}</span><button data-id="${s.temp_id}" class="ghost">削除</button></li>`;
  }).join('');
  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=>{
      currentSession.sets = currentSession.sets.filter(x=>x.temp_id!==b.dataset.id);
      renderTodaySets();
    });
  });
}

// ===== Timer =====
let timerHandle=null, timerLeft=0;
function startRestTimer(sec){
  clearInterval(timerHandle);
  timerLeft=sec;
  const btn=$('#btnTimer'); btn.disabled=true;
  timerHandle=setInterval(()=>{
    timerLeft--; btn.textContent=`休憩${timerLeft}s`;
    if(timerLeft<=0){
      clearInterval(timerHandle);
      btn.textContent='休憩60s'; btn.disabled=false;
      if('vibrate' in navigator) navigator.vibrate([100,100,100]);
      try{ new Audio('beep.wav').play().catch(()=>{});}catch(_){}
      if('Notification' in window && Notification.permission==='granted'){
        new Notification('休憩終了',{body:'次のセットへ', icon:'icons/icon-192.png'});
      }
      showToast('休憩終了');
    }
  },1000);
}

// ===== History =====
async function bindHistoryUI(){
  $('#historyCount').addEventListener('change', renderHistory);
  $('#btnExport').addEventListener('click', exportCSV);
  $('#btnImport').addEventListener('click', ()=>$('#importFile').click());
  $('#importFile').addEventListener('change', importCSV);
}
async function renderHistory(){
  const count = Number($('#historyCount').value || 20);
  const sessions = (await getAll('sessions')).sort((a,b)=>b.created_at-a.created_at).slice(0,count);
  const ul=$('#historyList'); ul.innerHTML='';
  for(const s of sessions){
    const sets = await indexGetAll('sets','by_session',s.id);
    const vol = sets.reduce((sum,x)=>sum+x.weight*x.reps,0);
    const est = sets.length ? Math.max(...sets.map(x=>x.weight*(1+x.reps/30))) : 0;
    const li=document.createElement('li');
    li.innerHTML=`
      <div>
        <strong>${s.date}</strong>
        <span class="badge">${Math.round(vol)}kg</span>
        <span class="badge">1RM推定:${Math.round(est)}kg</span>
        <div style="font-size:12px;color:#aaa">${s.note||''}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost" data-act="dup" data-id="${s.id}">複製</button>
        <button class="ghost" data-act="edit" data-id="${s.id}">編集</button>
        <button class="danger" data-act="del" data-id="${s.id}">削除</button>
      </div>`;
    ul.appendChild(li);
  }
  if(!sessions.length) ul.innerHTML='<li>まだありません</li>';
  if(!ul._bound){
    ul.addEventListener('click', async (e)=>{
      const b=e.target.closest('button'); if(!b) return;
      const id=Number(b.dataset.id), act=b.dataset.act;
      if(act==='del'){ if(confirm('このセッションを削除しますか？')) await deleteSession(id); }
      else if(act==='edit'){ await editSessionNote(id); }
      else if(act==='dup'){ await duplicateSessionToToday(id); }
    });
    ul._bound=true;
  }
}

// ===== Analytics =====
async function renderAnalytics(){
  const sets = await getAll('sets');
  const exMap = Object.fromEntries((await getAll('exercises')).map(e=>[e.id,e.name]));
  const today=new Date(); today.setHours(0,0,0,0);
  const days=[]; for(let i=6;i>=0;i--){ const d=new Date(today.getTime()-i*86400000); days.push({key:d.toISOString().slice(0,10), label:`${d.getMonth()+1}/${d.getDate()}`}); }
  const perEx={};
  for(const s of sets){
    if(!days.find(d=>d.key===s.date)) continue;
    const name=exMap[s.exercise_id]||'不明';
    perEx[name]=perEx[name]||{}; perEx[name][s.date]=(perEx[name][s.date]||0)+s.weight*s.reps;
  }
  const canvas=$('#chart'), ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W=canvas.width,H=canvas.height,L=40,B=30,T=10,R=10;
  ctx.strokeStyle='#444'; ctx.fillStyle='#999'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
  let max=1; Object.values(perEx).forEach(m=>days.forEach(d=>{max=Math.max(max,m[d.key]||0);})); 
  const colors=['#7cb342','#42a5f5','#ab47bc','#ef5350','#ffb300','#26a69a']; let idx=0;
  const legend=$('#legend'); legend.innerHTML='';
  Object.keys(perEx).forEach(name=>{
    const color=colors[idx++%colors.length];
    const pts=days.map((d,i)=>({x:L+(i*(W-L-R)/(days.length-1)), y:(H-B)-((perEx[name][d.key]||0)/max)*(H-B-T)}));
    ctx.strokeStyle=color; ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.stroke();
    pts.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,2,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); });
    const chip=document.createElement('div'); chip.className='chip';
    const dot=document.createElement('div'); dot.className='dot'; dot.style.background=color;
    const label=document.createElement('span'); label.textContent=name;
    chip.appendChild(dot); chip.appendChild(label); legend.appendChild(chip);
  });
  ctx.fillStyle='#aaa'; ctx.textAlign='center'; ctx.font='12px system-ui';
  days.forEach((d,i)=> ctx.fillText(d.label, L+(i*(W-L-R)/(days.length-1)), H-10));
  const total7 = Object.values(perEx).reduce((sum,map)=> sum + days.reduce((a,d)=>a+(map[d.key]||0),0), 0);
  $('#metrics').innerHTML = `
    <div>直近7日ボリューム</div><div>${Math.round(total7)} kg</div>
    <div>種目数</div><div>${Object.keys(perEx).length} 種目</div>`;
}

// ===== Settings（簡易そのまま） =====
async function bindSettingsUI(){
  $('#btnCreateEx').addEventListener('click', async ()=>{
    const name=$('#newExName').value.trim(); if(!name) return;
    try{ await put('exercises',{name}); $('#newExName').value=''; await renderExSelect(); await renderExList(); showToast('追加しました'); }
    catch(_){ showToast('同名の種目があります'); }
  });
  $('#darkToggle').addEventListener('change', async (e)=>{
    await put('prefs',{key:'dark', value:e.target.checked});
    document.documentElement.dataset.theme = e.target.checked?'dark':'light';
  });
  $('#btnNotif').addEventListener('click', async ()=>{
    if(!('Notification' in window)){ showToast('この端末は通知に未対応'); return; }
    const perm=await Notification.requestPermission();
    showToast(perm==='granted'?'通知を許可しました':'通知は許可されていません');
  });
  $('#btnWipe').addEventListener('click', async ()=>{
    if(!confirm('本当に全データを削除しますか？この操作は元に戻せません。')) return;
    await clearAll();
    await put('prefs',{key:'dark', value: $('#darkToggle').checked});
    await renderExSelect(); renderExList(); renderHistory(); renderAnalytics(); renderTodaySets();
    showToast('全データを削除しました');
  });
  renderExList();
}
async function renderExList(){
  const exs=(await getAll('exercises')).sort((a,b)=>(a.group||'').localeCompare(b.group||'','ja')||a.name.localeCompare(b.name,'ja'));
  const ul=$('#exList');
  ul.innerHTML = exs.map(e=>{
    const tag=e.group?`<span class="badge" style="margin-right:8px">${escapeHTML(e.group)}</span>`:'';
    return `<li><span>${tag}${escapeHTML(e.name)}</span><button class="ghost" data-id="${e.id}">削除</button></li>`;
  }).join('');
  ul.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async ()=>{
      await del('exercises', Number(b.dataset.id));
      await renderExList(); await renderExSelect(); renderAnalytics();
    });
  });
}

// ===== CSV =====
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
async function importCSV(ev){
  const file=ev.target.files[0]; if(!file) return;
  const text=await file.text();
  const [_, sBlock, setBlock] = text.split('##SESSIONS');
  if(!setBlock){ showToast('形式が違います'); ev.target.value=''; return; }
  const [sessionsPart, setsPart] = ('##SESSIONS'+setBlock).split('##SETS');
  const sLines=sessionsPart.split(/\r?\n/).slice(2).filter(Boolean);
  const setLines=setsPart.split(/\r?\n/).slice(2).filter(Boolean);
  await clearAll();
  for(const line of sLines){
    const [id,date,note]=parseCSVRow(line);
    await put('sessions',{id:Number(id), date, note, created_at:new Date(date).getTime()});
  }
  for(const line of setLines){
    const [id,session_id,exercise_id,weight,reps,rpe,ts,date]=parseCSVRow(line);
    await put('sets',{id:Number(id), session_id:Number(session_id), exercise_id:Number(exercise_id), weight:Number(weight), reps:Number(reps), rpe:rpe?Number(rpe):null, ts:Number(ts), date});
  }
  renderHistory(); renderAnalytics(); showToast('インポート完了'); ev.target.value='';
}
async function clearAll(){
  for(const s of ['sessions','sets','exercises']){
    await new Promise((res,rej)=>{ const r=tx([s],'readwrite').objectStore(s).clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
  }
  await ensureInitialExercises();
}
function csvEscape(s){ const needs=/[",\n]/.test(s); return needs ? '"' + String(s).replace(/"/g,'""') + '"' : s; }
function parseCSVRow(row){
  const out=[]; let cur='', inQ=false;
  for(let i=0;i<row.length;i++){
    const c=row[i];
    if(inQ){ if(c=='"'){ if(row[i+1]=='"'){cur+='"'; i++;} else {inQ=false;} } else cur+=c; }
    else { if(c===','){ out.push(cur); cur=''; } else if(c=='"'){ inQ=true; } else cur+=c; }
  } out.push(cur); return out;
}

// ===== History ops =====
async function deleteSession(id){
  const sets=await indexGetAll('sets','by_session',id);
  await Promise.all(sets.map(s=>del('sets',s.id)));
  await del('sessions',id);
  renderHistory(); renderAnalytics(); showToast('セッションを削除しました');
}
async function editSessionNote(id){
  const s=await get('sessions',id);
  const next=prompt('メモを編集', s?.note || ''); if(next===null) return;
  s.note=next; await put('sessions',s); renderHistory(); showToast('メモを更新しました');
}
async function duplicateSessionToToday(id){
  const src=await get('sessions',id);
  const today=todayStr();
  const newId=await put('sessions',{date:today, note:(src?.note||'')+' (複製)', created_at:Date.now()});
  const sets=await indexGetAll('sets','by_session',id);
  for(const x of sets){
    await put('sets',{session_id:newId, exercise_id:x.exercise_id, weight:x.weight, reps:x.reps, rpe:x.rpe, ts:Date.now(), date:today});
  }
  renderHistory(); renderAnalytics(); showToast('今日に複製しました');
}

init(); // ← 消さない