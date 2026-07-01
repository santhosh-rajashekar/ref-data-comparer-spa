/* =====================================================================
   CONSTANTS & STATE  (v5 — SKB Reference-File Architecture)
===================================================================== */
const SOURCES   = ['COA','FAQ','DataPool'];
const TX_SOURCES = ['FAQ','DataPool'];           // transactional sources (direct file uploads)
const REF_KEYS  = ['COA_MASTER','CC_MATRIX'];    // reference file keys
const SRC_LABEL = {COA:'COA Side', FAQ:'FAQ (SAP)', DataPool:'DataPool'};
const SRC_COLOR = {COA:'coa', FAQ:'faq', DataPool:'dp'};
const KEY_SEP   = '\u2016';   // double vertical bar — separator for composite keys

const S = {
  // Transactional source workbooks
  wbs:    {COA:null, FAQ:null, DataPool:null},
  fns:    {COA:'',   FAQ:'',   DataPool:''},
  headers:{COA:[],   FAQ:[],   DataPool:[]},
  coaWs:  null,   // COA worksheet ref (COA-only legacy SKA support)
  coaFilterStats:{total:0,yellowSkipped:0,tenDigitSkipped:0,strikeSkipped:0,kept:0},

  // Reference file workbooks (v5 SKB)
  refWbs: {COA_MASTER:null, CC_MATRIX:null},
  refFns: {COA_MASTER:'',   CC_MATRIX:''},
  ccMatrixOE: 'SERE',

  // Mapping
  activeMode:     'SKB',  // 'SKA' or 'SKB' — driven by mode toggle
  activeMapping:  null,
  resolvedMap:    [],
  comparableFields:[],
  keyFields:      {COA:'', FAQ:'', DataPool:''},

  // Diff results
  _diffRows:  [],
  diffCounts: {same:0,conflict:0,onlyCOA:0,onlyFAQ:0,onlyDP:0,total:0,noReference:0,unexpectedCoco:0},
  filter:     'all',
  pageOffset: 0,
  pageSize:   250,
  mapFilter:  'all',

  // UI state
  excludedFields: new Set(),
  fieldTransforms:{},
  hiddenCols:     new Set(),
  activeSources:  new Set(['COA','FAQ','DataPool']),
  caseSensitive:  false,
  trimWhitespace: true,
  skipYellow:     true,
  skipTenDigit:   true,
  skipStrike:     true,
  rowFilters:     [],
  colFilter:      '',
  rowSearch:      '',
  rowSearchKeys:  null,
  _activeSubTab:  'results',
  _sqlDB:         null,
};

