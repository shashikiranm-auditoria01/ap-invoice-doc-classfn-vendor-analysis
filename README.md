# AP Invoice Doc Classification & Vendor Name Matching — Analysis Dashboard

An interactive dashboard for reviewing AP‑invoice **document classification** and **vendor‑name
matching** for a tenant, plus a **customer‑edit mismatch review** mode (AAI/NLU value vs the
customer‑edited value). Data is pulled from Metabase/prod by a small Python pipeline and reviewed
in a React app.

> **TL;DR** — `cd frontend && npm install && npm run dev` → open the printed localhost URL. This repo
> ships **no tenant data** (customer data is never committed), so on first run the **Get Data** gate
> has no datasets — either run the pipeline ([`data-extraction/`](data-extraction/README.md)) to generate
> one into `frontend/public/data/`, or use the gate's **upload an Excel file** option.

---

## Contents

- [What this is](#what-this-is)
- [Repository layout](#repository-layout)
- [How the data flows (end to end)](#how-the-data-flows-end-to-end)
- [Quick start — run the dashboard](#quick-start--run-the-dashboard)
- [Pulling data for a tenant](#pulling-data-for-a-tenant)
- [The dashboard, tab by tab](#the-dashboard-tab-by-tab)
- [Two review modes](#two-review-modes)
- [Environment variables & the backend seam](#environment-variables--the-backend-seam)
- [Architecture doc (open in browser)](#architecture-doc-open-in-browser)
- [Credentials & security](#credentials--security)
- [Troubleshooting](#troubleshooting)

---

## What this is

Two pieces that work together:

1. **`frontend/`** — a React 19 + Vite + TypeScript + Tailwind single‑page app. It loads an AP‑invoice
   dataset for a tenant and lets a reviewer confirm, per document:
   - **Document classification** — is it an *Invoice* or *Others* (incl. `VB_CREDIT_MEMO`)?
   - **Vendor 2.1 matching** — is the vendor a match / mismatch / "does not exist", and does it exist
     in `mast_sor`?
   - **Customer‑edit mismatches** — where the customer changed AAI's *record type*, *entity name*, or
     *vendor name*.
   - Live **metrics**, a filterable **reviewed** sheet with per‑column filters and two Excel exports,
     and an **Email Sender** (AP‑invoice batch + Helpdesk) backed by the optional FastAPI/Gmail backend.

2. **`data-extraction/`** — Python scripts that query Metabase (two instances) for a tenant + date range,
   run SOR post‑processing, and produce the `.xlsx` the dashboard reads. `app_def_code = 'VIDE'` (the
   AP‑Invoice application code) is fixed in the query.

> **No customer data is committed to this repo.** `frontend/public/data/` contains only an empty
> `manifest.json`. Generate a dataset with the [data pipeline](data-extraction/README.md) (or upload
> your own Excel via the gate) before reviewing.

---

## Repository layout

```
ap-invoice-doc-classfn-vendor-analysis/
├── README.md                     ← you are here (overview • setup • run • data flow)
├── .env                          ← shared config: Metabase creds + prod-DB / S3 / SMTP (committed EMPTY)
├── .gitignore
├── frontend/                     ← the React/Vite app
│   ├── src/                      ← app source (pages, components, services, utils, types)
│   ├── public/data/manifest.json ← ships EMPTY (no customer data committed); add entries after a pull
│   ├── .env.example              ← the VITE_* vars that point the app at the backend
│   └── package.json, vite.config.ts, tailwind.config.js, tsconfig*.json
├── backend/                      ← ONE service the frontend calls (data + SOR + attachments + email)
│   ├── app.py                    ← FastAPI: /api/get_data, /api/sor/lookup, /api/attachments,
│   │                                /api/send_email, /api/email/send-simple, /api/health
│   ├── queries/mismatch_review.sql ← the customer-edit mismatch SQL (source of truth)
│   ├── smoke_test.py             ← backend smoke test (MOCK mode — 11 checks, no creds)
│   └── requirements.txt
├── data-extraction/              ← offline pull scripts (Metabase → .xlsx)
│   ├── README.md                 ← how to pull data for ANY tenant → dashboard
│   ├── ap_invoice_data.py        ← Regular DA Analysis pull (classification + vendor + SOR)
│   ├── ap_invoice_mismatch_data.py ← Mismatch Review pull (customer edits)
│   └── requirements.txt
└── docs/
    └── workflow-architecture.html ← the end-to-end workflow & architecture, open in a browser
```

---

## How the data flows (end to end)

```
                         ┌────────────────────── data-extraction/ (Python) ──────────────────────┐
  Metabase (Regular)  ─▶ │  ap_invoice_data.py            → AP_Invoice_Tenant_<id>.xlsx          │
  Metabase (ENT)      ─▶ │  ap_invoice_mismatch_data.py   → AP_Invoice_Mismatch_Report.xlsx      │
   app_def_code='VIDE'   │  (tenant + created_at range, SOR post-processing)                     │
                         └───────────────────────────────┬──────────────────────────────────────┘
                                                          │  copy the .xlsx into
                                                          ▼
                                        frontend/public/data/  +  add an entry to manifest.json
                                                          │
                                                          ▼
      ┌──────────────────────────── frontend/ (React) ────────────────────────────┐
      │  Get Data gate → dataSource.getData({kind, scenario, tenantId, from, to})   │
      │     • kind = 'regular'  (Regular DA Analysis)  → the full daily set           │
      │     • kind = 'mismatch' (Mismatch Review)    → customer-edit scenarios       │
      │  → Analysis / Reviewed / Metrics tabs, live review, exports, Email Sender    │
      └────────────────────────────────────────────────────────────────────────────┘
```

- **Today** the gate reads the bundled `.xlsx` from `public/data/` (filtered client‑side by the
  selected tenant + `created_at` range + mismatch scenario).
- **Later**, set `VITE_DATA_API_URL` and the *same* gate action instead POSTs to a backend that runs
  the live Metabase query — **no UI change** (see [the backend seam](#environment-variables--the-backend-seam)).

The 18‑digit Snowflake IDs (Document / Message / Tenant / vendor) are kept as **strings** end‑to‑end
(never parsed to numbers) so precision is never lost.

---

## Quick start — run the dashboard

**Prerequisites:** Node.js 18+ (20+ recommended) and npm.

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (e.g. `http://localhost:5173`). You'll land on the **Get Data** screen.
On a fresh clone there are no datasets yet — first [run the pipeline](#pulling-data-for-a-tenant) to
create one (or use **upload an Excel file instead** on the gate). Once a dataset is present:

1. Choose **Regular DA Analysis** or **Mismatch review**.
2. Pick a **Tenant Name** (populated from `public/data/manifest.json`).
3. (Mismatch only) choose **which mismatches** — All / Entity Name / Vendor Name / Record Type.
4. Adjust the **Created From/To** range (pre‑filled to the dataset's coverage).
5. Click **Get Data** → the dashboard loads.

A context bar under the tabs always shows what you're viewing (mode • scenario • tenant • date range •
count) with a **Change data** button back to the gate.

**Production build:** `npm run build` → static output in `frontend/dist/`.

### Optional: the backend (data + SOR + attachments + email)

Everything server‑side — live data pulls, SOR enrichment, S3 attachments, and the Email Sender — is
served by **one** FastAPI service in [`backend/`](backend). It's entirely optional: with it down,
the dashboard runs on the bundled datasets and the Email Sender simply shows a "Backend down" badge.

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --port 8787
```

Then point the frontend at it via `frontend/.env.local` (`VITE_DATA_API_URL`, `VITE_SOR_API_URL`,
`VITE_ATTACHMENT_API_URL`, `VITE_EMAIL_BACKEND_URL` — all `http://localhost:8787`). See
[`backend/README.md`](backend/README.md) for endpoints, prod‑DB connection, and S3 config.

The Email Sender (header button) sends via Gmail SMTP. Enter a **Gmail App Password** in the modal
(kept only in the browser's `sessionStorage`, never persisted or logged).

---

## Pulling data for a tenant

Full instructions are in **[`data-extraction/README.md`](data-extraction/README.md)**. In short:

```bash
cd data-extraction
pip install -r requirements.txt
# 1) fill your PASSWORD in .env (USERNAME defaults to the configured account)
# 2) set the tenant id(s) + date range at the top of the script, then:
python3 ap_invoice_data.py             # Regular DA Analysis dataset
python3 ap_invoice_mismatch_data.py    # Mismatch Review dataset
# 3) copy the resulting .xlsx into ../frontend/public/data/
# 4) add/adjust an entry in ../frontend/public/data/manifest.json (tenant, dates, counts)
```

The dashboard's **Get Data** gate reads `manifest.json` to populate the tenant dropdown and date
coverage — so a new tenant appears automatically once its file + manifest entry are added.

---

## The dashboard, tab by tab

| Tab | What it does |
|---|---|
| **Analysis** | The review workspace. 12 filters + date range + (for mismatch data) a *Customer Edit* scenario filter; status tabs (Not Reviewed / User Reviewed / Skipped / All); document navigation; PDF viewer (upload a ZIP of PDFs to view alongside); a details panel with Document Classification + Vendor 2.1 review forms, the 5 sub‑tabs (Details / JSON Data / Extracted Data / SOR Hints / Master SOR Record), and — for mismatch data — a **Customer Edits (AAI → Customer)** card. A live KPI strip updates as you review. |
| **Reviewed** | Every document you've reviewed, in a wide, scrollable table. **Per‑column filters** (searchable checkbox popover with Select all / Clear on each column) plus a top filter bar and search. Two Excel exports: **Reviewed** (reviewed rows only) and **Full Data with reviewed** (all docs, review columns filled for reviewed ones). All IDs export as text. |
| **Metrics** | Live "AP Invoice Overall Metrics": doc‑classification & vendor‑matching accuracy (computed over **your** manual reviews only — shows "—" until you review), On‑UI distribution, Write status, tenant breakdown, weekly trend, and an Excel report export. |

**Email Sender** (header button, app‑wide): AP‑Invoice batch send (multi‑PDF/ZIP drag‑drop, per‑file
delay, live activity log, Sent/Remaining/Failed tracker) and a Helpdesk sheet‑driven queue (matches
attachments by `s3_key`). Requires the email backend running.

---

## Two review modes

Chosen at the **Get Data** gate:

- **Regular DA Analysis** (`kind: regular`) — the full daily document set for a tenant + date range.
  Review classification + vendor matching as usual.

- **Mismatch Review** (`kind: mismatch`) — the customer‑edit set from `wk_result_edits`, where
  `original_json` is AAI/NLU's value and `final_json` is the customer's edit. Pick **which**
  mismatches to review:
  - **Record Type mismatches** — AAI record type ≠ customer record type
  - **Vendor Name mismatches** — AAI vendor name ≠ customer vendor name
  - **Entity Name mismatches** — AAI entity ≠ customer entity *(needs the live pull; the bundled
    report contains record‑type & vendor‑name only)*
  - **All mismatches** — the union of the above

  The scenario is authoritative: it comes from the pull query's `WHERE` clause (one sheet per
  scenario in the report), not a re‑derivation. The details panel adds the **Customer Edits
  (AAI → Customer)** card highlighting exactly which field changed.

---

## Environment variables & the backend

The dashboard runs fully on bundled data with **no env vars**. To go live, run the **single backend**
(`backend/app.py`) and point the frontend at it via `frontend/.env.local` (git‑ignored):

| Variable | Effect |
|---|---|
| `VITE_DATA_API_URL` | **Get Data** POSTs `{kind, scenario, tenant_id, app_def_code, date_from, date_to}` to `{URL}/api/get_data` (Metabase, or prod DB) instead of reading bundled `.xlsx`. Same UI. |
| `VITE_SOR_API_URL` | The **SOR Hints / Master SOR Record** tabs lazily fetch SOR per document from `{URL}/api/sor/lookup`. |
| `VITE_ATTACHMENT_API_URL` | The details panel loads a doc's invoice **PDF from AWS S3** via `{URL}/attachments?s3Key=<extractedFileS3Location \| s3Location>` (point at `{backend}/api`). |
| `VITE_EMAIL_BACKEND_URL` | Email Sender — now the same backend (`{URL}`). |

Run the backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --port 8787          # or: python3 app.py
# then in frontend/.env.local: VITE_DATA_API_URL / VITE_SOR_API_URL / VITE_EMAIL_BACKEND_URL = http://localhost:8787
#                              VITE_ATTACHMENT_API_URL = http://localhost:8787/api
```

**Connecting to prod DB.** The backend queries **Metabase by default**. To use the prod DB, set (in the
repo-root `.env`) either **`DB_URL`** (one DB/replica holding all tenants) or **`TENANT_DB_MAP`** (JSON
`tenant_id → DSN` if prod is sharded per tenant); `DATA_SOURCE` auto-switches to `proddb`. The **same
SQL** runs either way, via a pooled SQLAlchemy engine, with tenant/date inputs validated. No frontend
change. Endpoint contracts:

```
POST {VITE_DATA_API_URL}/api/get_data
{ kind:'regular'|'mismatch', scenario?, tenant_id, app_def_code:'VIDE', date_from, date_to }
→ [ { <row keyed by the .xlsx column headers> }, ... ]

POST {VITE_SOR_API_URL}/api/sor/lookup
{ tenantId, lookups: [{ documentId, normalizedVendorName, extractedVendorName }] }
→ { [documentId]: { sorHintsNormalized, sorHintsExtracted, sorMasterNormalized,
                    sorMasterExtracted, systemHintsNormalized, systemHintsExtracted } }

GET  {VITE_ATTACHMENT_API_URL}/attachments?s3Key=<key>   → raw PDF bytes (application/pdf)
```

---

## Architecture doc (open in browser)

Open **`docs/workflow-architecture.html`** directly in any browser (double‑click, or
`open docs/workflow-architecture.html` on macOS) — it's a self‑contained page (no server needed)
walking through the full end‑to‑end workflow, data model (`wk_inst_result` / `wk_result_edits`
original vs final), classification guidelines, and architecture diagrams.

---

## Credentials & security

- `data-extraction/.env` is committed with **empty** `USERNAME` / `PASSWORD`. **Fill your password
  locally before pulling; never commit real credentials.**
- Gmail **App Passwords** entered in the Email Sender live only in the browser's `sessionStorage` —
  never written to `localStorage`, logged, or persisted.
- Reviews are saved in the browser's `localStorage` (heavy JSON/SOR blobs stripped to stay under
  quota; re‑hydrated from the loaded dataset). Use **Export** to keep a durable copy.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gate shows no tenants | Ensure `frontend/public/data/manifest.json` exists and lists datasets whose `.xlsx` are in the same folder. |
| "No documents found" after Get Data | Widen the Created From/To range, or pick **All mismatches**. |
| Email Sender badge "Backend down" | Start the backend: `cd backend && uvicorn app:app --port 8787`, and set `VITE_EMAIL_BACKEND_URL`. |
| Uploaded Excel rejected ("ID column stored as numbers") | Re‑export the file with the ID columns formatted as **Text** — 18‑digit IDs lose precision if stored as numbers. |
| Pull script asks for a password | Fill `PASSWORD_REGULAR`/`PASSWORD_ENT` in the repo‑root `.env`, or type it at the prompt. |
