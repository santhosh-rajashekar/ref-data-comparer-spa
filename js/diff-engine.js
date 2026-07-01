/* =====================================================================
   SKB COMPARISON ENGINE  (v5 — (account, company_code) grain)
===================================================================== */

const KEY_NOSEP_WARN = {};  // suppress duplicate warnings

function tick(ms) { return new Promise(r => setTimeout(r, ms || 20)); }

async function runDiff() {
  const mapping = S.activeMapping || getEmbeddedMap();
  const isSKB   = mapping.comparison_grain === 'account_company_code';

  // Always read current UI key column selections into S.keyFields first
  // (applies to both SKB and flat modes — UI selection always takes precedence)
  TX_SOURCES.forEach(src => {
    const k0  = (id('key' + src + '0') || {}).value || '';
    const k1  = (id('key' + src + '1') || {}).value || '';
    const sep = (id('sep' + src)       || {}).value || '';
    S.keyFields[src] = k0 ? {cols: [k0, k1].filter(Boolean), sep} : {cols: [], sep};
  });

  S.comparableFields = S.resolvedMap.filter(f => {
    if (S.excludedFields.has(f.canonical)) return false;
    if (isSKB) {
      const coaOk = f.sources.COA !== null && !!S.refWbs.CC_MATRIX;
      const txOk  = TX_SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s) && f.sources[s]).length;
      return (coaOk ? 1 : 0) + txOk >= 2;
    }
    // SKA: COA comes from S.refWbs.COA_MASTER, not S.wbs['COA']
    const coaOk = f.sources.COA !== null && !!S.refWbs.COA_MASTER;
    const txOk2  = TX_SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s) && f.sources[s]).length;
    return (coaOk ? 1 : 0) + txOk2 >= 2;
  });

  if (!S.comparableFields.length) {
    showToast('No comparable fields. Adjust column mappings.', 'err');
    return;
  }

  if (isSKB) {
    await runDiffSKB(mapping);
  } else {
    await runDiffFlat(mapping);
  }
}

/* ── Reference file parsing ── */

// Normalise a header string for COA column matching:
// collapse all whitespace variants (\r\n, \n, \r, tabs, runs of spaces) → single space, trim, lowercase.
function normHdr(s){ return s == null ? '' : String(s).replace(/\s+/g,' ').trim().toLowerCase(); }

// Resolve a COA column name → array index with 4-tier fallback:
//   1. Exact normalised match (case + whitespace insensitive)
//   2. Starts-with: actual header begins with the mapping name
//      (handles "(New) To be updated for next release" suffixes in COA file)
//   3. Fuzzy similarity ≥ 0.55 (handles minor naming differences)
//   4. Returns -1 if nothing matches
function coaColIdx(colName, headerIdx, headers) {
  if (!colName) return -1;
  const n = normHdr(colName);
  if (!n) return -1;
  // Tier 1: exact normalised match
  if (headerIdx.has(n)) return headerIdx.get(n);
  // Tier 2: actual header starts with the mapping column name
  for (const [hNorm, idx] of headerIdx) {
    if (hNorm.startsWith(n + ' ') || hNorm.startsWith(n + '(') || hNorm === n) return idx;
  }
  // Tier 3: fuzzy similarity
  let best = -1, bestScore = 0;
  headers.forEach((h, i) => {
    const s = similarity(colName, h);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return bestScore >= 0.55 ? best : -1;
}

function buildCoaMasterMap(mapping) {
  const cfg = mapping.reference_files.COA_MASTER;
  const wb  = S.refWbs.COA_MASTER;
  if (!wb) return {map: new Map(), headers: [], headerIdx: new Map(), excludedAccts: new Set()};
  // Support both cfg.sheet (name) and cfg.sheet_index (SKA uses index)
  // Priority: user-selected sheet from UI selector → cfg.data_sheet name → cfg.sheet_index → 0
  const selEl = id('sheet-COA_MASTER');
  let wsName;
  if (selEl && selEl.value !== '' && selEl.value !== '—' && wb.SheetNames[parseInt(selEl.value)]) {
    wsName = wb.SheetNames[parseInt(selEl.value)];
  } else {
    wsName = cfg.sheet || wb.SheetNames[cfg.sheet_index || 0];
  }
  const ws = wb.Sheets[wsName];
  if (!ws) return {map: new Map(), headers: [], headerIdx: new Map(), excludedAccts: new Set()};
  const allRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null, raw:false});
  const headers = (allRows[cfg.header_row] || []).map(h => h == null ? '' : String(h));
  // Build normalised-name → index lookup for robust COA column resolution
  const headerIdx = new Map();
  headers.forEach((h, i) => { const n = normHdr(h); if (n && !headerIdx.has(n)) headerIdx.set(n, i); });

  // ── COA row filters: yellow (hierarchy), 10-digit only, strikethrough ──
  // Find "7 digit / 10 digit Accounts" column.
  // Primary: from chart_of_account derivation in resolvedMap (SKA).
  // Fallback: direct header name lookup — covers SKB where chart_of_account is not in SKB_MAP.
  let tenDigitColIdx = -1;
  if (S.skipTenDigit) {
    const chartField = (S.resolvedMap || []).find(f => f.canonical === 'chart_of_account');
    if (chartField && chartField.sources.COA && chartField.sources.COA.derivation) {
      const srcCol = ((chartField.sources.COA.derivation.conditions || [])[0] || {}).source_col || '';
      if (srcCol) tenDigitColIdx = headerIdx.has(normHdr(srcCol)) ? headerIdx.get(normHdr(srcCol)) : -1;
    }
    // Fallback for SKB: search well-known column name directly in COA Master headers
    if (tenDigitColIdx < 0) {
      const fallbackKey = normHdr('7 digit  10 digit Accounts');
      if (headerIdx.has(fallbackKey)) tenDigitColIdx = headerIdx.get(fallbackKey);
    }
  }
  const doYellow   = S.skipYellow;
  const doTenDigit = S.skipTenDigit && tenDigitColIdx >= 0;
  const doStrike   = S.skipStrike;

  let total = 0, yellowSkipped = 0, tenDigitSkipped = 0, strikeSkipped = 0;

  const map = new Map();
  const excludedAccts = new Set(); // filtered-out account keys — used by buildCOASideRows (SKB)
  for (let ri = cfg.header_row + 1; ri < allRows.length; ri++) {
    const row  = allRows[ri];
    const acct = row[cfg.account_key_col_index];
    if (acct === null || acct === undefined || acct === '') continue;
    const acctKey = String(acct).trim().replace(/\.0$/, '');
    total++;

    // Yellow / hierarchy rows
    if (doYellow && isYellowRow(ws, ri)) { yellowSkipped++; excludedAccts.add(acctKey); continue; }
    // 10-digit accounts only (skip 7-digit / non-10-digit)
    if (doTenDigit) {
      const val = String(row[tenDigitColIdx] || '').toLowerCase().trim();
      if (!val.includes('10 digit')) { tenDigitSkipped++; excludedAccts.add(acctKey); continue; }
    }
    // Strikethrough — struck-out rows are retired/removed accounts
    if (doStrike && isStrikeRow(ws, ri)) { strikeSkipped++; excludedAccts.add(acctKey); continue; }

    map.set(acctKey, row);
  }

  // Update the filter stats shown in the summary bar
  S.coaFilterStats = {total, yellowSkipped, tenDigitSkipped, strikeSkipped, kept: map.size};
  updateCoaFilterStats();

  return {map, headers, headerIdx, excludedAccts};
}

function buildCoaSideFlat(mapping, coaMasterMap, coaHeaders, coaHeaderIdx) {
  // SKA only: build Map<acctKey, valArray> parallel to S.comparableFields
  const result = new Map();
  if (!coaMasterMap.size) return result;

  for (const [acctKey, rawRow] of coaMasterMap) {
    // Store as {[canonical]: value} so getFieldSamples can look up by canonical name
    const rowObj = {};
    for (const f of S.comparableFields) {
      if (!f.sources.COA || typeof f.sources.COA !== 'object') { rowObj[f.canonical] = null; continue; }
      const coaSrc = f.sources.COA;
      let val = null;

      if (f.type === 'coa_lookup') {
        // Name-first: always try the column name; fall back to column_index only if name not found
        let colIdx = coaColIdx(coaSrc.column, coaHeaderIdx, coaHeaders);
        if (colIdx < 0 && coaSrc.column_index != null) colIdx = coaSrc.column_index;
        if (colIdx >= 0) {
          const raw = rawRow[colIdx];
          // Empty cell → '' (renders blank); null stays null only when column wasn't found at all
          val = raw != null && raw !== '' ? String(raw).trim() : '';
        }
      } else if (f.type === 'coa_derived') {
        const drv = coaSrc.derivation;
        if (drv) {
          if (drv.rule === 'if_else_chain') {
            for (const cond of (drv.conditions || [])) {
              // Name-first for derivation source cols too
              let ci = coaColIdx(cond.source_col, coaHeaderIdx, coaHeaders);
              if (ci < 0 && cond.source_col_index != null) ci = cond.source_col_index;
              if (ci < 0) continue;
              const v = rawRow[ci];
              if (v != null && String(v).trim().toUpperCase() === String(cond.match_value).toUpperCase()) {
                val = cond.result; break;
              }
            }
            if (val === null && drv.default != null) val = String(drv.default);
          } else if (drv.rule === 'multi_condition') {
            for (const cond of (drv.conditions || [])) {
              const match = (cond.when || []).every(w => {
                const ci = coaColIdx(w.col, coaHeaderIdx, coaHeaders);
                if (ci < 0) return false;
                const v = String(rawRow[ci] ?? '').trim();
                if (w.eq != null) return v === String(w.eq);
                if (w.in != null) return w.in.map(String).includes(v);
                return false;
              });
              if (match) { val = String(cond.result); break; }
            }
            if (val === null && drv.default != null) val = String(drv.default);
          }
        }
      }
      rowObj[f.canonical] = val;
    }
    result.set(acctKey, rowObj);
  }
  return result;
}

function buildCCMatrixData(mapping) {
  const cfg = mapping.reference_files.CC_MATRIX;
  const wb  = S.refWbs.CC_MATRIX;
  if (!wb) return null;
  // Priority: user-selected sheet → cfg.data_sheet by name → sheet 0
  const ccSelEl = id('sheet-CC_MATRIX');
  let ccWsName;
  if (ccSelEl && ccSelEl.value !== '' && ccSelEl.value !== '—' && wb.SheetNames[parseInt(ccSelEl.value)]) {
    ccWsName = wb.SheetNames[parseInt(ccSelEl.value)];
  } else {
    ccWsName = cfg.data_sheet || wb.SheetNames[0];
  }
  const ws = wb.Sheets[ccWsName];
  if (!ws) return null;
  const allRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null, raw:false});

  // Company codes from row 1 (0-based index cfg.company_code_header_row)
  const ccRow       = allRows[cfg.company_code_header_row] || [];
  const startIdx    = cfg.company_code_col_start_index;
  const endIdx      = cfg.company_code_col_end_index;
  const companyCodes= [];
  for (let ci = startIdx; ci <= endIdx; ci++) {
    if (ccRow[ci]) companyCodes.push({code: String(ccRow[ci]).trim(), colIdx: ci});
  }

  // Attribute header row (index 4)
  const attrHdrRow  = allRows[cfg.attribute_header_row] || [];

  // Build account map from data rows
  const accountMap  = new Map();
  for (let ri = cfg.attribute_header_row + 1; ri < allRows.length; ri++) {
    const row  = allRows[ri];
    if (!row) continue;
    const acct = row[cfg.account_key_col_index];
    if (acct === null || acct === undefined) continue;
    const acctKey = String(acct).trim().replace(/\.0$/, '');
    if (!acctKey || acctKey === '0') continue;

    // AH-AR (per account row) holds SERE-specific company-code data. A populated cell
    // means this company code applies to this account; its value is the per-company-code
    // Open Item Management override (falls back to the AS-AV base value when blank).
    // This is NOT a generic active/inactive flag and NOT a separate "Different Setting
    // per CoCo" sheet (that sheet doesn't exist — see below) — it's all in this block.
    const activeCoCos   = new Set();
    const cocoOverrides = new Map();
    for (const {code, colIdx} of companyCodes) {
      const cell = row[colIdx];
      const v = cell !== null && cell !== undefined ? String(cell).trim() : '';
      if (v) {
        activeCoCos.add(code);
        cocoOverrides.set(code, v);
      }
    }

    // Attribute values live in columns AS-AV (idx 44-47), headers in row 5 (attribute_header_row).
    // Columns D-AG (idx 3-32) are hidden/stale and must not be read.
    const attrs = {};
    for (let ci = 44; ci <= 47; ci++) {
      const hdr = attrHdrRow[ci];
      if (hdr) {
        const v = row[ci];
        attrs[String(hdr).trim()] = v !== null && v !== undefined ? String(v).trim() : null;
      }
    }
    accountMap.set(acctKey, {activeCoCos, attrs, cocoOverrides});
  }

  return {companyCodes, accountMap};
}

function applyDerivation(row, derivation, coaHeaderIdx, coaHeaders) {
  if (!derivation || !row) return null;

  if (derivation.rule === 'if_else_chain') {
    // ── Step 1: OE-specific column (Authorization Group pattern) ───────────
    // Use the OE selected by the user on the CC-Matrix upload panel.
    // This tells us exactly which column to read — no guessing.
    const oeMap = derivation.oe_specific_cols;
    if (oeMap && coaHeaderIdx) {
      const selectedOE  = S.ccMatrixOE || 'SERE';
      const colName     = oeMap[selectedOE];
      if (colName) {
        const ci = coaColIdx(colName, coaHeaderIdx, coaHeaders);
        if (ci >= 0) {
          const v = row[ci];
          const filled = v !== null && v !== undefined && String(v).trim() !== '';
          if (filled) {
            const val = String(v).trim().toUpperCase();
            if (val === 'GL')  return '';
            if (val === 'FPG') return 'ZFPG';
            return String(v).trim(); // unexpected non-empty value — preserve it
          }
          // OE column is empty → fall through to standard conditions
        }
      }
    }

    // ── Step 2: Standard if_else_chain conditions ──────────────────────────
    // e.g. "Closed in FPG" = X → "ZFPG", "Closed in G/L" = X → ""
    for (const cond of derivation.conditions) {
      let ci = (coaHeaderIdx && cond.source_col) ? coaColIdx(cond.source_col, coaHeaderIdx, coaHeaders) : -1;
      if (ci < 0 && cond.source_col_index != null) ci = cond.source_col_index;
      if (ci < 0) continue;
      const v = row[ci];
      if (v !== null && v !== undefined && String(v).trim().toUpperCase() === String(cond.match_value).toUpperCase()) return cond.result;
    }
    return derivation.default !== undefined ? derivation.default : null;
  }

  return null;
}

function buildCOASideRows(mapping, coaMasterMap, coaHeaders, coaHeaderIdx, ccData, excludedAccts) {
  if (!ccData) return new Map();
  const coaSideMap = new Map();
  const compFields = S.comparableFields;

  for (const [acct, ccEntry] of ccData.accountMap) {
    // Skip accounts that were filtered out in buildCoaMasterMap (yellow, 7-digit, strikethrough)
    if (excludedAccts && excludedAccts.has(acct)) continue;
    const coaRow = coaMasterMap.get(acct);
    for (const coco of ccEntry.activeCoCos) {
      const key = acct + coco; // no separator
      const fv  = {};
      for (const f of compFields) {
        const coaSrc = f.sources.COA;
        if (!coaSrc) { fv[f.canonical] = null; continue; }
        switch (f.type) {
          case 'dimension':
            fv[f.canonical] = coco; break;
          case 'cc_matrix_lookup': {
            let val = ccEntry.attrs[coaSrc.column] ?? null;
            if (coaSrc.has_coco_override && ccEntry.cocoOverrides && ccEntry.cocoOverrides.has(coco)) {
              val = ccEntry.cocoOverrides.get(coco);
            }
            fv[f.canonical] = val; break;
          }
          case 'coa_lookup': {
            // Name-first: resolve by column name; fall back to column_index only if name not found
            let ci = coaColIdx(coaSrc.column, coaHeaderIdx, coaHeaders);
            if (ci < 0 && coaSrc.column_index != null) ci = coaSrc.column_index;
            fv[f.canonical] = (coaRow && ci >= 0)
              ? (coaRow[ci] != null ? String(coaRow[ci]).trim() : '')
              : null;
            break;
          }
          case 'coa_derived':
            fv[f.canonical] = coaRow && coaSrc.derivation ? applyDerivation(coaRow, coaSrc.derivation, coaHeaderIdx, coaHeaders) : null;
            break;
          default:
            fv[f.canonical] = null;
        }
      }
      coaSideMap.set(key, fv);
    }
  }
  return coaSideMap;
}

function buildSourceMap(src, mapping) {
  const map = new Map();
  if (!S.wbs[src] || !S.activeSources.has(src)) return map;
  const rows    = getSourceRows(src);
  const hdrs    = S.headers[src];
  // Priority: UI selection (S.keyFields) → mapping.key_fields fallback → row index
  let keyIdxs = [];
  const uiKey = S.keyFields[src];
  if (uiKey && uiKey.cols && uiKey.cols.length) {
    // User has selected key columns in the UI — use those
    keyIdxs = uiKey.cols.map(k => {
      let idx = hdrs.indexOf(k);
      if (idx < 0) idx = hdrs.findIndex(h => normalise(h) === normalise(k));
      return idx;
    }).filter(i => i >= 0);
  } else {
    // Fallback: auto-resolve from mapping.key_fields (used on first run before UI interaction)
    const keyDef = mapping.key_fields?.[src];
    if (keyDef && keyDef.length) {
      keyIdxs = keyDef.map(col => {
        let idx = hdrs.indexOf(col);
        if (idx < 0) idx = hdrs.findIndex(h => normalise(h) === normalise(col));
        return idx;
      }).filter(i => i >= 0);
    }
  }
  rows.forEach((row, i) => {
    let key;
    if (keyIdxs.length >= 2) {
      key = keyIdxs.map(idx => {
        const v = row[idx];
        return v !== null && v !== undefined ? String(v).trim().replace(/\.0$/, '') : '';
      }).join(''); // no separator — GL account (10 digits) + company code (4 chars)
    } else if (keyIdxs.length === 1) {
      const v = row[keyIdxs[0]];
      key = v !== null && v !== undefined ? String(v).trim().replace(/\.0$/, '') : '';
    } else {
      key = '__row' + i;
    }
    if (key) map.set(key, row);
  });
  return map;
}

function applyFieldTransform(f, src, raw) {
  // Allow null/undefined through only if there is no default_transform that handles empty values.
  // e.g. value_map: {"": "FALSE"} should fire even when the cell is null.
  const dt = f.default_transforms;
  const preset = dt && (dt[src] || dt['All']);
  const nullMapped = preset && preset.value_map && preset.value_map[''] !== undefined;
  if ((raw === null || raw === undefined) && !nullMapped) return null;

  let val = raw === null || raw === undefined ? '' : (S.trimWhitespace ? String(raw).trim() : String(raw));

  // ── 1. Apply default_transforms from the mapping JSON (always-on presets) ──
  if (dt) {
    if (preset) {
      if (preset.value_map) {
        const mapped = preset.value_map[val];
        if (mapped !== undefined) val = String(mapped);
        else if (preset.value_map['*'] !== undefined) val = String(preset.value_map['*']);
      }
      if (preset.case === 'upper') val = val.toUpperCase();
      if (preset.case === 'lower') val = val.toLowerCase();
      if (preset.trim !== false)   val = val.trim();
    }
  }

  // ── 2. Apply user-defined transforms (override presets) ───────────────────
  const ft = S.fieldTransforms[txKey(f.canonical)];
  if (ft) {
    const entry = ft[src] || ft['All'];
    const fn    = entry && typeof entry === 'object' ? entry.fn : entry;
    if (typeof fn === 'function') { try { return String(fn(val) ?? val); } catch(e){} }
  }
  return val;
}

async function runDiffSKB(mapping) {
  showProgress('Parsing COA Master\u2026', '');
  await tick();
  const {map: coaMasterMap, headers: coaHeaders, headerIdx: coaHeaderIdx, excludedAccts} = buildCoaMasterMap(mapping);

  id('progSub').textContent = 'Parsing CC-Matrix\u2026';
  await tick();
  const ccData = buildCCMatrixData(mapping);
  if (!ccData) { hideProgress(); showToast('CC-Matrix not loaded', 'err'); return; }

  id('progSub').textContent = 'Building COA side\u2026';
  await tick();
  const coaSideMap = buildCOASideRows(mapping, coaMasterMap, coaHeaders, coaHeaderIdx, ccData, excludedAccts);
  S._coaSideMap = coaSideMap; // cache raw pre-transform values for transform panel

  id('progSub').textContent = 'Building source maps\u2026';
  await tick();
  const faqMap = buildSourceMap('FAQ', mapping);
  const dpMap  = buildSourceMap('DataPool', mapping);

  id('progSub').textContent = 'Computing 3-way diff\u2026';
  await tick();

  const allKeys = new Set([...coaSideMap.keys(), ...faqMap.keys(), ...dpMap.keys()]);
  S._diffRows   = [];

  for (const k of allKeys) {
    const inCOA = coaSideMap.has(k);
    const inFAQ = faqMap.has(k) && !!S.wbs.FAQ && S.activeSources.has('FAQ');
    const inDP  = dpMap.has(k)  && !!S.wbs.DataPool && S.activeSources.has('DataPool');

    const vals = {};
    vals['COA'] = S.comparableFields.map(f => {
      if (!inCOA || !f.sources.COA) return null;
      const raw = coaSideMap.get(k)[f.canonical] ?? null;
      return raw !== null ? applyFieldTransform(f, 'COA', raw) : null;
    });
    vals['FAQ'] = S.comparableFields.map(f => {
      if (!inFAQ || !f.sources.FAQ) return null;
      const row = faqMap.get(k);
      const hi  = S.headers.FAQ.indexOf(f.sources.FAQ);
      return hi >= 0 ? applyFieldTransform(f, 'FAQ', row[hi]) : null;
    });
    vals['DataPool'] = S.comparableFields.map(f => {
      if (!inDP || !f.sources.DataPool) return null;
      const row = dpMap.get(k);
      const hi  = S.headers.DataPool.indexOf(f.sources.DataPool);
      return hi >= 0 ? applyFieldTransform(f, 'DataPool', row[hi]) : null;
    });

    // Discrepancy type for rows missing from COA side
    let discType = null;
    if (!inCOA && ccData) {
      // Keys are acct+coco with no separator; split by trying each known company code suffix
      const knownCoCos = mapping.reference_files.CC_MATRIX.known_company_codes || [];
      let acct = k, coco = '';
      for (const cc of knownCoCos) {
        if (k.endsWith(cc)) { acct = k.slice(0, -cc.length); coco = cc; break; }
      }
      if (!ccData.accountMap.has(acct))                              discType = 'no_reference';
      else if (coco && !ccData.accountMap.get(acct).activeCoCos.has(coco)) discType = 'unexpected_coco';
    }

    const activeSrcs = (inCOA ? 1 : 0) + (inFAQ ? 1 : 0) + (inDP ? 1 : 0);
    if (activeSrcs <= 1) {
      const who = inCOA ? 'COA' : inFAQ ? 'FAQ' : 'DataPool';
      S._diffRows.push({dtype:'only_'+who, key:k, vals, discType});
    } else {
      const fc = S.comparableFields.map((f, fi) => {
        const avail = SOURCES.map(s => vals[s][fi]).filter(v => v !== null);
        if (avail.length <= 1) return false;
        const cmp = S.caseSensitive ? avail : avail.map(v => v.toLowerCase());
        return new Set(cmp).size > 1;
      });
      S._diffRows.push({dtype: fc.some(c=>c) ? 'conflict' : 'same', key:k, vals, fieldConflicts:fc, discType});
    }
  }

  // Counts
  const dc = {same:0,conflict:0,onlyCOA:0,onlyFAQ:0,onlyDP:0,total:S._diffRows.length,noReference:0,unexpectedCoco:0};
  S._diffRows.forEach(r => {
    if (r.dtype==='same')          dc.same++;
    else if (r.dtype==='conflict') dc.conflict++;
    else if (r.dtype==='only_COA') dc.onlyCOA++;
    else if (r.dtype==='only_FAQ') dc.onlyFAQ++;
    else if (r.dtype==='only_DataPool') dc.onlyDP++;
    if (r.discType==='no_reference')    dc.noReference++;
    if (r.discType==='unexpected_coco') dc.unexpectedCoco++;
  });
  S.diffCounts = dc;
  hideProgress();
  finalizeDiff();
}

/* ── Flat 3-way diff (SKA / legacy mode) ── */
async function runDiffFlat(mapping) {
  showProgress('Building row maps…', 'Reading source data');
  await tick();
  const activeFilters = getActiveRowFilters();

  // Build COA side flat map for SKA when COA_MASTER is loaded
  const isSKAWithCOA = !!(S.refWbs.COA_MASTER &&
    mapping.comparison_grain !== 'account_company_code');
  let coaSideFlat = null;
  if (isSKAWithCOA) {
    id('progSub').textContent = 'Building COA side…';
    await tick();
    const {map: coaMasterMap, headers: coaHeaders, headerIdx: coaHeaderIdx} = buildCoaMasterMap(mapping);
    coaSideFlat = buildCoaSideFlat(mapping, coaMasterMap, coaHeaders, coaHeaderIdx);
    S._coaSideMap = coaSideFlat; // cache for transform panel
  }

  const maps = {};
  TX_SOURCES.forEach(src => {
    maps[src] = new Map();
    if (!S.wbs[src] || !S.activeSources.has(src)) return;
    const rows    = getSourceRows(src);
    const hdrs    = S.headers[src];
    const keyDef  = S.keyFields[src] || {cols:[], sep:'|'};
    const keyIdxs = (keyDef.cols||[]).map(k=>hdrs.indexOf(k)).filter(i=>i>=0);
    const keySep  = keyDef.sep !== undefined ? keyDef.sep : '|';
    rows.forEach((row,i) => {
      if (!passesRowFilters(src,row,activeFilters)) return;
      const k = keyIdxs.length ? keyIdxs.map(idx=>(row[idx]||'').trim()).join(keySep) : '__row'+i;
      maps[src].set(k, row);
    });
  });

  id('progSub').textContent = 'Computing diff…';
  await tick();

  // Determine active sources: COA (from ref file) + uploaded tx sources
  const txLoaded = TX_SOURCES.filter(s => S.wbs[s] && S.activeSources.has(s));
  const loaded   = isSKAWithCOA ? ['COA', ...txLoaded] : txLoaded;

  const allKeys = new Set();
  txLoaded.forEach(s => maps[s].forEach((_,k) => allKeys.add(k)));
  if (isSKAWithCOA && coaSideFlat) coaSideFlat.forEach((_,k) => allKeys.add(k));

  S._diffRows = [];
  for (const k of allKeys) {
    const inSrcs = loaded.filter(s =>
      s === 'COA'
        ? coaSideFlat && coaSideFlat.has(k)
        : maps[s] && maps[s].has(k)
    );

    const vals = {};

    // COA: from pre-built flat map
    vals['COA'] = S.comparableFields.map(f => {
      if (!isSKAWithCOA || !coaSideFlat || !f.sources.COA) return null;
      const coaRow = coaSideFlat.get(k);
      if (!coaRow) return null;
      const raw = coaRow[f.canonical]; // null=col not found, ''=empty cell, string=value
      return raw !== null && raw !== undefined ? applyFieldTransform(f, 'COA', raw) : null;
    });

    // Transactional sources
    TX_SOURCES.forEach(src => {
      vals[src] = S.comparableFields.map(f => {
        if (!S.wbs[src] || !f.sources[src]) return null;
        const row = maps[src].get(k);
        if (!row) return null;
        // Use normalised header lookup — tolerates trailing newlines, casing, extra spaces
        let hi = S.headers[src].indexOf(f.sources[src]);
        if (hi < 0) hi = S.headers[src].findIndex(h => normHdr(h) === normHdr(f.sources[src]));
        if (hi < 0) hi = S.headers[src].findIndex(h => normHdr(h).startsWith(normHdr(f.sources[src])));
        const raw = hi >= 0 ? (S.trimWhitespace ? String(row[hi]??'').trim() : String(row[hi]??'')) : null;
        if (raw === null) return null;
        if (f.source_transform?.[src]?.value_map) {
          const vm = f.source_transform[src].value_map;
          return vm[raw] !== undefined ? vm[raw] : raw;
        }
        return applyFieldTransform(f, src, raw);
      });
    });

    if (inSrcs.length === 1) {
      S._diffRows.push({dtype:'only_'+inSrcs[0], key:k, vals});
    } else {
      const fc = S.comparableFields.map((_f,fi) => {
        const avail = loaded.map(s=>vals[s][fi]).filter(v=>v!==null);
        if (avail.length<=1) return false;
        const cmp = S.caseSensitive ? avail : avail.map(v=>v.toLowerCase());
        return new Set(cmp).size>1;
      });
      S._diffRows.push({dtype:fc.some(c=>c)?'conflict':'same', key:k, vals, fieldConflicts:fc});
    }
  }

  const dc = {same:0,conflict:0,onlyCOA:0,onlyFAQ:0,onlyDP:0,
              total:S._diffRows.length,noReference:0,unexpectedCoco:0};
  S._diffRows.forEach(r => {
    if      (r.dtype==='same')            dc.same++;
    else if (r.dtype==='conflict')        dc.conflict++;
    else if (r.dtype==='only_COA')        dc.onlyCOA++;
    else if (r.dtype==='only_FAQ')        dc.onlyFAQ++;
    else if (r.dtype==='only_DataPool')   dc.onlyDP++;
  });
  S.diffCounts = dc;
  hideProgress();
  finalizeDiff();
}

/* ── Post-diff common setup ── */
function finalizeDiff() {
  setStep(3); showTab(3); showSubTab('results');
  ['mapBody','compareBody','uploadBody'].forEach(bid => {
    const body = id(bid), icon = id(bid.replace('Body','Icon'));
    if (body && icon && icon.classList.contains('open')) {
      body.style.maxHeight='0'; body.style.opacity='0';
      body.classList.add('collapsed'); icon.classList.remove('open');
    }
  });
  renderSummary();
  SOURCES.forEach(updateSourceToggle);
  const autoFilter = S.diffCounts.conflict > 0 ? 'conflict' : 'all';
  S.filter = autoFilter;
  S.pageOffset = 0;
  renderDiff(true);
  applyFilter(autoFilter);
  const rb = id('subtabResultsBadge');
  if (rb) { rb.textContent = S.diffCounts.total.toLocaleString(); rb.style.display = ''; }
  showTab(3); showSubTab('results');
  setTimeout(() => { const sc=id('summaryCard'); if(sc) sc.scrollIntoView({behavior:'smooth',block:'start'}); }, 100);
  setTimeout(buildDiffSQLite, 200);
  setTimeout(buildContextualChips, 300);
}
