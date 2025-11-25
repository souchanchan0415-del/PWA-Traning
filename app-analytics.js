// Train Punch analytics module — v1.1.2
// 解析タブ（7日ボリューム / e1RMトレンド / 週次サマリー）専用
// 依存しているグローバル: $, getAll, e1rm, debounce, watchlist, esc, SETTINGS_TIPS など

// =================== Analytics ===================
function _resizeCanvas(canvas,targetHeight=260){
  const dpr=Math.max(1,window.devicePixelRatio||1);
  const rect=canvas.getBoundingClientRect();
  const w=Math.max(200,Math.floor(rect.width));
  const h=targetHeight;
  if(canvas.width!==w*dpr||canvas.height!==h*dpr){
    canvas.width=w*dpr; canvas.height=h*dpr; canvas.style.height=h+'px';
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  }
}
function _lastNDays(n){
  const base=new Date(); base.setHours(0,0,0,0);
  const days=[];
  for(let i=n-1;i>=0;i--){
    const d=new Date(base); d.setDate(base.getDate()-i);
    days.push({key:ymdLocal(d),label:`${d.getMonth()+1}/${d.getDate()}`});
  }
  return days;
}
function _niceRange(min,max,ticksDesired=5){
  if(!isFinite(min)||!isFinite(max)) return {niceMin:0,niceMax:1,step:1};
  if(min===max){
    const p=Math.max(1,Math.pow(10,Math.floor(Math.log10(Math.abs(max)||1))));
    return {niceMin:Math.floor((min-p)/p)*p,niceMax:Math.ceil((max+p)/p)*p,step:p};
  }
  const span=max-min;
  const raw=span/Math.max(2,ticksDesired);
  const mag=Math.pow(10,Math.floor(Math.log10(raw)));
  const norm=raw/mag;
  let step=(norm<=1)?1*mag:(norm<=2)?2*mag:(norm<=5)?5*mag:10*mag;
  const niceMin=Math.floor(min/step)*step;
  const niceMax=Math.ceil(max/step)*step;
  return {niceMin,niceMax,step};
}
function _drawBarChart(canvas,days,totals,hoverIndex=-1){
  _resizeCanvas(canvas,260);
  const ctx=canvas.getContext('2d');
  const W=canvas.getBoundingClientRect().width, H=260;
  const T=26,R=12,B=30;
  const maxV=Math.max(1,...totals);
  const {niceMin,niceMax,step}= _niceRange(0,maxV*1.08,5);
  const yFor=v=>(H-B)-((v-niceMin)/(niceMax-niceMin||1))*(H-B-T);

  ctx.font='12px system-ui';
  const yLabels=[];
  for(let v=niceMin; v<=niceMax+1e-9; v+=step) yLabels.push(v);
  const widest=Math.max(...yLabels.map(v=>ctx.measureText(String(Math.round(v))).width));
  const L=Math.max(42,Math.ceil(widest)+14);

  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='#9993'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
  ctx.strokeStyle='#9992'; ctx.fillStyle='#9aa4b2'; ctx.textAlign='right'; ctx.textBaseline='middle';
  for(const v of yLabels){
    const y=yFor(v);
    ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-R,y); ctx.stroke();
    ctx.fillText(String(Math.round(v)),L-6,y);
  }

  ctx.textAlign='center'; ctx.textBaseline='alphabetic'; ctx.font='12px system-ui';
  const innerW=W-L-R, stepX=innerW/days.length;
  for(let i=0;i<days.length;i++){
    const x=L+i*stepX+stepX/2;
    ctx.fillStyle='#9aa4b2';
    ctx.fillText(days[i].label,x,H-8);
  }

  if(totals.every(v=>v<=0)){
    ctx.fillStyle='#9aa4b2'; ctx.textAlign='center'; ctx.font='14px system-ui';
    ctx.fillText('まだデータがありません。セットを追加すると表示されます。', W/2, (H-B+T)/2);
    canvas._chartDims={L,step:stepX,barW:Math.min(32,stepX*0.58),W,H,T,B,max:niceMax};
    canvas._days=days; canvas._totals=totals;
    return;
  }

  const barW=Math.min(32,stepX*0.58);
  for(let i=0;i<totals.length;i++){
    const v=totals[i];
    const xC=L+i*stepX+stepX/2;
    const h=((v-niceMin)/(niceMax-niceMin||1))*(H-B-T);
    const x=xC-barW/2;
    const y=(H-B)-h;
    ctx.fillStyle=(i===hoverIndex)?'#0fb6a9':'#6cc7bf';
    ctx.fillRect(Math.round(x)+0.5,Math.round(y),Math.round(barW),Math.round(h));
    if(v>0){
      const yLabel=Math.max(T+12,y-6);
      ctx.fillStyle='#4a5568'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
      ctx.fillText(String(Math.round(v)),xC,yLabel);
    }
  }
  canvas._chartDims={L,step:stepX,barW,W,H,T,B,max:niceMax};
  canvas._days=days; canvas._totals=totals;
}

// --- Line ---
function _drawLineChart(canvas,labels,values,hoverIndex=-1){
  _resizeCanvas(canvas,260);
  const ctx=canvas.getContext('2d'); const W=canvas.getBoundingClientRect().width, H=260;
  const T=26,R=12,B=30; ctx.clearRect(0,0,W,H);
  if(values.length===0){
    const L=56; ctx.strokeStyle='#9993'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
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
  const yFor=v=>(H-B)-((v-niceMin)/(niceMax-niceMin||1))*(H-B-T);

  ctx.strokeStyle='#9993'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(L,T); ctx.lineTo(L,H-B); ctx.lineTo(W-R,H-B); ctx.stroke();
  ctx.strokeStyle='#9992'; ctx.fillStyle='#9aa4b2'; ctx.textAlign='right'; ctx.textBaseline='middle';
  for(const v of tickVals){
    const y=yFor(v);
    ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-R,y); ctx.stroke();
    ctx.fillText(String(Math.round(v)),L-6,y);
  }

  ctx.textAlign='center'; ctx.textBaseline='alphabetic';
  const tickN=Math.min(6,labels.length);
  for(let i=0;i<labels.length;i++){
    if(i===0||i===labels.length-1||i%Math.ceil(labels.length/(tickN||1))===0){
      const x=L+i*stepX;
      ctx.fillStyle='#9aa4b2';
      ctx.fillText(labels[i],x,H-8);
    }
  }

  ctx.strokeStyle='#0fb6a9'; ctx.lineWidth=2;
  ctx.beginPath();
  for(let i=0;i<values.length;i++){
    const x=L+i*stepX, y=yFor(values[i]);
    (i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  }
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
      const pickIndex=(evt)=>{
        const r=canvas.getBoundingClientRect();
        const x=(evt.touches?evt.touches[0].clientX:evt.clientX)-r.left;
        const dims=canvas._chartDims||{L:0,step:1};
        const i=Math.floor((x-dims.L)/dims.step);
        return (i>=0 && i<(canvas._days?.length||0))?i:-1;
      };
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
    const m=$('#metrics');
    if(m) m.innerHTML=`<div>直近7日ボリューム</div><div>${Math.round(total7)} kg</div><div>種目数</div><div>${uniqEx} 種目</div>`;
    const legend=$('#legend'); if(legend) legend.innerHTML='';
  }
  await renderTrendSelect();
  await renderTrendChart();
  await renderWeeklySummary();
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
  if(!sel._bound){
    sel.addEventListener('change',renderTrendChart);
    $('#trendRange')?.addEventListener('change',renderTrendChart);
    sel._bound=true;
  }
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
  rows.forEach(s=>{
    const v=e1rm(s.weight,s.reps);
    if(!byDate[s.date]||v>byDate[s.date]) byDate[s.date]=v;
  });
  const points=Object.entries(byDate).map(([date,v])=>({date,v,ts:new Date(date).getTime()})).sort((a,b)=>a.ts-b.ts);

  let data=points;
  if(range!=='all'){ const n=Number(range)||10; data=points.slice(-n); }

  const labels=data.map(p=>{ const d=new Date(p.ts); return `${d.getMonth()+1}/${d.getDate()}`; });
  const values=data.map(p=>p.v);

  _drawLineChart(canvas,labels,values,-1);

  if(!_trendEventsBound){
    const pickIndex=(evt)=>{
      const r=canvas.getBoundingClientRect();
      const x=(evt.touches?evt.touches[0].clientX:evt.clientX)-r.left;
      const dims=canvas._trendDims||{L:0,step:1};
      const i=Math.round((x-dims.L)/dims.step);
      return (i>=0 && i<(canvas._labels?.length||0))?i:-1;
    };
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
  if(info){
    info.innerHTML=`<span class="badge">最新: ${Math.round(latest)} kg</span><span class="badge">ベスト: ${Math.round(best)} kg</span><span class="badge">データ: ${values.length} 回</span>`;
  }
}

// ===== 週次サマリー =====
function _isoWeekKeyLocal(dateStr){
  const d0=new Date(dateStr);
  const d=new Date(d0.getFullYear(),d0.getMonth(),d0.getDate());
  const day=d.getDay()||7; d.setDate(d.getDate()+4-day);
  const yearStart=new Date(d.getFullYear(),0,1);
  const week=Math.ceil((((d - yearStart)/86400000) + 1)/7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}
async function renderWeeklySummary(){
  const el=document.getElementById('weekly-summary-body'); if(!el) return;
  const sets= (await getAll('sets')).filter(s=>!s.wu);
  if(!sets.length){
    el.textContent='記録が見つかりません。入力するとここに今週の要約が出ます。';
    return;
  }
  const map=new Map();
  for(const s of sets){
    const k=_isoWeekKeyLocal(s.date);
    (map.get(k)||map.set(k,[]).get(k)).push(s);
  }
  const latestKey=[...map.keys()].sort().pop();
  const arr=map.get(latestKey)||[];
  const totalVol=arr.reduce((sum,x)=>sum+(Number(x.weight)||0)*(Number(x.reps)||0),0);
  const rpes=arr.map(x=>x.rpe).filter(v=>typeof v==='number'&&!Number.isNaN(v));
  const avgRpe=rpes.length?(rpes.reduce((a,b)=>a+b,0)/rpes.length):null;
  let score=10;
  if(totalVol<=1000) score=2;
  else if(totalVol<=2000) score=4;
  else if(totalVol<=3000) score=6;
  else if(totalVol<=4000) score=8;
  const comment=
    score<=3 ? '基礎づくり週。次週は+10〜20%を目安に。'
    : score<=6 ? '標準負荷。フォームと睡眠を重視。'
    : score<=8 ? 'やや高負荷。補助種目を整理して回復時間を。'
    : '高負荷。48–72hの回復と栄養を最優先。';
  el.innerHTML=`<div style="display:flex;gap:1rem;align-items:baseline;flex-wrap:wrap">
      <strong>対象週：</strong><span>${latestKey}</span>
      <strong>合計ボリューム：</strong><span>${Math.round(totalVol)}</span>
      <strong>強度スコア：</strong><span style="font-size:1.25rem">${score}/10</span>
      ${avgRpe!=null?`<strong>平均RPE：</strong><span>${avgRpe.toFixed(1)}</span>`:''}
    </div><p style="margin-top:.5rem">${comment}</p>`;
}
