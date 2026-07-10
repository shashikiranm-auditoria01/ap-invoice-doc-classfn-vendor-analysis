"""
Smoke test for the backend (app.py) — runs in MOCK mode, no Metabase/DB/S3 needed.

    cd backend
    pip install fastapi httpx        # (uvicorn/boto3/pandas NOT required for this test)
    python3 smoke_test.py

Verifies the endpoints exist, wire up, and return the shapes the dashboard expects. It does NOT
exercise real Metabase/prod-DB/S3 — do that separately with real credentials.
"""
import os
os.environ["MOCK"] = "1"  # must be set before importing server

from fastapi.testclient import TestClient  # noqa: E402
import app as server  # noqa: E402

client = TestClient(server.app)
passed = failed = 0

def check(name, cond):
    global passed, failed
    if cond:
        passed += 1; print(f"  PASS  {name}")
    else:
        failed += 1; print(f"  FAIL  {name}")

print("Backend smoke test (MOCK mode)\n")

# health
r = client.get("/api/health")
check("GET /api/health 200", r.status_code == 200)
check("health status ok", r.json().get("status") == "ok")

# regular get_data
r = client.post("/api/get_data", json={
    "kind": "regular", "tenant_id": "665247456933969920",
    "app_def_code": "VIDE", "date_from": "2026-06-15 00:00:00", "date_to": "2026-06-18 23:59:59",
})
check("POST /api/get_data (regular) 200", r.status_code == 200)
rows = r.json()
check("regular returns rows", isinstance(rows, list) and len(rows) > 0)
check("row has 'Document ID' (string)", isinstance(rows[0].get("Document ID"), str))
check("row tenant echoes request", rows[0].get("Tenant ID") == "665247456933969920")

# mismatch get_data
r = client.post("/api/get_data", json={
    "kind": "mismatch", "scenario": "recordType", "tenant_id": "665247456933969920",
    "app_def_code": "VIDE", "date_from": "2026-06-01 00:00:00", "date_to": "2026-06-26 23:59:59",
})
check("POST /api/get_data (mismatch) 200", r.status_code == 200)
mrows = r.json()
check("mismatch row has customer edit cols", bool(mrows) and "Customer RecordType" in mrows[0])

# sor lookup
r = client.post("/api/sor/lookup", json={
    "tenantId": "665247456933969920",
    "lookups": [{"documentId": "855390894818852864", "normalizedVendorName": "Acme", "extractedVendorName": "Acme"}],
})
check("POST /api/sor/lookup 200", r.status_code == 200)
sor = r.json()
check("sor keyed by documentId", "855390894818852864" in sor)

# attachments: missing config → clear error (400/404/500), not a crash
r = client.get("/api/attachments", params={"s3Key": "mock/doc.pdf"})
check("GET /api/attachments handled (no crash)", r.status_code in (200, 400, 404, 500))

print(f"\nRESULT: {passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
