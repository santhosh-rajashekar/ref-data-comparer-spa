/* =====================================================================
   EXPORT CSV
===================================================================== */
function exportCSV(){
  const rows=filteredRows();
  if(!rows.length){showToast('No rows to export','warn');return;}
  const isSKBmode=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code';
  const loaded=SOURCES.filter(s=>{
    if(s==='COA') return isSKBmode
      ? !!S.refWbs.CC_MATRIX&&S.activeSources.has('COA')
      : !!S.refWbs.COA_MASTER&&S.activeSources.has('COA'); // SKA: COA from COA_MASTER
    return S.wbs[s]&&S.activeSources.has(s);
  });
  const headers=['type','key',...S.comparableFields.map(f=>f.label)];
  const lines=[headers.join(',')];
  rows.forEach(row=>{
    const srcs=row.dtype.startsWith('only_')?[row.dtype.replace('only_','')]:
               row.dtype==='same'?['same']:loaded;
    srcs.forEach(src=>{
      const type=row.dtype==='same'?'same':row.dtype==='conflict'?'conflict_'+src:src+'_only';
      const vals=row.vals[src]||[];
      const csvRow=[type,row.key,...S.comparableFields.map((_,fi)=>{
        const v=vals[fi]||'';
        return v.includes(',')||v.includes('"')?'"'+v.replace(/"/g,'""')+'"':v;
      })];
      lines.push(csvRow.join(','));
    });
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='rdm-3way-diff-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  showToast('CSV exported ('+rows.length+' rows)','ok');
}

/* =====================================================================
   EXPORT DROPDOWN HELPERS
===================================================================== */
(function(){
  const menu=document.createElement('div');
  menu.id='exportMenu'; menu.className='export-menu';
  menu.innerHTML=
    '<div class="export-menu-item" onclick="closeExportMenu();exportExcel(true)"><span class="emi-icon">&#9888;</span><span><strong>Conflicts only</strong><br><span style="color:var(--text3);font-size:10px;">Conflict &amp; source-only rows</span></span></div>'+
    '<div class="export-menu-sep"></div>'+
    '<div class="export-menu-item" onclick="closeExportMenu();exportExcel(false)"><span class="emi-icon">&#128196;</span><span><strong>All rows</strong><br><span style="color:var(--text3);font-size:10px;">Full diff including matches</span></span></div>'+
    '<div class="export-menu-sep"></div>'+
    '<div class="export-menu-item" onclick="closeExportMenu();exportCSV()"><span class="emi-icon">&#128202;</span><span>CSV (raw)</span></div>';
  document.body.appendChild(menu);

  const backdrop=document.createElement('div');
  backdrop.id='xprogBackdrop'; backdrop.className='xprog-backdrop';
  backdrop.innerHTML=
    '<div class="xprog-box">'+
      '<div class="xprog-title">&#128196; Generating Excel export\u2026</div>'+
      '<div class="xprog-sub" id="xprogSub">Preparing\u2026</div>'+
      '<div class="xprog-track"><div class="xprog-bar" id="xprogBar"></div></div>'+
      '<div class="xprog-pct" id="xprogPct">0%</div>'+
    '</div>';
  document.body.appendChild(backdrop);
})();
function toggleExportMenu(e){
  e.stopPropagation();
  const menu=id('exportMenu');
  const open=menu.classList.contains('open');
  if(open){ menu.classList.remove('open'); return; }
  const btn=e.currentTarget;
  const r=btn.getBoundingClientRect();
  menu.style.top=(r.bottom+4)+'px';
  menu.style.left='auto';
  menu.style.right=(window.innerWidth-r.right)+'px';
  menu.classList.add('open');
}
function closeExportMenu(){ id('exportMenu').classList.remove('open'); }
document.addEventListener('click',e=>{ const m=id('exportMenu'); if(m&&!e.target.closest('#exportWrap')&&!e.target.closest('#exportMenu')) m.classList.remove('open'); });

/* =====================================================================
   EXPORT EXCEL  (ExcelJS — lazy loaded)
===================================================================== */
const EXCELJS_CDN='https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';

const XL_CLR={
  navy:     'FF1F3864',
  white:    'FFFFFFFF',
  coaBg:    'FFF0FFF4', coaText: 'FF276749', coaBorder: 'FF68D391',
  faqBg:    'FFFFF0F3', faqText: 'FF8C1A30', faqBorder: 'FFF4A0B4',
  dpBg:     'FFEEF4FF', dpText:  'FF1A4D9A', dpBorder:  'FF93B8F5',
  sameBg:   'FFFFFFFF', sameFirst:'FFF0FFF4',
  diffBg:   'FFFFF3CD', diffText: 'FF7D4E00',
  onlyCoa:  'FFF0FFF4', onlyFaq: 'FFFFF5F5', onlyDp: 'FFF5F9FF',
  hdrText:  'FFFFFFFF', subHdr:  'FFD6E4F0', subText: 'FF1F3864',
  gray:     'FFF0F0F0',
};
const XL_SRC={
  COA:      { bg:'coaBg', text:'coaText', label:'COA' },
  FAQ:      { bg:'faqBg', text:'faqText', label:'FAQ (SAP)' },
  DataPool: { bg:'dpBg',  text:'dpText',  label:'DataPool' },
};

function setFill(cell,argb){ cell.fill={type:'pattern',pattern:'solid',fgColor:{argb}}; }
function setFont(cell,argb,opts={}){ cell.font={name:'Arial',size:opts.size||9,color:{argb},bold:!!opts.bold,italic:!!opts.italic}; }
function setBorder(cell,argb='FFD0D7E3'){ const s={style:'thin',color:{argb}}; cell.border={top:s,left:s,bottom:s,right:s}; }
function styleCell(cell,bgArgb,textArgb,opts={}){
  setFill(cell,bgArgb); setFont(cell,textArgb,opts); setBorder(cell);
  cell.alignment={vertical:'middle',wrapText:true};
}
function setXprog(pct,sub){
  id('xprogBar').style.width=pct+'%';
  id('xprogPct').textContent=Math.round(pct)+'%';
  if(sub) id('xprogSub').textContent=sub;
}
async function loadExcelJS(){
  if(window.ExcelJS) return;
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=EXCELJS_CDN; s.onload=res;
    s.onerror=()=>rej(new Error('Failed to load ExcelJS'));
    document.head.appendChild(s);
  });
}
function tick(ms=0){ return new Promise(r=>setTimeout(r,ms)); }

async function exportExcel(conflictsOnly){
  const isSKBmode=(S.activeMapping||getEmbeddedMap()).comparison_grain==='account_company_code';
  const loaded=SOURCES.filter(s=>{
    if(s==='COA') return isSKBmode
      ? !!S.refWbs.CC_MATRIX&&S.activeSources.has('COA')
      : !!S.refWbs.COA_MASTER&&S.activeSources.has('COA');
    return S.wbs[s]&&S.activeSources.has(s);
  });

  const exportRows=conflictsOnly
    ? S._diffRows.filter(r=>r.dtype==='conflict'||r.dtype.startsWith('only_'))
    : S._diffRows;

  if(!exportRows.length){ showToast('No rows to export','warn'); return; }

  const backdrop=id('xprogBackdrop');
  backdrop.classList.add('visible');
  setXprog(0,'Loading export engine…');

  try{
    await loadExcelJS();
    setXprog(5,'Building workbook…'); await tick();

    const wb=new ExcelJS.Workbook();
    wb.creator='RDM QA Tool'; wb.created=new Date();

    await buildSummarySheet(wb,exportRows,loaded,conflictsOnly);
    setXprog(12,'Building diff sheet…'); await tick();

    await buildDiffSheet(wb,exportRows,loaded,(pct,sub)=>{ setXprog(12+pct*0.85,sub); });

    setXprog(97,'Writing file…'); await tick();
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='rdm-diff'+(conflictsOnly?'-conflicts':'-all')+'-'+new Date().toISOString().slice(0,10)+'.xlsx';
    a.click();
    setXprog(100,'Done!'); await tick(300);
    showToast('Excel exported ('+exportRows.length+' rows)','ok');
  } catch(err){
    console.error(err);
    showToast('Export failed: '+err.message,'error');
  } finally{
    backdrop.classList.remove('visible');
  }
}

async function buildSummarySheet(wb,rows,loaded,conflictsOnly){
  const ws=wb.addWorksheet('Summary');
  ws.columns=[{width:28},{width:18}];
  const t=ws.addRow(['RDM 3-Way Diff — Export Summary']);
  t.getCell(1).font={name:'Arial',bold:true,size:13,color:{argb:XL_CLR.hdrText}};
  t.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:XL_CLR.navy}};
  ws.mergeCells('A1:B1'); t.height=28;
  const addMeta=(label,val)=>{
    const r=ws.addRow([label,val]);
    styleCell(r.getCell(1),XL_CLR.subHdr,XL_CLR.subText,{bold:true});
    styleCell(r.getCell(2),XL_CLR.white,'44444400');
  };
  addMeta('Generated',new Date().toLocaleString());
  addMeta('Export scope',conflictsOnly?'Conflicts & source-only rows':'All rows');
  addMeta('Active sources',loaded.map(s=>XL_SRC[s]?.label||s).join(' | '));
  addMeta('Compared fields',S.comparableFields.length+' fields');
  ws.addRow([]);
  const counts=[
    ['Total rows exported',rows.length,null],
    ['✓ Matching rows',rows.filter(r=>r.dtype==='same').length,XL_CLR.sameFirst],
    ['⚠ Conflict rows',rows.filter(r=>r.dtype==='conflict').length,XL_CLR.diffBg],
    ['COA only',rows.filter(r=>r.dtype==='only_COA').length,XL_CLR.onlyCoa],
    ['FAQ only',rows.filter(r=>r.dtype==='only_FAQ').length,XL_CLR.onlyFaq],
    ['DataPool only',rows.filter(r=>r.dtype==='only_DataPool').length,XL_CLR.onlyDp],
  ];
  counts.forEach(([label,val,bg])=>{
    const r=ws.addRow([label,val]);
    const isConf=label.startsWith('⚠');
    styleCell(r.getCell(1),bg||XL_CLR.white,isConf?XL_CLR.diffText:'44444400',{bold:isConf||label.startsWith('Total')});
    styleCell(r.getCell(2),bg||XL_CLR.white,isConf?XL_CLR.diffText:'44444400',{bold:true});
    r.getCell(2).alignment={horizontal:'right',vertical:'middle'};
  });
}

async function buildDiffSheet(wb,rows,loaded,onProgress){
  const ws=wb.addWorksheet(rows.every(r=>r.dtype!=='same')?'Conflicts':'Diff Results');
  const fields=S.comparableFields;
  ws.columns=[
    {header:'Status',key:'status',width:18},
    {header:'Key',key:'key',width:26},
    ...fields.flatMap(f=>loaded.map(src=>({header:f.label+'\n['+(XL_SRC[src]?.label||src)+']',width:22}))),
  ];
  // Header row 1 — field group labels
  const grpRow=ws.addRow(['','',...fields.flatMap(f=>loaded.map((_,i)=>i===0?f.label:''))]);
  grpRow.height=20;
  let col=3;
  fields.forEach(f=>{
    if(loaded.length>1) ws.mergeCells(1,col,1,col+loaded.length-1);
    const c=grpRow.getCell(col);
    c.value=f.label;
    styleCell(c,XL_CLR.subHdr,XL_CLR.subText,{bold:true,size:9});
    c.alignment={horizontal:'center',vertical:'middle'};
    col+=loaded.length;
  });
  styleCell(grpRow.getCell(1),XL_CLR.navy,XL_CLR.hdrText,{bold:true});
  styleCell(grpRow.getCell(2),XL_CLR.navy,XL_CLR.hdrText,{bold:true});
  // Header row 2 — source sub-headers
  const srcRow=ws.addRow(['Status','Key',...fields.flatMap(_=>loaded.map(src=>XL_SRC[src]?.label||src))]);
  srcRow.height=18;
  styleCell(srcRow.getCell(1),XL_CLR.navy,XL_CLR.hdrText,{bold:true});
  styleCell(srcRow.getCell(2),XL_CLR.navy,XL_CLR.hdrText,{bold:true});
  let sc=3;
  fields.forEach(_=>{ loaded.forEach(src=>{ const p=XL_SRC[src]; const c=srcRow.getCell(sc++); styleCell(c,p.bg in XL_CLR?XL_CLR[p.bg]:XL_CLR.dpBg,p.text in XL_CLR?XL_CLR[p.text]:XL_CLR.dpText,{bold:true,size:9}); c.alignment={horizontal:'center',vertical:'middle'}; }); });
  ws.views=[{state:'frozen',ySplit:2}];
  // Data rows — batched
  const BATCH=200;
  for(let i=0;i<rows.length;i+=BATCH){
    rows.slice(i,i+BATCH).forEach(row=>{
      const isConflict=row.dtype==='conflict';
      const isSame=row.dtype==='same';
      const onlySrc=row.dtype.startsWith('only_')?row.dtype.replace('only_',''):null;
      const rowSrcs=onlySrc?[onlySrc]:(isSame?[loaded[0]]:loaded);
      const fc=row.fieldConflicts||[];
      const rowBgMap={COA:XL_CLR.onlyCoa,FAQ:XL_CLR.onlyFaq,DataPool:XL_CLR.onlyDp};
      const statusLabel=isSame?'✓ Match':isConflict?'⚠ Conflict':(onlySrc||'')+ ' Only';
      rowSrcs.forEach((src,si)=>{
        const p=XL_SRC[src]||XL_SRC.COA;
        const srcBg=XL_CLR[p.bg]||XL_CLR.dpBg;
        const srcTxt=XL_CLR[p.text]||XL_CLR.dpText;
        const effectiveBg=isConflict?srcBg:(isSame?XL_CLR.sameBg:(rowBgMap[src]||srcBg));
        const vals=row.vals[src]||[];
        const rowData=[
          si===0?statusLabel:'',
          si===0?(row.key||''):'↑',
          ...fields.flatMap((f,fi)=>loaded.map(lsrc=>lsrc===src?(vals[fi]||''):(isConflict?(row.vals[lsrc]||[])[fi]||'':''))),
        ];
        const exRow=ws.addRow(rowData); exRow.height=18;
        // Status cell
        const sCl=exRow.getCell(1);
        styleCell(sCl,isConflict?XL_CLR.diffBg:(isSame?XL_CLR.sameFirst:effectiveBg),isConflict?XL_CLR.diffText:(isSame?XL_CLR.coaText:srcTxt),{bold:true,size:9});
        sCl.alignment={horizontal:'center',vertical:'middle'};
        // Key cell
        const kCl=exRow.getCell(2);
        styleCell(kCl,si===0?effectiveBg:XL_CLR.gray,si===0?srcTxt:'FFAAAAAA',{bold:si===0,italic:si>0,size:9});
        if(si===0) kCl.font.name='Courier New';
        // Value cells
        let ci=3;
        fields.forEach((_,fi)=>{
          const hasDiff=isConflict&&fc[fi];
          loaded.forEach(()=>{ const c=exRow.getCell(ci++); styleCell(c,hasDiff?XL_CLR.diffBg:effectiveBg,hasDiff?XL_CLR.diffText:srcTxt,{bold:hasDiff,size:9}); });
        });
      });
    });
    onProgress(((i+Math.min(BATCH,rows.length-i))/rows.length)*100,`Writing rows ${Math.min(i+BATCH,rows.length)} of ${rows.length}…`);
    await tick();
  }
}

