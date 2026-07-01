/* =====================================================================
   FILE LOADING
===================================================================== */
function dov(e,src){e.preventDefault();id('drop-'+src).classList.add('drag-over');}
function dol(src){id('drop-'+src).classList.remove('drag-over');}
function ddr(e,src){e.preventDefault();dol(src);const f=e.dataTransfer.files[0];if(f)loadFile(src,f);}

function loadFile(src,file){
  // Show blocking overlay immediately
  const srcColor={COA:'var(--coa-bg)',FAQ:'var(--faq-bg)',DataPool:'var(--dp-bg)'};
  const srcTextColor={COA:'var(--coa-text)',FAQ:'var(--faq-text)',DataPool:'var(--dp-text)'};
  const srcBadge={COA:'🌿 COA Master',FAQ:'📈 FAQ (SAP)',DataPool:'📊 DataPool'};
  id('fileLoadSrc').textContent=srcBadge[src];
  id('fileLoadSrc').style.background=srcColor[src];
  id('fileLoadSrc').style.color=srcTextColor[src];
  id('fileLoadTitle').textContent='Reading '+file.name+'…';
  id('fileLoadSub').textContent=src==='COA'
    ?'Parsing cell styles to detect yellow (hierarchy) rows'
    :'Parsing workbook…';
  id('fileLoadHint').textContent=src==='COA'
    ?'COA files with 200k+ rows may take 15–30 seconds — please wait'
    :'';
  id('fileLoadOverlay').classList.remove('hidden');

  const r=new FileReader();
  r.onload=e=>{
    setTimeout(()=>{
      const opts={type:'array',cellDates:false};
      if(src==='COA') opts.cellStyles=true;
      const wb=XLSX.read(new Uint8Array(e.target.result),opts);
      id('fileLoadTitle').textContent='Indexing worksheets…';
      id('fileLoadSub').textContent=wb.SheetNames.length+' sheet'+(wb.SheetNames.length!==1?'s':'')+ ' found';
      S.wbs[src]=wb;
      S.fns[src]=file.name;
      const sel=id('sheet-'+src);
      const wrap=id('sheet-'+src+'-wrap');
      // Populate sheet selector — always show it so user can confirm/change sheet
      sel.innerHTML=wb.SheetNames.map((s,i)=>'<option value="'+i+'">'+esc(s)+'</option>').join('');
      if(wrap) wrap.style.display = wb.SheetNames.length > 1 ? '' : 'none';
      id('fileLoadTitle').textContent='Extracting headers…';
      id('fileLoadSub').textContent='Sheet: '+wb.SheetNames[0];
      extractHeaders(src);
      if(src==='COA'){
        const shIdx=parseInt(sel.value)||0;
        S.coaWs=wb.Sheets[wb.SheetNames[shIdx]];
      }
      id('fn-'+src).textContent='📄 '+file.name;
      id('fn-'+src).classList.remove('hidden');
      id('drop-'+src).classList.add('loaded');
      S.activeSources.add(src);
      updateSourceToggle(src);
      id('fileLoadOverlay').classList.add('hidden');
      checkReady();
    },src==='COA'?80:20);
  };
  r.readAsArrayBuffer(file);
}

function onSheetChange(src){
  if(!S.wbs[src]) return;
  extractHeaders(src);
  if(src==='COA'){
    const shIdx=parseInt(id('sheet-COA').value)||0;
    S.coaWs=S.wbs.COA.Sheets[S.wbs.COA.SheetNames[shIdx]];
  }
}

function onRefSheetChange(refKey){
  // No immediate action needed — buildCoaMasterMap/buildCCMatrixData
  // read the selector value at diff time. Just show the new sheet name.
  const sel = id('sheet-' + refKey);
  const wb  = S.refWbs[refKey];
  if (!sel || !wb) return;
  const shIdx = parseInt(sel.value) || 0;
  showToast(({COA_MASTER:'COA Master', CC_MATRIX:'CC-Matrix'}[refKey]||refKey) +
    ': sheet "' + wb.SheetNames[shIdx] + '" selected', 'ok');
}

function extractHeaders(src){
  const wb=S.wbs[src];
  if(!wb) return;
  const shIdx=parseInt(id('sheet-'+src).value)||0;
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[shIdx]],{header:1,defval:'',raw:false});
  S.headers[src]=(rows[0]||[]).map(String);
}

function getSourceRows(src){
  if(src==='COA') return getFilteredCOARows();
  const wb=S.wbs[src];
  if(!wb) return [];
  const shIdx=parseInt(id('sheet-'+src).value)||0;
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[shIdx]],{header:1,defval:'',raw:false});
  return rows.slice(1).map(r=>r.map(v=>v==null?'':String(v)));
}

function updateSourceToggle(src){
  const colorKey={COA:'coa',FAQ:'faq',DataPool:'dp'};
  const resLabel={COA:'🌿 COA',FAQ:'📈 FAQ',DataPool:'📊 DataPool'};
  const loaded=!!S.wbs[src];
  const active=S.activeSources.has(src);
  const ck=colorKey[src];

  // Upload-card toggle button (div in v2)
  const btn=id('tog-'+src);
  if(btn){
    btn.classList.toggle('file-loaded',loaded);
    btn.classList.remove('active-coa','active-faq','active-dp','inactive');
    if(loaded) btn.classList.add(active?'active-'+ck:'inactive');
  }

  // Results-view compact button
  const rBtn=id('res-tog-'+src);
  if(rBtn){
    rBtn.style.display=loaded?'':'none';
    rBtn.textContent=resLabel[src];
    rBtn.className='res-src-btn';
    if(loaded) rBtn.classList.add(active?'rs-active-'+ck:'rs-inactive');
  }
}

function toggleActiveSource(src){
  if(!S.wbs[src]) return;
  const active=S.activeSources.has(src);
  // Must keep at least 2 active
  if(active&&S.activeSources.size<=2){
    showToast('Need at least 2 active sources to compare','warn');
    return;
  }
  if(active) S.activeSources.delete(src);
  else S.activeSources.add(src);
  updateSourceToggle(src);
  checkReady();
  const inResults=id('subtab-panel-results')&&id('subtab-panel-results').classList.contains('active');
  if(inResults){
    const nowActive=S.activeSources.has(src);
    showToast(SRC_LABEL[src]+' '+(nowActive?'activated \u2714':'deactivated \u2716')+' \u2014 click Re-run Compare','ok');
  }
}



/* =====================================================================
   REFERENCE FILE LOADING  (v5 new)
===================================================================== */
function loadRefFile(refKey, file) {
  if (!file) return;
  const labels = {COA_MASTER: 'COA Master', CC_MATRIX: 'CC-Matrix'};
  showProgress('Loading ' + labels[refKey] + '\u2026', file.name);
  const r = new FileReader();
  r.onload = e => {
    try {
      const opts = {type:'array', cellDates:false, raw:false};
      if(refKey === 'COA_MASTER') opts.cellStyles = true; // needed for yellow/strike row detection
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, opts);
      S.refWbs[refKey] = wb;
      S.refFns[refKey] = file.name;
      // Populate sheet selector
      const sel  = id('sheet-' + refKey);
      const wrap = id('sheet-' + refKey + '-wrap');
      if (sel) {
        sel.innerHTML = wb.SheetNames.map((s,i) => '<option value="'+i+'">'+esc(s)+'</option>').join('');
        // Pre-select the sheet matching the mapping config if possible
        const mapping = S.activeMapping || getEmbeddedMap();
        const cfg = mapping.reference_files && mapping.reference_files[refKey];
        if (cfg) {
          let matchIdx = 0;
          if (cfg.data_sheet) {
            // CC-Matrix: match by sheet name
            const nameIdx = wb.SheetNames.indexOf(cfg.data_sheet);
            if (nameIdx >= 0) matchIdx = nameIdx;
          } else if (cfg.sheet_index != null) {
            matchIdx = cfg.sheet_index;
          }
          sel.value = String(matchIdx);
        }
      }
      if (wrap) wrap.style.display = wb.SheetNames.length > 1 ? '' : 'none';
      updateRefDropUI(refKey, file.name);
      hideProgress();
      showToast(labels[refKey] + ' loaded — ' + wb.SheetNames.length + ' sheet(s)', 'ok');
      checkReady();
    } catch(err) {
      hideProgress();
      showToast('Error loading ' + labels[refKey] + ': ' + err.message, 'err');
    }
  };
  r.readAsArrayBuffer(file);
}

function updateRefDropUI(refKey, fileName) {
  const drop = id('ref-drop-' + refKey);
  const fnEl = id('ref-fn-' + refKey);
  if (drop) drop.classList.add('loaded');
  if (fnEl) { fnEl.textContent = '\u2713 ' + fileName; fnEl.classList.remove('hidden'); }
}

/* =====================================================================
   READY CHECK  (v5 — CC_MATRIX required for SKB mode)
===================================================================== */
function checkReady() {
  const mapping    = S.activeMapping || getEmbeddedMap();
  const isSKB      = mapping.comparison_grain === 'account_company_code';
  const isSKA      = mapping.comparison_grain === 'gl_account';
  const txUploaded = TX_SOURCES.filter(s => S.wbs[s]);
  const ccLoaded   = !!S.refWbs.CC_MATRIX;

  const ready = isSKB
    ? (ccLoaded && txUploaded.length >= 1)
    : (txUploaded.length >= 1);  // SKA: CC-Matrix not required

  const hint = id('uploadHint');

  // Tab/button unlock
  const goBtn = id('btnGoToMapping');
  if (goBtn)  goBtn.disabled = !ready;
  const tab2btn = id('tab-btn-2');
  if (tab2btn) tab2btn.classList.toggle('enabled', ready);
  const tab3btn = id('tab-btn-3');
  if (tab3btn) tab3btn.classList.toggle('enabled', ready);

  if (ready) {
    TX_SOURCES.forEach(src => { if (S.wbs[src]) extractHeaders(src); });
    if (!S.resolvedMap.length) buildResolvedMap();
    buildKeySelects();
    refreshMapMeta();
    refreshCompareHint();
    const mt = id('mapTbody');
    if (mt && !mt.innerHTML) renderMappingTable();

    const mode = isSKB
      ? ('SKB mode \u2014 ' + txUploaded.map(s => SRC_LABEL[s]).join(' & '))
      : (txUploaded.length === 3 ? '3-way' : '2-way \u2014 ' + txUploaded.map(s => SRC_LABEL[s]).join(' \u2194 '));
    if (hint) { hint.textContent = '\u2713 Ready \u2014 ' + mode; hint.style.color = 'var(--add-src)'; }
  } else {
    let msg;
    if (isSKB && !ccLoaded)    msg = 'Upload CC-Matrix (required for SKB) + at least one of FAQ / DataPool';
    else if (txUploaded.length === 0) msg = 'Upload at least one source file (FAQ / DataPool)';
    else msg = 'Upload CC-Matrix + at least one transactional source';
    if (hint) { hint.textContent = msg; hint.style.color = 'var(--text3)'; }
  }

  // COA Master warning: if CC-Matrix is loaded but COA_MASTER is not,
  // flag that coa_lookup / coa_derived fields will show null on the COA side
  {
    const coaMasterWarn = id('coaMasterWarn');
    if (coaMasterWarn) {
      const activeMap = S.activeMapping || getEmbeddedMap();
      const needsCoaMaster = activeMap.fields
        .some(f => f.sources && f.sources.COA && (f.type === 'coa_lookup' || f.type === 'coa_derived'));
      const missing = needsCoaMaster && !S.refWbs.COA_MASTER;
      coaMasterWarn.style.display = missing ? 'inline-flex' : 'none';
      // Update warn text to list affected fields for current mode
      if (missing) {
        const affectedFields = activeMap.fields
          .filter(f => f.sources && f.sources.COA && (f.type==='coa_lookup'||f.type==='coa_derived'))
          .map(f => f.label).join(', ');
        const span = coaMasterWarn.querySelector('span:last-child');
        if (span) span.innerHTML = 'COA Master not loaded — fields <strong>' + affectedFields + '</strong> will show <em>null</em> on the COA side.';
      }
    }
  }
}
