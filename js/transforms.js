/* =====================================================================
   COLUMN TRANSFORM PANEL
===================================================================== */
let tpFieldIdx=null;
let tpSrc='All';
let tpCurrentFn=null;

function openTransformPanel(fieldIdx){
  tpFieldIdx=fieldIdx;
  const f=S.resolvedMap[fieldIdx];
  id('tpTitle').textContent='Transform: '+f.label;
  id('tpPanel').classList.add('open');

  const isSKBtx=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code';
  const loaded=SOURCES.filter(s=>{
    if(isSKBtx&&s==='COA') return !!S.refWbs.CC_MATRIX&&!!f.sources[s];
    return S.wbs[s]&&!!f.sources[s];
  });
  const defaultSrc=loaded[0]||'All';
  setTpSrc(defaultSrc);

  const ft=S.fieldTransforms[txKey(f.canonical)];
  const existingEntry=ft?Object.values(ft)[0]:null;

  if(existingEntry){
    // Restore last applied state
    id('tpClearBtn').style.display='';
    id('tpInstruction').value=existingEntry.instruction||'';
    if(existingEntry.fnStr){
      id('tpFnBox').textContent=existingEntry.fnStr;
      id('tpFnBox').style.display='block';
      tpCurrentFn={str:existingEntry.fnStr, fn:existingEntry.fn};
      id('tpApplyBtn').disabled=true; // already applied
    }
    id('tpSub').textContent='Transform active \u2014 modify instruction and Preview to update';
  } else {
    id('tpClearBtn').style.display='none';
    id('tpInstruction').value='';
    id('tpFnBox').style.display='none';
    id('tpFnBox').textContent='';
    tpCurrentFn=null;
    id('tpApplyBtn').disabled=true;
    id('tpSub').textContent='Select a source \u2192 preview \u2192 apply';
  }
  id('tpErr').style.display='none';
  loadTpSamples();
}

function closeTransformPanel(){
  id('tpPanel').classList.remove('open');
  tpFieldIdx=null; tpCurrentFn=null;
}

function setTpSrc(src){
  tpSrc=src;
  document.querySelectorAll('#tpSrcToggle .src-btn').forEach(b=>b.classList.remove('active'));
  const map={COA:'s-coa',FAQ:'s-faq',DataPool:'s-dp',All:'s-all'};
  const btn=document.querySelector('#tpSrcToggle .'+map[src]);
  if(btn) btn.classList.add('active');
  loadTpSamples();
}

function getFieldSamples(fieldIdx,src){
  const isSKBtx=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code';
  if(src==='All'){
    const loaded=SOURCES.filter(s=>{
      if(s==='COA') return !!S._coaSideMap; // COA available whenever coaSideMap is cached
      return S.wbs[s]&&S.activeSources.has(s);
    });
    for(const s of loaded){
      const vals=getFieldSamples(fieldIdx,s);
      if(vals.length) return vals;
    }
    return [];
  }
  const f=S.resolvedMap[fieldIdx];
  // COA: read pre-transform values from the cached coaSideMap (both SKA and SKB)
  if(src==='COA'&&S._coaSideMap){
    const seen=new Set();
    const out=[];
    for(const rowVals of S._coaSideMap.values()){
      // rowVals is {[canonical]:value} for SKA, {[canonical]:value} for SKB (same shape now)
      const v = typeof rowVals === 'object' && !Array.isArray(rowVals)
        ? rowVals[f.canonical]
        : rowVals; // fallback
      if(v!==null&&v!==undefined&&v!==''&&!seen.has(String(v))){
        seen.add(String(v));
        out.push(String(v));
        if(out.length>=10) break;
      }
    }
    return out;
  }
  if(src==='COA') return []; // COA_MASTER not loaded yet
  const col=f.sources[src];
  if(!col||!S.wbs[src]) return [];
  const rows=getSourceRows(src);
  const hi=S.headers[src].indexOf(col);
  if(hi<0) return [];
  return [...new Set(rows.slice(0,200).map(r=>r[hi]||'').filter(Boolean))].slice(0,10);
}

function loadTpSamples(){
  if(tpFieldIdx===null) return;
  // Show preset transforms from mapping JSON
  const tpField = S.resolvedMap[tpFieldIdx];
  const presetHtml = (()=>{
    const dt = tpField && tpField.default_transforms;
    if(!dt) return '';
    const entries = Object.entries(dt)
      .filter(([k]) => k === tpSrc || k === 'All')
      .map(([k,v]) => {
        const parts = [];
        if(v.value_map) parts.push('map: '+JSON.stringify(v.value_map));
        if(v.case)      parts.push('case: '+v.case);
        return parts.join(', ');
      }).filter(Boolean);
    if(!entries.length) return '';
    return '<div style="font-size:10px;background:#f0f9ff;border:1px solid #bae0fd;border-radius:6px;padding:5px 10px;margin-bottom:8px;">'
      +'<span style="font-weight:700;color:#0369a1;">&#9670; Preset (from mapping JSON):</span> '
      +entries.join(' | ')+'</div>';
  })();
  const presetEl = id('tpPreset');
  if(presetEl) presetEl.innerHTML = presetHtml;
  const samples=getFieldSamples(tpFieldIdx,tpSrc);
  const ft=S.fieldTransforms[S.resolvedMap[tpFieldIdx].canonical];
  const activeSrc=tpSrc==='All'?null:tpSrc;
  const existEntry=ft?(activeSrc?ft[activeSrc]||ft['All']:ft['All']):null;
  const existFn=existEntry&&typeof existEntry==='object'?existEntry.fn:existEntry;

  const rows=samples.map(v=>{
    let result='&#8212;';
    if(existFn){try{result=esc(String(existFn(v)));}catch(e){result='<span style="color:var(--del-src)">error</span>';}}
    else if(tpCurrentFn){try{result=esc(String(tpCurrentFn.fn(v)));}catch(e){result='<span style="color:var(--del-src)">error</span>';}}
    return '<div class="tp-row"><div class="tp-orig" title="'+esc(v)+'">'+esc(v)+'</div><div style="text-align:center;color:var(--text3);">&rarr;</div><div class="tp-result">'+result+'</div></div>';
  }).join('');

  id('tpSamples').innerHTML='<div class="tp-row hdr"><div>Original</div><div></div><div>Transformed</div></div>'+
    (rows||'<div style="padding:10px;font-size:11px;color:var(--text3);">No values found for this source/column</div>');

  // Quick suggestions
  const chips=['Remove leading zeros','Uppercase','Trim whitespace','Extract digits only','Remove special chars'];
  id('tpChips').innerHTML=chips.map(c=>
    '<button style="font-family:inherit;font-size:10px;padding:2px 9px;border-radius:20px;border:1px solid var(--dp-border);background:var(--dp-bg);color:var(--dp-text);cursor:pointer;" onclick="id(\'tpInstruction\').value=\''+c+'\'">'
    +c+'</button>'
  ).join('');
}

async function previewTransform(){
  const instruction=id('tpInstruction').value.trim();
  if(!instruction){showToast('Enter an instruction first','warn');return;}
  const cfg=getAICfg();
  if(!cfg.endpoint||(!cfg.key&&cfg.mode==='apikey')){showToast('Configure AI endpoint first — click AI Config in the header','warn');return;}

  const btn=id('tpPreviewBtn');
  btn.disabled=true; btn.textContent='Thinking\u2026';
  id('tpErr').style.display='none';

  // Show preset transforms from mapping JSON
  const tpField = S.resolvedMap[tpFieldIdx];
  const presetHtml = (()=>{
    const dt = tpField && tpField.default_transforms;
    if(!dt) return '';
    const entries = Object.entries(dt)
      .filter(([k]) => k === tpSrc || k === 'All')
      .map(([k,v]) => {
        const parts = [];
        if(v.value_map) parts.push('map: '+JSON.stringify(v.value_map));
        if(v.case)      parts.push('case: '+v.case);
        return parts.join(', ');
      }).filter(Boolean);
    if(!entries.length) return '';
    return '<div style="font-size:10px;background:#f0f9ff;border:1px solid #bae0fd;border-radius:6px;padding:5px 10px;margin-bottom:8px;">'
      +'<span style="font-weight:700;color:#0369a1;">&#9670; Preset (from mapping JSON):</span> '
      +entries.join(' | ')+'</div>';
  })();
  const presetEl = id('tpPreset');
  if(presetEl) presetEl.innerHTML = presetHtml;
  const samples=getFieldSamples(tpFieldIdx,tpSrc);
  const f=S.resolvedMap[tpFieldIdx];

  const prompt=[
    'You are a data transformation expert.',
    'Field: "'+f.label+'"',
    'Source: '+tpSrc,
    'Task: '+instruction,
    'Sample values: '+JSON.stringify(samples.slice(0,8)),
    '',
    'Return ONLY a JavaScript arrow function (no markdown, no explanation).',
    'The function takes one string argument and returns the transformed string.',
    'Handle empty strings gracefully.',
    'Examples: v => v.replace(/^0+/,"")   or   v => v.toUpperCase()'
  ].join('\n');

  try{
    const reply=await callAI([{role:'user',content:prompt}]);
    let fnStr=reply.trim().replace(/^```[a-z]*\n?/,'').replace(/\n?```$/,'').trim();
    let fn;
    try{fn=eval('('+fnStr+')');if(typeof fn!=='function')throw new Error('Not a function');}
    catch(e){throw new Error('AI returned invalid function: '+fnStr.slice(0,80));}
    tpCurrentFn={str:fnStr,fn};
    id('tpFnBox').textContent=fnStr;
    id('tpFnBox').style.display='block';
    id('tpApplyBtn').disabled=false;
    loadTpSamples();
  }catch(err){
    id('tpErr').textContent='Error: '+err.message;
    id('tpErr').style.display='block';
  }finally{
    btn.disabled=false; btn.textContent='\u25b6 Preview';
  }
}

function applyTransform(){
  if(!tpCurrentFn||tpFieldIdx===null) return;
  const f=S.resolvedMap[tpFieldIdx];
  if(!S.fieldTransforms[txKey(f.canonical)]) S.fieldTransforms[txKey(f.canonical)]={};
  S.fieldTransforms[txKey(f.canonical)][tpSrc]={
    fn: tpCurrentFn.fn,
    fnStr: tpCurrentFn.str,
    instruction: id('tpInstruction').value.trim()||'(custom)',
    appliedAt: Date.now()
  };
  saveTransformsToStorage();
  renderTxCard();
  renderMappingTable();
  id('tpClearBtn').style.display='';
  id('tpApplyBtn').disabled=true;
  showToast('Transform applied to "'+f.label+'" ('+tpSrc+')','ok');
}

function clearFieldTransform(){
  if(tpFieldIdx===null) return;
  const f=S.resolvedMap[tpFieldIdx];
  delete S.fieldTransforms[txKey(f.canonical)];
  tpCurrentFn=null;
  id('tpFnBox').style.display='none';
  id('tpFnBox').textContent='';
  id('tpClearBtn').style.display='none';
  id('tpApplyBtn').disabled=true;
  id('tpInstruction').value='';
  id('tpSub').textContent='Select a source \u2192 preview \u2192 apply';
  saveTransformsToStorage();
  renderTxCard();
  loadTpSamples();
  renderMappingTable();
  showToast('Transform cleared from "'+f.label+'"','ok');
}

/* =====================================================================
   DIFF CARD FULLSCREEN
===================================================================== */
let diffFs=false;
function toggleDiffFullscreen(){
  const card=id('diffCard');
  const btn=id('diffFsBtn');
  diffFs=!diffFs;
  if(diffFs){
    card.classList.add('diff-card-fs');
    if(btn){btn.innerHTML='&#x2B1C; Exit Fullscreen';btn.title='Exit fullscreen';}
    document.body.style.overflow='hidden';
  } else {
    card.classList.remove('diff-card-fs');
    if(btn){btn.innerHTML='&#x26F6; Fullscreen';btn.title='Enter fullscreen';}
    document.body.style.overflow='';
  }
}

