"""
AP Invoice — Data-Fetching Backend (FastAPI)
════════════════════════════════════════════════════════════════════════════════════════════════
Exposes the endpoints the dashboard's frontend seams call, so the app can run LIVE instead of from
bundled .xlsx. Same Metabase-API approach as the pull scripts (reuses their SQL); ready to swap to a
direct prod-DB connection; and serves invoice PDFs from AWS S3.

Endpoints
─────────
  POST /api/get_data        ← dashboard VITE_DATA_API_URL      (Regular DA Analysis + Mismatch Review)
       body: { kind: 'regular'|'mismatch', scenario?, tenant_id, app_def_code, date_from, date_to }
       → [ { <column-keyed row matching the .xlsx headers> }, ... ]

  POST /api/sor/lookup      ← dashboard VITE_SOR_API_URL       (lazy SOR enrichment per document)
       body: { tenantId, lookups: [{ documentId, normalizedVendorName, extractedVendorName }] }
       → { [documentId]: { sorHintsNormalized, sorHintsExtracted, sorMasterNormalized,
                           sorMasterExtracted, systemHintsNormalized, systemHintsExtracted } }

  GET  {VITE_ATTACHMENT_API_URL}/attachments?s3Key=<key>   (load PDF from S3 — set the env to {URL}/api)
       → the raw PDF bytes (Content-Type: application/pdf) for extractedFileS3Location / s3Location.
         (The frontend reads response.arrayBuffer(); 404 = not found.)

  GET  /api/health

Run
───
  pip install -r requirements.txt
  # fill .env (USERNAME_REGULAR/PASSWORD_REGULAR/USERNAME_ENT/PASSWORD_ENT, AWS creds, optional DB_URL)
  uvicorn server:app --port 8787         # or: python3 server.py

Data source: Metabase now → prod DB later
──────────────────────────────────────────
`run_sql()` runs against Metabase by default. Set DB_URL in .env (e.g. mysql+pymysql://user:pass@host/db)
and it runs the SAME SQL directly against the prod DB instead — no other change, no frontend change.
"""
import os
import mimetypes
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import httpx

# Reuse the REAL, source-of-truth SQL templates from the pull scripts (import is side-effect-free).
from ap_invoice_data import SQL_QUERY_TEMPLATE as REGULAR_SQL_TEMPLATE
from ap_invoice_mismatch_data import SQL_QUERY_TEMPLATE as MISMATCH_SQL_TEMPLATE

# ── Config (from environment / .env) ─────────────────────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
_load_env()

METABASE_INSTANCES = [
    {"name": "regular", "url": "https://metabase.auditoria.ai",
     "user": os.environ.get("USERNAME_REGULAR", ""), "pw": os.environ.get("PASSWORD_REGULAR", "")},
    {"name": "enterprise", "url": "https://metabase-ent1.auditoria.ai",
     "user": os.environ.get("USERNAME_ENT", ""), "pw": os.environ.get("PASSWORD_ENT", "")},
]
DB_URL = os.environ.get("DB_URL", "")              # set → query prod DB directly instead of Metabase
S3_BUCKET = os.environ.get("S3_BUCKET", "")        # default bucket if an s3Key has no bucket prefix
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

app = FastAPI(title="AP Invoice Data-Fetching Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ── SQL execution: Metabase today, prod DB when DB_URL is set ─────────────────────────────────────
_mb_tokens: dict = {}  # instance name → session token cache

def _mb_login(inst: dict) -> Optional[str]:
    if not inst["user"] or not inst["pw"]:
        return None
    if _mb_tokens.get(inst["name"]):
        return _mb_tokens[inst["name"]]
    try:
        r = httpx.post(f"{inst['url']}/api/session", verify=False, timeout=30,
                       json={"username": inst["user"], "password": inst["pw"]})
        if r.status_code == 200:
            tok = r.json().get("id")
            _mb_tokens[inst["name"]] = tok
            return tok
    except httpx.HTTPError:
        return None
    return None

def _mb_query(inst: dict, db_id: int, sql: str) -> list[dict]:
    tok = _mb_login(inst)
    if not tok:
        return []
    r = httpx.post(f"{inst['url']}/api/dataset", verify=False, timeout=300,
                   headers={"Content-Type": "application/json", "X-Metabase-Session": tok},
                   json={"database": db_id, "type": "native", "native": {"query": sql}})
    if r.status_code not in (200, 202):
        return []
    d = r.json().get("data", {})
    cols = [c.get("display_name") or c.get("name") for c in d.get("cols", [])]
    return [dict(zip(cols, row)) for row in d.get("rows", [])]

def _mb_databases(inst: dict) -> list[int]:
    tok = _mb_login(inst)
    if not tok:
        return []
    r = httpx.get(f"{inst['url']}/api/database", verify=False, timeout=30,
                  headers={"X-Metabase-Session": tok})
    if r.status_code != 200:
        return []
    data = r.json()
    dbs = data if isinstance(data, list) else data.get("data", [])
    # Prefer SOR / shard DBs (that's where tenant data lives), like the pull scripts do.
    pref = [db["id"] for db in dbs if any(k in db["name"].lower() for k in ("sor", "shard"))]
    return pref or [db["id"] for db in dbs]

def run_sql(sql: str) -> list[dict]:
    """Run a SELECT and return column-keyed row dicts. Prod DB if DB_URL set, else probe Metabase."""
    if DB_URL:
        # Prod-DB path — same SQL, direct connection.
        from sqlalchemy import create_engine, text  # lazy import; only needed on this path
        eng = create_engine(DB_URL)
        with eng.connect() as conn:
            res = conn.execute(text(sql))
            return [dict(r._mapping) for r in res]
    # Metabase path — try each instance's SOR/shard DBs until one returns rows.
    for inst in METABASE_INSTANCES:
        for db_id in _mb_databases(inst):
            rows = _mb_query(inst, db_id, sql)
            if rows:
                return rows
    return []


# ── /api/get_data ─────────────────────────────────────────────────────────────────────────────────
class GetDataRequest(BaseModel):
    kind: str = "regular"                 # 'regular' | 'mismatch'
    scenario: Optional[str] = "all"       # mismatch only: all|recordType|vendorName|entityName
    tenant_id: str
    app_def_code: str = "VIDE"
    date_from: str                        # 'YYYY-MM-DD HH:MM:SS'
    date_to: str

# Extra WHERE fragments that turn the mismatch query into a single-scenario pull.
_SCENARIO_WHERE = {
    "recordType": " AND swre.original_json->>'$.recordType' != swre.final_json->>'$.recordType' ",
    "vendorName": " AND swre.original_json->>'$.vendorName' != swre.final_json->>'$.vendorName' ",
    "entityName": " AND swre.original_json->>'$.aaiEntityId' != swre.final_json->>'$.aaiEntityId' ",
}

@app.post("/api/get_data")
def get_data(req: GetDataRequest):
    template = MISMATCH_SQL_TEMPLATE if req.kind == "mismatch" else REGULAR_SQL_TEMPLATE
    sql = (template
           .replace("DATE_FROM_PLACEHOLDER", req.date_from)
           .replace("DATE_TO_PLACEHOLDER", req.date_to)
           .replace("TENANT_PLACEHOLDER", req.tenant_id))
    if req.kind == "mismatch" and req.scenario and req.scenario != "all":
        extra = _SCENARIO_WHERE.get(req.scenario, "")
        # Inject the scenario predicate before the trailing ORDER BY (defensive: only if present).
        if extra and "ORDER BY" in sql:
            head, _, tail = sql.rpartition("ORDER BY")
            sql = head + extra + " ORDER BY " + tail
    try:
        rows = run_sql(sql)
    except Exception as e:  # noqa: BLE001 — surface any driver/Metabase error to the client
        raise HTTPException(status_code=502, detail=f"Data source error: {e}")
    return rows


# ── /api/sor/lookup ─────────────────────────────────────────────────────────────────────────────
class SorLookup(BaseModel):
    documentId: str
    normalizedVendorName: Optional[str] = None
    extractedVendorName: Optional[str] = None

class SorRequest(BaseModel):
    tenantId: str
    lookups: list[SorLookup]

def _esc(v: Optional[str]) -> str:
    return (v or "").replace("'", "''")

def _sor_rows(tenant_id: str, vendor: str, table: str) -> str:
    """Return the JSON-array literal string for a vendor's SOR matches, shaped like the .xlsx cell."""
    if not vendor:
        return "[]"
    v = _esc(vendor)
    # sor_hints uses vendor_name/acceptable_name; sor_master uses coalesced_name/status. Adjust column
    # names here if your SOR schema differs. Returns a JSON array string (parsed client-side).
    sql = (
        f"SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT("
        f"'search_value_used','{v}','tenant_id','{_esc(tenant_id)}')), JSON_ARRAY()) AS matches "
        f"FROM sor.{table} WHERE tenant_id='{_esc(tenant_id)}' "
        f"AND (LOWER(coalesced_name)=LOWER('{v}') OR LOWER(vendor_name)=LOWER('{v}'))"
    )
    rows = run_sql(sql)
    return (rows[0].get("matches") if rows else None) or "[]"

@app.post("/api/sor/lookup")
def sor_lookup(req: SorRequest):
    out: dict = {}
    for lk in req.lookups:
        norm, ext = lk.normalizedVendorName, lk.extractedVendorName
        try:
            out[lk.documentId] = {
                "sorHintsNormalized": _sor_rows(req.tenantId, norm or "", "sor_hints"),
                "sorHintsExtracted": _sor_rows(req.tenantId, ext or "", "sor_hints"),
                "sorMasterNormalized": _sor_rows(req.tenantId, norm or "", "sor_master"),
                "sorMasterExtracted": _sor_rows(req.tenantId, ext or "", "sor_master"),
                "systemHintsNormalized": "[]",
                "systemHintsExtracted": "[]",
            }
        except Exception:  # noqa: BLE001 — degrade to empty; the SOR tabs handle it gracefully
            out[lk.documentId] = {}
    return out


# ── /api/attachments — load the invoice PDF from AWS S3 ────────────────────────────────────────────
@app.get("/api/attachments")
def get_attachment(s3Key: str = Query(..., description="S3 key, e.g. extractedFileS3Location / s3Location")):
    try:
        import boto3  # lazy import
    except ImportError:
        raise HTTPException(status_code=500, detail="boto3 not installed (pip install boto3)")

    key = s3Key.strip()
    bucket = S3_BUCKET
    # Support "bucket/key" form as well as a bare key with a configured default bucket.
    if key.startswith("s3://"):
        key = key[5:]
    if "/" in key and not bucket:
        bucket, key = key.split("/", 1)
    if not bucket:
        raise HTTPException(status_code=400, detail="No S3 bucket: set S3_BUCKET or pass 'bucket/key'.")

    try:
        s3 = boto3.client("s3", region_name=AWS_REGION)
        obj = s3.get_object(Bucket=bucket, Key=key)
        body = obj["Body"].read()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"S3 fetch failed for {bucket}/{key}: {e}")

    name = key.rsplit("/", 1)[-1] or "attachment.pdf"
    mime = mimetypes.guess_type(name)[0] or "application/pdf"
    # Return the raw bytes — the dashboard reads response.arrayBuffer().
    return Response(content=body, media_type=mime,
                    headers={"Content-Disposition": f'inline; filename="{name}"'})


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data_source": "prod-db" if DB_URL else "metabase",
        "metabase_configured": any(i["user"] and i["pw"] for i in METABASE_INSTANCES),
        "s3_bucket": bool(S3_BUCKET),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("DATA_BACKEND_PORT", "8787")))
