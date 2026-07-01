/* =====================================================================
   AI CONFIG — modal, localStorage persistence, API key + Azure AD
===================================================================== */
function getAICfg(){
  return{
    endpoint: localStorage.getItem('ai_endpoint')||'',
    key:      localStorage.getItem('ai_key')||'',
    mode:     localStorage.getItem('ai_mode')||'apikey',
    clientId: localStorage.getItem('ai_clientId')||'',
    tenantId: localStorage.getItem('ai_tenantId')||'',
    model:    localStorage.getItem('ai_model')||'gpt-4.1'
  };
}

function setAuthMode(mode){
  localStorage.setItem('ai_mode',mode);
  const isKey=mode==='apikey';
  id('panelApiKey').style.display=isKey?'':'none';
  id('panelAzureAD').style.display=isKey?'none':'';
  id('modeApiKey').style.cssText='flex:1;font-family:inherit;font-size:12px;padding:7px 0;border:none;cursor:pointer;transition:all 0.15s;background:'+(isKey?'var(--head-bg)':'var(--page-bg)')+';color:'+(isKey?'#fff':'var(--text2)')+';font-weight:'+(isKey?'600':'400')+';';
  id('modeAzureAD').style.cssText='flex:1;font-family:inherit;font-size:12px;padding:7px 0;border:none;cursor:pointer;transition:all 0.15s;background:'+(isKey?'var(--page-bg)':'var(--head-bg)')+';color:'+(isKey?'var(--text2)':'#fff')+';font-weight:'+(isKey?'400':'600')+';';
}

function openAIConfig(){
  const cfg=getAICfg();
  id('aiEndpoint').value=cfg.endpoint;
  id('aiModel').value=cfg.model;
  id('aiKey').value=cfg.key?'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022':'';
  id('aiClientId').value=cfg.clientId;
  id('aiTenantId').value=cfg.tenantId;
  id('aiTestStatus').innerHTML='';
  setAuthMode(cfg.mode);
  id('aiConfigModal').classList.add('open');
  refreshMsalUserInfo();
}

function closeAIConfig(){
  const ep=id('aiEndpoint').value.trim();
  const key=id('aiKey').value.trim();
  const model=id('aiModel').value.trim();
  const cid=id('aiClientId').value.trim();
  const tid=id('aiTenantId').value.trim();
  if(ep) localStorage.setItem('ai_endpoint',ep);
  if(model) localStorage.setItem('ai_model',model);
  if(key&&!key.startsWith('\u2022')) localStorage.setItem('ai_key',key);
  if(cid) localStorage.setItem('ai_clientId',cid);
  if(tid) localStorage.setItem('ai_tenantId',tid);
  id('aiConfigModal').classList.remove('open');
  updateAIBtnState();
}

function clearAIConfig(){
  ['ai_endpoint','ai_key','ai_mode','ai_clientId','ai_tenantId','ai_model'].forEach(k=>localStorage.removeItem(k));
  id('aiEndpoint').value=''; id('aiKey').value='';
  id('aiModel').value=''; id('aiClientId').value=''; id('aiTenantId').value='';
  id('aiTestStatus').innerHTML='';
  _msalInstance=null; _msalAccount=null;
  refreshMsalUserInfo(); setAuthMode('apikey'); updateAIBtnState();
  showToast('AI config cleared','warn');
}

function updateAIBtnState(){
  const btn=id('aiCfgBtn'); if(!btn) return;
  const cfg=getAICfg();
  const ready=cfg.endpoint&&(
    (cfg.mode==='apikey'&&cfg.key)||
    (cfg.mode==='azuread'&&cfg.clientId&&cfg.tenantId&&_msalAccount)
  );
  if(ready){btn.classList.add('connected');btn.title='AI connected — click to reconfigure';}
  else{btn.classList.remove('connected');btn.title='Configure AI Transform';}
}

// MSAL / Azure AD
let _msalInstance=null, _msalAccount=null;

function getMsalInstance(){
  const cfg=getAICfg();
  if(!cfg.clientId||!cfg.tenantId) throw new Error('Enter Client ID and Tenant ID first');
  if(_msalInstance) return _msalInstance;
  if(typeof msal==='undefined') throw new Error('MSAL library not loaded');
  const isFile=window.location.protocol==='file:';
  const redirectUri=isFile?'https://login.microsoftonline.com/common/oauth2/nativeclient':window.location.href.split('?')[0].split('#')[0];
  _msalInstance=new msal.PublicClientApplication({
    auth:{clientId:cfg.clientId,authority:'https://login.microsoftonline.com/'+cfg.tenantId,redirectUri},
    cache:{cacheLocation:'localStorage',storeAuthStateInCookie:false}
  });
  return _msalInstance;
}

async function msalSignIn(){
  try{
    const inst=getMsalInstance();
    const resp=await inst.loginPopup({scopes:['https://cognitiveservices.azure.com/.default']});
    _msalAccount=resp.account;
    refreshMsalUserInfo(); updateAIBtnState();
  }catch(e){showToast('MSAL login failed: '+e.message,'err');}
}

async function getAzureADToken(){
  const inst=getMsalInstance();
  const req={scopes:['https://cognitiveservices.azure.com/.default'],account:_msalAccount};
  try{const r=await inst.acquireTokenSilent(req);_msalAccount=r.account;return r.accessToken;}
  catch(e){const r=await inst.acquireTokenPopup(req);_msalAccount=r.account;return r.accessToken;}
}

function refreshMsalUserInfo(){
  const el=id('msalUserInfo'), btn=id('msalLoginBtn');
  if(!el||!btn) return;
  if(_msalAccount){
    el.style.display=''; el.innerHTML='\u2713 Signed in as <strong>'+esc(_msalAccount.username)+'</strong>';
    btn.textContent='\uD83D\uDD04 Switch account';
  } else {
    el.style.display='none'; btn.textContent='\uD83C\uDF10 Login with Microsoft';
  }
}

async function testAIConnection(){
  const ep=id('aiEndpoint').value.trim();
  const mode=localStorage.getItem('ai_mode')||'apikey';
  if(!ep){id('aiTestStatus').innerHTML='<span class="ai-status err">Enter endpoint URL first</span>';return;}
  id('aiTestStatus').innerHTML='<span class="ai-status testing">Testing\u2026</span>';
  try{
    let token;
    if(mode==='azuread'){token=await getAzureADToken();}
    else{
      const raw=id('aiKey').value.trim();
      token=raw.startsWith('\u2022')?getAICfg().key:raw;
      if(!token) throw new Error('Enter an API key or Azure CLI token');
    }
    await callAIWithToken([{role:'user',content:'Reply with just the word: OK'}],ep,token);
    id('aiTestStatus').innerHTML='<span class="ai-status ok">\u2713 Connected \u2014 '+(id('aiModel').value.trim()||'gpt-4.1')+' responding</span>';
    localStorage.setItem('ai_endpoint',ep);
    if(mode==='apikey'&&!id('aiKey').value.startsWith('\u2022')) localStorage.setItem('ai_key',id('aiKey').value.trim());
    const cid=id('aiClientId').value.trim(), tid=id('aiTenantId').value.trim();
    if(cid) localStorage.setItem('ai_clientId',cid);
    if(tid) localStorage.setItem('ai_tenantId',tid);
    updateAIBtnState();
  }catch(e){
    id('aiTestStatus').innerHTML='<span class="ai-status err">\u2717 '+esc(e.message)+'</span>';
  }
}

async function callAIWithToken(messages,endpoint,token,modelOverride){
  if(!endpoint||!token) throw new Error('AI not configured');
  const model=modelOverride||getAICfg().model||'gpt-4.1';
  const res=await fetch(endpoint,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify({model,max_completion_tokens:2000,temperature:0.2,messages})
  });
  if(!res.ok){const err=await res.text();throw new Error('API error '+res.status+': '+err.slice(0,200));}
  const data=await res.json();
  return data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content||'';
}

async function callAI(messages){
  const cfg=getAICfg();
  if(!cfg.endpoint) throw new Error('AI not configured — click AI Config in the header');
  const token=cfg.mode==='azuread'?await getAzureADToken():cfg.key;
  if(!token) throw new Error('AI not configured — click AI Config in the header');
  return callAIWithToken(messages,cfg.endpoint,token);
}

