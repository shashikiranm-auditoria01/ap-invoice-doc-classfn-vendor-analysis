"""
AP Invoice — Backend (FastAPI): data + SOR + S3 attachments + email
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
  uvicorn app:app --port 8787            # or: python3 app.py

Data source: Metabase now → prod DB later
──────────────────────────────────────────
`run_sql()` runs against Metabase by default. Set DB_URL in .env (e.g. mysql+pymysql://user:pass@host/db)
and it runs the SAME SQL directly against the prod DB instead — no other change, no frontend change.
"""
import os
import mimetypes
from typing import Optional

import re
import sys
import json
import smtplib
import base64 as _b64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders as _encoders

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import httpx

# The pull scripts (which own the source-of-truth SQL) live in ../data-extraction.
_EXTRACTION_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data-extraction")
if _EXTRACTION_DIR not in sys.path:
    sys.path.insert(0, _EXTRACTION_DIR)

# SQL templates imported LAZILY inside get_data so the backend (and /api/health, email, S3) start
# without pandas/requests — only the live pull path needs them.
def _sql_templates():
    from ap_invoice_data import SQL_QUERY_TEMPLATE as regular
    from ap_invoice_mismatch_data import SQL_QUERY_TEMPLATE as mismatch
    return regular, mismatch

MOCK = os.environ.get("MOCK") == "1"  # smoke-test mode: return a tiny sample instead of querying

# ── Config (from the repo-root .env) ──────────────────────────────────────────────────────────────
def _load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
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

# ── Data source: 'metabase' (default) | 'proddb' ──────────────────────────────────────────────────
DATA_SOURCE = os.environ.get("DATA_SOURCE", "proddb" if os.environ.get("DB_URL") or os.environ.get("TENANT_DB_MAP") else "metabase").lower()
DB_URL = os.environ.get("DB_URL", "")              # single prod DB / read-replica DSN (all tenants)
# Optional tenant→DSN routing for a SHARDED prod DB: {"665247456933969920": "mysql+pymysql://…", …}
try:
    TENANT_DB_MAP = json.loads(os.environ.get("TENANT_DB_MAP", "") or "{}")
except json.JSONDecodeError:
    TENANT_DB_MAP = {}

S3_BUCKET = os.environ.get("S3_BUCKET", "")        # default bucket if an s3Key has no bucket prefix
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# SMTP (Email Sender) — same config surface as the standalone email backend.
SMTP_HOST = os.environ.get("MAIL_SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("MAIL_SMTP_PORT", "587"))
USE_STARTTLS = os.environ.get("MAIL_STARTTLS", "true").lower() != "false"
SKIP_LOGIN = os.environ.get("MAIL_SKIP_LOGIN", "false").lower() == "true"

app = FastAPI(title="AP Invoice Backend (data + SOR + attachments + email)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ── SQL execution: Metabase today, prod DB when DB_URL is set ─────────────────────────────────────
_mb_tokens: dict = {}  # instance name → session token cache

# 18-digit Snowflake IDs must be returned to the JS frontend as strings — as JSON numbers they
# exceed 2^53 and get silently rounded. Stringify these known ID-named columns in every row dict.
_ID_KEYS = {"Document ID", "Tenant ID", "Message ID", "Edit Message ID", "vendorid",
            "AAI entityID", "Customer entityID", "aaiEntityId"}

def _stringify_ids(d: dict) -> dict:
    for k, v in d.items():
        if k in _ID_KEYS and v is not None and not isinstance(v, str):
            d[k] = str(v)  # Python ints are arbitrary-precision here → exact digits preserved
    return d

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
    # Key rows off the raw SQL alias (c['name']); Metabase humanizes display_name
    # ("created_at" → "Created At"), which breaks the frontend/extraction parsers.
    cols = [c.get("name") or c.get("display_name") for c in d.get("cols", [])]
    return [_stringify_ids(dict(zip(cols, row))) for row in d.get("rows", [])]

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

# ── Prod-DB: one pooled engine per DSN, created lazily and reused across requests ────────────────
_engines: dict = {}

def _engine_for(dsn: str):
    from sqlalchemy import create_engine  # lazy import; only on the prod-DB path
    eng = _engines.get(dsn)
    if eng is None:
        # pool_pre_ping avoids stale connections; a small pool is plenty for a review tool.
        eng = create_engine(dsn, pool_pre_ping=True, pool_size=5, max_overflow=5, pool_recycle=1800)
        _engines[dsn] = eng
    return eng

def _dsn_for_tenant(tenant_id: str) -> Optional[str]:
    """Resolve the prod DSN for a tenant: per-tenant shard map wins, else the single DB_URL."""
    return TENANT_DB_MAP.get(tenant_id) or (DB_URL or None)

def run_sql(sql: str, tenant_id: Optional[str] = None) -> list[dict]:
    """Run a SELECT and return column-keyed row dicts.

    DATA_SOURCE='proddb' → run against the tenant's prod DB (sharded via TENANT_DB_MAP, or the single
    DB_URL) using a pooled engine. Otherwise probe Metabase (dev/legacy). Same SQL either way.
    """
    if DATA_SOURCE == "proddb":
        from sqlalchemy import text
        dsn = _dsn_for_tenant(tenant_id or "")
        if not dsn:
            raise RuntimeError("No prod DB configured — set DB_URL or TENANT_DB_MAP in .env")
        with _engine_for(dsn).connect() as conn:
            res = conn.execute(text(sql))
            return [_stringify_ids(dict(r._mapping)) for r in res]
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

def _mock_rows(req: "GetDataRequest") -> list[dict]:
    """A tiny, column-correct sample for MOCK=1 smoke tests (no Metabase/DB needed)."""
    base = {
        "Document ID": "855390894818852864", "created_at": "June 18, 2026, 10:18 AM",
        "updated_at": "June 18, 2026, 10:18 AM", "Message ID": "855386140541718528",
        "Tenant Name": "Mock Tenant", "Tenant ID": req.tenant_id, "On UI": "Active",
        "Written": "Written", "Manual": "Manual", "Final Record Type": "Invoice",
        "Original Record Type": "Invoice", "vendorname": "Acme Corp",
        "OriginalVendorName": "Acme Corporation", "S3Location": "mock/tenant/doc.pdf",
    }
    if req.kind == "mismatch":
        base.update({"AAI RecordType": "Invoice", "Customer RecordType": "VB_CREDIT_MEMO",
                     "Customer vendorName": "Acme Corp LLC", "customer entity_name": "Acme Entity"})
    return [base]


# The SQL templates use literal placeholders (not bound params), so validate the values that get
# interpolated to eliminate any injection surface. Tenant IDs are 18-digit snowflakes; dates are a
# fixed 'YYYY-MM-DD[ HH:MM:SS]' shape.
_TENANT_RE = re.compile(r"^\d{1,25}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$")

@app.post("/api/get_data")
def get_data(req: GetDataRequest):
    if MOCK:
        return _mock_rows(req)
    if not _TENANT_RE.match(req.tenant_id or ""):
        raise HTTPException(status_code=400, detail="tenant_id must be numeric (18-digit snowflake).")
    if not _DATE_RE.match(req.date_from or "") or not _DATE_RE.match(req.date_to or ""):
        raise HTTPException(status_code=400, detail="date_from/date_to must be 'YYYY-MM-DD[ HH:MM:SS]'.")
    regular_sql, mismatch_sql = _sql_templates()
    template = mismatch_sql if req.kind == "mismatch" else regular_sql
    sql = (template
           .replace("DATE_FROM_PLACEHOLDER", req.date_from)
           .replace("DATE_TO_PLACEHOLDER", req.date_to)
           .replace("TENANT_PLACEHOLDER", req.tenant_id))
    if req.kind == "mismatch" and req.scenario and req.scenario != "all":
        extra = _SCENARIO_WHERE.get(req.scenario, "")
        # Inject the scenario predicate into the INNER subquery's WHERE (it references swre), i.e.
        # right before the `) x` that closes the subquery — NOT after it / before the outer ORDER BY,
        # where `swre` is out of scope. The template has exactly one `) x`.
        if extra and ") x" in sql:
            head, _, tail = sql.rpartition(") x")
            sql = head + extra + "\n) x" + tail
    try:
        rows = run_sql(sql, tenant_id=req.tenant_id)
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
    # Escape backslash FIRST (else it re-escapes the '' below), then the single quote, for MySQL
    # string literals. Vendor names are document-derived, so they must be neutralised too.
    return (v or "").replace("\\", "\\\\").replace("'", "''")

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
    rows = run_sql(sql, tenant_id=tenant_id)
    return (rows[0].get("matches") if rows else None) or "[]"

@app.post("/api/sor/lookup")
def sor_lookup(req: SorRequest):
    # Validate the tenant id like /api/get_data does — it is interpolated into SQL string literals.
    if not _TENANT_RE.match(req.tenantId or ""):
        raise HTTPException(status_code=400, detail="tenantId must be numeric (18-digit snowflake).")
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


# ── Email Sender (folded in from the standalone email backend) ────────────────────────────────────
def _smtp_send(sender: str, password: str, recipient: str, msg: MIMEMultipart):
    server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30)
    try:
        if USE_STARTTLS:
            server.starttls()
        if password and not SKIP_LOGIN:
            server.login(sender, password)
        server.sendmail(sender, [r.strip() for r in recipient.split(",") if r.strip()], msg.as_string())
    finally:
        try: server.quit()
        except Exception: pass

class SingleEmail(BaseModel):
    recipient_email: str = ""
    sender_email: str = ""
    sender_password: str = ""
    email_subject: str = "Document Delivery"
    email_body: str = "Please find the attached document."
    file: Optional[dict] = None            # { name, data(base64) }

@app.post("/api/send_email")
def send_email(req: SingleEmail):
    """Single email with an optional PDF attachment (AP Invoice mode)."""
    if not req.recipient_email.strip() or not req.sender_email.strip():
        return {"success": False, "error": "Missing sender or recipient"}
    msg = MIMEMultipart()
    msg["From"], msg["To"], msg["Subject"] = req.sender_email, req.recipient_email, req.email_subject
    msg.attach(MIMEText(req.email_body, "plain"))
    fi = req.file or {}
    if fi.get("data"):
        try:
            part = MIMEBase("application", "pdf")
            part.set_payload(_b64.b64decode(fi["data"]))
            _encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{fi.get("name") or "document.pdf"}"')
            msg.attach(part)
        except Exception:
            return {"success": False, "error": f"Invalid base64 for {fi.get('name')}"}
    try:
        _smtp_send(req.sender_email, req.sender_password, req.recipient_email, msg)
    except smtplib.SMTPAuthenticationError:
        return {"success": False, "error": "Authentication failed. Use a Gmail App Password."}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "status": "failed", "error": str(e)}
    return {"success": True, "status": "sent", "message": "Email sent successfully"}

class SimpleAttachment(BaseModel):
    name: str = "document.pdf"
    base64Data: str = ""
    mimeType: Optional[str] = "application/pdf"

class SimpleEmail(BaseModel):
    sender_email: str = ""
    app_password: str = ""
    recipient: str = ""
    subject: str = "No Subject"
    body: str = ""
    attachments: list[SimpleAttachment] = []

@app.post("/api/email/send-simple")
def send_simple(req: SimpleEmail):
    """Email with any number of attachments (HelpDesk bulk mode)."""
    if not req.sender_email.strip() or not req.recipient.strip():
        return {"success": False, "error": "Missing sender or recipient"}
    msg = MIMEMultipart()
    msg["From"], msg["To"], msg["Subject"] = req.sender_email, req.recipient, req.subject
    msg.attach(MIMEText(req.body, "plain"))
    for att in req.attachments:
        if not att.base64Data:
            continue
        try:
            main, _, sub = (att.mimeType or "application/pdf").partition("/")
            part = MIMEBase(main, sub or "octet-stream")
            part.set_payload(_b64.b64decode(att.base64Data))
            _encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{att.name}"')
            msg.attach(part)
        except Exception as e:  # noqa: BLE001
            print(f"  Failed to attach {att.name}: {e}")
    try:
        _smtp_send(req.sender_email, req.app_password, req.recipient, msg)
    except smtplib.SMTPAuthenticationError:
        return {"success": False, "error": "Gmail authentication failed. Use an App Password."}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": str(e)}
    return {"success": True, "attachments_sent": len(req.attachments)}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "data_source": DATA_SOURCE,
        "prod_db_configured": bool(DB_URL or TENANT_DB_MAP),
        "metabase_configured": any(i["user"] and i["pw"] for i in METABASE_INSTANCES),
        "s3_bucket": bool(S3_BUCKET),
        "smtp_host": SMTP_HOST,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("DATA_BACKEND_PORT", "8787")))
