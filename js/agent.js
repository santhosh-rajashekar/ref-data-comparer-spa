/* =====================================================================
   AGENT: TOOL DEFINITIONS
===================================================================== */
function buildRDMTools(){
  const tools=[];
  const hasResults=S._diffRows&&S._diffRows.length>0;
  const hasCOA=S.coaFilterStats&&S.coaFilterStats.total>0;

  tools.push({type:'function',function:{
    name:'get_field_mapping',
    description:'Get the full mapping details for a specific field — which column each source reads from, field type (coa_lookup, coa_derived, cc_matrix_lookup, dimension), and any derivation rules. Use when explaining why a specific field may differ between sources.',
    parameters:{type:'object',properties:{
      canonical:{type:'string',description:'Canonical field name, e.g. "authorization_group", "chart_of_account", "indicator_blocked_for_posting"'}
    },required:['canonical']}
  }});

  if(hasResults){
    tools.push({type:'function',function:{
      name:'execute_sql',
      description:'Execute a SELECT SQL query against the diff_results SQLite table. Use for counting, grouping, or filtering rows. Always include LIMIT 50. Columns: dtype, key, then per-field triplets coa_{canonical} / faq_{canonical} / dp_{canonical} and conflict_{canonical} (1=differs).',
      parameters:{type:'object',properties:{
        query:{type:'string',description:'SQLite SELECT only. Table: diff_results. dtype values: conflict/same/only_COA/only_FAQ/only_DataPool. key is GL account (SKA) or GL+CoCo concatenated (SKB).'}
      },required:['query']}
    }});

    tools.push({type:'function',function:{
      name:'get_row_detail',
      description:'Get all field values for a specific row key across COA, FAQ, and DataPool. Use when the user asks about a specific account or account+company_code pair.',
      parameters:{type:'object',properties:{
        key:{type:'string',description:'Row key — GL account number for SKA (e.g. "7520005000") or GL account + company code concatenated for SKB (e.g. "7520005000DE10001").'}
      },required:['key']}
    }});

    tools.push({type:'function',function:{
      name:'get_value_distribution',
      description:'Get the frequency distribution of values for a specific field in a specific source. Use for root cause analysis — e.g. to understand what values drive conflicts in a field.',
      parameters:{type:'object',properties:{
        field:{type:'string',description:'Canonical field name'},
        source:{type:'string',enum:['COA','FAQ','DataPool'],description:'Which source to analyse'},
        dtype:{type:'string',enum:['conflict','same','only_COA','only_FAQ','only_DataPool'],description:'Optional: restrict to rows of this type. Omit for all rows.'}
      },required:['field','source']}
    }});

    tools.push({type:'function',function:{
      name:'get_conflict_summary',
      description:'Get conflict counts per field ranked by frequency. Optionally focus on one specific field to get sample conflicting rows.',
      parameters:{type:'object',properties:{
        field:{type:'string',description:'Optional: canonical field name. Omit to get all fields ranked.'}
      },required:[]}
    }});
  }

  if(hasCOA){
    tools.push({type:'function',function:{
      name:'get_coa_filter_stats',
      description:'Get COA Master row filter statistics — how many rows were excluded (yellow hierarchy rows, 7-digit accounts, strikethrough rows) and how many remain. Use when explaining why accounts appear only in FAQ or DataPool.',
      parameters:{type:'object',properties:{},required:[]}
    }});
  }

  return tools;
}

/* =====================================================================
   AGENT: TOOL IMPLEMENTATIONS
===================================================================== */
function rdmTool_executeSQL(args){
  const query=(args.query||'').trim();
  if(!_sqlReady||!_diffDb) return {error:'SQL database not ready — run a comparison first'};
  if(!/^SELECT\b/i.test(query)) return {error:'Only SELECT queries are allowed'};
  if(/\b(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(query)) return {error:'Query contains a forbidden statement'};
  try{
    const result=_diffDb.exec(query);
    if(!result||!result.length) return {columns:[],rows:[],rowCount:0};
    const {columns,values}=result[0];
    const rows=values.slice(0,50).map(r=>{const o={};columns.forEach((c,i)=>o[c]=r[i]);return o;});
    return {columns,rows,rowCount:rows.length,truncated:values.length>50};
  }catch(e){return {error:e.message};}
}

function rdmTool_getRowDetail(args){
  const key=args.key;
  if(!S._diffRows||!S._diffRows.length) return {error:'No comparison results available'};
  const row=S._diffRows.find(r=>r.key===key);
  if(!row) return {error:'Key "'+key+'" not found in results. Check exact format (GL account for SKA; GL+CoCo for SKB).'};
  const cf=S.comparableFields;
  const fields=cf.map((f,fi)=>{
    const entry={label:f.label,canonical:f.canonical,conflict:!!(row.fieldConflicts&&row.fieldConflicts[fi])};
    SOURCES.forEach(src=>{entry[src]=(row.vals&&row.vals[src]&&row.vals[src][fi]!=null)?row.vals[src][fi]:null;});
    return entry;
  });
  return {key,dtype:row.dtype,discType:row.discType||null,mode:S.activeMode,fields};
}

function rdmTool_getValueDistribution(args){
  const {field,source,dtype}=args;
  if(!S._diffRows||!S._diffRows.length) return {error:'No comparison results available'};
  const cf=S.comparableFields;
  const fi=cf.findIndex(f=>f.canonical===field);
  if(fi<0) return {error:'Field "'+field+'" not found. Available: '+cf.map(f=>f.canonical).join(', ')};
  if(!SOURCES.includes(source)) return {error:'Invalid source: '+source+'. Use COA, FAQ, or DataPool.'};
  const counts={};
  let total=0;
  for(const row of S._diffRows){
    if(dtype&&row.dtype!==dtype) continue;
    const val=(row.vals&&row.vals[source]&&row.vals[source][fi]!=null)?String(row.vals[source][fi]):'(blank)';
    counts[val]=(counts[val]||0)+1;
    total++;
  }
  const distribution=Object.entries(counts)
    .map(([value,count])=>({value,count,pct:((count/total)*100).toFixed(1)+'%'}))
    .sort((a,b)=>b.count-a.count).slice(0,25);
  return {field,label:cf[fi].label,source,dtype:dtype||'all',totalRows:total,distribution};
}

function rdmTool_getConflictSummary(args){
  const {field}=args||{};
  if(!S._diffRows||!S._diffRows.length) return {error:'No comparison results available'};
  const cf=S.comparableFields;
  const conflictRows=S._diffRows.filter(r=>r.dtype==='conflict');
  if(field){
    const fi=cf.findIndex(f=>f.canonical===field);
    if(fi<0) return {error:'Field "'+field+'" not found'};
    const hits=conflictRows.filter(r=>r.fieldConflicts&&r.fieldConflicts[fi]);
    const samples=hits.slice(0,5).map(r=>{
      const s={key:r.key};
      SOURCES.forEach(src=>{s[src]=(r.vals&&r.vals[src]&&r.vals[src][fi]!=null)?r.vals[src][fi]:null;});
      return s;
    });
    return {field,label:cf[fi].label,conflictCount:hits.length,
      ofTotalConflicts:conflictRows.length?(((hits.length/conflictRows.length)*100).toFixed(1)+'%'):'0%',samples};
  }
  const fieldStats=cf.map((f,fi)=>({
    label:f.label,canonical:f.canonical,
    conflictCount:conflictRows.filter(r=>r.fieldConflicts&&r.fieldConflicts[fi]).length
  })).sort((a,b)=>b.conflictCount-a.conflictCount);
  return {mode:S.activeMode,totalRows:S._diffRows.length,conflictRows:conflictRows.length,fields:fieldStats};
}

function rdmTool_getFieldMapping(args){
  const {canonical}=args;
  const fields=(S.resolvedMap&&S.resolvedMap.length)?S.resolvedMap:(getEmbeddedMap().fields||[]);
  const f=fields.find(f=>f.canonical===canonical);
  if(!f) return {found:false,error:'Field "'+canonical+'" not found. Available: '+fields.map(f=>f.canonical).join(', ')};
  return {found:true,field:{label:f.label,canonical:f.canonical,type:f.type,is_key:!!f.is_key,sources:f.sources,note:f.note||null}};
}

function rdmTool_getCoaFilterStats(){
  const fs=S.coaFilterStats;
  if(!fs||!fs.total) return {error:'COA Master not loaded or comparison not yet run'};
  return {total:fs.total,yellowSkipped:fs.yellowSkipped,tenDigitSkipped:fs.tenDigitSkipped,
    strikeSkipped:fs.strikeSkipped,kept:fs.kept,
    note:'Accounts excluded by these filters will appear as FAQ-only or DataPool-only rows in the results — this is expected, not a data quality issue.'};
}

function rdmExecuteTool(name,argsStr){
  let args;
  try{args=JSON.parse(argsStr);}catch(e){return {error:'Invalid tool arguments: '+e.message};}
  try{
    switch(name){
      case 'execute_sql':            return rdmTool_executeSQL(args);
      case 'get_row_detail':         return rdmTool_getRowDetail(args);
      case 'get_value_distribution': return rdmTool_getValueDistribution(args);
      case 'get_conflict_summary':   return rdmTool_getConflictSummary(args);
      case 'get_field_mapping':      return rdmTool_getFieldMapping(args);
      case 'get_coa_filter_stats':   return rdmTool_getCoaFilterStats();
      default: return {error:'Unknown tool: '+name};
    }
  }catch(e){return {error:'Tool error: '+e.message};}
}

/* =====================================================================
   AGENT: TOOL STEP UI
===================================================================== */
const _TOOL_LABELS={
  execute_sql:'SQL query',get_row_detail:'Row lookup',
  get_value_distribution:'Value distribution',get_conflict_summary:'Conflict summary',
  get_field_mapping:'Field mapping',get_coa_filter_stats:'COA filter stats'
};

function rdmAppendToolStep(toolName,argsStr){
  const body=id('rdmBody');
  const followup=body.querySelector('.rdm-followup-strip');
  let argsPreview='';
  try{
    const a=JSON.parse(argsStr);
    if(a.query) argsPreview=a.query.replace(/\s+/g,' ').trim().slice(0,120)+(a.query.length>120?'…':'');
    else argsPreview=Object.entries(a).filter(([,v])=>v!==undefined).map(([k,v])=>k+': '+v).join(' · ').slice(0,90);
  }catch(e){}
  const stepId='rdm-step-'+Date.now();
  const div=document.createElement('div');
  div.className='rdm-tool-step';
  div.id=stepId;
  div.innerHTML='<span class="rdm-step-icon">&#9881;</span>'
    +'<div class="rdm-step-body">'
    +'<div class="rdm-step-name">'+esc(_TOOL_LABELS[toolName]||toolName)+'</div>'
    +(argsPreview?'<div class="rdm-step-args">'+esc(argsPreview)+'</div>':'')
    +'<div class="rdm-step-result" id="'+stepId+'-res">running\u2026</div>'
    +'</div>';
  if(followup) body.insertBefore(div,followup); else body.appendChild(div);
  body.scrollTop=body.scrollHeight;
  return stepId;
}

function rdmUpdateToolStep(stepId,resultSummary){
  const el=id(stepId+'-res');
  if(el) el.textContent='\u2192 '+resultSummary;
}

function rdmToolResultSummary(toolName,result){
  if(result.error) return 'error: '+result.error;
  switch(toolName){
    case 'execute_sql':
      return result.rowCount+' row'+(result.rowCount!==1?'s':'')+' returned'+(result.truncated?' (truncated)':'');
    case 'get_row_detail':
      if(!result.fields) return 'not found';
      return 'found \u2014 '+result.dtype+', '+result.fields.filter(f=>f.conflict).length+' conflicting field(s)';
    case 'get_value_distribution':
      const top=(result.distribution||[]).slice(0,3).map(d=>'"'+d.value+'" ('+d.count+')').join(', ');
      return (result.totalRows||0)+' rows \u00b7 top: '+top;
    case 'get_conflict_summary':
      if(result.field) return result.conflictCount+' conflicts ('+result.ofTotalConflicts+' of conflict rows)';
      return (result.conflictRows||0)+' conflict rows \u00b7 '+(result.fields||[]).length+' fields';
    case 'get_field_mapping':
      return result.found?'found: '+result.field.type+' \u2014 '+result.field.label:'not found';
    case 'get_coa_filter_stats':
      return (result.total||0)+' total \u2192 '+(result.kept||0)+' kept';
    default: return 'done';
  }
}


function clearRDM(){
  id('rdmBody').innerHTML='<div class="rdm-welcome" id="rdmWelcome"><div class="rdm-welcome-icon">&#129302;</div><h4>RDM Agent</h4><p>Ask me anything about your 3-way comparison — conflicts, missing rows, field discrepancies, or data quality patterns.</p><div class="rdm-quick-prompts" id="rdmWelcomeChips"></div></div>';
  _rdmHistory=[];
  _rdmBusy=false;
  buildContextualChips();
}


