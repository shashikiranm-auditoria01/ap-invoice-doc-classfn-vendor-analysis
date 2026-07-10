# Backend — one FastAPI service (data + SOR + attachments + email)

`app.py` is the **single** server-side component. It is entirely optional: with it down the dashboard
runs on the bundled `.xlsx` datasets in `frontend/public/data/` and the Email Sender shows a
"Backend down" badge. When it's up and the frontend's `VITE_*` env points at it, the dashboard fetches
live instead of from files.

It does four jobs:

| Job | Endpoint | Backed by |
|---|---|---|
| **Live data pull** | `POST /api/get_data` | Metabase API *or* prod DB (see `DATA_SOURCE`) |
| **SOR enrichment** (lazy, per-document) | `POST /api/sor/lookup` | same data source |
| **Invoice PDF attachments** | `GET /api/attachments?s3Key=…` | AWS S3 (boto3) |
| **Email Sender** | `POST /api/send_email`, `POST /api/email/send-simple` | Gmail SMTP (smtplib) |

`GET /api/health` reports which of these are configured.

## Run

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --port 8787          # or: python3 app.py  (reads DATA_BACKEND_PORT)
```

Then point the frontend at it in `frontend/.env.local`:

```dotenv
VITE_DATA_API_URL=http://localhost:8787
VITE_SOR_API_URL=http://localhost:8787
VITE_ATTACHMENT_API_URL=http://localhost:8787/api
VITE_EMAIL_BACKEND_URL=http://localhost:8787
```

Config is read from the **repo-root `.env`** (committed with empty values). Set `MOCK=1` to return
canned rows with no Metabase/DB/S3 — handy for a smoke test (`python3 smoke_test.py`, 11 checks).

## Data source — Metabase vs prod DB

`DATA_SOURCE` selects where `get_data` / `sor/lookup` read from. It **defaults to `proddb`** if either
`DB_URL` or `TENANT_DB_MAP` is set, otherwise `metabase`.

### Metabase (default, matches the offline `data-extraction/` scripts)

```dotenv
DATA_SOURCE=metabase
USERNAME_REGULAR=you@auditoria.ai      # metabase.auditoria.ai
PASSWORD_REGULAR=
USERNAME_ENT=you@auditoria.ai          # metabase-ent1.auditoria.ai
PASSWORD_ENT=
```

The backend runs the **same SQL** as the extraction scripts (imported from
`../data-extraction/ap_invoice_data.py` and `ap_invoice_mismatch_data.py`); the mismatch source of
truth is [`queries/mismatch_review.sql`](queries/mismatch_review.sql).

### Prod DB

```dotenv
DATA_SOURCE=proddb
# Single DB / read-replica for all tenants:
DB_URL=mysql+pymysql://user:pass@host:3306/dbname
# …OR, for a SHARDED prod DB, route each tenant to its own DSN (JSON):
TENANT_DB_MAP={"665247456933969920":"mysql+pymysql://…","674288818571972608":"mysql+pymysql://…"}
```

- Engines are **pooled** (`pool_pre_ping`, `pool_size=5`, `max_overflow=5`, `pool_recycle=1800`) and
  cached per DSN. `TENANT_DB_MAP` wins over `DB_URL` when a tenant matches.
- Uncomment the right driver in `requirements.txt` (`pymysql` for MySQL/MariaDB, `psycopg2-binary`
  for Postgres, …).
- Inputs are validated before they reach SQL: `tenant_id` must match `^\d{1,25}$` and dates
  `^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$`.

`POST /api/get_data` body: `{ kind, scenario, tenant_id, app_def_code, date_from, date_to }` — `kind`
is `regular` or `mismatch`; `scenario` (mismatch only) is `all` | `recordType` | `vendorName` |
`entityName`.

## Attachments (AWS S3)

```dotenv
S3_BUCKET=your-default-bucket          # used when an s3Key has no bucket prefix
AWS_REGION=us-east-1
# AWS credentials via the usual boto3 chain (env / ~/.aws / instance role)
```

`GET /api/attachments?s3Key=<extractedFileS3Location | s3Location>` streams the **raw PDF bytes**
(`Response(content=…, media_type=…)`) — the frontend reads `res.arrayBuffer()`. Keys may be a plain
key (resolved against `S3_BUCKET`), `bucket/key`, or a full `s3://bucket/key` URI.

## Email (Gmail SMTP)

```dotenv
MAIL_SMTP_HOST=smtp.gmail.com
MAIL_SMTP_PORT=587
MAIL_STARTTLS=true
MAIL_SKIP_LOGIN=false                  # true only for a local relay with no auth
```

The **Gmail App Password** is entered in the dashboard modal per session and sent with each request —
it is never stored server-side. `MAIL_SKIP_LOGIN=true` supports a local unauthenticated relay for
testing.

## Health

```bash
curl localhost:8787/api/health
# {"status":"ok","data_source":"metabase","prod_db_configured":false,
#  "metabase_configured":true,"s3_bucket":false,"smtp_host":"smtp.gmail.com"}
```
