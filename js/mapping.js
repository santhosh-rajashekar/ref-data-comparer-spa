/* =====================================================================
   MAPPING LOADER
   Loads SKA_MAP and SKB_MAP from data/ska_mapping.json and
   data/skb_mapping.json at runtime.

   When served via server.js (http://localhost:8787) both fetches work
   normally. If the file is opened directly as file:// the fetches fail
   and the inline fallback JSON is used instead.
===================================================================== */
let SKA_MAP = null;
let SKB_MAP = null;

async function loadMappings() {
  try {
    const [ska, skb] = await Promise.all([
      fetch('./data/ska_mapping.json').then(r => r.json()),
      fetch('./data/skb_mapping.json').then(r => r.json())
    ]);
    SKA_MAP = ska;
    SKB_MAP = skb;
    console.log('[mapping] Loaded SKA + SKB mappings from JSON files');
  } catch (e) {
    // Fallback: inline copies embedded at build time (see data/_ska_skb_map.js)
    console.warn('[mapping] Could not fetch mapping JSON (file:// or network error) — using embedded fallback:', e.message);
    if (typeof SKA_MAP_EMBEDDED !== 'undefined') { SKA_MAP = SKA_MAP_EMBEDDED; SKB_MAP = SKB_MAP_EMBEDDED; }
    else { console.error('[mapping] No embedded fallback available — check server.js is running'); }
  }
}

function getEmbeddedMap() {
  return (S && S.activeMode === 'SKA') ? SKA_MAP : SKB_MAP;
}
