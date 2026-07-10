# Data Extraction — pulling AP Invoice data for a tenant (offline)

These Python scripts query **Metabase** (two instances) for a tenant + date range, run SOR
post‑processing, and produce the `.xlsx` files the dashboard reads. `app_def_code = 'VIDE'` (the
AP‑Invoice application code) is fixed in the queries.

> **Two ways to feed the dashboard**
> 1. **Offline (this folder):** run a script → get an `.xlsx` → drop it in `frontend/public/data/` + add a
>    `manifest.json` entry (steps below).
> 2. **Live backend:** run **`../backend/app.py`** and point the frontend's env at it — the app fetches on
>    demand, no `.xlsx` step. Same Metabase-API approach; also serves SOR + S3 attachments + email, and
>    connects to the prod DB via `DB_URL`/`TENANT_DB_MAP`. See [`../backend`](../backend) and the top‑level README.
>
> The customer‑edit mismatch SQL (source of truth) lives at
> [`../backend/queries/mismatch_review.sql`](../backend/queries/mismatch_review.sql).

## Files

| File | Produces | For which dashboard mode |
|---|---|---|
| `ap_invoice_data.py` | `AP_Invoice_Tenant_<id>.xlsx` — classification + vendor + SOR columns | **Regular DA Analysis** (`kind: regular`) |
| `ap_invoice_mismatch_data.py` | `AP_Invoice_Mismatch_Report.xlsx` — one sheet per scenario (`RecordType_Mismatch`, `VendorName_Mismatch`, …) | **Mismatch Review** (`kind: mismatch`) |
| `sample_metabase_script.py` | minimal Metabase auth/query example | reference |

Credentials live in the shared repo‑root **`.env`** (`USERNAME_REGULAR`/`PASSWORD_REGULAR`/… — committed empty).

## 1. Install

```bash
cd data-extraction
python3 -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements.txt
```

## 2. Credentials

Edit the repo-root **`.env`** (committed with empty values) and fill in your Metabase credentials — one pair per
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

For a single tenant, the simplest path is to set `TENANT_ID=<id>` in `.env` — it overrides
`ALL_TENANT_IDS` at run time, so you don't need to edit the script.

## 4. Run

```bash
python3 ap_invoice_data.py           # → AP_Invoice_Tenant_<id>.xlsx  (Regular DA Analysis)
python3 ap_invoice_mismatch_data.py  # → AP_Invoice_Mismatch_Report.xlsx  (Mismatch Review)
```

The script authenticates both Metabase instances, finds each tenant's shard DB, fetches, runs the
SOR post‑processing, formats dates, and writes the `.xlsx`.

## 5. Wire the output into the dashboard

1. Copy the produced `.xlsx` into `../frontend/public/data/`.
2. Add (or update) an entry in `../frontend/public/data/manifest.json` — the **Get Data** gate reads
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

## The three mismatch scenarios (from `../backend/queries/mismatch_review.sql`)

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

## Live backend (instead of the offline `.xlsx` step)

The backend at [`../backend/app.py`](../backend) already runs these same queries on demand and serves
them to the dashboard via `POST /api/get_data` (plus SOR, S3 attachments, and email). Point the
frontend at it with `VITE_DATA_API_URL` and connect it to the prod DB with `DB_URL`/`TENANT_DB_MAP` —
see the top‑level README's **"Environment variables & the backend"** section.
