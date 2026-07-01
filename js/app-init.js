/* =====================================================================
   CLEAR ALL
===================================================================== */
function clearAll(){
  SOURCES.forEach(src=>{
    S.wbs[src]=null; S.fns[src]=''; S.headers[src]=[];
    id('drop-'+src).classList.remove('loaded','drag-over');
    // v2: fn-X is always visible, just clear text
    const fnEl=id('fn-'+src);
    if(fnEl){fnEl.textContent='';fnEl.classList.add('hidden');}
    const sel=id('sheet-'+src);
    if(sel){sel.innerHTML='<option>\u2014 upload file \u2014</option>';}
    S.activeSources.add(src);
    updateSourceToggle(src);
  });
  S.resolvedMap=[]; S.comparableFields=[];
  S._diffRows=[]; S.filter='all'; S.pageOffset=0;
  S.diffCounts={same:0,conflict:0,onlyCOA:0,onlyFAQ:0,onlyDP:0,total:0,noReference:0,unexpectedCoco:0};
  S.coaWs=null;
  S.coaFilterStats={total:0,yellowSkipped:0,tenDigitSkipped:0,strikeSkipped:0,kept:0};
  if(diffFs){toggleDiffFullscreen();}
  S.excludedFields=new Set();
  S.fieldTransforms={};
  saveTransformsToStorage();
  renderTxCard();
  S.hiddenCols=new Set();
  S.colFilter='';
  S.rowSearch=''; S.rowSearchKeys=null;
  S.trimWhitespace=true;
  S.skipYellow=true;
  S.skipTenDigit=true;
  S.skipStrike=true;
  S.rowFilters=[];
  const ci=id('caseSensitive'); if(ci) ci.checked=false;
  const tw=id('trimWhitespace'); if(tw) tw.checked=true;
  const sk=id('skipStrike');     if(sk) sk.checked=true;
  const tww=id('togTrimWrap');   if(tww) tww.classList.add('on');
  const ciw=id('togCaseWrap');   if(ciw) ciw.classList.remove('on');
  const stw=id('togStrikeWrap'); if(stw) stw.classList.add('on');
  const yw=id('togYellowWrap');  if(yw)  yw.classList.add('on');
  const tdw=id('togTenDigitWrap'); if(tdw) tdw.classList.add('on');
  // colFilterInput removed — column picker used instead
  const rl=id('rowFilterList'); if(rl) rl.innerHTML='<span style="font-size:11px;color:var(--text3);font-style:italic;">No filters — all rows will be compared.</span>';
  if(id('coaFilterStats')) id('coaFilterStats').textContent='';
  if(id('exclBar')) id('exclBar').classList.add('hidden');

  setStep(1);
  showTab(1);
  const resBadge=id('subtabResultsBadge');if(resBadge)resBadge.style.display='none';
  const txBadge=id('subtabTxBadge');if(txBadge)txBadge.style.display='none';
  checkReady();
  id('diffOut').innerHTML='<div class="empty"><div class="empty-ico">&#128269;</div><h3>No comparison yet</h3><p>Upload files, review the mapping, then click Run Compare.</p></div>';
  clearRDM();
  if(_sqlReady&&_diffDb){try{_diffDb.run('DROP TABLE IF EXISTS diff_results');}catch(e){}}
  updateRdmDbBadge(0);
  showToast('All data cleared','ok');
}

/* =====================================================================
   CLEAR RESULTS ONLY (keeps uploaded files & settings)
===================================================================== */
function clearResults(){
  S._diffRows=[]; S.filter='all'; S.pageOffset=0;
  S.diffCounts={same:0,conflict:0,onlyCOA:0,onlyFAQ:0,onlyDP:0,total:0,noReference:0,unexpectedCoco:0};
  const rs=id('rowSearchInput'); if(rs){rs.value='';rs.classList.remove('active');}
  const rb=id('rowSearchBadge'); if(rb){rb.classList.remove('show');rb.textContent='';}
  const rc=id('rowSearchClear'); if(rc) rc.classList.remove('show');
  if(id('exclBar')) id('exclBar').classList.add('hidden');
  if(id('loadBar')) id('loadBar').classList.add('hidden');
  if(diffFs){toggleDiffFullscreen();}
  id('diffOut').innerHTML='<div class="empty"><div class="empty-ico">&#128269;</div><h3>No comparison yet</h3><p>Configure settings and click Run Compare.</p></div>';
  id('summaryGrid').innerHTML='';
  const resBadge=id('subtabResultsBadge');if(resBadge){resBadge.style.display='none';}
  showTab(3); showSubTab('settings');
  showToast('Results cleared \u2014 files and settings kept','ok');
}

/* =====================================================================
   PAGE FULLSCREEN (header button)
===================================================================== */
function togglePageFullscreen(){
  const btn=id('hdrFsBtn');
  if(!document.fullscreenElement){
    document.documentElement.requestFullscreen().catch(()=>{});
    if(btn) btn.innerHTML='&#x2715; Exit Fullscreen';
  } else {
    document.exitFullscreen().catch(()=>{});
    if(btn) btn.innerHTML='&#x26F6; Fullscreen';
  }
}
document.addEventListener('fullscreenchange',()=>{
  const btn=id('hdrFsBtn');
  if(btn) btn.innerHTML=document.fullscreenElement?'&#x2715; Exit Fullscreen':'&#x26F6; Fullscreen';
});

/* =====================================================================
   TRANSFORM PERSISTENCE & CONSOLIDATED VIEW
===================================================================== */
/* ═══════════════════════════════════════════════════════════
   TRANSFORM EXPORT / IMPORT  (cross-device JSON portability)
═══════════════════════════════════════════════════════════ */
function exportTransformsJSON(){
  const entries=Object.entries(S.fieldTransforms);
  if(!entries.length){showToast('No transforms to export','warn');return;}
  const toExport={__meta:{exported:new Date().toISOString(),version:'v6'},transforms:{}};
  entries.forEach(([canonical,srcs])=>{
    toExport.transforms[canonical]={};
    Object.entries(srcs).forEach(([src,t])=>{
      toExport.transforms[canonical][src]={
        fnStr:      t.fnStr       ||'',
        instruction:t.instruction ||'',
        appliedAt:  t.appliedAt   ||Date.now()
      };
    });
  });
  const count=entries.reduce((n,[,srcs])=>n+Object.keys(srcs).length,0);
  const blob=new Blob([JSON.stringify(toExport,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='rdm_transforms_'+new Date().toISOString().slice(0,10)+'.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported '+count+' transform'+(count!==1?'s':''),'ok');
}

function importTransformsJSON(input){
  const file=input.files[0]; if(!file) return;
  input.value='';
  const reader=new FileReader();
  reader.onload=e=>{
    let parsed;
    try{parsed=JSON.parse(e.target.result);}
    catch(err){showToast('Invalid JSON: '+err.message,'warn');return;}
    // Accept both {transforms:{...}} envelope and bare {canonical:{src:{...}}} object
    const raw=parsed.transforms||parsed;
    if(typeof raw!=='object'||Array.isArray(raw)){showToast('Unrecognised format','warn');return;}
    let imported=0, skipped=0;
    Object.entries(raw).forEach(([canonical,srcs])=>{
      if(canonical==='__meta') return;
      if(typeof srcs!=='object'||Array.isArray(srcs)) return;
      Object.entries(srcs).forEach(([src,t])=>{
        if(!t||!t.fnStr){skipped++;return;}
        let fn;
        try{fn=eval('('+t.fnStr+')'); if(typeof fn!=='function') throw new Error();}
        catch(e){skipped++;return;}
        if(!S.fieldTransforms[canonical]) S.fieldTransforms[canonical]={};
        S.fieldTransforms[canonical][src]={fn,fnStr:t.fnStr,instruction:t.instruction||'',appliedAt:t.appliedAt||Date.now()};
        imported++;
      });
    });
    saveTransformsToStorage();
    renderTxCard();
    renderMappingTable();
    const msg=imported+' transform'+(imported!==1?'s':'')+' imported from '+file.name+(skipped?' ('+skipped+' skipped — invalid)':'');
    showToast(msg, imported?'ok':'warn');
  };
  reader.readAsText(file);
}

function saveTransformsToStorage(){
  const toSave={};
  Object.entries(S.fieldTransforms).forEach(([canonical,srcs])=>{
    toSave[canonical]={};
    Object.entries(srcs).forEach(([src,t])=>{
      toSave[canonical][src]={
        fnStr:    t.fnStr    ||'',
        instruction: t.instruction||'',
        appliedAt:   t.appliedAt  ||Date.now()
      };
    });
  });
  try{localStorage.setItem('rdm_transforms',JSON.stringify(toSave));}
  catch(e){console.warn('Could not save transforms:',e.message);}
}

/* ═══════════════════════════════════════════════════════════
   BUILT-IN DEFAULT TRANSFORMS  (SKA — seeded for first-time users)
   Exported 2026-05-15. Existing user overrides always take precedence.
═══════════════════════════════════════════════════════════ */
const BUILTIN_TRANSFORMS = {
  // ── SKA (account-level) ───────────────────────────────────────────────────
  "SKA:g_l_account": {
    "FAQ": {
      fnStr: "v => (v && typeof v === 'string') ? v.split(' ')[0] : ''",
      instruction: "extract digits and characters before first space"
    }
  },
  "SKA:indicator_blocked_for_posting": {
    "COA": {
      fnStr: "v => v === \"X\" ? \"TRUE\" : \"FALSE\"",
      instruction: "treat X as TRUE and empty value as FALSE"
    }
  },
  "SKA:gl_account_subtype": {
    "FAQ": {
      fnStr: "v => v === \"Bank Reconciliation Account\" ? \"B\" : v === \"Petty Cash\" ? \"P\" : v === \"Bank Subaccount\" ? \"S\" : v === \"\" ? \"\" : \"\"",
      instruction: "treat Bank Reconciliation Account as \"B\", Petty Cash as \"P\", Bank Subaccount as \"S\", [blank] as empty"
    },
    "COA": {
      fnStr: "v => v === \"[blank]\" ? \"\" : v",
      instruction: "treat [blank] as empty"
    }
  },
  "SKA:gl_account_type": {
    "FAQ": {
      fnStr: "v => ({\n  \"Balance Sheet Account\": \"X\",\n  \"Cash Account\": \"C\",\n  \"Nonoperating Expense or Income\": \"N\",\n  \"Primary Costs or Revenue\": \"P\",\n  \"Secondary Costs\": \"S\"\n}[v] ?? \"\")",
      instruction: "treat Balance Sheet Account as \"X\", Cash Account as \"C\", Nonoperating Expense or Income as \"N\", Primary Costs or Revenue as \"P\", Secondary Costs as \"S\""
    }
  },
  "SKA:indicator_mark_for_deletion": {
    "COA": {
      fnStr: "v => v === \"X\" ? \"TRUE\" : \"FALSE\"",
      instruction: "treat X as TRUE and empty as FALSE"
    }
  },
  "SKA:reconciliation_account_for_account_group": {
    "COA": {
      fnStr: "v => v === \"[blank]\" ? \"\" : v",
      instruction: "treat [blank] as empty value"
    }
  },
  "SKA:trading_partner_number": {
    "COA": {
      fnStr: "v => v === \"[blank]\" ? \"\" : v",
      instruction: "treat [blank] as empty value"
    }
  },
  "SKA:functional_area_code": {
    "COA": {
      fnStr: "v => v === \"[blank]\" ? \"\" : v",
      instruction: "treat [blank] as empty value"
    }
  },
  // ── SKB (account × company-code level) ───────────────────────────────────
  "SKB:gl_account_number": {
    "FAQ": {
      fnStr: "v => (v && typeof v === 'string') ? v.split(' ')[0] : ''",
      instruction: "extract digits and characters before first space"
    }
  },
  "SKB:indicator_is_account_blocked_for_posting": {
    "COA": {
      fnStr: "v => v === \"X\" ? \"TRUE\" : \"FALSE\"",
      instruction: "treat X as TRUE and empty as FALSE"
    }
  },
  "SKB:indicator_account_marked_for_deletion": {
    "COA": {
      fnStr: "v => v === \"X\" ? \"TRUE\" : \"FALSE\"",
      instruction: "treat X as TRUE and empty as FALSE"
    }
  },
  "SKB:open_item_management": {
    "COA": {
      fnStr: "v => v === \"[blank]\" || v === \"\" ? \"FALSE\" : v",
      instruction: "treat [blank] as FALSE"
    }
  },
  "SKB:open_item_management_by_ledger_group": {
    "COA": {
      fnStr: "v => v === \"X\" ? \"TRUE\" : \"FALSE\"",
      instruction: "treat [blank] as FALSE and X as TRUE"
    }
  },
  "SKB:posting_without_tax_allowed": {
    "COA": {
      fnStr: "v => v === \"X\" ? \"TRUE\" : \"FALSE\"",
      instruction: "treat [blank] as FALSE and X as TRUE"
    }
  },
  "SKB:account_is_reconciliation_account": {
    "COA": {
      fnStr: "v => v === \"[blank]\" ? \"\" : v",
      instruction: "treat [blank] as empty value"
    }
  },
  "SKB:tax_category_in_account_master_record": {
    "COA": {
      fnStr: "v => v === \"[blank]\" ? \"\" : v",
      instruction: "treat [blank] as empty value"
    }
  }
};

/* Seed BUILTIN_TRANSFORMS into S.fieldTransforms for any key not already
   set by the user. Saves to localStorage so they persist across refreshes.
   Called after restoreTransformsFromStorage() so user overrides always win. */
function seedDefaultTransforms(){
  let seeded=0;
  Object.entries(BUILTIN_TRANSFORMS).forEach(([canonical,srcs])=>{
    Object.entries(srcs).forEach(([src,t])=>{
      // Skip if the user already has an entry for this canonical+source
      if(S.fieldTransforms[canonical]&&S.fieldTransforms[canonical][src]) return;
      try{
        const fn=eval('('+t.fnStr+')');
        if(typeof fn!=='function') return;
        if(!S.fieldTransforms[canonical]) S.fieldTransforms[canonical]={};
        S.fieldTransforms[canonical][src]={
          fn, fnStr:t.fnStr, instruction:t.instruction,
          appliedAt: t.appliedAt||Date.now()
        };
        seeded++;
      }catch(e){console.warn('Built-in transform eval failed:',canonical,src,e.message);}
    });
  });
  if(seeded>0) saveTransformsToStorage();
  return seeded;
}

function restoreTransformsFromStorage(){
  try{
    const raw=localStorage.getItem('rdm_transforms');
    if(!raw) return;
    const saved=JSON.parse(raw);
    let count=0;
    Object.entries(saved).forEach(([canonical,srcs])=>{
      S.fieldTransforms[canonical]={};
      Object.entries(srcs).forEach(([src,t])=>{
        if(!t.fnStr) return;
        try{
          const fn=eval('('+t.fnStr+')');
          if(typeof fn!=='function') return;
          S.fieldTransforms[canonical][src]={fn,fnStr:t.fnStr,instruction:t.instruction,appliedAt:t.appliedAt};
          count++;
        }catch(e){/* skip invalid */}
      });
      if(!Object.keys(S.fieldTransforms[canonical]).length) delete S.fieldTransforms[canonical];
    });
    if(count>0) showToast(count+' transform'+(count>1?'s':'')+' restored from last session','ok');
  }catch(e){console.warn('Could not restore transforms:',e.message);}
}

function renderTxCard(){
  // ── Preset transforms (from mapping JSON) ─────────────────────────────────
  const presetEl = id('txPresetSection');
  if (presetEl) {
    const presetRows = (S.comparableFields || [])
      .filter(f => f.default_transforms)
      .map(f => {
        const dt = f.default_transforms;
        const parts = Object.entries(dt).map(([src, cfg]) => {
          const desc = [];
          if (cfg.value_map) {
            const ex = Object.entries(cfg.value_map).slice(0,3).map(([k,v])=>`"${k||'(blank)'}"→"${v}"`).join(', ');
            desc.push(ex);
          }
          if (cfg.case) desc.push('case: '+cfg.case);
          return `<span style="color:var(--text3);font-size:10px;">[${src}]</span> ${desc.join(', ')}`;
        });
        return `<tr>
          <td style="font-size:11px;font-weight:500;padding:5px 8px;">${esc(f.label)}</td>
          <td colspan="4" style="font-size:11px;padding:5px 8px;color:var(--text2);">${parts.join(' &nbsp;|&nbsp; ')}</td>
        </tr>`;
      }).join('');
    if (presetRows) {
      presetEl.style.display = '';
      const ptbody = id('txPresetTbody');
      if (ptbody) ptbody.innerHTML = presetRows;
    } else {
      presetEl.style.display = 'none';
    }
  }

  const entries=[];
  Object.entries(S.fieldTransforms).forEach(([modeCanonical,srcs])=>{
    Object.entries(srcs).forEach(([src,t])=>{
      // Extract mode prefix (e.g. "SKA" from "SKA:g_l_account")
      const colonIdx = modeCanonical.indexOf(':');
      const mode     = colonIdx>=0 ? modeCanonical.slice(0,colonIdx) : (S.activeMode||'SKA');
      const canonical= colonIdx>=0 ? modeCanonical.slice(colonIdx+1) : modeCanonical;
      // Try resolvedMap first (active mode), then fall back to embedded map for inactive mode
      let f = S.resolvedMap.find(r=>r.canonical===canonical);
      if(!f){
        const fallbackMap = mode==='SKA' ? SKA_MAP : SKB_MAP;
        const fallbackField = (fallbackMap.fields||[]).find(ff=>ff.canonical===canonical);
        if(fallbackField) f={label:fallbackField.label, canonical};
      }
      entries.push({modeCanonical,canonical,mode,src,label:f?f.label:canonical,t,
        fieldIdx:(mode===S.activeMode&&f)?S.resolvedMap.indexOf(S.resolvedMap.find(r=>r.canonical===canonical)):-1});
    });
  });

  // Sort: active mode first, then alphabetical by label
  entries.sort((a,b)=>{
    if(a.mode===S.activeMode && b.mode!==S.activeMode) return -1;
    if(a.mode!==S.activeMode && b.mode===S.activeMode) return 1;
    return a.label.localeCompare(b.label);
  });

  // Update Transforms sub-tab badge
  const txBadge=id('subtabTxBadge');
  if(txBadge){
    if(entries.length){txBadge.textContent=entries.length;txBadge.style.display='';}
    else{txBadge.style.display='none';}
  }

  if(!entries.length){
    const tbody=id('txTbody');
    if(tbody) tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:16px;font-size:12px;color:var(--text3);font-style:italic;">No transforms applied yet. Use ⚡ Transform in the field mapping to add one.</td></tr>';
    const cnt=id('txCount'); if(cnt) cnt.textContent='';
    const badge=id('txPersistBadge'); if(badge) badge.style.display='none';
    return;
  }

  id('txCount').textContent='('+entries.length+')';
  const persisted=!!localStorage.getItem('rdm_transforms');
  const badge=id('txPersistBadge');
  if(badge) badge.style.display=persisted?'':'none';

  const SRC_COLORS={
    COA:'background:var(--coa-bg);color:var(--coa-text);border:1px solid var(--coa-border);',
    FAQ:'background:var(--faq-bg);color:var(--faq-text);border:1px solid var(--faq-border);',
    DataPool:'background:var(--dp-bg);color:var(--dp-text);border:1px solid var(--dp-border);',
    All:'background:var(--page-bg);color:var(--text2);border:1px solid var(--border);'
  };
  const MODE_STYLE={
    SKA:'background:var(--green-bg,#E6FFEC);color:var(--green,#116329);border:1px solid var(--green-border,#4AC26B);',
    SKB:'background:var(--mod-new-bg,#DBF0FF);color:#0550AE;border:1px solid #54AEFF;'
  };

  id('txTbody').innerHTML=entries.map((e,i)=>`
    <tr style="${e.mode!==S.activeMode?'opacity:0.55;':''}">
      <td><span class="tx-src-badge" style="${MODE_STYLE[e.mode]||''}">${esc(e.mode)}</span></td>
      <td class="tx-field-name">${esc(e.label)}</td>
      <td><span class="tx-src-badge" style="${SRC_COLORS[e.src]||SRC_COLORS.All}">${esc(e.src)}</span></td>
      <td class="tx-instruction" title="${esc(e.t.instruction||'')}">${esc(e.t.instruction||'—')}</td>
      <td class="tx-fnstr" title="${esc(e.t.fnStr||'')}">${esc(e.t.fnStr||'—')}</td>
      <td class="tx-actions">
        ${e.fieldIdx>=0?`<button class="tx-edit-btn" onclick="openTransformPanel(${e.fieldIdx})">&#9998; Edit</button>`:''}
        <button class="tx-del-btn" onclick="deleteTxEntry('${esc(e.modeCanonical)}','${esc(e.src)}')">&#215; Remove</button>
      </td>
    </tr>`).join('');
}

function deleteTxEntry(canonical,src){
  if(S.fieldTransforms[canonical]){
    delete S.fieldTransforms[canonical][src];
    if(!Object.keys(S.fieldTransforms[canonical]).length) delete S.fieldTransforms[canonical];
  }
  saveTransformsToStorage();
  renderTxCard();
  renderMappingTable();
  showToast('Transform removed','ok');
}

function clearAllTransforms(){
  if(!Object.keys(S.fieldTransforms).length){showToast('No transforms to clear','warn');return;}
  S.fieldTransforms={};
  saveTransformsToStorage();
  renderTxCard();
  renderMappingTable();
  showToast('All transforms cleared','ok');
}

async function rerunDiff(){
  // Re-run diff preserving current hiddenCols (column removals) and fieldTransforms
  await runDiff();
}

async function applyAllTransforms(){
  if(!Object.keys(S.fieldTransforms).length){showToast('No transforms to apply','warn');return;}
  const loaded=SOURCES.filter(s=>S.wbs[s]&&S.activeSources.has(s));
  if(loaded.length<2){showToast('Upload at least 2 source files first','warn');return;}
  S.hiddenCols=new Set();
  await runDiff();
  showToast('Re-run complete with all transforms applied','ok');
}

// Restore AI button state on page load
updateAIBtnState();
// Restore JIRA button state on page load
updateJiraBtnState();
// Initialise sql.js for RDM Agent Text-to-SQL
initSQLite();
// Restore persisted transforms
restoreTransformsFromStorage();
// Seed built-in SKA defaults for any entry not already saved by the user

// Async startup: load mapping JSON then seed defaults + init UI
(async function appStart() {
  await loadMappings();          // populates SKA_MAP / SKB_MAP from JSON files
  seedDefaultTransforms();
  // Popover positioning — fixed position to avoid clipping in scroll containers
  document.addEventListener('mouseover', function(e){
    const wrap = e.target.closest('.ftype-wrap');
    if(!wrap) return;
    const pop = wrap.querySelector('.ftype-popover');
    if(!pop) return;
    const rect = wrap.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if(spaceBelow > 160){
      pop.style.top  = (rect.bottom + 5) + 'px';
      pop.style.bottom = '';
    } else {
      pop.style.bottom = (window.innerHeight - rect.top + 5) + 'px';
      pop.style.top = '';
    }
    const left = Math.min(rect.left, window.innerWidth - 276);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.display = 'block';
  });
  document.addEventListener('mouseout', function(e){
    const wrap = e.target.closest('.ftype-wrap');
    if(!wrap) return;
    const pop = wrap.querySelector('.ftype-popover');
    if(pop) pop.style.display = 'none';
  });

  // Init mode UI to match default S.activeMode
  (function initModeUI(){
    const ccSec=id('ccMatrixSection');
    if(ccSec) ccSec.style.display=S.activeMode==='SKB'?'':'none';
    const activeBtn=id('modeBtn-'+S.activeMode);
    if(activeBtn) activeBtn.classList.add('mode-btn-active');
  })();
  // Render tx card after restore (will be hidden if empty)
  setTimeout(renderTxCard, 100);
})();