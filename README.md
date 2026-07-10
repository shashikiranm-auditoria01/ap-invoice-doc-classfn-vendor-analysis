# AP Invoice Doc Classification & Vendor Name Matching — Analysis Dashboard

An interactive dashboard for reviewing AP‑invoice **document classification** and **vendor‑name
matching** for a tenant, plus a **customer‑edit mismatch review** mode (AAI/NLU value vs the
customer‑edited value). Data is pulled from Metabase/prod by a small Python pipeline and reviewed
in a React app.

> **TL;DR** — `cd dashboard && npm install && npm run dev` → open the printed localhost URL. This repo
> ships **no tenant data** (customer data is never committed), so on first run the **Get Data** gate
> has no datasets — either run the pipeline ([`data-fetching/`](data-fetching/README.md)) to generate
> one into `dashboard/public/data/`, or use the gate's **upload an Excel file** option.

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

1. **`dashboard/`** — a React 19 + Vite + TypeScript + Tailwind single‑page app. It loads an AP‑invoice
   dataset for a tenant and lets a reviewer confirm, per document:
   - **Document classification** — is it an *Invoice* or *Others* (incl. `VB_CREDIT_MEMO`)?
   - **Vendor 2.1 matching** — is the vendor a match / mismatch / "does not exist", and does it exist
     in `mast_sor`?
   - **Customer‑edit mismatches** — where the customer changed AAI's *record type*, *entity name*, or
     *vendor name*.
   - Live **metrics**, a filterable **reviewed** sheet with per‑column filters and two Excel exports,
     and an **Email Sender** (AP‑invoice batch + Helpdesk) backed by an optional Flask/Gmail backend.

2. **`data-fetching/`** — Python scripts that query Metabase (two instances) for a tenant + date range,
   run SOR post‑processing, and produce the `.xlsx` the dashboard reads. `app_def_code = 'VIDE'` (the
   AP‑Invoice application code) is fixed in the query.

> **No customer data is committed to this repo.** `dashboard/public/data/` contains only an empty
> `manifest.json`. Generate a dataset with the [data pipeline](data-fetching/README.md) (or upload
> your own Excel via the gate) before reviewing.

---

## Repository layout

```
ap-invoice-doc-classfn-vendor-analysis/
├── README.md                     ← you are here (overview • setup • run • data flow)
├── .gitignore
├── dashboard/                    ← the React app
│   ├── src/                      ← app source (pages, components, services, utils, types)
│   ├── public/data/              ← datasets + manifest.json (what the gate reads)
│   │   └── manifest.json         ← ships EMPTY (no customer data committed); add entries after a pull
│   ├── email_backend.py          ← optional Flask + Gmail SMTP backend for the Email Sender
│   ├── api/index.py              ← optional serverless entry (Vercel)
│   ├── package.json, vite.config.ts, tailwind.config.js, tsconfig*.json
│   └── vercel.json               ← deployment config
├── data-fetching/                ← Python data pull (Metabase → .xlsx)
│   ├── README.md                 ← how to pull data for ANY tenant → dashboard
│   ├── ap_invoice_data.py        ← Daily Data Review pull (classification + vendor + SOR)
│   ├── ap_invoice_mismatch_data.py ← Mismatch Review pull (customer edits)
│   ├── pull_tenant_674288818571972608.py ← single‑tenant pull example
│   ├── query.md                  ← the customer‑edit mismatch SQL + explanation
│   ├── requirements.txt
│   └── .env                      ← USERNAME / PASSWORD (committed EMPTY — fill before pulling)
└── docs/
    └── workflow-architecture.html ← the end‑to‑end workflow & architecture, open in a browser
```

---

## How the data flows (end to end)

```
                         ┌────────────────────── data-fetching/ (Python) ──────────────────────┐
  Metabase (Regular)  ─▶ │  ap_invoice_data.py            → AP_Invoice_Tenant_<id>.xlsx          │
  Metabase (ENT)      ─▶ │  ap_invoice_mismatch_data.py   → AP_Invoice_Mismatch_Report.xlsx      │
   app_def_code='VIDE'   │  (tenant + created_at range, SOR post-processing)                     │
                         └───────────────────────────────┬──────────────────────────────────────┘
                                                          │  copy the .xlsx into
                                                          ▼
                                        dashboard/public/data/  +  add an entry to manifest.json
                                                          │
                                                          ▼
      ┌──────────────────────────── dashboard/ (React) ────────────────────────────┐
      │  Get Data gate → dataSource.getData({kind, scenario, tenantId, from, to})   │
      │     • kind = 'regular'  (Daily Data Review)  → the full daily set           │
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
cd dashboard
npm install
npm run dev
```

Open the URL Vite prints (e.g. `http://localhost:5173`). You'll land on the **Get Data** screen.
On a fresh clone there are no datasets yet — first [run the pipeline](#pulling-data-for-a-tenant) to
create one (or use **upload an Excel file instead** on the gate). Once a dataset is present:

1. Choose **Daily Data Review** or **Mismatch review**.
2. Pick a **Tenant Name** (populated from `public/data/manifest.json`).
3. (Mismatch only) choose **which mismatches** — All / Entity Name / Vendor Name / Record Type.
4. Adjust the **Created From/To** range (pre‑filled to the dataset's coverage).
5. Click **Get Data** → the dashboard loads.

A context bar under the tabs always shows what you're viewing (mode • scenario • tenant • date range •
count) with a **Change data** button back to the gate.

**Production build:** `npm run build` → static output in `dashboard/dist/`.

### Optional: Email Sender backend

The Email Sender (header button) sends via Gmail SMTP through a small Flask backend:

```bash
cd dashboard
pip install -r requirements.txt      # Flask, etc.
npm run email-backend                # starts email_backend.py on http://localhost:5001
```

Enter a **Gmail App Password** in the modal (kept only in the browser's `sessionStorage`, never
persisted or logged). With the backend down, the modal shows a "Backend down" badge and Send is
disabled.

---

## Pulling data for a tenant

Full instructions are in **[`data-fetching/README.md`](data-fetching/README.md)**. In short:

```bash
cd data-fetching
pip install -r requirements.txt
# 1) fill your PASSWORD in .env (USERNAME defaults to the configured account)
# 2) set the tenant id(s) + date range at the top of the script, then:
python3 ap_invoice_data.py             # Daily Data Review dataset
python3 ap_invoice_mismatch_data.py    # Mismatch Review dataset
# 3) copy the resulting .xlsx into ../dashboard/public/data/
# 4) add/adjust an entry in ../dashboard/public/data/manifest.json (tenant, dates, counts)
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

- **Daily Data Review** (`kind: regular`) — the full daily document set for a tenant + date range.
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

## Environment variables & the backend seam

The dashboard runs fully on bundled data with **no env vars**. Optional flags wire it to the live
**data-fetching backend** (`data-fetching/server.py`) — set them in `dashboard/.env.local` (git‑ignored):

| Variable | Effect |
|---|---|
| `VITE_DATA_API_URL` | **Get Data** POSTs `{kind, scenario, tenant_id, app_def_code, date_from, date_to}` to `{URL}/api/get_data` (live Metabase pull, or prod DB) instead of reading bundled `.xlsx`. Same UI. |
| `VITE_SOR_API_URL` | The **SOR Hints / Master SOR Record** tabs lazily fetch SOR data per document from `{URL}/api/sor/lookup` (only for docs without SOR). Cached per document. |
| `VITE_ATTACHMENT_API_URL` | The details panel loads a doc's invoice **PDF from AWS S3** via `{URL}/attachments?s3Key=<extractedFileS3Location \| s3Location>` (point at `{backend}/api`). |
| `VITE_EMAIL_BACKEND_URL` | Email backend base URL (default `http://localhost:5001`). |

All three data endpoints are served by **`data-fetching/server.py`** (FastAPI). Run it with
`cd data-fetching && uvicorn server:app --port 8787`, then set the three URLs to `http://localhost:8787`
(attachment URL to `http://localhost:8787/api`). See [`data-fetching/README.md`](data-fetching/README.md).

**Incremental rollout / prod DB:** ship the live pull first (`VITE_DATA_API_URL`), add SOR + attachments
when ready — none blocks the others, and the bundled path stays the dev/fallback. `server.py` uses the
**Metabase API** by default; set `DB_URL` in `data-fetching/.env` and the *same* SQL runs against the
**prod DB** directly — no frontend change. Endpoint contracts:

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

- `data-fetching/.env` is committed with **empty** `USERNAME` / `PASSWORD`. **Fill your password
  locally before pulling; never commit real credentials.**
- Gmail **App Passwords** entered in the Email Sender live only in the browser's `sessionStorage` —
  never written to `localStorage`, logged, or persisted.
- Reviews are saved in the browser's `localStorage` (heavy JSON/SOR blobs stripped to stay under
  quota; re‑hydrated from the loaded dataset). Use **Export** to keep a durable copy.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gate shows no tenants | Ensure `dashboard/public/data/manifest.json` exists and lists datasets whose `.xlsx` are in the same folder. |
| "No documents found" after Get Data | Widen the Created From/To range, or pick **All mismatches**. |
| Email Sender badge "Backend down" | Start the backend: `cd dashboard && npm run email-backend`. |
| Uploaded Excel rejected ("ID column stored as numbers") | Re‑export the file with the ID columns formatted as **Text** — 18‑digit IDs lose precision if stored as numbers. |
| Pull script asks for a password | Fill `PASSWORD` in `data-fetching/.env`, or type it at the prompt. |
