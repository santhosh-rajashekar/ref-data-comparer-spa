/* =====================================================================
   TAB + SUB-TAB NAVIGATION
===================================================================== */
let _activeSubTab='settings';

function showTab(n){
  [1,2,3].forEach(i=>{
    const btn=id('tab-btn-'+i), panel=id('tab-panel-'+i);
    if(btn) btn.classList.toggle('active',i===n);
    if(btn) btn.classList.toggle('done',i<n);
    if(btn) btn.classList.toggle('enabled',true);
    if(panel) panel.classList.toggle('active',i===n);
  });
  // Full viewport width on Compare tab, constrained on Upload/Mapping
  const canvas=document.querySelector('.canvas');
  if(canvas) canvas.classList.toggle('canvas-wide', n===3);
  if(n===2){
    SOURCES.forEach(src=>{if(S.wbs[src])extractHeaders(src);});
    if(!S.resolvedMap.length) buildResolvedMap();
    renderMappingTable(); refreshMapMeta();
    const ci=id('caseSensitive'); if(ci) ci.checked=S.caseSensitive;
    const tww=id('togTrimWrap');     if(tww) tww.classList.toggle('on',S.trimWhitespace);
    const ciw=id('togCaseWrap');     if(ciw) ciw.classList.toggle('on',S.caseSensitive);
    const stw=id('togStrikeWrap');   if(stw) stw.classList.toggle('on',S.skipStrike);
    const yw=id('togYellowWrap');    if(yw)  yw.classList.toggle('on',S.skipYellow);
    const tdw=id('togTenDigitWrap'); if(tdw) tdw.classList.toggle('on',S.skipTenDigit);
  }
  if(n===3){refreshCompareHint();buildKeySelects();showSubTab(_activeSubTab);}
}

function showSubTab(name){
  _activeSubTab=name;
  if(name==='transforms') renderTxCard();
  ['settings','transforms','results'].forEach(s=>{
    const btn=id('subtab-btn-'+s), panel=id('subtab-panel-'+s);
    if(btn) btn.classList.toggle('active',s===name);
    if(panel) panel.classList.toggle('active',s===name);
  });
}

function toggleCollapse(bodyId, iconId){
  const body=id(bodyId), icon=id(iconId);
  if(!body||!icon) return;
  const isOpen=icon.classList.contains('open');
  if(isOpen){
    body.style.maxHeight=body.scrollHeight+'px';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      body.style.maxHeight='0';
      body.style.opacity='0';
      body.classList.add('collapsed');
      icon.classList.remove('open');
    }));
  } else {
    body.classList.remove('collapsed');
    body.style.opacity='1';
    body.style.maxHeight=body.scrollHeight+'px';
    icon.classList.add('open');
    setTimeout(()=>{body.style.maxHeight='none';},350);
  }
}

