/**
 * Data source seam for the pre-load "Get Data" gate.
 *
 * The gate collects a tenant + created_at range (with app_def_code fixed to 'VIDE', the AP-Invoice
 * application code used by the real Metabase pull in AP_Invoice_Doc_Classfn_Vendor/ap_invoice_data.py).
 *
 * TODAY: getData() loads and filters a bundled .xlsx that was pre-pulled for that tenant.
 * LATER: set VITE_DATA_API_URL and getData() will POST the same params to a backend endpoint that
 *        runs the live Metabase query — no UI change required (the gate calls this service either way).
 */
import * as XLSX from 'xlsx';
import {
  DocClassificationDocument,
  DOC_CLASSIFICATION_REQUIRED_COLUMNS,
  DOC_CLASSIFICATION_COLUMNS,
  DOC_CLASSIFICATION_ALL_COLUMNS,
  parseDocClassificationRow,
} from '../types/docClassification';

export type DatasetKind = 'regular' | 'mismatch';
export type MismatchScenario = 'recordType' | 'vendorName' | 'entityName';
export type ReviewScenario = 'all' | MismatchScenario;

export interface DatasetManifestEntry {
  kind: DatasetKind;   // 'regular' = full document set; 'mismatch' = customer-edit review set
  file: string;
  tenantId: string;
  tenantName: string;
  createdFrom: string; // YYYY-MM-DD (inclusive) — the dataset's created_at coverage
  createdTo: string;   // YYYY-MM-DD (inclusive)
  rowCount?: number;
  scenarioCounts?: Record<MismatchScenario | 'all', number>; // for the gate's scenario selector
}

export interface DataManifest {
  appDefCode: string;
  datasets: DatasetManifestEntry[];
}

export interface GetDataParams {
  kind: DatasetKind;       // which pull: full document set or customer-edit mismatch review
  scenario?: ReviewScenario; // mismatch mode only: which scenario to review ('all' = union)
  tenantId: string;
  tenantName: string;
  appDefCode: string;      // 'VIDE' for AP Invoice
  from: string;            // YYYY-MM-DD (inclusive)
  to: string;              // YYYY-MM-DD (inclusive)
}

export interface GetDataResult {
  documents: DocClassificationDocument[];
  sourceFile?: string;
  fetchedFromApi: boolean;
}

const DATA_API_URL = (import.meta.env.VITE_DATA_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
export const isDataApiConfigured = DATA_API_URL.length > 0;

/** Load the manifest of available datasets (tenants + date coverage). */
export async function loadManifest(): Promise<DataManifest> {
  const res = await fetch('/data/manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load dataset manifest (HTTP ${res.status})`);
  const json = (await res.json()) as DataManifest;
  if (!json || !Array.isArray(json.datasets)) throw new Error('Dataset manifest is malformed');
  return json;
}

// Map a worksheet name to the mismatch scenario its WHERE clause encodes (query.md), so a doc's
// scenario is taken from the sheet it came from — authoritative, unlike re-deriving from columns.
function scenarioForSheet(name: string): 'recordType' | 'vendorName' | 'entityName' | null {
  const n = name.toLowerCase();
  if (!n.includes('mismatch')) return null; // only *_Mismatch sheets carry a scenario
  if (n.includes('record')) return 'recordType';
  if (n.includes('vendor')) return 'vendorName';
  if (n.includes('entity')) return 'entityName';
  return null;
}

/** Parse an .xlsx ArrayBuffer into documents using the SAME path as the Excel uploader. */
export function parseWorkbookBuffer(buffer: ArrayBuffer): DocClassificationDocument[] {
  const workbook = XLSX.read(buffer, { type: 'array' });

  const known = [
    ...DOC_CLASSIFICATION_REQUIRED_COLUMNS,
    ...DOC_CLASSIFICATION_COLUMNS,
    ...DOC_CLASSIFICATION_ALL_COLUMNS,
  ];
  const norm = new Map<string, string>();
  for (const c of known) norm.set(c.toLowerCase(), c);

  // Parse sheet-by-sheet so each row can be tagged with its sheet's mismatch scenario.
  const byId = new Map<string, DocClassificationDocument>();
  const idNumericColumns = new Set<string>();
  for (const sheetName of workbook.SheetNames) {
    const scenario = scenarioForSheet(sheetName);
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) as Record<string, unknown>[];
    for (const raw of rawRows) {
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) row[norm.get(k.trim().toLowerCase()) ?? k.trim()] = v;
      // Same numeric-ID guard the uploader enforces: an 18-digit ID stored as a NUMBER cell was
      // already rounded past 2^53 by SheetJS and can't be recovered as a string.
      for (const col of ['Document ID', 'Message ID', 'Tenant ID', 'vendorid']) {
        if (typeof row[col] === 'number' && Math.abs(row[col] as number) >= 1e15) idNumericColumns.add(col);
      }
      const doc = parseDocClassificationRow(row);
      if (!doc) continue;
      if (scenario) doc.mismatchScenarios = [scenario];
      const existing = byId.get(doc.documentId);
      if (existing) {
        // Same doc in multiple scenario sheets → union the scenarios, and fill in any field the
        // first-seen row left empty from this row (later scenario sheets can carry richer columns).
        if (scenario) {
          existing.mismatchScenarios = Array.from(new Set([...(existing.mismatchScenarios || []), scenario]));
        }
        const existingRec = existing as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(doc)) {
          const cur = existingRec[k];
          if ((cur === null || cur === undefined || cur === '') && v !== null && v !== undefined && v !== '') {
            existingRec[k] = v;
          }
        }
      } else {
        byId.set(doc.documentId, doc);
      }
    }
  }
  if (idNumericColumns.size > 0) {
    throw new Error(
      `Dataset has ID column(s) stored as numbers (${Array.from(idNumericColumns).join(', ')}), which corrupts ` +
      `18-digit IDs. Re-export those columns as Text.`
    );
  }
  return Array.from(byId.values());
}

/** Local-day bounds so a YYYY-MM-DD range is inclusive of the whole "to" day. */
function dayStart(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime();
}
function dayEnd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999).getTime();
}

/**
 * Fetch documents for the chosen tenant + created_at range.
 * Backend-seam: uses VITE_DATA_API_URL when configured, else the bundled dataset.
 */
export async function getData(params: GetDataParams): Promise<GetDataResult> {
  // ── Live backend path (future Metabase pull) ──
  if (isDataApiConfigured) {
    const res = await fetch(`${DATA_API_URL}/api/get_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: params.kind,               // 'regular' or 'mismatch' (wk_result_edits query)
        scenario: params.scenario || 'all',
        tenant_id: params.tenantId,
        app_def_code: params.appDefCode,
        date_from: `${params.from} 00:00:00`,
        date_to: `${params.to} 23:59:59`,
      }),
    });
    if (!res.ok) throw new Error(`Data backend returned HTTP ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    const documents = rows
      .map(r => parseDocClassificationRow(r))
      .filter((d): d is DocClassificationDocument => d !== null);
    // NOTE: do NOT re-apply byScenario here — backend rows have no `mismatchScenarios` sheet tag,
    // and the POST body already told the backend which scenario to return. Client-side tag filtering
    // would drop everything for a specific scenario.
    return { documents: filterByRange(byTenant(documents, params.tenantId), params), fetchedFromApi: true };
  }

  // ── Bundled dataset path (today) ──
  const manifest = await loadManifest();
  const entry = manifest.datasets.find(d => d.tenantId === params.tenantId && d.kind === params.kind);
  if (!entry) throw new Error(`No ${params.kind} dataset available for tenant ${params.tenantName || params.tenantId}`);

  const res = await fetch(`/data/${entry.file}`);
  if (!res.ok) throw new Error(`Could not load dataset file "${entry.file}" (HTTP ${res.status})`);
  const buffer = await res.arrayBuffer();
  const all = parseWorkbookBuffer(buffer);
  // Mismatch files are multi-tenant, so also scope to the selected tenant, then to the scenario.
  return { documents: byScenario(filterByRange(byTenant(all, params.tenantId), params), params.scenario), sourceFile: entry.file, fetchedFromApi: false };
}

/** Keep only rows for the selected tenant. Require an exact match — a blank Tenant ID must NOT
 * leak into every tenant's selection in the multi-tenant mismatch file. */
function byTenant(docs: DocClassificationDocument[], tenantId: string): DocClassificationDocument[] {
  return docs.filter(d => d.tenantId === tenantId);
}

/** Narrow to a single mismatch scenario using the authoritative sheet tags. 'all'/undefined = union. */
function byScenario(docs: DocClassificationDocument[], scenario?: ReviewScenario): DocClassificationDocument[] {
  if (!scenario || scenario === 'all') return docs;
  return docs.filter(d => (d.mismatchScenarios || []).includes(scenario));
}

/** Keep only documents whose created_at falls within the inclusive [from, to] day range. */
function filterByRange(docs: DocClassificationDocument[], params: GetDataParams): DocClassificationDocument[] {
  if (!params.from && !params.to) return docs;
  const lo = params.from ? dayStart(params.from) : -Infinity;
  const hi = params.to ? dayEnd(params.to) : Infinity;
  return docs.filter(d => {
    const t = d.createdAt instanceof Date ? d.createdAt.getTime() : new Date(d.createdAt).getTime();
    if (isNaN(t)) return true; // keep undated rows rather than silently dropping them
    return t >= lo && t <= hi;
  });
}
