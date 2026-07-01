/* =====================================================================
   JIRA CONFIG
===================================================================== */
function getJiraCfg(){
  return {
    baseUrl: (localStorage.getItem('jira_baseUrl')||'').trim().replace(/\/+$/,''),
    email:   (localStorage.getItem('jira_email')||'').trim(),
    token:   localStorage.getItem('jira_token')||'',
    project: (localStorage.getItem('jira_project')||'').trim(),
    issueType: (localStorage.getItem('jira_issueType')||'Task').trim(),
    proxyUrl: (localStorage.getItem('jira_proxyUrl')||'').trim().replace(/\/+$/,'')
  };
}

function jiraAuthHeader(cfg){
  if(cfg.email){
    return 'Basic '+btoa(cfg.email+':'+cfg.token); // JIRA Cloud: email + API token
  }
  return 'Bearer '+cfg.token; // JIRA Server/Data Center: Personal Access Token
}

function openJiraConfig(){
  const cfg=getJiraCfg();
  id('jiraBaseUrl').value=cfg.baseUrl;
  id('jiraEmail').value=cfg.email;
  id('jiraToken').value=cfg.token?'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022':'';
  id('jiraProject').value=cfg.project;
  id('jiraIssueType').value=cfg.issueType||'Task';
  id('jiraProxyUrl').value=cfg.proxyUrl;
  id('jiraTestStatus').innerHTML='';
  id('jiraConfigModal').classList.add('open');
}

function closeJiraConfig(){
  const baseUrl=id('jiraBaseUrl').value.trim().replace(/\/+$/,'');
  const email=id('jiraEmail').value.trim();
  const token=id('jiraToken').value.trim();
  const project=id('jiraProject').value.trim();
  const issueType=id('jiraIssueType').value.trim();
  const proxyUrl=id('jiraProxyUrl').value.trim().replace(/\/+$/,'');
  if(baseUrl) localStorage.setItem('jira_baseUrl',baseUrl);
  localStorage.setItem('jira_email',email);
  if(token&&!token.startsWith('\u2022')) localStorage.setItem('jira_token',token);
  if(project) localStorage.setItem('jira_project',project);
  if(issueType) localStorage.setItem('jira_issueType',issueType);
  localStorage.setItem('jira_proxyUrl',proxyUrl);
  id('jiraConfigModal').classList.remove('open');
  updateJiraBtnState();
}

function clearJiraConfig(){
  ['jira_baseUrl','jira_email','jira_token','jira_project','jira_issueType','jira_proxyUrl'].forEach(k=>localStorage.removeItem(k));
  id('jiraBaseUrl').value=''; id('jiraEmail').value=''; id('jiraToken').value='';
  id('jiraProject').value=''; id('jiraIssueType').value='Task'; id('jiraProxyUrl').value='';
  id('jiraTestStatus').innerHTML='';
  updateJiraBtnState();
  showToast('JIRA config cleared','warn');
}

function updateJiraBtnState(){
  const btn=id('jiraCfgBtn'); if(!btn) return;
  const cfg=getJiraCfg();
  const ready=cfg.baseUrl&&cfg.token&&cfg.project;
  if(ready){btn.classList.add('connected');btn.title='JIRA connected — click to reconfigure';}
  else{btn.classList.remove('connected');btn.title='Configure JIRA connection';}
}

async function testJiraConnection(){
  const baseUrl=id('jiraBaseUrl').value.trim().replace(/\/+$/,'');
  const email=id('jiraEmail').value.trim();
  const rawToken=id('jiraToken').value.trim();
  const token=rawToken.startsWith('\u2022')?getJiraCfg().token:rawToken;
  const proxyUrl=id('jiraProxyUrl').value.trim().replace(/\/+$/,'');
  if(!baseUrl){id('jiraTestStatus').innerHTML='<span class="ai-status err">Enter base URL first</span>';return;}
  if(!token){id('jiraTestStatus').innerHTML='<span class="ai-status err">Enter an API token / PAT first</span>';return;}
  id('jiraTestStatus').innerHTML='<span class="ai-status testing">Testing\u2026</span>';
  try{
    const cfg={baseUrl,email,token};
    const url = proxyUrl ? (proxyUrl+'/api/jira/myself') : (baseUrl+'/rest/api/2/myself');
    const headers = proxyUrl
      ? {'Authorization':jiraAuthHeader(cfg),'X-Jira-Base-Url':baseUrl,'Accept':'application/json'}
      : {'Authorization':jiraAuthHeader(cfg),'Accept':'application/json'};
    const res=await fetch(url,{headers});
    if(!res.ok){
      const txt=await res.text();
      throw new Error('HTTP '+res.status+': '+txt.slice(0,200));
    }
    const data=await res.json();
    id('jiraTestStatus').innerHTML='<span class="ai-status ok">\u2713 Connected'+(proxyUrl?' via local proxy':'')+' \u2014 authenticated as '+esc(data.displayName||data.name||'unknown user')+'</span>';
    if(baseUrl) localStorage.setItem('jira_baseUrl',baseUrl);
    localStorage.setItem('jira_email',email);
    if(rawToken&&!rawToken.startsWith('\u2022')) localStorage.setItem('jira_token',rawToken);
    localStorage.setItem('jira_proxyUrl',proxyUrl);
    updateJiraBtnState();
  }catch(e){
    id('jiraTestStatus').innerHTML='<span class="ai-status err">\u2717 '+esc(e.message)+
      ' <br><span style="color:var(--text3);">'+(proxyUrl
        ?'Make sure the local proxy is running (node server.js) and reachable at '+esc(proxyUrl)+'.'
        :'If this looks like a network/CORS failure rather than a 401/403, your JIRA instance is likely blocking direct browser calls \u2014 set a Local Proxy URL above.')+'</span></span>';
  }
}

/* =====================================================================
   JIRA TICKET — AI-drafted summary + create
===================================================================== */
let _jiraDraft=null; // {title, description, rowKey}

function findConflictRow(rowKey){
  return (S._diffRows||[]).find(r=>r.dtype==='conflict'&&r.key===rowKey);
}

function buildConflictContext(row){
  const keyFields = S.comparableFields.filter(f=>f.is_key);
  const keyParts = keyFields.map(f=>{
    const fi=S.comparableFields.indexOf(f);
    const v = SOURCES.map(src=>row.vals[src]?row.vals[src][fi]:null).find(v=>v!==null&&v!==undefined&&v!=='');
    return {label:f.label, value:v||'(unknown)'};
  });

  const conflicts=[];
  S.comparableFields.forEach((f,fi)=>{
    if(!row.fieldConflicts||!row.fieldConflicts[fi]) return;
    const values={};
    SOURCES.forEach(src=>{
      const v=row.vals[src]?row.vals[src][fi]:null;
      values[src]=(v===null||v===undefined||v==='')?'(empty)':String(v);
    });
    conflicts.push({label:f.label, values});
  });

  const mode=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code'
    ?'SKB (Account \u00d7 Company Code)':'SKA (Chart of Accounts)';

  return {key:row.key, mode, keyParts, conflicts};
}

// Plain-text version for the AI prompt (no markup, easy for the model to read)
function conflictContextToPlainText(ctx){
  const lines=[];
  lines.push('Mode: '+ctx.mode);
  ctx.keyParts.forEach(p=>lines.push(p.label+': '+p.value));
  lines.push('Conflicting fields ('+ctx.conflicts.length+'):');
  ctx.conflicts.forEach(c=>{
    lines.push('- '+c.label+': COA='+c.values.COA+', FAQ='+c.values.FAQ+', DataPool='+c.values.DataPool);
  });
  return lines.join('\n');
}

function wikiEscape(v){ return String(v).replace(/\|/g,'\\|').replace(/\n/g,' '); }

// Deterministic JIRA wiki-markup table — built from actual row data, never from the AI,
// so values can never be paraphrased/garbled by the model.
function buildJiraWikiTable(ctx){
  const lines=[];
  lines.push('h3. Discrepancy Details');
  lines.push('*Comparison Key:* '+wikiEscape(ctx.key));
  lines.push('*Mode:* '+wikiEscape(ctx.mode));
  ctx.keyParts.forEach(p=>lines.push('*'+wikiEscape(p.label)+':* '+wikiEscape(p.value)));
  lines.push('');
  lines.push('h3. Conflicting Fields ('+ctx.conflicts.length+')');
  lines.push('||Field||COA Master||FAQ (SAP)||DataPool||');
  ctx.conflicts.forEach(c=>{
    lines.push('|'+wikiEscape(c.label)+'|'+wikiEscape(c.values.COA)+'|'+wikiEscape(c.values.FAQ)+'|'+wikiEscape(c.values.DataPool)+'|');
  });
  return lines.join('\n');
}

async function openJiraTicketModal(rowKey){
  const row=findConflictRow(rowKey);
  if(!row){showToast('Could not find that conflict row','err');return;}
  id('jiraTicketModal').classList.add('open');
  id('jiraTicketBody').innerHTML='<div style="display:flex;align-items:center;gap:10px;padding:20px 0;">'+
    '<div class="file-load-spinner" style="width:20px;height:20px;"></div>'+
    '<span style="font-size:12px;color:var(--text2);">AI is drafting a ticket summary from this conflict&hellip;</span></div>';

  const ctx=buildConflictContext(row);
  const jiraCfg=getJiraCfg();
  if(!jiraCfg.baseUrl||!jiraCfg.token||!jiraCfg.project){
    id('jiraTicketBody').innerHTML='<div class="ai-field"><span class="ai-status err">JIRA isn\'t configured yet \u2014 click <strong>JIRA Config</strong> in the header first (base URL, token, and project key are required).</span></div>';
    return;
  }

  try{
    const plainCtx=conflictContextToPlainText(ctx);
    const prompt='You are drafting a JIRA ticket for a Reference Data Management (RDM) reconciliation conflict. '+
      'Three sources (COA Master = governance reference, FAQ = SAP export, DataPool = ADLS/Databricks Delta tables) disagree on one or more field values for the same record. '+
      'Do NOT restate the raw field values yourself \u2014 a table of exact values will be appended separately. '+
      'Respond with ONLY valid JSON, no markdown fences, no commentary, in this exact shape: '+
      '{"title":"short ticket summary under 100 chars, mention the key and field count","summary":"2-4 sentence narrative explaining what disagrees and why it matters for data governance","recommended_action":"1-3 sentence suggested next step, e.g. which source is likely authoritative or who should confirm (e.g. Ionela for COA mapping questions)"}.\n\n'+
      'Conflict details:\n'+plainCtx;
    const raw=await callAI([{role:'user',content:prompt}]);
    let parsed;
    try{
      parsed=JSON.parse(raw.trim().replace(/^```json\s*/i,'').replace(/```\s*$/,''));
    }catch(e){
      parsed={title:'RDM conflict: '+row.key,summary:raw,recommended_action:''};
    }
    const title=parsed.title||('RDM conflict: '+row.key+' ('+ctx.conflicts.length+' field'+(ctx.conflicts.length!==1?'s':'')+')');
    const table=buildJiraWikiTable(ctx);
    const descParts=[];
    if(parsed.summary) descParts.push(parsed.summary);
    descParts.push(table);
    if(parsed.recommended_action){
      descParts.push('h3. Recommended Action');
      descParts.push(parsed.recommended_action);
    }
    descParts.push('----');
    descParts.push('_Auto-generated by the RDM Reconciliation Tool \u2014 '+ctx.mode+'_');
    _jiraDraft={title, description:descParts.join('\n\n'), rowKey, mode:ctx.mode};
    renderJiraDraftForm();
  }catch(e){
    id('jiraTicketBody').innerHTML='<div class="ai-field"><span class="ai-status err">\u2717 AI drafting failed: '+esc(e.message)+'</span></div>'+
      '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="openJiraTicketModal(\''+rowKey.replace(/'/g,"\\'")+'\')">Retry</button></div>';
  }
}

function renderJiraDraftForm(){
  if(!_jiraDraft) return;
  const jiraCfg=getJiraCfg();
  id('jiraTicketBody').innerHTML=
    '<div class="ai-field"><label>Project</label><div style="font-size:12px;color:var(--text2);">'+esc(jiraCfg.project)+' / '+esc(jiraCfg.issueType)+' &middot; '+esc(_jiraDraft.mode||'')+'</div></div>'+
    '<div class="ai-field"><label>Summary</label><input type="text" id="jiraDraftTitle" value="'+esc(_jiraDraft.title)+'" style="width:100%;box-sizing:border-box;"/></div>'+
    '<div class="ai-field"><label>Description <span style="color:var(--text3);font-weight:400;">(JIRA wiki markup \u2014 h3./*bold*/||table|| render automatically in JIRA)</span></label>'+
      '<textarea id="jiraDraftDesc" rows="18" style="width:100%;min-height:320px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5;padding:10px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;">'+esc(_jiraDraft.description)+'</textarea></div>'+
    '<div id="jiraCreateStatus" style="margin-top:6px;font-size:11px;word-break:break-word;"></div>'+
    '<div style="margin-top:14px;display:flex;gap:8px;">'+
      '<button class="btn btn-primary" onclick="createJiraTicket()">Create JIRA Ticket</button>'+
      '<button class="btn btn-secondary" onclick="openJiraTicketModal(_jiraDraft.rowKey)">Regenerate with AI</button>'+
    '</div>';
}

async function createJiraTicket(){
  const jiraCfg=getJiraCfg();
  const title=id('jiraDraftTitle').value.trim();
  const desc=id('jiraDraftDesc').value;
  if(!title){showToast('Summary cannot be empty','warn');return;}
  id('jiraCreateStatus').innerHTML='<span class="ai-status testing">Creating ticket\u2026</span>';
  try{
    const url = jiraCfg.proxyUrl ? (jiraCfg.proxyUrl+'/api/jira/issue') : (jiraCfg.baseUrl+'/rest/api/2/issue');
    const headers = jiraCfg.proxyUrl
      ? {'Authorization':jiraAuthHeader(jiraCfg),'X-Jira-Base-Url':jiraCfg.baseUrl,'Content-Type':'application/json','Accept':'application/json'}
      : {'Authorization':jiraAuthHeader(jiraCfg),'Content-Type':'application/json','Accept':'application/json'};
    const res=await fetch(url,{
      method:'POST',
      headers,
      body:JSON.stringify({fields:{
        project:{key:jiraCfg.project},
        summary:title,
        description:desc,
        issuetype:{name:jiraCfg.issueType||'Task'},
        labels:['rdm-reconciliation', _jiraDraft&&_jiraDraft.mode&&_jiraDraft.mode.startsWith('SKB')?'rdm-skb':'rdm-ska']
      }})
    });
    if(!res.ok){
      const txt=await res.text();
      throw new Error('HTTP '+res.status+': '+txt.slice(0,300));
    }
    const data=await res.json();
    const link=jiraCfg.baseUrl+'/browse/'+data.key;
    id('jiraCreateStatus').innerHTML='<span class="ai-status ok">\u2713 Created <a href="'+esc(link)+'" target="_blank" rel="noopener">'+esc(data.key)+'</a></span>';
    showToast('JIRA ticket '+data.key+' created','ok');
  }catch(e){
    id('jiraCreateStatus').innerHTML='<span class="ai-status err">\u2717 '+esc(e.message)+
      ' <br><span style="color:var(--text3);">'+(jiraCfg.proxyUrl
        ?'Make sure the local proxy is running and reachable at '+esc(jiraCfg.proxyUrl)+'.'
        :'If this is a network/CORS error, set a Local Proxy URL in JIRA Config (run node server.js locally).')+'</span></span>';
  }
}

function closeJiraTicketModal(){
  id('jiraTicketModal').classList.remove('open');
  _jiraDraft=null;
}

// Returns full message object (content + tool_calls) for the agent loop.
// callAI / callAIWithToken are unchanged and still return a plain string.
async function callAIMessage(messages, tools, toolChoice){
  const cfg=getAICfg();
  if(!cfg.endpoint) throw new Error('AI not configured — click AI Config in the header');
  const token=cfg.mode==='azuread'?await getAzureADToken():cfg.key;
  if(!token) throw new Error('AI not configured — click AI Config in the header');
  const model=cfg.model||'gpt-4.1';
  const body={model,max_completion_tokens:2000,temperature:0.2,messages};
  if(tools&&tools.length){body.tools=tools;body.tool_choice=toolChoice||'auto';}
  const res=await fetch(cfg.endpoint,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify(body)
  });
  if(!res.ok){const err=await res.text();throw new Error('API error '+res.status+': '+err.slice(0,200));}
  const data=await res.json();
  return (data.choices&&data.choices[0]&&data.choices[0].message)||{role:'assistant',content:''};
}

let rdmOpen=false;
let _rdmHistory=[];
let _rdmBusy=false;

/* SQLite (sql.js) — in-browser database for Text-to-SQL Q&A */
let _SQL=null, _diffDb=null, _sqlReady=false;

async function initSQLite(){
  if(_sqlReady) return;
  try{
    if(typeof initSqlJs==='undefined') return;
    _SQL=await initSqlJs({locateFile:f=>'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/'+f});
    _diffDb=new _SQL.Database();
    _sqlReady=true;
  }catch(e){console.warn('sql.js init failed:',e.message);}
}

function buildDiffSQLite(){
  if(!_sqlReady||!_diffDb) return;
  try{
    const cf=S.comparableFields;
    const pfx={COA:'coa',FAQ:'faq',DataPool:'dp'};
    const colDefs=['dtype TEXT','key TEXT'];
    cf.forEach(f=>{
      SOURCES.forEach(src=>colDefs.push(pfx[src]+'_'+f.canonical+' TEXT'));
      colDefs.push('conflict_'+f.canonical+' INTEGER');
    });
    _diffDb.run('DROP TABLE IF EXISTS diff_results');
    _diffDb.run('CREATE TABLE diff_results ('+colDefs.join(',')+')');
    _diffDb.run('CREATE INDEX IF NOT EXISTS idx_dtype ON diff_results(dtype)');
    _diffDb.run('CREATE INDEX IF NOT EXISTS idx_key ON diff_results(key)');
    _diffDb.run('BEGIN');
    let count=0;
    S._diffRows.forEach(row=>{
      const vals=[row.dtype, row.key||''];
      cf.forEach((f,fi)=>{
        SOURCES.forEach(src=>{
          const v=row.vals&&row.vals[src]&&row.vals[src][fi]!=null?String(row.vals[src][fi]):null;
          vals.push(v);
        });
        vals.push(row.fieldConflicts&&row.fieldConflicts[fi]?1:0);
      });
      _diffDb.run('INSERT INTO diff_results VALUES ('+vals.map(()=>'?').join(',')+')',vals);
      if(++count%2000===0){_diffDb.run('COMMIT');_diffDb.run('BEGIN');}
    });
    _diffDb.run('COMMIT');
    updateRdmDbBadge(S._diffRows.length);
    injectSchemaIntoHistory();
  }catch(e){console.warn('buildDiffSQLite failed:',e.message);}
}

function buildSchemaText(){
  const cf=S.comparableFields;
  const n=S._diffRows.length;
  const isSKB=(S.activeMode==='SKB');
  const keyDesc=isSKB
    ? 'key TEXT    -- GL account + Company Code concatenated with NO separator (e.g. "7520005000DE10001"). Use LIKE or SUBSTR to filter by account/coco separately.'
    : 'key TEXT    -- GL account number (e.g. "7520005000")';
  const lines=[
    '## SQLite Schema — diff_results ('+n.toLocaleString()+' rows) — Mode: '+(S.activeMode||'SKB'),
    '',
    "dtype TEXT  -- 'conflict','same','only_COA','only_FAQ','only_DataPool'",
    keyDesc,
    ''
  ];
  cf.forEach(f=>{
    lines.push('coa_'+f.canonical+' TEXT,  faq_'+f.canonical+' TEXT,  dp_'+f.canonical+' TEXT');
    lines.push('conflict_'+f.canonical+' INTEGER  -- 1 if this field differs across sources');
  });
  lines.push('');
  lines.push("Rules: dtype='conflict' = at least one field differs. NULL = that source had no row for this key. Always LIMIT 50. Only query diff_results.");
  return lines.join('\n');
}

function injectSchemaIntoHistory(){
  const schema=buildSchemaText();
  const isSKB=(S.activeMode==='SKB');
  const schemaMsg='## SQLite Database Schema — '+(S.activeMode||'SKB')+' mode\n\n'+schema+'\n\nThis schema is for reference when I call the execute_sql tool. Key column: '+(isSKB?'GL account + Company Code concatenated with no separator (e.g. \"7520005000DE10001\") — use LIKE or SUBSTR to filter separately.':'GL account number (e.g. \"7520005000\")')+'';
  const ackMsg='Understood. I have the diff_results schema for '+(S.activeMode||'SKB')+' mode with '+S.comparableFields.length+' comparable fields. '+(isSKB?'Composite key: GL+CoCo, no separator.':'Key: GL account number.')+' I can call execute_sql, get_row_detail, get_value_distribution, get_conflict_summary, get_field_mapping, and get_coa_filter_stats to investigate. Ready for questions.';
  // Always reset schema at positions [0,1]; preserve any ongoing conversation
  const existingConversation=_rdmHistory.length>2?_rdmHistory.slice(2):[];
  _rdmHistory=[
    {role:'user',content:schemaMsg},
    {role:'assistant',content:ackMsg},
    ...existingConversation
  ];
}

function updateRdmDbBadge(rowCount){
  const el=id('rdmDbBadge');
  if(!el) return;
  if(rowCount>0){
    el.textContent='🗄 DB · '+rowCount.toLocaleString()+' rows';
    el.style.display='inline-block';
  } else {
    el.style.display='none';
  }
}

function execDiffSQL(sql){
  if(!_sqlReady||!_diffDb) return null;
  try{
    const result=_diffDb.exec(sql);
    return {sql,result};
  }catch(e){
    return {sql,error:e.message};
  }
}

function renderSQLResult(sqlResult){
  if(!sqlResult) return '';
  let html='<div class="sql-result">';
  html+='<details class="sql-query-details"><summary>&#9654; Query used</summary><pre class="sql-pre">'+esc(sqlResult.sql)+'</pre></details>';
  if(sqlResult.error){
    html+='<div class="sql-error">&#9888; Query error: '+esc(sqlResult.error)+'</div>';
  } else if(!sqlResult.result||!sqlResult.result.length||!sqlResult.result[0].values.length){
    html+='<div class="sql-empty">No rows returned.</div>';
  } else {
    const {columns,values}=sqlResult.result[0];
    html+='<div class="sql-table-wrap"><table class="sql-table"><thead><tr>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>';
    values.forEach(row=>{
      html+='<tr>'+row.map(v=>'<td>'+(v!=null?esc(String(v)):'<span class="sql-null">null</span>')+'</td>').join('')+'</tr>';
    });
    html+='</tbody></table></div>';
    html+='<div class="sql-rowcount">'+values.length+' row'+(values.length!==1?'s':'')+' returned</div>';
  }
  html+='</div>';
  return html;
}

function toggleRDM(){
  rdmOpen=!rdmOpen;
  id('rdmPanel').classList.toggle('open',rdmOpen);
  const btn=id('rdmBtn');
  if(btn) btn.classList.toggle('connected',rdmOpen);
  if(rdmOpen){rdmRefreshContextBar();buildContextualChips();}
}

function rdmRefreshContextBar(){
  // Bug fix: COA is a reference file (S.refFns.COA_MASTER), not a transactional source (S.fns.COA).
  // Previously the COA chip was always grey because S.fns.COA is always null.
  const coaChip=id('rdmCtxCOA');
  if(coaChip){
    const coaLoaded=!!(S.refFns&&S.refFns.COA_MASTER);
    coaChip.textContent=coaLoaded?'COA ✓':'COA';
    coaChip.classList.toggle('has-data',coaLoaded);
  }
  ['FAQ','DataPool'].forEach(src=>{
    const chip=id('rdmCtx'+src);
    if(!chip) return;
    const label={FAQ:'FAQ',DataPool:'DataPool'}[src];
    const fn=S.fns&&S.fns[src]?S.fns[src]:'';
    chip.textContent=fn?label+' ✓':label;
    chip.classList.toggle('has-data',!!fn);
  });
  // Bug fix: show current mode (SKA/SKB) in context bar so agent panel is always mode-aware
  let modeBadge=id('rdmCtxMode');
  if(!modeBadge){
    modeBadge=document.createElement('span');
    modeBadge.id='rdmCtxMode';
    modeBadge.style.cssText='margin-left:auto;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(255,195,0,0.15);border:1px solid rgba(255,195,0,0.35);color:rgba(255,195,0,0.9);';
    const bar=id('rdmCtxBar');
    if(bar) bar.appendChild(modeBadge);
  }
  modeBadge.textContent=(S.activeMode||'SKB')+' mode';
}

function buildContextualChips(){
  const el=id('rdmWelcomeChips');
  if(!el) return;
  const dc=S.diffCounts;
  const cf=S.comparableFields;
  const chips=[];

  if(!dc||dc.total===0){
    // No comparison run yet — generic chips
    chips.push({e:'📂',l:'What data sources are loaded?',p:'What data sources are currently loaded and what are their key columns?'});
    chips.push({e:'🗺️',l:'Explain the field mapping',p:'Explain the field mapping between COA, FAQ, and DataPool — which fields are being compared?'});
    chips.push({e:'🚀',l:'How to get started',p:'What steps should I follow to run a useful 3-way comparison and interpret the results?'});
    chips.push({e:'🔧',l:'What transforms are applied?',p:'What field transforms are currently configured and what do they do?'});
  } else {
    const pct=((dc.same/dc.total)*100).toFixed(1);

    // Always show match rate
    chips.push({e:'📊',l:'Match rate: '+pct+'%',p:'The match rate is '+pct+'% ('+dc.same.toLocaleString()+' of '+dc.total.toLocaleString()+' rows). What is causing the mismatches and what should I investigate first?'});

    // Conflicts
    if(dc.conflict>0){
      // Find the single top conflict field
      const topField=cf.map((f,fi)=>({f,count:(S._diffRows||[]).filter(r=>r.dtype==='conflict'&&r.fieldConflicts&&r.fieldConflicts[fi]).length}))
        .sort((a,b)=>b.count-a.count)[0];
      chips.push({e:'⚠️',l:dc.conflict.toLocaleString()+' conflict rows',p:'There are '+dc.conflict+' conflict rows. Show me the most common field differences — give me specific key examples with the actual values that differ.'});
      if(topField&&topField.count>0) chips.push({e:'🔍',l:'Top conflict: '+topField.f.label,p:'The field "'+topField.f.label+'" has the most conflicts ('+topField.count+' rows). Show me examples of what values differ and what might be causing this.'});
    }

    // Only-in-X rows
    if(dc.onlyCOA>0) chips.push({e:'📋',l:dc.onlyCOA.toLocaleString()+' COA-only rows',p:'There are '+dc.onlyCOA+' rows that exist only in COA and are missing from FAQ and DataPool. Show me example keys and explain likely reasons.'});
    if(dc.onlyFAQ>0) chips.push({e:'🗂️',l:dc.onlyFAQ.toLocaleString()+' FAQ-only rows',p:'There are '+dc.onlyFAQ+' rows only in FAQ (SAP) but missing from COA and DataPool. Show me examples and suggest possible causes.'});
    if(dc.onlyDP>0)  chips.push({e:'💾',l:dc.onlyDP.toLocaleString()+' DataPool-only rows',p:'There are '+dc.onlyDP+' rows only in DataPool. Are these expected or do they indicate data quality issues?'});

    // Actionable
    chips.push({e:'✅',l:'Recommended actions',p:'Based on the comparison results — '+dc.conflict+' conflicts, '+dc.onlyCOA+' COA-only, '+dc.onlyFAQ+' FAQ-only, '+dc.onlyDP+' DataPool-only — what are the recommended next steps to resolve these data quality issues?'});
  }

  // Render chips using event delegation to avoid quoting issues
  el.innerHTML=chips.map((c,i)=>'<button class="rdm-qp" data-chip-idx="'+i+'">'+c.e+' '+c.l+'</button>').join('');
  el._chips=chips;
  el.onclick=function(e){
    const btn=e.target.closest('.rdm-qp[data-chip-idx]');
    if(!btn) return;
    const chip=el._chips[parseInt(btn.dataset.chipIdx)];
    if(chip) rdmQuickAsk(chip.p);
  };
}

/* Build rich system prompt from current state */
function rdmBuildSystemPrompt(){
  const isSKB=(S.activeMode==='SKB');
  const fns=S.fns||{};
  const refFns=S.refFns||{};
  const cf=S.comparableFields||[];
  const dc=S.diffCounts||{};

  const lines=[
    'You are RDM Agent, an expert Reference & Master Data analyst embedded in a 3-way GL account master reconciliation tool.',
    'Answer questions about the loaded data, comparison results, and data quality issues. Be specific, concise, and actionable.',
    'Format responses using **bold** headers and bullet points where helpful.',
    ''
  ];

  // ── DOMAIN BACKGROUND (always present) ──
  lines.push('## About This Tool');
  lines.push('This tool performs 3-way reconciliation of GL account master data across three authoritative sources:');
  lines.push('- **COA Master** (Common Chart of Accounts Working File): the governance reference, managed in SharePoint. Values here are the agreed-upon standard.');
  lines.push('- **FAQ / SAP**: OData export from the live SAP system. Reflects what SAP currently holds for each account.');
  lines.push('- **DataPool**: ADLS Gen2 Delta tables — the integrated data platform layer downstream of SAP.');
  lines.push('Discrepancies between sources indicate data quality issues (systems out of sync) that need investigation and remediation.');
  lines.push('COA Master is always the reference source (read from a file, never a direct upload). FAQ and DataPool are the transactional sources being checked against it.');
  lines.push('');

  // ── ACTIVE MODE ──
  lines.push('## Active Mode: '+(S.activeMode||'SKB'));
  if(isSKB){
    lines.push('**SKB — Company Code level.** Comparison grain: one row per (GL account × Company Code) pair.');
    lines.push('Key format in results: GL account + Company Code concatenated with NO separator (e.g. `7520005000DE10001` = account `7520005000` + company code `DE10001`).');
    lines.push('Active company codes per account are expanded from the CC-Matrix file (cell = X in company code columns AH–AR).');
    lines.push('Active OE scope for Authorization Group derivation: '+(S.ccMatrixOE||'SERE')+'.');
  } else {
    lines.push('**SKA — Chart of Accounts level.** Comparison grain: one row per GL account.');
    lines.push('Key format: GL account number only (e.g. `7520005000`).');
  }
  lines.push('');

  // ── LOADED FILES ──
  lines.push('## Loaded Files');
  lines.push('- COA Master: '+(refFns.COA_MASTER||'— not loaded'));
  if(isSKB) lines.push('- CC-Matrix: '+(refFns.CC_MATRIX||'— not loaded'));
  lines.push('- FAQ (SAP): '+(fns.FAQ||'— not loaded'));
  lines.push('- DataPool: '+(fns.DataPool||'— not loaded'));
  lines.push('');

  // ── FIELD MAPPING (always present — use resolvedMap if available, fall back to embedded map) ──
  const embFields=(getEmbeddedMap().fields||[]);
  const fields=cf.length?cf:embFields;
  if(fields.length){
    lines.push('## Field Mapping ('+fields.length+' fields in '+(S.activeMode||'SKB')+' mode)');
    lines.push('Format: Label (`canonical`) [type] | COA source | FAQ column | DataPool column');
    fields.forEach(function(f){
      const coaSrc=f.sources&&f.sources.COA;
      let coaDesc='—';
      if(coaSrc===null||coaSrc===undefined){
        coaDesc='not in COA';
      } else if(typeof coaSrc==='string'){
        coaDesc='col "'+coaSrc+'"';
      } else if(coaSrc&&coaSrc.derivation){
        const desc=(coaSrc.derivation.description||'').replace(/\s+/g,' ').trim();
        coaDesc='derived — '+(desc.length>110?desc.slice(0,110)+'…':desc);
      } else if(coaSrc&&coaSrc.column){
        coaDesc='col "'+coaSrc.column+'"'+(coaSrc.file==='CC_MATRIX'?' (CC-Matrix)':'');
      } else if(coaSrc&&coaSrc.mode){
        coaDesc='active_company_codes from CC-Matrix cols AH–AR';
      } else if(coaSrc&&coaSrc.file){
        coaDesc=coaSrc.file;
      }
      const faqCol=(f.sources&&f.sources.FAQ)||'—';
      const dpCol=(f.sources&&f.sources.DataPool)||'—';
      const typeTag=f.is_key?'key,'+f.type:f.type;
      lines.push('- **'+f.label+'** (`'+f.canonical+'`) ['+typeTag+'] | COA: '+coaDesc+' | FAQ: "'+faqCol+'" | DP: "'+dpCol+'"');
    });
    lines.push('');
  }

  // ── COA ROW FILTERS (critical for explaining FAQ-only / DataPool-only rows) ──
  const fs=S.coaFilterStats;
  if(fs&&fs.total>0){
    lines.push('## COA Row Filters Applied');
    lines.push('- Total rows in COA Master: '+fs.total.toLocaleString());
    if(fs.yellowSkipped>0) lines.push('- Yellow/hierarchy rows excluded: '+fs.yellowSkipped.toLocaleString()+' (grouping rows, not real accounts)');
    if(fs.tenDigitSkipped>0) lines.push('- 7-digit accounts excluded: '+fs.tenDigitSkipped.toLocaleString()+' (only 10-digit accounts are in scope)');
    if(fs.strikeSkipped>0) lines.push('- Strikethrough rows excluded: '+fs.strikeSkipped.toLocaleString()+' (retired/deleted accounts)');
    lines.push('- Rows kept for comparison: '+fs.kept.toLocaleString());
    lines.push('IMPORTANT: Accounts excluded by these filters will appear as "FAQ-only" or "DataPool-only" rows if they still exist in SAP or DataPool. This is EXPECTED behaviour — not necessarily a data quality issue.');
    lines.push('');
  }

  // ── ACTIVE COMPARISON SETTINGS ──
  lines.push('## Active Comparison Settings');
  lines.push('- Trim whitespace before comparing: '+(S.trimWhitespace?'ON':'OFF'));
  lines.push('- Case-sensitive comparison: '+(S.caseSensitive?'ON':'OFF'));
  lines.push('- Skip yellow COA rows: '+(S.skipYellow?'ON':'OFF'));
  lines.push('- Skip 7-digit (non-10-digit) accounts: '+(S.skipTenDigit?'ON':'OFF'));
  lines.push('- Skip strikethrough rows: '+(S.skipStrike?'ON':'OFF'));
  lines.push('');

  // ── ACTIVE TRANSFORMS ──
  const modePrefix=(S.activeMode||'SKB')+':';
  const txEntries=Object.entries(S.fieldTransforms||{}).filter(function(e){return e[0].startsWith(modePrefix)&&Object.keys(S.fieldTransforms[e[0]]||{}).length;});
  if(txEntries.length){
    lines.push('## Active Field Transforms ('+txEntries.length+' fields)');
    lines.push('These transforms normalise values before comparison — discrepancies reflect pre-transform differences:');
    txEntries.forEach(function(e){
      const key=e[0], srcs=e[1];
      const canonical=key.slice(modePrefix.length);
      const field=fields.find(function(f){return f.canonical===canonical;});
      const label=field?field.label:canonical;
      const srcDescs=Object.entries(srcs).map(function(se){return se[0]+': '+(se[1].instruction||se[1].fnStr||'custom fn');}).join(' | ');
      lines.push('- **'+label+'**: '+srcDescs);
    });
    lines.push('');
  }

  // ── COMPARISON RESULTS ──
  if(dc.total>0){
    const matchPct=((dc.same/dc.total)*100).toFixed(1);
    lines.push('## Comparison Results');
    lines.push('- Total rows: '+dc.total.toLocaleString());
    lines.push('- Matching (all loaded sources agree): '+dc.same.toLocaleString()+' ('+matchPct+'%)');
    lines.push('- Conflicts (same key, field values differ): '+dc.conflict.toLocaleString());
    lines.push('- COA-only (in COA, absent from FAQ+DataPool): '+dc.onlyCOA.toLocaleString());
    lines.push('- FAQ-only (in FAQ/SAP, absent from COA+DataPool): '+dc.onlyFAQ.toLocaleString());
    lines.push('- DataPool-only (in DataPool, absent from COA+FAQ): '+dc.onlyDP.toLocaleString());
    if(isSKB&&dc.noReference>0) lines.push('- No-reference rows (account in FAQ/DP, not found in COA Master at all): '+dc.noReference.toLocaleString());
    if(isSKB&&dc.unexpectedCoco>0) lines.push('- Unexpected company code rows (account in COA but that company code not active in CC-Matrix): '+dc.unexpectedCoco.toLocaleString());

    if(cf.length){
      const fieldHits=cf.map(function(_,fi){return (S._diffRows||[]).filter(function(r){return r.dtype==='conflict'&&r.fieldConflicts&&r.fieldConflicts[fi];}).length;});
      const topConflicts=cf.map(function(f,fi){return {label:f.label,count:fieldHits[fi]};}).sort(function(a,b){return b.count-a.count;}).slice(0,5).filter(function(x){return x.count>0;});
      if(topConflicts.length) lines.push('- Top conflict fields: '+topConflicts.map(function(x){return '"'+x.label+'" ('+x.count+' rows)';}).join(', '));

      const sampleConflicts=(S._diffRows||[]).filter(function(r){return r.dtype==='conflict';}).slice(0,8);
      if(sampleConflicts.length){
        lines.push('');
        lines.push('**Sample conflict rows:**');
        sampleConflicts.forEach(function(r){
          const keyVal=r.key||'?';
          const diffs=cf.filter(function(_,fi){return r.fieldConflicts&&r.fieldConflicts[fi];}).map(function(f){
            const vals=SOURCES.filter(function(s){return S.activeSources&&S.activeSources.has(s);}).map(function(s){
              const v=r.vals&&r.vals[s]&&r.vals[s][cf.indexOf(f)]!==undefined?r.vals[s][cf.indexOf(f)]:'—';
              return SRC_LABEL[s]+':"'+v+'"';
            });
            return f.label+' ['+vals.join(' vs ')+']';
          }).slice(0,3);
          if(diffs.length) lines.push('  Key "'+keyVal+'": '+diffs.join('; '));
        });
      }
      const onlyCOA=(S._diffRows||[]).filter(function(r){return r.dtype==='only_COA';}).slice(0,5);
      if(onlyCOA.length) lines.push('Sample COA-only keys: '+onlyCOA.map(function(r){return '"'+(r.key||'?')+'"';}).join(', '));
      const onlyDP=(S._diffRows||[]).filter(function(r){return r.dtype==='only_DataPool';}).slice(0,5);
      if(onlyDP.length) lines.push('Sample DataPool-only keys: '+onlyDP.map(function(r){return '"'+(r.key||'?')+'"';}).join(', '));
    }
    lines.push('');
  } else {
    lines.push('## Comparison Results');
    lines.push('No comparison has been run yet. You can still answer questions about the field mapping, SKA vs SKB mode, and what the tool does.');
    lines.push('');
  }

  // ── TOOL GUIDANCE ──
  lines.push('## Available Tools');
  lines.push('You have access to the following tools — use them proactively to investigate rather than guessing from the summary alone:');
  lines.push('- **execute_sql**: run SELECT queries against diff_results SQLite table (always LIMIT 50)'+(isSKB?' — NOTE: key is GL+CoCo concatenated, no separator e.g. "7520005000DE10001"; use LIKE or SUBSTR to filter by account or company code':''));
  lines.push('- **get_row_detail**: get all field values for a specific account key across all sources');
  lines.push('- **get_value_distribution**: count value frequencies for a field in a source (great for root cause analysis)');
  lines.push('- **get_conflict_summary**: ranked list of fields by conflict count, with optional sample rows for one field');
  lines.push('- **get_field_mapping**: full mapping details for a specific field including COA column/derivation rules');
  if(S.coaFilterStats&&S.coaFilterStats.total>0) lines.push('- **get_coa_filter_stats**: COA filter statistics (yellow/7-digit/strikethrough row counts)');
  if(!_sqlReady) lines.push('Note: execute_sql requires a comparison to be run first.');

  return lines.join('\n');
}


function rdmFormatReply(text){
  let html=text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^#{1,3}\s+(.+)$/gm,'<strong style="font-size:12px;color:var(--head-bg)">$1</strong>')
    .replace(/^[\-\*] (.+)$/gm,'<span style="display:block;padding-left:10px">• $1</span>')
    .replace(/^(\d+)\. (.+)$/gm,'<span style="display:block;padding-left:10px">$1. $2</span>')
    .replace(/\n{2,}/g,'<br><br>')
    .replace(/\n/g,'<br>');

  // Wrap known diff row keys as clickable search pills
  if(S._diffRows.length){
    const keySet=new Set(S._diffRows.map(r=>r.key).filter(Boolean));
    // Match quoted keys: "7520005000" or '7520005000'
    html=html.replace(/["""]([^"""]{3,50})["""]/g,(match,inner)=>{
      const plain=inner.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      if(keySet.has(plain)){
        const escaped=plain.replace(/'/g,"\\'");
        return '<button class="key-pill" onclick="searchRowsByKey(\''+escaped+'\')" title="Find in results table">&#128269; '+esc(inner)+'</button>';
      }
      return match;
    });
  }
  return html;
}

function rdmAppendMsg(role,content,isHtml){
  const body=id('rdmBody');
  const followup=body.querySelector('.rdm-followup-strip');
  const div=document.createElement('div');
  div.className='rdm-msg '+role;
  const sender=role==='user'?'You':'🤖 RDM Agent';
  div.innerHTML='<div class="rdm-sender">'+sender+'</div>'
    +'<div class="rdm-bubble">'+(isHtml?content:esc(content))+'</div>';
  if(followup) body.insertBefore(div,followup);
  else body.appendChild(div);
  body.scrollTop=body.scrollHeight;
}

function rdmAppendTyping(elId){
  const body=id('rdmBody');
  const followup=body.querySelector('.rdm-followup-strip');
  const div=document.createElement('div');
  div.className='rdm-msg agent';
  div.id=elId;
  div.innerHTML='<div class="rdm-sender">🤖 RDM Agent</div>'
    +'<div class="rdm-bubble thinking"><div class="rdm-typing">'
    +'<div class="rdm-dot"></div><div class="rdm-dot"></div><div class="rdm-dot"></div>'
    +'</div></div>';
  if(followup) body.insertBefore(div,followup);
  else body.appendChild(div);
  body.scrollTop=body.scrollHeight;
}

function rdmAppendFollowUps(){
  const body=id('rdmBody');
  const old=body.querySelector('.rdm-followup-strip');
  if(old) old.remove();
  const strip=document.createElement('div');
  strip.className='rdm-followup-strip';
  strip.style.cssText='padding:8px 0 4px;display:flex;flex-wrap:wrap;gap:5px;';
  const prompts=[
    {emoji:'📊',label:'Match rate details',prompt:'What is the overall match rate and what fields are driving the most mismatches?'},
    {emoji:'🔍',label:'Root cause',prompt:'What are the likely root causes of the discrepancies found?'},
    {emoji:'📋',label:'Missing rows',prompt:'Summarise which rows are missing from each source and possible reasons.'},
    {emoji:'✅',label:'Recommended actions',prompt:'What are the recommended next steps to resolve these data quality issues?'}
  ];
  strip.innerHTML='<span style="font-size:10px;color:var(--text3);width:100%;margin-bottom:2px;">💡 Ask next:</span>'
    +prompts.map((p,i)=>'<button class="rdm-qp rdm-followup-btn" data-idx="'+i+'" style="font-size:10px;padding:3px 8px;">'+p.emoji+' '+p.label+'</button>').join('');
  // Store prompts on strip element to avoid any quoting issues
  strip._prompts=prompts;
  // Use event delegation — one listener on the strip
  strip.addEventListener('click',function(e){
    const btn=e.target.closest('.rdm-followup-btn');
    if(!btn) return;
    const idx=parseInt(btn.dataset.idx);
    const p=strip._prompts[idx];
    if(p) rdmQuickAsk(p.prompt);
  });
  body.appendChild(strip);
  body.scrollTop=body.scrollHeight;
}

function rdmQuickAsk(prompt){
  const input=id('rdmInput');
  input.value=prompt;
  rdmAutoResize(input);
  sendRDMMessage();
}

function rdmInputKeydown(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendRDMMessage();}
}

function rdmAutoResize(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,120)+'px';
}

const MAX_AGENT_ITERS=6;

async function sendRDMMessage(){
  const input=id('rdmInput');
  const text=input.value.trim();
  if(!text||_rdmBusy) return;

  const cfg=getAICfg();
  if(!cfg||!cfg.endpoint){
    rdmAppendMsg('agent','⚠️ **AI not configured.** Click **⚙ AI Config** in the header to set up your endpoint and key.',true);
    return;
  }

  const welcome=id('rdmWelcome');
  if(welcome) welcome.style.display='none';

  rdmAppendMsg('user',text);
  input.value='';
  input.style.height='auto';
  _rdmHistory.push({role:'user',content:text});

  const thinkId='rdm-think-'+Date.now();
  rdmAppendTyping(thinkId);
  _rdmBusy=true;
  id('rdmSendBtn').disabled=true;

  try{
    const systemPrompt=rdmBuildSystemPrompt();
    // Keep schema entries [0,1] + last 12 conversation turns; tool messages stay local to the loop
    const schemaEntries=_rdmHistory.slice(0,2);
    const conversationEntries=_rdmHistory.slice(2).slice(-12);

    // agentMessages is local — tool call/result turns live here, not in _rdmHistory
    const agentMessages=[{role:'system',content:systemPrompt},...schemaEntries,...conversationEntries];
    const tools=buildRDMTools();

    let finalReply='';
    let iterCount=0;
    let thinkRemoved=false;

    while(iterCount<MAX_AGENT_ITERS){
      iterCount++;
      const isLastIter=(iterCount>=MAX_AGENT_ITERS);
      const toolChoice=isLastIter?'none':'auto';

      const message=await callAIMessage(agentMessages,tools.length?tools:undefined,toolChoice);

      // Remove typing indicator after first LLM response
      if(!thinkRemoved){
        const thinkEl=id(thinkId); if(thinkEl) thinkEl.remove();
        thinkRemoved=true;
      }

      if(message.tool_calls&&message.tool_calls.length&&!isLastIter){
        // Append assistant message with tool_calls to local context
        agentMessages.push({role:'assistant',content:message.content||null,tool_calls:message.tool_calls});

        // Execute each tool call, show step UI, inject result
        for(const tc of message.tool_calls){
          const stepId=rdmAppendToolStep(tc.function.name,tc.function.arguments);
          const result=rdmExecuteTool(tc.function.name,tc.function.arguments);
          rdmUpdateToolStep(stepId,rdmToolResultSummary(tc.function.name,result));
          // Cap result at 3000 chars to avoid bloating context
          const resultStr=JSON.stringify(result).slice(0,3000);
          agentMessages.push({role:'tool',tool_call_id:tc.id,content:resultStr});
        }
        // Continue loop — model will reason over results
      } else {
        // finish_reason = stop (or forced by tool_choice:'none') — final answer
        finalReply=message.content||'';
        break;
      }
    }

    if(!thinkRemoved){const thinkEl=id(thinkId);if(thinkEl)thinkEl.remove();}

    // Render final answer and commit to history
    const formattedText=rdmFormatReply(finalReply);
    rdmAppendMsg('agent',formattedText,true);
    _rdmHistory.push({role:'assistant',content:finalReply});
    rdmAppendFollowUps();

  }catch(e){
    const thinkEl=id(thinkId); if(thinkEl) thinkEl.remove();
    rdmAppendMsg('agent','⚠️ **Error:** '+(e.message||String(e))+'. Check your AI configuration.',true);
  }
  _rdmBusy=false;
  id('rdmSendBtn').disabled=false;
  id('rdmInput').focus();
}

/* Keep old rdmSend alias so any call sites still work */
function rdmSend(msg){
  const input=id('rdmInput'); if(input) input.value=msg;
  sendRDMMessage();
}

