/* =====================================================================
   COA ROW FILTERS — yellow (hierarchy) rows + 10-digit accounts
===================================================================== */
function isYellowish(hex){
  // hex = 6-char RRGGBB or 8-char AARRGGBB
  if(!hex||hex.length<6) return false;
  const h=hex.length===8?hex.slice(2):hex; // strip alpha
  if(h.length!==6) return false;
  const r=parseInt(h.slice(0,2),16);
  const g=parseInt(h.slice(2,4),16);
  const b=parseInt(h.slice(4,6),16);
  // Yellow range: high R, high G, low B
  return r>180&&g>160&&b<110;
}

function isYellowRow(ws,wsRowIdx){
  // Check first 5 columns only — fast and sufficient for row-level fills
  for(let c=0;c<5;c++){
    const addr=XLSX.utils.encode_cell({r:wsRowIdx,c});
    const cell=ws[addr];
    if(!cell||!cell.s) continue;
    const fg=cell.s.fgColor;
    if(fg&&fg.rgb&&isYellowish(fg.rgb.toUpperCase())) return true;
    const bg=cell.s.bgColor;
    if(bg&&bg.rgb&&isYellowish(bg.rgb.toUpperCase())) return true;
  }
  return false;
}

function isStrikeRow(ws,wsRowIdx){
  // A row is considered struck out if ANY cell in the first 10 columns has
  // strikethrough formatting (cell.s.strike === true in SheetJS cellStyles).
  // Checking 10 cols covers the account-key column in any typical COA layout.
  for(let c=0;c<10;c++){
    const addr=XLSX.utils.encode_cell({r:wsRowIdx,c});
    const cell=ws[addr];
    if(cell&&cell.s&&cell.s.strike===true) return true;
  }
  return false;
}

function getFilteredCOARows(){
  // ── Source: always S.refWbs.COA_MASTER (COA is a reference file in v6, not S.wbs.COA)
  const wb = S.refWbs.COA_MASTER;
  if(!wb) return [];

  const mapping = S.activeMapping || getEmbeddedMap();
  const cfg = mapping.reference_files && mapping.reference_files.COA_MASTER;
  const shIdx = (cfg && cfg.sheet_index != null) ? cfg.sheet_index : 0;
  const ws  = wb.Sheets[wb.SheetNames[shIdx]];
  if(!ws) return [];

  const allRows = XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
  const headerRow = (cfg && cfg.header_row != null) ? cfg.header_row : 0;
  const headers = (allRows[headerRow]||[]).map(h=>h==null?'':String(h));
  const hdrIdx  = new Map();
  headers.forEach((h,i)=>{ const n=normHdr(h); if(n&&!hdrIdx.has(n)) hdrIdx.set(n,i); });
  const dataRows = allRows.slice(headerRow+1);

  // ── Locate "7 digit / 10 digit Accounts" column for the 10-digit filter.
  // chart_of_account is a coa_derived field; the source column lives in its
  // derivation conditions as source_col "7 digit  10 digit Accounts".
  const chartField = S.resolvedMap.find(f=>f.canonical==='chart_of_account'); // no trailing 's'
  let chartIdx = -1;
  if(chartField && chartField.sources.COA){
    const coaSrc = chartField.sources.COA;
    // derivation-type field: pull source_col from first condition
    if(coaSrc.derivation && coaSrc.derivation.conditions && coaSrc.derivation.conditions.length){
      const srcCol = coaSrc.derivation.conditions[0].source_col || '';
      chartIdx = hdrIdx.has(normHdr(srcCol)) ? hdrIdx.get(normHdr(srcCol)) : -1;
    } else if(typeof coaSrc.column === 'string'){
      chartIdx = coaColIdx(coaSrc, hdrIdx, headers);
    }
  }

  const doYellow   = S.skipYellow   && !!ws;
  const doTenDigit = S.skipTenDigit && chartIdx >= 0;
  const doStrike   = S.skipStrike   && !!ws;

  let yellowSkipped=0, tenDigitSkipped=0, strikeSkipped=0;
  const kept=[];

  dataRows.forEach((row,i)=>{
    // wsRowIdx: +1 for header row, +headerRow for any leading rows before header
    const wsRowIdx = i + headerRow + 1;

    // Yellow / hierarchy rows
    if(doYellow && isYellowRow(ws, wsRowIdx)){
      yellowSkipped++;
      return;
    }
    // 10-digit accounts only (skip 7-digit / non-10-digit)
    if(doTenDigit){
      const val = String(row[chartIdx]||'').toLowerCase().trim();
      if(!val.includes('10 digit')){
        tenDigitSkipped++;
        return;
      }
    }
    // Strikethrough — struck-out rows are retired accounts
    if(doStrike && isStrikeRow(ws, wsRowIdx)){
      strikeSkipped++;
      return;
    }
    kept.push(row.map(v=>v==null?'':String(v)));
  });

  S.coaFilterStats={total:dataRows.length,yellowSkipped,tenDigitSkipped,strikeSkipped,kept:kept.length};
  updateCoaFilterStats();
  return kept;
}

function updateCoaFilterStats(){
  const el=id('coaFilterStats');
  if(!el) return;
  const s=S.coaFilterStats;
  if(!s.total){el.textContent='';return;}
  el.innerHTML=
    '<strong>'+s.total.toLocaleString()+'</strong> total rows &rarr; '+
    (s.yellowSkipped?'<span style="background:#FFF8C5;color:#7D4E00;padding:1px 7px;border-radius:10px;font-weight:600;">'+s.yellowSkipped.toLocaleString()+' yellow skipped</span> &rarr; ':'&mdash; 0 yellow &rarr; ')+
    (s.tenDigitSkipped?'<span style="background:#FFE5D0;color:#7D4E00;padding:1px 7px;border-radius:10px;font-weight:600;">'+s.tenDigitSkipped.toLocaleString()+' non-10-digit skipped</span> &rarr; ':'')+
    (s.strikeSkipped?'<span style="background:#F3F0FF;color:#5B21B6;padding:1px 7px;border-radius:10px;font-weight:600;text-decoration:line-through;">'+s.strikeSkipped.toLocaleString()+'</span><span style="color:#5B21B6;font-weight:600;"> strikethrough skipped</span> &rarr; ':'')+
    '<strong style="color:var(--add-src)">'+s.kept.toLocaleString()+' rows used</strong>';
}


/* =====================================================================
   MAPPING RESOLUTION  (v5 — handles object COA sources for SKB types)
===================================================================== */
function buildResolvedMap() {
  const mapping = S.activeMapping || getEmbeddedMap();
  const isSKB   = mapping.comparison_grain === 'account_company_code';

  // Filter out skip fields
  const fields  = mapping.fields.filter(f =>
    !['dp_only','dp_internal'].includes(f.type) && f.comparison_rule !== 'skip'
  );

  S.resolvedMap = fields.map(field => {
    const resolved = JSON.parse(JSON.stringify(field));

    if (isSKB) {
      // COA source is an object (reference metadata) — keep as-is, no fuzzy matching
      // FAQ + DataPool sources are column names — fuzzy match against uploaded headers
      ['FAQ','DataPool'].forEach(src => {
        const col = field.sources[src];
        if (!col || typeof col !== 'string') { resolved.sources[src] = null; return; }
        const hdrs = S.headers[src];
        if (!hdrs.length) { resolved.sources[src] = col; return; }
        resolved.sources[src] = findBestCol(col, hdrs) || null;
      });
    } else {
      // SKA mode: COA source is an object (reference metadata, same as SKB) — keep as-is.
      // FAQ + DataPool sources are column name strings — fuzzy match against uploaded headers.
      ['FAQ','DataPool'].forEach(src => {
        const col = field.sources[src];
        if (!col || typeof col !== 'string') { resolved.sources[src] = null; return; }
        const hdrs = S.headers[src];
        if (!hdrs.length) { resolved.sources[src] = col; return; }
        resolved.sources[src] = findBestCol(col, hdrs) || null;
      });
      // COA: keep the reference metadata object (or null) as-is — no fuzzy matching needed
      resolved.sources['COA'] = field.sources['COA'] ?? null;
    }

    return resolved;
  });

  // Determine comparable fields
  const ccLoaded   = !!S.refWbs.CC_MATRIX;
  const txLoaded   = TX_SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s));

  S.comparableFields = S.resolvedMap.filter(f => {
    if (S.excludedFields.has(f.canonical)) return false;
    if (isSKB) {
      const coaOk = f.sources.COA !== null && ccLoaded;
      const txOk  = txLoaded.filter(s => f.sources[s]).length;
      return (coaOk ? 1 : 0) + txOk >= 2;
    } else {
      // SKA: COA comes from S.refWbs.COA_MASTER, not S.wbs['COA']
      const coaOk = f.sources.COA !== null;
      const txLoaded2 = TX_SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s));
      const txOk = txLoaded2.filter(s => f.sources[s]).length;
      return (coaOk ? 1 : 0) + txOk >= 2;
    }
  });
}

/* =====================================================================
   MAPPING UI  (v5 — COA column shows reference type badges)
===================================================================== */
/* =====================================================================
   MAPPING UI
===================================================================== */
function goToMapping(){
  SOURCES.forEach(src=>{if(S.wbs[src])extractHeaders(src);});
  // Always rebuild resolved map when navigating to Review Mapping
  // so mode switches get fresh column matches
  buildResolvedMap();
  renderMappingTable();
  refreshMapMeta();
  renderFieldTypeLegend();
  showTab(2);
}

function setMapFilter(f){ renderMappingTable(); } // simplified — all fields are 3-way


function renderMappingTable() {
  const mapping  = S.activeMapping || getEmbeddedMap();
  const isSKB    = mapping.comparison_grain === 'account_company_code';
  const txLoaded = TX_SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s));
  let   rows     = S.resolvedMap;

  // Helper: score a field (how many sources it covers)
  const fieldScore = f => {
    if (!isSKB) return txLoaded.filter(s => f.sources[s]).length;
    const coaOk = f.sources.COA !== null && !!S.refWbs.CC_MATRIX;
    const txOk  = txLoaded.filter(s => f.sources[s]).length;
    return (coaOk ? 1 : 0) + txOk;
  };
  if (S.mapFilter === '3way')    rows = rows.filter(f => fieldScore(f) >= 3);
  if (S.mapFilter === '2way')    rows = rows.filter(f => {
    // All fields where both FAQ and DataPool are mapped (includes 3-way fields)
    return !!f.sources.FAQ && !!f.sources.DataPool;
  });
  if (S.mapFilter === 'partial') rows = rows.filter(f => fieldScore(f) === 1);
  // Legacy aliases (kept for backward compat)
  if (S.mapFilter === 'comparable') rows = rows.filter(f => fieldScore(f) >= 2);
  if (S.mapFilter === 'skip')       rows = rows.filter(f => fieldScore(f) < 2);

  const makeSelect = (src, f, realIdx, isExcl) => {
    if (!S.wbs[src]) return '<span style="font-size:11px;color:var(--text3);">&mdash; not uploaded &mdash;</span>';
    const val = f.sources[src] || '';
    const opts = ['<option value="">&mdash; skip &mdash;</option>',
      ...S.headers[src].map(h => '<option value="' + esc(h) + '"' + (h === val ? ' selected' : '') + '>' + esc(h) + '</option>')
    ].join('');
    return '<select class="map-select" onchange="updateSourceCol(' + realIdx + ',\'' + src + '\',this.value)"' + (isExcl ? ' disabled' : '') + '>' + opts + '</select>';
  };

  const typeInfo = {
    coa_lookup:      {cls:'ftype-coa_lookup',     txt:'Lookup',    icon:'&#128218;'},
    coa_derived:     {cls:'ftype-coa_derived',    txt:'Derived',   icon:'&#402;'},
    cc_matrix_lookup:{cls:'ftype-cc_matrix_lookup',txt:'CC-Matrix',icon:'&#128203;'},
    dimension:       {cls:'ftype-dimension',      txt:'Dimension', icon:'&#128273;'},
    direct:          {cls:'ftype-direct',         txt:'Direct',    icon:''},
  };

  const makeCoaCell = (f, isExcl) => {
    // Both SKA and SKB: COA side comes from reference files (COA_MASTER / CC_MATRIX),
    // never from S.wbs['COA']. Use reference display whenever sources.COA is an object.
    const coaSrc = f.sources.COA;
    if (!isSKB && coaSrc && typeof coaSrc === 'string') {
      // Legacy / custom mapping: plain string column name — fall back to dropdown
      return makeSelect('COA', f, S.resolvedMap.indexOf(f), isExcl);
    }
    if (!coaSrc) {
      return '<span class="coa-ref-cell"><span style="font-size:10px;color:var(--text3);">— direct comparison only —</span></span>';
    }
    const ti = typeInfo[f.type] || {cls:'', txt:f.type, icon:''};
    let detail = '';
    if (f.type === 'coa_derived' && coaSrc.derivation) {
      detail = '<div class="coa-ref-rule">' + esc((coaSrc.derivation.description || '').substring(0,60)) + '</div>';
    } else if (coaSrc.column) {
      detail = '<div class="coa-ref-col">' + esc(coaSrc.column) + '</div>';
    } else if (coaSrc.mode) {
      detail = '<div class="coa-ref-col">' + esc(coaSrc.mode) + '</div>';
    }
    const fileLabel = coaSrc.file === 'COA_MASTER' ? 'COA Master' : 'CC-Matrix';
    const refLoaded = coaSrc.file === 'COA_MASTER' ? !!S.refWbs.COA_MASTER : !!S.refWbs.CC_MATRIX;
    const refStatus = refLoaded ? '' : ' <span style="color:var(--mod-old-src);font-size:9px;">&#9888; not loaded</span>';
    // Build popover content
    let popContent = '<div class="ftype-popover-title">' + ti.txt + ' — ' + fileLabel + '</div>';
    if (f.type === 'coa_derived' && coaSrc.derivation) {
      popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl">Rule:</span><span class="ftype-popover-val">' + esc(coaSrc.derivation.description||'') + '</span></div>';
      // OE-specific columns (Authorization Group pattern)
      const oeMap = coaSrc.derivation.oe_specific_cols;
      if (oeMap) {
        const selectedOE = S.ccMatrixOE || 'SERE';
        Object.entries(oeMap).forEach(([oe, col]) => {
          const isActive = oe === selectedOE;
          const style = isActive ? 'font-weight:700;color:#94d3a2;' : '';
          popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl" style="' + style + '">' + esc(oe) + (isActive ? ' ✓' : '') + ':</span><span class="ftype-popover-val" style="' + style + '">' + esc(col) + '</span></div>';
        });
        popContent += '<div class="ftype-popover-row" style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.1);padding-top:4px;"><span class="ftype-popover-lbl">GL →</span><span class="ftype-popover-val">empty &nbsp;|&nbsp; FPG → <b>ZFPG</b></span></div>';
        popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl" style="color:#94a3b8;font-size:9px;">fallback:</span></div>';
      }
      (coaSrc.derivation.conditions||[]).forEach(c => {
        popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl">If:</span><span class="ftype-popover-val">[' + esc(c.source_col) + '] = ' + esc(c.match_value) + ' → <b>' + esc(c.result||'""') + '</b></span></div>';
      });
      popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl">Else:</span><span class="ftype-popover-val">' + esc(String(coaSrc.derivation.default||'""')) + '</span></div>';
    } else if (coaSrc.column) {
      popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl">Column:</span><span class="ftype-popover-val">' + esc(coaSrc.column) + '</span></div>';
    }
    if (coaSrc.has_coco_override) {
      popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl">Override:</span><span class="ftype-popover-val">Per-(account, CoCo) via "Different Setting per CoCo" sheet</span></div>';
    }
    if (f.type === 'dimension') {
      popContent += '<div class="ftype-popover-row"><span class="ftype-popover-lbl">Expands:</span><span class="ftype-popover-val">One row per active company code (X in cols AH–AR)</span></div>';
    }
    return '<div class="coa-ref-cell"><div class="coa-ref-file"><span class="ftype-wrap"><span class="ftype ' + ti.cls + '">' + ti.icon + ' ' + ti.txt + ' &#9432;</span><div class="ftype-popover">' + popContent + '</div></span><span style="font-size:10px;color:var(--text3);margin-left:4px;">' + fileLabel + refStatus + '</span></div>' + detail + '</div>';
  };

  id('mapTbody').innerHTML = rows.map(f => {
    const realIdx = S.resolvedMap.indexOf(f);
    const noteHtml = f.note ? '<div class="note-chip">' + esc(f.note) + '</div>' : '';
    return '<tr>'
      + '<td><div class="fld-label" style="font-size:12px;font-weight:500;">' + esc(f.label) + '</div>' + noteHtml + '</td>'
      + '<td>' + makeCoaCell(f, false) + '</td>'
      + '<td>' + makeSelect('FAQ', f, realIdx, false) + '</td>'
      + '<td>' + makeSelect('DataPool', f, realIdx, false) + '</td>'
      + '</tr>';
  }).join('');
}
function refreshMapMeta(){
  const mapping = S.activeMapping || getEmbeddedMap();
  const mode = mapping.comparison_grain === 'account_company_code' ? 'SKB' : 'SKA';
  const n = S.resolvedMap.length;
  id('mapMeta').textContent = n + ' fields · all 3-way (COA · FAQ · DataPool) · ' + mode + ' mode';
}

function renderFieldTypeLegend(){
  const el = id('fieldTypeLegend');
  if(!el) return;
  const mapping = S.activeMapping || getEmbeddedMap();
  const ft = mapping.field_types || {};
  const typeInfo = {
    coa_lookup:       {icon:'&#128218;', label:'Lookup',       cls:'ftype-coa_lookup'},
    coa_derived:      {icon:'&#402;',    label:'Derived',      cls:'ftype-coa_derived'},
    cc_matrix_lookup: {icon:'&#128203;', label:'CC-Matrix',    cls:'ftype-cc_matrix_lookup'},
    dimension:        {icon:'&#128273;', label:'Dimension',    cls:'ftype-dimension'},
    direct:           {icon:'',          label:'Direct',       cls:'ftype-direct'},
    pending_coa:      {icon:'&#9203;',   label:'Pending',      cls:'ftype-pending_coa'},
  };
  const showTypes = Object.keys(typeInfo);
  const items = showTypes
    .filter(k => ft[k])
    .map(k => {
      const ti = typeInfo[k];
      return '<div class="ftleg-item">'
        + '<span class="ftype ' + ti.cls + '" style="font-size:10px;padding:2px 7px;white-space:nowrap;">' + ti.icon + ' ' + ti.label + '</span>'
        + '<span class="ftleg-desc">' + esc(ft[k]) + '</span>'
        + '</div>';
    }).join('');
  el.innerHTML = items;
  const panel = id('fieldTypeLegendPanel');
  if(panel) panel.style.display = items ? '' : 'none';
}

function refreshCompareHint(){
  const loaded=SOURCES.filter(s=>S.wbs[s]&&S.activeSources.has(s));
  const n=S.resolvedMap.filter(f=>!S.excludedFields.has(f.canonical)&&loaded.filter(s=>f.sources[s]).length>=2).length;
  id('compareHint').textContent=n?n+' fields will be compared':'No comparable fields \u2014 check column mappings';
  id('compareHint').style.color=n?'var(--add-src)':'var(--del-src)';
}

function buildKeySelects(){
  const mapping = S.activeMapping || getEmbeddedMap();
  const isSKB   = mapping.comparison_grain === 'account_company_code';

  SOURCES.forEach(src => {
    const hdrs   = S.headers[src] || [];
    const loaded = !!S.wbs[src];

    // In both SKA and SKB, COA comes from reference files — show read-only key info
    if (src === 'COA') {
      const row0 = id('keyRowCOA0');
      const sel0 = id('keyCOA0');
      const sel1 = id('keyCOA1');
      const btn  = id('btnAddKeyCOA');
      const hint = id('keyHintCOA');
      const isSkbMode = mapping.comparison_grain === 'account_company_code';
      const keyLabelHtml = '<span style="color:var(--add-src);font-weight:600;">&#128273;</span> ' +
        (isSkbMode ? 'cCoA Account Number<br><span style="font-size:10px;color:var(--text3);padding-left:14px;">+ Company Code (from CC-Matrix)</span>' :
         'cCoA Account Number<br><span style="font-size:10px;color:var(--text3);padding-left:14px;">from COA Master</span>');
      // Replace dropdown with read-only label showing the composite key
      if (sel0) {
        sel0.style.display = 'none';
        // Bug fix: always update the label when it already exists (mode may have changed)
        const existing = id('coaKeyReadOnly');
        if (existing) {
          existing.innerHTML = keyLabelHtml;
        } else {
          const lbl = document.createElement('div');
          lbl.id = 'coaKeyReadOnly';
          lbl.style.cssText = 'font-size:11px;color:var(--text2);padding:5px 8px;background:var(--page-bg);border:1px solid var(--border);border-radius:6px;min-width:180px;';
          lbl.innerHTML = keyLabelHtml;
          sel0.parentNode.insertBefore(lbl, sel0);
        }
      }
      if (sel1) { sel1.style.display = 'none'; }
      if (btn)  { btn.style.display  = 'none'; }
      if (hint) { hint.textContent = isSkbMode ? 'Key auto-set from CC-Matrix expansion' : 'Key auto-set from COA Master'; hint.style.color = 'var(--add-src)'; }
      return;
    }

    const sel0 = id('key' + src + '0');
    if (!sel0) return;
    const prev = sel0.value;
    sel0.style.display = '';
    sel0.innerHTML = '<option value="">— Row index (position) —</option>' +
      hdrs.map(h => '<option value="' + esc(h) + '" title="' + esc(h) + '">' + esc(h) + '</option>').join('');
    sel0.disabled = !loaded;
    sel0.style.opacity = loaded ? '1' : '0.4';

    // Restore or auto-guess key column
    if (prev && hdrs.includes(prev)) {
      sel0.value = prev;
    } else if (!prev && isSKB) {
      // Auto-set from mapping.key_fields
      const mappingKey = mapping.key_fields?.[src]?.[0];
      if (mappingKey) {
        const match = hdrs.find(h => normalise(h) === normalise(mappingKey));
        if (match) sel0.value = match;
      }
    } else if (!prev) {
      const guessCols = ['g/l account','gl_account','chart_of_account','account number','ccoaaccountnumber','gl account'];
      // Exact match first, then substring — prevents 'G/L Acct External ID' beating 'G/L Account'
      const norm = v => normalise(v).replace(/ /g,'');
      const best = hdrs.find(h => guessCols.some(g => norm(h) === norm(g)))
                || hdrs.find(h => guessCols.some(g => norm(h).includes(norm(g))));
      if (best) sel0.value = best;
    }
    sel0.title = sel0.value || 'Select key column';
    sel0.onchange = function(){ this.title = this.value || 'Select key column'; updateKeyHint(src); };

    const btn = id('btnAddKey' + src);
    if (btn) { btn.style.display = ''; btn.disabled = !loaded; }

    const sel1 = id('key' + src + '1');
    if (sel1) {
      sel1.style.display = '';
      sel1.innerHTML = '<option value="">— none —</option>' +
        hdrs.map(h => '<option value="' + esc(h) + '">' + esc(h) + '</option>').join('');
      // Auto-set second key col from mapping
      if (isSKB && !sel1.value) {
        const mappingKey2 = mapping.key_fields?.[src]?.[1];
        if (mappingKey2) {
          const match2 = hdrs.find(h => normalise(h) === normalise(mappingKey2));
          if (match2) sel1.value = match2;
        }
      }
    }
    updateKeyHint(src);
  });
}

function addKeyCol(src){
  const stack=id('keyRow'+src+'0')?.parentElement;
  if(!stack||stack.querySelectorAll('.key-row-extra').length>=2) return;
  const hdrs=S.headers[src]||[];
  const opts='<option value="">— none —</option>'+hdrs.map(h=>'<option value="'+esc(h)+'">'+esc(h)+'</option>').join('');
  const row=document.createElement('div');
  row.className='key-row-extra'; row.id='keyRow'+src+'1';
  row.innerHTML='<select id="key'+src+'1" onchange="updateKeyHint(\''+src+'\')">'+opts+'</select>'+
    '<button class="btn-icon remove" onclick="removeKeyCol(\''+src+'\')" title="Remove">\u2715</button>';
  stack.appendChild(row);
  const btn=id('btnAddKey'+src); if(btn) btn.style.display='none';
  const sr=id('sepRow'+src); if(sr) sr.style.display='';
  updateKeyHint(src);
}

function removeKeyCol(src){
  const row=id('keyRow'+src+'1'); if(row) row.remove();
  const btn=id('btnAddKey'+src); if(btn) btn.style.display='flex';
  const sr=id('sepRow'+src); if(sr) sr.style.display='none';
  updateKeyHint(src);
}

function setSep(src, val){
  const inp=id('sep'+src); if(inp){inp.value=val; updateKeyHint(src);}
}

function updateKeyHint(src){
  const hint=id('hint'+src); if(!hint) return;
  const k0=(id('key'+src+'0')||{}).value||'';
  const k1=(id('key'+src+'1')||{}).value||'';
  const sep=(id('sep'+src)||{}).value||'';
  if(!k0||!k1){hint.style.display='none';return;}
  hint.style.display='block';
  const mapping3 = S.activeMapping || getEmbeddedMap();
  const isSKB3   = mapping3.comparison_grain === 'account_company_code';
  const effectiveSep = isSKB3 ? '' : sep;
  const sepLabel = isSKB3
    ? '<em style="color:var(--add-src);font-size:9px;">&#10003; no sep</em>'
    : (sep===''?'<em style="color:var(--text3)">no sep</em>':'"<code>'+esc(sep)+'</code>"');
  // Show a sample from first data row
  let ex0='…', ex1='…';
  try{
    const rows=src==='COA'?getFilteredCOARows():getSourceRows(src);
    const hi0=S.headers[src].indexOf(k0), hi1=S.headers[src].indexOf(k1);
    const r=rows.find(r=>r[hi0]||r[hi1]);
    if(r){ex0=String(r[hi0]||'').slice(0,12);ex1=String(r[hi1]||'').slice(0,12);}
  }catch(e){}
  hint.innerHTML='Key = <span class="col-pill pill-'+SRC_COLOR[src]+'" style="font-size:10px;">'+esc(k0)+'</span> + '+sepLabel+' + <span class="col-pill pill-'+SRC_COLOR[src]+'" style="font-size:10px;">'+esc(k1)+'</span>'+
    (ex0&&ex1?' &nbsp;<span style="color:var(--text3);font-size:10px;">e.g. "'+esc(ex0+effectiveSep+ex1)+'"</span>':'');
}

function goBackToUpload(){showTab(1);}


