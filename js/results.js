/* =====================================================================
   CONFLICT CELL CLASS
===================================================================== */
function getCellClass(vals, fi, src){
  if(vals[src][fi]===null) return 'c-na';
  const avail=SOURCES.map(s=>vals[s][fi]).filter(v=>v!==null);
  if(avail.length<=1) return '';
  const cmpAvail=S.caseSensitive?avail:avail.map(v=>v.toLowerCase());
  const uniq=new Set(cmpAvail);
  if(uniq.size===1) return '';
  const cnt={};
  cmpAvail.forEach(v=>{cnt[v]=(cnt[v]||0)+1;});
  const majority=Object.keys(cnt).find(v=>cnt[v]>=2);
  const myVal=S.caseSensitive?vals[src][fi]:(vals[src][fi]||'').toLowerCase();
  if(majority) return myVal===majority?'c-majority':'c-outlier';
  return 'c-alldiff';
}

/* =====================================================================
   RESULTS RENDERING
===================================================================== */
function renderSummary(){
  const dc=S.diffCounts;
  const pct=dc.total>0?((dc.same/dc.total)*100).toFixed(1):'—';
  const mapping2 = S.activeMapping || getEmbeddedMap();
  const isSKB2   = mapping2.comparison_grain === 'account_company_code';
  const loaded   = SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s));
  const modeLabel = isSKB2
    ? 'SKB \u2014 (account, company code) grain'
    : (loaded.length===3 ? '3-way' : loaded.length===2 ? '2-way \u2014 '+loaded.map(s=>SRC_LABEL[s]).join(' \u2194 ') : '');
  if (id('summaryMode')) id('summaryMode').textContent = modeLabel ? '(' + modeLabel + ')' : '';

  // Inline clickable stat chips — clicking applies the matching filter
  const matchCls=pct==='—'?'':(parseFloat(pct)>=95?'s-match-hi':'s-match-lo');
  const af=S.filter; // current active filter for initial chip-active state
  const mapping = S.activeMapping || getEmbeddedMap();
  const isSKB   = mapping.comparison_grain === 'account_company_code';
  const chips=[
    {cls:'',f:'all',label:'Total',num:dc.total.toLocaleString()},
    {cls:'s-same',f:'same',label:'&#10003; Match',num:dc.same.toLocaleString()},
    {cls:'s-conflict',f:'conflict',label:'&#9888; Conflicts',num:dc.conflict.toLocaleString()},
    (isSKB ? !!S.refWbs.CC_MATRIX : !!S.refWbs.COA_MASTER)
      ?{cls:'s-only',f:'only_COA',label:'COA only',num:dc.onlyCOA.toLocaleString()}:null,
    S.wbs.FAQ?{cls:'s-only',f:'only_FAQ',label:'FAQ only',num:dc.onlyFAQ.toLocaleString()}:null,
    S.wbs.DataPool?{cls:'s-only',f:'only_DataPool',label:'DP only',num:dc.onlyDP.toLocaleString()}:null,
    isSKB&&dc.noReference>0?{cls:'s-warn',f:'no_reference',label:'&#9888; Not in CC-Matrix',num:dc.noReference.toLocaleString()}:null,
    isSKB&&dc.unexpectedCoco>0?{cls:'s-warn',f:'unexpected_coco',label:'&#9888; Unexpected CoCo',num:dc.unexpectedCoco.toLocaleString()}:null,
    {cls:matchCls,f:'',label:'Match rate',num:pct+(pct==='—'?'':'%'),noFilter:true},
    {cls:'',f:'',label:'Fields',num:S.comparableFields.length,noFilter:true},
  ].filter(Boolean);

  id('summaryGrid').innerHTML=chips.map(c=>{
    const isActive=!c.noFilter&&af===c.f;
    const clickable=!c.noFilter;
    const onclick=clickable?'onclick="applyStatChip(\''+c.f+'\')"':'';
    const cls='stat-chip '+c.cls+(clickable?' clickable':'')+(isActive?' chip-active':'');
    return '<span class="'+cls+'" '+onclick+' title="'+(clickable?'Click to filter':'')+'"><span class="sc-num">'+c.num+'</span> '+c.label+'</span>';
  }).join('');

  // COA filter stats — compact inline
  const coaStats=S.coaFilterStats;
  const coaEl=id('coaStats');
  if(coaEl){
    coaEl.innerHTML=S.wbs.COA&&coaStats.total>0
      ?'<span style="color:var(--coa-text);font-weight:600;">&#127807; COA filter:</span> '+
        coaStats.total.toLocaleString()+' total'+
        (coaStats.yellowSkipped?' &mdash; <span style="background:#FFF8C5;color:#7D4E00;padding:1px 7px;border-radius:10px;">&#9632; '+coaStats.yellowSkipped.toLocaleString()+' yellow</span>':'')+
        (coaStats.tenDigitSkipped?' <span style="background:#FFE5D0;color:#7D4E00;padding:1px 7px;border-radius:10px;">&#9726; '+coaStats.tenDigitSkipped.toLocaleString()+' non-10-digit</span>':'')+
        (coaStats.strikeSkipped?' <span style="background:#F3F0FF;color:#5B21B6;padding:1px 7px;border-radius:10px;text-decoration:line-through;">'+coaStats.strikeSkipped.toLocaleString()+'</span><span style="color:#5B21B6;"> struck out</span>':'')+
        ' <span style="color:var(--add-src);">&#10003; '+coaStats.kept.toLocaleString()+' used</span>'
      :'';
  }
}

function applyStatChip(f){
  // Navigate to Results sub-tab and apply filter
  showSubTab('results');
  applyFilter(f);
}

function applyFilter(f){
  // Deactivate all filter buttons
  ['f-all','f-conflict','f-onlyCOA','f-onlyFAQ','f-onlyDataPool','f-same'].forEach(bid=>{
    const el=id(bid); if(el) el.classList.remove('active');
  });
  // Activate matching button
  const btnId={
    'all':'f-all','conflict':'f-conflict','same':'f-same',
    'only_COA':'f-onlyCOA','only_FAQ':'f-onlyFAQ','only_DataPool':'f-onlyDataPool'
  }[f];
  if(btnId){const el=id(btnId);if(el)el.classList.add('active');}
  // Sync stat chip active state
  document.querySelectorAll('.stat-chip.clickable').forEach(el=>{
    const onclick=el.getAttribute('onclick')||'';
    const chipF=onclick.match(/'([^']+)'/)?.[1]||'';
    el.classList.toggle('chip-active', chipF===f);
  });
  S.filter=f;
  S.pageOffset=0;
  renderDiff(true);
}

function filteredRows(){
  let rows;
  if (S.filter === 'all')               rows = S._diffRows;
  else if (S.filter === 'no_reference')    rows = S._diffRows.filter(r => r.discType === 'no_reference');
  else if (S.filter === 'unexpected_coco') rows = S._diffRows.filter(r => r.discType === 'unexpected_coco');
  else                                  rows = S._diffRows.filter(r => r.dtype === S.filter);
  if (S.rowSearchKeys !== null) rows = rows.filter(r => S.rowSearchKeys.has(r.key));
  return rows;
}

function applyColFilter(val){
  S.colFilter=val||'';
  S.pageOffset=0;
  renderDiff(true);
}

/* =====================================================================
   COLUMN PICKER POPOVER
===================================================================== */
let _colPickerOpen=false;

function toggleColPicker(){
  _colPickerOpen=!_colPickerOpen;
  const pop=id('colPickerPopover');
  const btn=id('colPickerBtn');
  if(!pop||!btn) return;
  pop.classList.toggle('hidden',!_colPickerOpen);
  btn.classList.toggle('open',_colPickerOpen);
  if(_colPickerOpen){
    const srch=id('colPickerSearch');
    if(srch){srch.value='';srch.focus();}
    renderColPicker('');
  }
}

function renderColPicker(query){
  const q=(query||'').toLowerCase().trim();
  const list=id('colPickerList');
  const exclSection=id('colPickerExcluded');
  if(!list) return;

  const cf=S.comparableFields;          // currently visible in diff (not excluded)
  const excluded=[...S.excludedFields]; // canonical names of excluded fields
  const allFields=S.resolvedMap;        // full field list including excluded

  // Comparable fields (not excluded) — filtered by search query
  const visible=cf.filter(f=>!q||f.label.toLowerCase().includes(q));
  const hasTx=f=>!!(S.fieldTransforms[txKey(f.canonical)]&&Object.keys(S.fieldTransforms[txKey(f.canonical)]).length);

  list.innerHTML=visible.map(f=>{
    const hidden=S.hiddenCols.has(f.canonical);
    const tx=hasTx(f);
    return '<label class="col-picker-item">'+
      '<input type="checkbox" '+(hidden?'':'checked')+' onchange="colPickerToggle(\''+f.canonical+'\',this.checked)">'+
      '<span class="col-picker-item-label" title="'+esc(f.label)+'">'+esc(f.label)+'</span>'+
      (tx?'<span class="col-picker-tx">&#9889; Tx</span>':'')+
      '</label>';
  }).join('');

  if(!visible.length){
    list.innerHTML='<div style="padding:10px 12px;font-size:11px;color:var(--text3);font-style:italic;">No matching fields</div>';
  }

  // Excluded fields section
  const exclFields=allFields.filter(f=>excluded.includes(f.canonical)&&(!q||f.label.toLowerCase().includes(q)));
  if(exclSection){
    if(exclFields.length){
      exclSection.innerHTML='<div class="col-picker-excl-title">&#8856; Excluded (click to restore)</div>'+
        '<div class="col-picker-excl-pills">'+
        exclFields.map(f=>'<span class="col-picker-excl-pill" onclick="restoreCol(\''+f.canonical+'\');renderColPicker(id(\'colPickerSearch\').value)">'+esc(f.label)+' &#8617;</span>').join('')+
        '</div>';
      exclSection.style.display='';
    } else {
      exclSection.style.display='none';
    }
  }

  updateColPickerCount();
}

function colPickerToggle(canonical, show){
  if(show){
    S.hiddenCols.delete(canonical);
  } else {
    S.hiddenCols.add(canonical);
  }
  S.pageOffset=0;
  renderDiff(true);
  updateColPickerCount();
}

function colPickerSelectAll(){
  S.hiddenCols.clear();
  S.pageOffset=0;
  renderDiff(true);
  renderColPicker(id('colPickerSearch')?.value||'');
}

function colPickerClearAll(){
  S.comparableFields.forEach(f=>S.hiddenCols.add(f.canonical));
  S.pageOffset=0;
  renderDiff(true);
  renderColPicker(id('colPickerSearch')?.value||'');
}

function updateColPickerCount(){
  const btn=id('colPickerBtn');
  const countEl=id('colPickerCount');
  if(!btn||!countEl) return;
  const total=S.comparableFields.length;
  const hidden=S.hiddenCols.size;
  const vis=total-hidden;
  countEl.textContent=vis+'/'+total;
  btn.classList.toggle('open',_colPickerOpen);
}

// Close popover on outside click
document.addEventListener('click',function(e){
  if(!_colPickerOpen) return;
  const wrap=id('colPickerWrap');
  if(wrap&&!wrap.contains(e.target)){
    _colPickerOpen=false;
    const pop=id('colPickerPopover');if(pop)pop.classList.add('hidden');
    const btn=id('colPickerBtn');if(btn)btn.classList.remove('open');
  }
},{capture:true});

