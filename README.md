# RDM Ref-Data Comparer — SPA

Reference & Master Data Quality Assurance — three-way comparison of GL account
master data across COA Master (governance), FAQ/SAP, and DataPool (ADLS/Delta).

## Quick start

```bash
node server.js
# Open http://localhost:8787
```

No `npm install` needed. Requires **Node 18+**.

## Modes

| Mode | Grain | Key |
|------|-------|-----|
| SKA  | Chart of Accounts | `gl_account` |
| SKB  | Account × Company Code | `gl_account + company_code` |

## Features

- Three-way diff with field-level conflict highlighting
- COA Master reference file + CC-Matrix (SKB) company-code expansion
- Column transforms (normalize, map values, custom JS) per source per field
- Row filters (yellow/hierarchy rows, 10-digit accounts, strike-through)
- RDM AI Agent (6 tools, Text-to-SQL via SQLite WASM, Azure AI Foundry GPT-4.1)
- JIRA ticket creation for conflicts (AI-drafted wiki-markup, via local proxy)
- Export: CSV, Excel (ExcelJS)
- Azure AD / MSAL auth for AI endpoint

## JIRA setup

Configure in **JIRA Config** header button:
- Base URL, API token (Cloud) or PAT (Server/DC, leave Email blank)
- Project key, Issue Type
- Local Proxy URL: `http://localhost:8787` (required for CORS)

For TLS/corporate cert issues, set before running:
```bash
set NODE_EXTRA_CA_CERTS=C:\path\to\corporate-ca.pem   # Windows
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem  # macOS/Linux
```

## Project structure

See [CLAUDE.md](./CLAUDE.md) for full architectural documentation, invariants,
and guidance for AI coding assistants.

## Related

- **Phase 2** (automated pipeline): `santhosh-rajashekar/rdm-reconciliation`
- **Original monolith**: `santhosh-rajashekar/chat-repo` → `rdm-3way-diff-v6.html`
