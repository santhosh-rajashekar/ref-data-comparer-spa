/* =====================================================================
   COLUMN EXCLUDE / RE-INCLUDE
===================================================================== */
function toggleExclude(canonical){
  if(S.excludedFields.has(canonical)){
    S.excludedFields.delete(canonical);
    showToast('Field re-included — re-run Compare to apply','ok');
  } else {
    S.excludedFields.add(canonical);
    showToast('Field excluded — re-run Compare to apply','warn');
  }
  // Do NOT recompute S.comparableFields here — it is the stable index
  // reference for _diffRows.vals. Only runDiff() may set it.
  refreshMapMeta();
  refreshCompareHint();
  renderMappingTable();
  // If results are visible, refresh the restore bar
  if(id('subtab-panel-results')&&id('subtab-panel-results').classList.contains('active')) renderExclBar();
}

function hideColFromResults(canonical){
  S.hiddenCols.add(canonical);
  // Mark excluded so the next re-run skips it — but do NOT touch S.comparableFields
  // here because _diffRows.vals are indexed against the original comparableFields order
  S.excludedFields.add(canonical);
  const f=S.resolvedMap.find(r=>r.canonical===canonical);
  showToast('Column hidden: '+(f?f.label:canonical)+' \u2014 re-run to update match counts','warn');
  S.pageOffset=0;
  renderDiff(true);
  renderExclBar();
}

function restoreCol(canonical){
  S.hiddenCols.delete(canonical);
  S.excludedFields.delete(canonical);
  const f=S.resolvedMap.find(r=>r.canonical===canonical);
  showToast('Column restored: '+(f?f.label:canonical),'ok');
  S.pageOffset=0;
  renderDiff(true);
  renderExclBar();
}

function renderExclBar(){
  const bar=id('exclBar'), pills=id('exclPills');
  if(!bar||!pills) return;
  const allHidden=new Set([...S.excludedFields,...S.hiddenCols]);
  if(!allHidden.size){bar.classList.add('hidden');return;}
  bar.classList.remove('hidden');
  const fieldLabels={};
  S.resolvedMap.forEach(f=>{fieldLabels[f.canonical]=f.label;});
  pills.innerHTML=[...allHidden].map(c=>{
    const isHidden=S.hiddenCols.has(c);
    return '<span class="excl-pill" onclick="'+(isHidden?'restoreCol':'toggleExclude')+'(\''+esc(c)+'\')" title="Click to restore">'+
      esc(fieldLabels[c]||c)+(isHidden?' \uD83D\uDC41 \u21a9':' \u21a9')+
      '</span>';
  }).join('');
}

