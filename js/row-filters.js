/* =====================================================================
   OPTIONS TOGGLES & ROW FILTERS
===================================================================== */
function toggleOpt(stateKey, wrapId){
  S[stateKey]=!S[stateKey];
  const wrap=id(wrapId);
  if(wrap) wrap.classList.toggle('on', S[stateKey]);
  const cb=id(stateKey); if(cb) cb.checked=S[stateKey];
}

let _rfId=0;
const S_rowFilters=[];

function addRowFilter(){
  const loaded=SOURCES.filter(s=>S.wbs[s]&&S.activeSources.has(s));
  if(!loaded.length){showToast('Upload files first','warn');return;}
  const id_=++_rfId;
  const srcOpts=loaded.map(s=>'<option value="'+s+'">'+SRC_LABEL[s]+'</option>').join('');
  const firstSrc=loaded[0];
  const colOpts=(S.headers[firstSrc]||[]).map(h=>'<option value="'+esc(h)+'">'+esc(h)+'</option>').join('');
  const chip=document.createElement('div');
  chip.className='rf-chip'; chip.id='rf-'+id_;
  chip.innerHTML=
    '<select onchange="rfUpdateCols('+id_+',this.value)">'+srcOpts+'</select>'+
    '<select id="rfc-'+id_+'">'+colOpts+'</select>'+
    '<select id="rfo-'+id_+'"><option value="contains">contains</option><option value="equals">equals</option><option value="starts">starts with</option><option value="notcontains">not contains</option></select>'+
    '<input type="text" id="rfv-'+id_+'" placeholder="value…" style="width:100px;">'+
    '<button onclick="removeRowFilter('+id_+')">&#215;</button>';
  const list=document.getElementById('rowFilterList');
  if(list.querySelector('span')) list.innerHTML='';
  list.appendChild(chip);
  S.rowFilters.push({id:id_});
}

function rfUpdateCols(rfid, src){
  const sel=document.getElementById('rfc-'+rfid);
  if(!sel) return;
  sel.innerHTML=(S.headers[src]||[]).map(h=>'<option value="'+esc(h)+'">'+esc(h)+'</option>').join('');
}

function removeRowFilter(rfid){
  const el=document.getElementById('rf-'+rfid);
  if(el) el.remove();
  S.rowFilters=S.rowFilters.filter(r=>r.id!==rfid);
  const list=document.getElementById('rowFilterList');
  if(!list.children.length) list.innerHTML='<span style="font-size:11px;color:var(--text3);font-style:italic;">No filters — all rows will be compared.</span>';
}

function getActiveRowFilters(){
  const chips=document.querySelectorAll('.rf-chip');
  const filters=[];
  chips.forEach(chip=>{
    const sels=chip.querySelectorAll('select');
    const inp=chip.querySelector('input');
    if(sels.length>=3&&inp&&inp.value.trim()){
      filters.push({src:sels[0].value, col:sels[1].value, op:sels[2].value, val:inp.value.trim()});
    }
  });
  return filters;
}

function passesRowFilters(src, row, filters){
  if(!filters.length) return true;
  return filters.every(f=>{
    if(f.src!==src) return true;
    const hi=S.headers[src].indexOf(f.col);
    if(hi<0) return true;
    const cell=(row[hi]||'').toLowerCase();
    const fv=f.val.toLowerCase();
    if(f.op==='contains') return cell.includes(fv);
    if(f.op==='equals') return cell===fv;
    if(f.op==='starts') return cell.startsWith(fv);
    if(f.op==='notcontains') return !cell.includes(fv);
    return true;
  });
}

