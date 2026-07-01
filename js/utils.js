/* =====================================================================
   UTILITIES
===================================================================== */
function id(x){return document.getElementById(x);}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function normalise(s){return s.toLowerCase().replace(/\s+/g,' ').trim().replace(/[^a-z0-9 ]/g,'');}

function similarity(a,b){
  const na=normalise(a), nb=normalise(b);
  if(na===nb) return 1;
  if(na.replace(/ /g,'')=== nb.replace(/ /g,'')) return 0.97;
  if(na.includes(nb)||nb.includes(na)) return 0.88;
  const wa=new Set(na.split(' ')), wb=new Set(nb.split(' '));
  const inter=[...wa].filter(w=>wb.has(w)).length;
  const union=new Set([...wa,...wb]).size;
  const j=union>0?inter/union:0;
  if(j>=0.5) return 0.7+j*0.2;
  let m=0;
  for(let i=0;i<Math.min(na.length,nb.length);i++) if(na[i]===nb[i]) m++;
  return m/Math.max(na.length,nb.length,1);
}

function findBestCol(jsonCol, headers){
  if(!jsonCol||!headers.length) return null;
  // Tier 1: exact raw match
  if(headers.includes(jsonCol)) return jsonCol;
  // Tier 2: normalised exact match — handles trailing newlines, casing, extra spaces
  const n = normHdr(jsonCol);
  const normExact = headers.find(h => normHdr(h) === n);
  if(normExact) return normExact;
  // Tier 3: starts-with — handles "(New) To be updated..." suffixes in file headers
  const normPrefix = headers.find(h => normHdr(h).startsWith(n + ' ') || normHdr(h).startsWith(n + '('));
  if(normPrefix) return normPrefix;
  // Tier 4: fuzzy similarity
  let best=null, bestScore=0;
  headers.forEach(h=>{
    const s=similarity(jsonCol,h);
    if(s>bestScore){bestScore=s;best=h;}
  });
  return bestScore>=0.55?best:null;
}

function showToast(msg, type){
  const t=id('toast');
  t.textContent=msg;
  t.className='toast show '+(type||'ok');
  clearTimeout(t._to);
  t._to=setTimeout(()=>{t.className='toast';},3000);
}

function showProgress(title,sub){
  id('progTitle').textContent=title;
  id('progSub').textContent=sub||'';
  id('progOverlay').classList.remove('hidden');
}
function hideProgress(){id('progOverlay').classList.add('hidden');}

function setStep(n){showTab(n);} // legacy shim

