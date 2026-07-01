/* =====================================================================
   ROW SEARCH — key or value, JS for <50K rows, SQLite for ≥50K
===================================================================== */
let _rowSearchTimer=null;

function onRowSearchInput(val){
  S.rowSearch=val||'';
  const clear=id('rowSearchClear');
  if(clear) clear.classList.toggle('show',!!S.rowSearch);
  const inp=id('rowSearchInput');
  if(inp) inp.classList.toggle('active',!!S.rowSearch);
  clearTimeout(_rowSearchTimer);
  if(!S.rowSearch){
    clearRowSearch();
    return;
  }
  const badge=id('rowSearchBadge');
  if(badge){badge.textContent='Searching\u2026';badge.classList.add('show');}
  // Debounce 300ms
  _rowSearchTimer=setTimeout(()=>execRowSearch(S.rowSearch),300);
}

async function execRowSearch(term){
  if(!term){clearRowSearch();return;}
  const badge=id('rowSearchBadge');
  const total=S._diffRows.length;
  const LARGE=50000;

  if(total<LARGE||!_sqlReady||!_diffDb){
    // JS path — fast for small/medium datasets
    const t=term.toLowerCase();
    const keys=new Set();
    S._diffRows.forEach(row=>{
      // Search key first
      if((row.key||'').toLowerCase().includes(t)){keys.add(row.key);return;}
      // Search all field values across all sources
      const vals=row.vals||{};
      for(const src of SOURCES){
        const srcVals=vals[src];
        if(!srcVals) continue;
        for(const v of srcVals){
          if(v!==null&&String(v).toLowerCase().includes(t)){keys.add(row.key);break;}
        }
        if(keys.has(row.key)) break;
      }
    });
    applyRowSearchResult(keys,term);
  } else {
    // SQLite path — for large datasets, search key + all columns via LIKE
    if(badge){badge.textContent='Searching\u2026';badge.classList.add('show');}
    await new Promise(r=>setTimeout(r,20)); // yield to browser
    try{
      // Build LIKE clause for every column in diff_results
      const schemaRes=_diffDb.exec("SELECT name FROM pragma_table_info('diff_results') WHERE name != 'dtype'");
      const cols=schemaRes.length?schemaRes[0].values.map(r=>r[0]):['key'];
      const likeClauses=cols.map(c=>c+' LIKE ?').join(' OR ');
      const likeVal='%'+term+'%';
      const params=cols.map(()=>likeVal);
      const res=_diffDb.exec('SELECT DISTINCT key FROM diff_results WHERE '+likeClauses,[...params]);
      const keys=new Set(res.length?res[0].values.map(r=>r[0]):[]);
      applyRowSearchResult(keys,term);
    }catch(e){
      console.warn('SQLite row search failed:',e.message);
      // Fallback to JS
      const t=term.toLowerCase();
      const keys=new Set(S._diffRows.filter(r=>(r.key||'').toLowerCase().includes(t)).map(r=>r.key));
      applyRowSearchResult(keys,term);
    }
  }
}

function applyRowSearchResult(keys,term){
  S.rowSearchKeys=keys;
  S.pageOffset=0;
  const badge=id('rowSearchBadge');
  if(badge){
    if(keys.size===0){
      badge.textContent='No rows found for "'+term+'"';
      badge.style.background='var(--del-bg)';badge.style.borderColor='var(--del-border)';badge.style.color='var(--del-src)';
    } else {
      badge.textContent=keys.size.toLocaleString()+' row'+(keys.size!==1?'s':'')+' matched';
      badge.style.background='#FFF8C5';badge.style.borderColor='#D4A72C';badge.style.color='#7D4E00';
    }
    badge.classList.add('show');
  }
  renderDiff(true);
  // Scroll diff table into view
  const dc=id('diffCard');
  if(dc&&keys.size>0) setTimeout(()=>dc.scrollIntoView({behavior:'smooth',block:'nearest'}),120);
}

function clearRowSearch(){
  S.rowSearch='';
  S.rowSearchKeys=null;
  const inp=id('rowSearchInput');if(inp){inp.value='';inp.classList.remove('active');}
  const clear=id('rowSearchClear');if(clear) clear.classList.remove('show');
  const badge=id('rowSearchBadge');if(badge){badge.classList.remove('show');badge.textContent='';}
  S.pageOffset=0;
  renderDiff(true);
}

function searchRowsByKey(key){
  const inp=id('rowSearchInput');
  if(inp){inp.value=key;inp.classList.add('active');}
  const clear=id('rowSearchClear');if(clear) clear.classList.add('show');
  S.rowSearch=key;
  const badge=id('rowSearchBadge');
  if(badge){badge.textContent='Searching\u2026';badge.classList.add('show');}
  execRowSearch(key);
  // Navigate to results if on step 3
  const dc=id('diffCard');
  if(dc) setTimeout(()=>dc.scrollIntoView({behavior:'smooth',block:'start'}),150);
}

function renderDiff(reset){
  const rows=filteredRows();
  const isSKBmode=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code';
  const loaded=SOURCES.filter(s=>{
    if(s==='COA') return isSKBmode
      ? !!S.refWbs.CC_MATRIX&&S.activeSources.has('COA')
      : !!S.refWbs.COA_MASTER&&S.activeSources.has('COA'); // SKA: COA from COA_MASTER
    return S.wbs[s]&&S.activeSources.has(s);
  });
  const cf=S.colFilter.toLowerCase().trim();
  const visFields=S.comparableFields.filter(f=>
    !S.hiddenCols.has(f.canonical)&&(!cf||f.label.toLowerCase().includes(cf))
  );
  const N=visFields.length;
  const hiddenCount=S.comparableFields.filter(f=>S.hiddenCols.has(f.canonical)).length;
  const filteredCount=S.comparableFields.length-hiddenCount-N;

  const SRC_DOT_COLOR={COA:'var(--coa-text)',FAQ:'var(--faq-text)',DataPool:'var(--dp-text)'};
  const legend=id('srcLegend');
  if(legend) legend.innerHTML=loaded.map(s=>
    '<span class="legend-dot" style="color:'+SRC_DOT_COLOR[s]+'"><span class="legend-dot-circle" style="background:'+SRC_DOT_COLOR[s]+'"></span>'+esc(SRC_LABEL[s])+'</span>'
  ).join('<span style="color:var(--border);margin:0 4px;font-weight:400;">·</span>');

  const thFields=S.comparableFields.map(f=>{
    if(S.hiddenCols.has(f.canonical)) return '';
    if(cf&&!f.label.toLowerCase().includes(cf)) return '';
    const hasTx=!!(S.fieldTransforms[txKey(f.canonical)]&&Object.keys(S.fieldTransforms[txKey(f.canonical)]).length);
    const txDot=hasTx?'<span class="th-tx-dot"></span>':'';
    const mapIdx=S.resolvedMap.findIndex(r=>r.canonical===f.canonical);
    const hasPreset = !!(f.default_transforms && Object.keys(f.default_transforms).length);
    const presetBadge = hasPreset ? '<span title="Preset transform active" style="font-size:9px;background:#0369a1;color:#fff;border-radius:3px;padding:1px 4px;margin-left:2px;">P</span>' : '';
    const txBtn='<button class="th-btn th-btn-tx" onclick="event.stopPropagation();openTransformPanel('+mapIdx+')" title="Transform: '+esc(f.label)+'">\u26a1</button>'+presetBadge;
    const exclBtn='<button class="th-btn th-btn-excl" onclick="event.stopPropagation();hideColFromResults(\''+f.canonical+'\')" title="Remove: '+esc(f.label)+'">\u00d7</button>';
    return '<th class="fh" title="'+esc(f.label)+'">'+
      '<div class="th-wrap">'+
      '<span class="th-label">'+esc(f.label)+'</span>'+txDot+txBtn+exclBtn+
      '</div></th>';
  }).join('');

  // Removed-columns state is shown in the title bar and column picker — no sticky banner needed
  const noticeRow='';

  const tbl='<div class="diff-box anim"><table class="dt">'+
    '<thead><tr><th>Source</th><th class="fh fh-key" style="position:sticky;left:0;z-index:3;background:var(--head-bg);color:#fff;white-space:nowrap;">Key</th>'+thFields+'</tr>'+noticeRow+'</thead>'+
    '<tbody id="dtBody"></tbody></table></div>';

  id('diffOut').innerHTML=tbl;
  const exclNote=S.excludedFields.size?' \u00b7 '+S.excludedFields.size+' excluded':'';
  const hidNote=hiddenCount?' \u00b7 '+hiddenCount+' removed':'';
  const cfNote=filteredCount?' \u00b7 '+filteredCount+' col-filtered':'';
  const rsNote=S.rowSearchKeys!==null?' \u00b7 \ud83d\udd0d '+S.rowSearchKeys.size+' row search match'+(S.rowSearchKeys.size!==1?'es':''):'';
  id('diffTitle').textContent='Diff Results \u2014 '+rows.length.toLocaleString()+' rows ('+S.comparableFields.length+' fields'+exclNote+hidNote+cfNote+rsNote+')';
  id('filterCount').textContent=rows.length.toLocaleString()+' rows \u00b7 '+N+' cols';
  renderExclBar();
  updateColPickerCount();

  S.pageOffset=0;
  appendRows(rows.slice(0,S.pageSize), visFields);
  S.pageOffset=S.pageSize;
  updateLoadBar(rows.length);
}function loadMore(){
  const rows=filteredRows();
  const cf=S.colFilter.toLowerCase().trim();
  const visFields=S.comparableFields.filter(f=>
    !S.hiddenCols.has(f.canonical)&&(!cf||f.label.toLowerCase().includes(cf))
  );
  const slice=rows.slice(S.pageOffset,S.pageOffset+S.pageSize);
  appendRows(slice, visFields);
  S.pageOffset+=slice.length;
  updateLoadBar(rows.length);
}

function updateLoadBar(total){
  const bar=id('loadBar'), cnt=id('loadCount'), btn=id('loadMoreBtn');
  if(S.pageOffset>=total){
    bar.classList.remove('hidden');
    cnt.textContent='All '+total.toLocaleString()+' rows loaded';
    btn.style.display='none';
  } else {
    bar.classList.remove('hidden');
    cnt.textContent='Showing '+S.pageOffset.toLocaleString()+' of '+total.toLocaleString()+' rows';
    btn.style.display='';
    btn.textContent='Load next '+Math.min(S.pageSize,total-S.pageOffset).toLocaleString()+' rows';
  }
}

function appendRows(rows, visFields){
  const isSKBmode=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code';
  const loaded=SOURCES.filter(s=>{
    if(s==='COA') return isSKBmode
      ? !!S.refWbs.CC_MATRIX&&S.activeSources.has('COA')
      : !!S.refWbs.COA_MASTER&&S.activeSources.has('COA'); // SKA: COA from COA_MASTER
    return S.wbs[s]&&S.activeSources.has(s);
  });
  // visFields passed from renderDiff so header/cells are always in sync
  if(!visFields) visFields=S.comparableFields.filter(f=>!S.hiddenCols.has(f.canonical));
  const N=visFields.length;
  let html='';
  let prevType=null;

  rows.forEach(row=>{
    const {dtype,vals,fieldConflicts}=row;

    if(prevType&&prevType!==dtype&&(prevType==='conflict'||dtype==='conflict')){
      html+='<tr class="r-sep"><td colspan="'+(N+1)+'"></td></tr>';
    }
    prevType=dtype;

    if(dtype==='same'){
      const cells=visFields.map(f=>{
        const fi=S.comparableFields.indexOf(f);
        const src=SOURCES.find(s=>vals[s]&&vals[s][fi]!==null);
        const v=src?vals[src][fi]:'';
        return '<td title="'+esc(v)+'">'+esc(v)+'</td>';
      }).join('');
      const keyVal=esc(row.key||'');
      html+='<tr class="r-3same"><td class="src">&#10003; All Match</td><td class="c-key" rowspan="1">'+keyVal+'</td>'+cells+'</tr>';

    } else if(dtype==='conflict'){
      const keyVal=esc(row.key||'');
      loaded.forEach((src,si)=>{
        const rowCls='r-3'+SRC_COLOR[src];
        const cells=visFields.map(f=>{
          const fi=S.comparableFields.indexOf(f);
          const v=vals[src]?vals[src][fi]:null;
          if(v===null) return '<td class="c-na">\u2014</td>';
          const cls=fieldConflicts&&fieldConflicts[fi]?getCellClass(vals,fi,src):'';
          return '<td class="'+cls+'" title="'+esc(v)+'">'+esc(v)+'</td>';
        }).join('');
        // Key cell only on first source row, spans all source rows
        const jiraBtn='<button class="th-btn" style="margin-left:6px;vertical-align:middle;" onclick="event.stopPropagation();openJiraTicketModal(\''+esc(row.key||'').replace(/'/g,"\\'")+'\')" title="Raise JIRA ticket for this conflict">&#127915;</button>';
        const keyCell=si===0?'<td class="c-key" rowspan="'+loaded.length+'" style="vertical-align:middle;">'+keyVal+jiraBtn+'</td>':'';
        html+='<tr class="'+rowCls+'"><td>'+esc(SRC_LABEL[src])+'</td>'+keyCell+cells+'</tr>';
      });
      html+='<tr class="r-sep"><td colspan="'+(N+1)+'"></td></tr>';
      prevType=null;

    } else if(dtype.startsWith('only_')){
      const src=dtype.replace('only_','');
      const color=SRC_COLOR[src]||'coa';
      const cells=visFields.map(f=>{
        const fi=S.comparableFields.indexOf(f);
        const v=vals[src]?vals[src][fi]:null;
        return '<td title="'+esc(v||'')+'">'+esc(v||'')+'</td>';
      }).join('');
      const keyVal=esc(row.key||'');
      html+='<tr class="r-3only-'+color+'"><td>'+esc(SRC_LABEL[src]||src)+' Only</td><td class="c-key">'+keyVal+'</td>'+cells+'</tr>';
    }
  });

  const body=id('dtBody');
  if(body) body.insertAdjacentHTML('beforeend',html);
}

