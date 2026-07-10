# Data Fetching — pulling AP Invoice data for a tenant

This is the **data‑fetching backend** for the dashboard. These Python scripts query **Metabase**
(two instances) for a tenant + date range, run SOR post‑processing, and produce the `.xlsx` files the
dashboard reads. `app_def_code = 'VIDE'` (the AP‑Invoice application code) is fixed in the queries.

> **How fetching works today vs later.**
> - **Now:** we fetch through the **Metabase API** — `ap_invoice_data.py` / `ap_invoice_mismatch_data.py`
>   run the SQL against Metabase. **`query.md` is that SQL** (the customer‑edit mismatch query) with a
>   plain‑English explanation of the three scenarios — it is the source‑of‑truth query, not a stray doc.
> - **Later:** we may switch to a **direct prod‑DB connection**. Only the connection + execution layer
>   changes — the same `query.md` SQL and the same output `.xlsx` shape (and the dashboard) stay put.
>   The dashboard also has a `VITE_DATA_API_URL` seam so it can call a live backend instead of reading
>   the generated `.xlsx` (see the top‑level README).

## Two ways to feed the dashboard

1. **Offline (default):** run a pull script → get an `.xlsx` → drop it in `dashboard/public/data/` + add a
   `manifest.json` entry (steps below).
2. **Live backend:** run **`server.py`** and point the dashboard's env at it — the app fetches on demand,
   no `.xlsx` step. This is the same Metabase-API approach, and it also serves SOR and S3 attachments.

### Live backend — `server.py`

```bash
cd data-fetching
pip install -r requirements.txt
# fill .env (Metabase creds; optionally DB_URL for prod DB, and S3_BUCKET/AWS creds for attachments)
uvicorn server:app --port 8787          # or: python3 server.py
```

Then in `dashboard/.env.local`:

```dotenv
VITE_DATA_API_URL=http://localhost:8787
VITE_SOR_API_URL=http://localhost:8787
VITE_ATTACHMENT_API_URL=http://localhost:8787/api
```

Endpoints (match the frontend seams exactly):

| Endpoint | Purpose |
|---|---|
| `POST /api/get_data` | Regular / Mismatch pull for a tenant + date range (reuses the scripts' SQL). Body `{kind, scenario, tenant_id, app_def_code, date_from, date_to}`. |
| `POST /api/sor/lookup` | Lazy per-document SOR enrichment (SOR Hints / Master SOR tabs). |
| `GET /api/attachments?s3Key=…` | Streams the invoice PDF from **AWS S3** (for `extractedFileS3Location` / `s3Location`). |
| `GET /api/health` | Status + which data source is active. |

**Metabase now → prod DB later:** `server.py` runs the SQL via the Metabase API by default. Set `DB_URL`
in `.env` (a SQLAlchemy URL) and the *same* SQL runs directly against the prod DB instead — no frontend
change. **AWS attachments:** set `S3_BUCKET` + AWS creds and the details panel can load PDFs from S3.

## Files

| File | Produces | For which dashboard mode |
|---|---|---|
| `ap_invoice_data.py` | `AP_Invoice_Tenant_<id>.xlsx` — classification + vendor + SOR columns | **Regular DA Analysis** (`kind: regular`) |
| `ap_invoice_mismatch_data.py` | `AP_Invoice_Mismatch_Report.xlsx` — one sheet per scenario (`RecordType_Mismatch`, `VendorName_Mismatch`, …) | **Mismatch Review** (`kind: mismatch`) |
| `server.py` | **Live backend** — the endpoints the dashboard calls (no `.xlsx` step) | both (live) |
| `query.md` | the customer‑edit mismatch SQL + a plain‑English explanation of the 3 scenarios | reference |
| `sample_metabase_script.py` | minimal Metabase auth/query example | reference |
| `.env` | your `USERNAME` / `PASSWORD` (committed **empty**) | credentials |

## 1. Install

```bash
cd data-fetching
python3 -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements.txt
```

## 2. Credentials

Edit **`.env`** (committed with empty values) and fill in your Metabase credentials — one pair per
instance — and optionally the tenant to pull:

```dotenv
# Regular instance (metabase.auditoria.ai)
USERNAME_REGULAR=you@auditoria.ai
PASSWORD_REGULAR=your-regular-password

# Enterprise instance (metabase-ent1.auditoria.ai)
USERNAME_ENT=you@auditoria.ai
PASSWORD_ENT=your-ent-password

# Optional: overrides ALL_TENANT_IDS in the script
TENANT_ID=665247456933969920
```

Anything left blank is prompted for at run time. `TENANT_ID`, if set, overrides the tenant list in
the script. **Never commit real credentials** — keep the committed `.env` values empty.

## 3. Configure the tenant + date range

Near the top of `ap_invoice_data.py` (and `ap_invoice_mismatch_data.py`):

```python
QUERY_DATE_FROM = '2026-06-15 00:00:00'
QUERY_DATE_TO   = '2026-06-18 23:59:59'
ALL_TENANT_IDS  = ['665247456933969920']   # one or more 18-digit tenant IDs
```

For a single tenant you can copy `pull_tenant_674288818571972608.py` and change `TARGET_TENANT` +
the date range.

## 4. Run

```bash
python3 ap_invoice_data.py           # → AP_Invoice_Tenant_<id>.xlsx  (Daily Data Review)
python3 ap_invoice_mismatch_data.py  # → AP_Invoice_Mismatch_Report.xlsx  (Mismatch Review)
```

The script authenticates both Metabase instances, finds each tenant's shard DB, fetches, runs the
SOR post‑processing, formats dates, and writes the `.xlsx`.

## 5. Wire the output into the dashboard

1. Copy the produced `.xlsx` into `../dashboard/public/data/`.
2. Add (or update) an entry in `../dashboard/public/data/manifest.json` — the **Get Data** gate reads
   this to populate the tenant dropdown, date coverage, and (for mismatch) scenario counts:

   ```jsonc
   {
     "appDefCode": "VIDE",
     "datasets": [
       {
         "kind": "regular",
         "file": "AP_Invoice_Tenant_665247456933969920.xlsx",
         "tenantId": "665247456933969920",
         "tenantName": "General Atlantic Prod",
         "createdFrom": "2026-06-15",   // earliest created_at in the file (YYYY-MM-DD)
         "createdTo": "2026-06-18",     // latest created_at
         "rowCount": 676
       },
       {
         "kind": "mismatch",
         "file": "AP_Invoice_Mismatch_Report.xlsx",
         "tenantId": "665247456933969920",
         "tenantName": "General Atlantic Prod",
         "createdFrom": "2026-06-01",
         "createdTo": "2026-06-26",
         "rowCount": 219,
         "scenarioCounts": { "recordType": 68, "vendorName": 151, "entityName": 0, "all": 219 }
       }
     ]
   }
   ```

   - `rowCount` / `scenarioCounts` are display hints (distinct document counts per scenario);
     `all` is the deduped union of the scenarios.
   - The mismatch file is multi‑tenant — add one `mismatch` entry **per tenant** it contains, all
     pointing at the same `file`. The dashboard scopes rows by `tenantId` at load.

3. Reload the dashboard — the new tenant/dataset now appears in the gate.

## The three mismatch scenarios (from `query.md`)

Customer edits come from `sor.wk_result_edits`: `original_json` = the value AAI/NLU produced,
`final_json` = the value the customer edited to. The report has one sheet per scenario:

| Scenario | Condition |
|---|---|
| **Record Type** | `original_json.recordType != final_json.recordType` |
| **Vendor Name** | `original_json.vendorName != final_json.vendorName` |
| **Entity Name** | `original_json.aaiEntityId != final_json.aaiEntityId` |

The dashboard reads the scenario from the **sheet name** (authoritative), not by re‑deriving from
columns.

## Important: IDs must stay text

Document / Message / Tenant / vendor IDs are 18‑digit Snowflakes that exceed JavaScript's safe
integer range. The scripts write them as **text** cells. If you hand‑edit an `.xlsx`, keep those
columns formatted as Text — the dashboard rejects uploads whose ID columns arrive as numbers
(precision would already be lost).

## Notes on the live backend (future)

When a backend endpoint is stood up, the dashboard can pull live instead of from bundled files by
setting `VITE_DATA_API_URL` (see the top‑level README). The backend should run the same queries as
these scripts and accept `{ kind, scenario, tenant_id, app_def_code, date_from, date_to }`.
