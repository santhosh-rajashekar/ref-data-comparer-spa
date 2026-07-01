/* =====================================================================
   MAPPING FILE UPLOAD
===================================================================== */
function loadMappingFile(file){
  if(!file) return;
  const r=new FileReader();
  r.onload=e=>{
    try{
      const parsed=JSON.parse(e.target.result);
      if(!parsed.fields||!Array.isArray(parsed.fields)) throw new Error('Missing "fields" array');
      S.activeMapping=parsed;
      const jdn=id('jsonDropName'); if(jdn){jdn.textContent='\uD83D\uDCC4 '+file.name+' ('+parsed.fields.length+' fields)';jdn.style.display='block';}
      const jrb=id('jsonResetBtn'); if(jrb) jrb.style.display='';
      const jd=id('jsonDrop'); if(jd) jd.classList.add('loaded');
      // Sync compact drop in mapping tab
      const sm=id('jsonDropSm'); if(sm) sm.classList.add('loaded');
      const sml=id('jsonDropSmLabel'); if(sml) sml.textContent=file.name;
      const smr=id('jsonResetBtnSm'); if(smr) smr.style.display='';
      showToast('Mapping loaded: '+parsed.fields.length+' fields','ok');
    }catch(err){
      showToast('Invalid mapping JSON: '+err.message,'err');
    }
  };
  r.readAsText(file);
}

function resetMapping(e){
  e.stopPropagation();
  S.activeMapping=null;
  const jdn=id('jsonDropName'); if(jdn){jdn.style.display='none';}
  const jrb=id('jsonResetBtn'); if(jrb) jrb.style.display='none';
  const jd=id('jsonDrop'); if(jd) jd.classList.remove('loaded');
  const sm=id('jsonDropSm'); if(sm) sm.classList.remove('loaded');
  const sml=id('jsonDropSmLabel'); if(sml) sml.textContent='Mapping JSON';
  const smr=id('jsonResetBtnSm'); if(smr) smr.style.display='none';
  showToast('Mapping reset to embedded SKA defaults','ok');
}

