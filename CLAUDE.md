# RDM Ref-Data Comparer — AI Assistant Context

This file provides essential architectural context for Claude Code, GitHub Copilot,
and any AI assistant working on this codebase. Read this before making changes.

## What this is

A single-page application (SPA) that performs three-way reconciliation of GL account
master data across three authoritative sources:
- **COA Master** — SharePoint/Excel governance reference (read-only reference file, never uploaded as a source)
- **FAQ/SAP** — OData export from SAP (direct upload)
- **DataPool** — ADLS Gen2 Delta tables export (direct upload)

Two comparison modes:
- **SKA** — Chart-of-Accounts grain, key: `gl_account` (single column)
- **SKB** — Account × Company Code grain, composite key (no separator)

## How to run

```bash
node server.js        # serves http://localhost:8787 + JIRA proxy
```

No build step, no npm install. Node 18+ required (built-in fetch).

## File structure

```
index.html               # HTML shell only — all modals, panels, tab structure
css/main.css             # All styles (~660 lines)
js/
  constants.js           # S state object, SOURCES, SRC_LABEL constants
  mapping.js             # loadMappings() — fetches data/ska_mapping.json + skb_mapping.json
  utils.js               # id(), esc(), normalise(), similarity(), showToast()
  navigation.js          # showTab(), showSubTab(), toggleCollapse()
  ingest.js              # loadFile(), loadRefFile(), SheetJS Excel parsing
  coa.js                 # coaColIdx(), buildCoaSideFlat(), buildCoaMasterMap(), COA mapping UI
  diff-engine.js         # runDiff(), runDiffSKB(), buildCCMatrixData(), buildCOASideRows()
  results.js             # renderDiff(), renderSummary(), column picker popover
  row-search.js          # onRowSearchInput(), execRowSearch(), SQLite/JS row search
  export.js              # exportCSV(), exportExcel() (ExcelJS lazy-loaded from CDN)
  ai-config.js           # AI Config modal, callAI(), callAIMessage(), Azure AD/MSAL
  jira.js                # JIRA Config modal, AI-drafted ticket creation, proxy routing
  agent.js               # RDM Agent loop (6 tools, 6-iteration cap, SQLite Text-to-SQL)
  row-filters.js         # Options toggles (yellow/10-digit/strike skip), addRowFilter()
  mapping-upload.js      # loadMappingFile(), resetMapping()
  col-exclude.js         # toggleExclude(), restoreCol(), renderExclBar()
  transforms.js          # Transform panel, seedDefaultTransforms(), applyTransform()
  app-init.js            # Startup sequence: loadMappings() → seedDefaultTransforms() → init
data/
  ska_mapping.json       # SKA field mapping config (15 fields, 3-source)
  skb_mapping.json       # SKB field mapping config (12 fields, 3-source)
  _ska_skb_map.js        # Embedded fallback (used when file:// prevents fetch)
server.js                # Static file server + JIRA CORS proxy (zero deps)
```

## Critical architectural invariants — never violate these

### 1. COA is reference-only
COA Master is always read from `S.refWbs.COA_MASTER`, never from `S.wbs['COA']`.
`S.wbs` only holds transactional sources (FAQ, DataPool).
The `SOURCES` constant includes `'COA'` for comparison purposes but COA data
is always resolved through the reference file path, not a direct upload.

### 2. coaColIdx() for all COA column lookups
COA Excel headers contain newlines, mixed casing, extra spaces, annotation suffixes.
Always use `coaColIdx(colName, headerIdx, headers)` for any COA column lookup —
never `headerIdx[colName]` directly. This applies to:
- Direct `coa_lookup` fields
- `coa_derived` condition columns (`if_else_chain`, `multi_condition`)
- CC-Matrix attribute header lookups

### 3. CC-Matrix column layout (SKB only)
The CC-Matrix file ("20260309" sheet) has this layout:
- Row 2 (index 1): company codes in columns AH–AR (index 33–43)
- Row 5 (index 4): attribute names in columns AS–AV (index 44–47)
- Columns D–AG (index 3–32): hidden/legacy, **do not read**
- AH–AR cells for each account row: non-blank = that company code applies to
  that account; the cell value IS the per-company-code Open Item Management
  value (only `open_item_management` has `has_coco_override: true`)
- AS–AV cells: base/default attribute values (shared across all company codes
  for that account), used when AH–AR is blank for a given coco

### 4. Transform namespacing
All field transforms are namespaced by mode using `txKey(mode, canonical, source)`.
Never read or write `S.fieldTransforms[canonical]` directly — always via `txKey()`.
This prevents SKA transforms bleeding into SKB mode and vice versa.

### 5. SKB composite key — no separator
SKB uses `gl_account + company_code` as a naked concatenation (no separator).
This is intentional. Company codes contain letters (e.g. "0DE1") while account
numbers are pure digits, which makes collisions practically impossible with current
data. Do not add a separator without explicit sign-off.

### 6. Empty vs not-found distinction
For COA column resolution:
- Column found, cell empty → `''` (renders as blank in UI)
- Column not found → `null` (renders as `—` in UI)
This distinction is used in the diff engine and must be preserved.

### 7. Mode isolation on switch
`setMode()` must clear: `_coaSideMap`, `resolvedMap`, `comparableFields`,
`_diffRows`, `hiddenCols`, `diffCounts`, and drop+rebuild the SQLite
`diff_results` table. The SKB composite-key DOM row must be removed when
switching to SKA. `fieldTransforms` is intentionally NOT cleared (namespaced).

### 8. CORS constraints
- **JIRA**: direct browser calls blocked → route through `server.js` proxy
  (`/api/jira/myself`, `/api/jira/issue`) using `X-Jira-Base-Url` header
- **Databricks model serving**: also CORS-blocked → Phase 2 `AiSummaryProxy`
  Azure Function handles this; don't add direct browser calls to Databricks
- **Azure AI Foundry** (GPT-4.1): use `/openai/v1/chat/completions` endpoint
  (not `/openai/v1/responses` — that's the newer Responses API, incompatible
  with the Chat Completions request shape used in callAIWithToken())

## Mapping files

`data/ska_mapping.json` and `data/skb_mapping.json` are the authoritative
field mapping configs. Only include fields where **all three sources** have
mappings. Do not hand-author derivation rules — verify against
`SKA_and_SKB_mapping_4.xlsx` (held by Ionela) before adding/changing any field.

When served via `server.js`, these are fetched at startup by `loadMappings()`.
When opened as `file://`, the embedded fallback in `data/_ska_skb_map.js` is used.

## Key colleagues

- **Ionela** — COA Master / CC-Matrix SME, mapping file maintainer, UAT sign-off
- **Sorabh** — architecture contributor  
- **Christian, Dominik** — stakeholders / sign-off

## Phase 2 (separate repo: santhosh-rajashekar/rdm-reconciliation)

Phase 2 is an automated daily pipeline: Azure Synapse/Databricks → Azure
Function App (TypeScript) → Angular frontend. This repo (Phase 1 SPA) remains
the manual-upload demo/PoC tool. Do not conflate the two architectures.
