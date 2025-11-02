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

  // ★ WU 設定保存
  $('#wuScheme')?.addEventListener('change', (e)=> put('prefs',{key:'wu_scheme', value: e.target.value}).catch(()=>{}));
  $('#wuRound') ?.addEventListener('change', (e)=> put('prefs',{key:'wu_round',  value: Number(e.target.value)||2.5}).catch(()=>{}));

  // ★ WU自動生成
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

    // 既存WU（当日・同種目）を置き換え
    const exFilter = s => !(s.wu && s.exercise_id===exId);
    currentSession.sets = currentSession.sets.filter(exFilter);

    // 既存（非WU）と重複する重量×回数はスキップ
    const hasSame = (w,r)=> currentSession.sets.some(s=> s.exercise_id===exId && !s.wu && s.weight===w && s.reps===r);

    const date = $('#sessDate').value;
    const now  = Date.now();
    let added = 0;
    plan.forEach((s,i)=>{
      if(hasSame(s.weight, s.reps)) return;
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
      added++;
    });
    renderTodaySets();
    const label = scheme==='auto' ? `自動(${guessSchemeByReps(rTop)})` : scheme;
    showToast(`WU ${added}セットを追加（${label} / ±${step}kg）`);
  });

  // ★ WU一括削除
  $('#btnClearWarmup')?.addEventListener('click', ()=>{
    if(!currentSession.sets.length){ showToast('削除対象がありません'); return; }
    pushUndo();
    const exId = Number($('#exSelect').value||0);
    let removed = 0;
    if(exId){
      const lenBefore = currentSession.sets.length;
      currentSession.sets = currentSession.sets.filter(s=> !(s.wu && s.exercise_id===exId));
      removed = lenBefore - currentSession.sets.length;
      renderTodaySets();
      showToast(removed>0 ? `WUを削除（この種目: ${removed}）` : 'この種目のWUはありません');
    }else{
      const lenBefore = currentSession.sets.length;
      currentSession.sets = currentSession.sets.filter(s=> !s.wu);
      removed = lenBefore - currentSession.sets.length;
      renderTodaySets();
      showToast(removed>0 ? `WUをすべて削除（${removed}）` : 'WUはありません');
    }
  });

  // セット追加（PR判定はウォッチのみ）
  $('#btnAddSet')?.addEventListener('click', async ()=>{
    const exId = Number($('#exSelect').value);
    const weight = Number($('#weight').value);
    const reps   = Number($('#reps').value);
    const rpeStr = $('#rpe').value;
    if(!exId || !weight || !reps){ showToast('種目・重量・回数は必須です'); return; }

    let willPR = false;
    if (isWatched(exId)) {
      const curE1 = e1rm(weight,reps);
      const hist = (await getAll('sets')).filter(s=>s.exercise_id===exId);
      const histBest = Math.max(0, ...hist.map(s=>e1rm(s.weight,s.reps)));
      const sessBest = Math.max(0, ...currentSession.sets.filter(s=>s.exercise_id===exId).map(s=>e1rm(s.weight,s.reps)));
      const bestSoFar = Math.max(histBest, sessBest);
      willPR = curE1 > bestSoFar;
    }

    pushUndo();

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

    if(autoTimerOn) startRestTimer(defaultTimerSec);

    $('#weight').value=''; $('#reps').value=''; $('#rpe').value='';
    renderTodaySets();
  });

  // タイマー / Undo
  $('#btnTimer')?.addEventListener('click', ()=>startRestTimer(defaultTimerSec));
  $('#btnUndo')?.addEventListener('click', doUndo);

  // セーブ
  $('#btnSaveSession')?.addEventListener('click', async ()=>{
    if(!currentSession.sets.length){ showToast('セットがありません'); return; }
    const date = $('#sessDate').value;
    const note = $('#sessNote').value;

    pushUndo();

    const sessionId = await put('sessions',{date, note, created_at: Date.now()});
    for(const s of currentSession.sets){
      await put('sets',{
        session_id:sessionId,
        exercise_id:s.exercise_id,
        weight:s.weight,
        reps:s.reps,
        rpe:s.rpe,
        ts:s.ts,
        date,
        ...(s.wu ? { wu:true } : {})
      });
    }
    currentSession = { date: todayStr(), note:'', sets: [] };
    $('#sessDate').value = todayStr(); $('#sessNote').value = '';
    renderTodaySets(); renderHistory(); renderAnalytics();
    await renderWeeklySummary();
    showToast('セッションを保存しました');
  });

  // カスタム投入
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