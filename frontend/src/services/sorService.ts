/**
 * SOR fetching seam (Stage 2 of the prod-DB rollout).
 *
 * SOR enrichment (sor_hints / sor_master / system_hints lookups for a doc's normalized + extracted
 * vendor names) is the slow part of the pull, so it is fetched LAZILY and OFF the critical path:
 * the dashboard renders from the base pull immediately, and SOR is fetched per-document only when
 * the user opens that doc's "SOR Hints" / "Master SOR Record" tab. Results are cached by documentId.
 *
 * TODAY this is a no-op: the bundled dataset already carries SOR columns (hasSorData() is true), and
 * no backend is configured, so nothing is fetched. When VITE_SOR_API_URL is set (Stage 2), docs
 * arriving WITHOUT SOR (the live base pull omits it) get enriched on demand — no UI change.
 */
import {
  DocClassificationDocument, SorLookupResult, parseJsonColumn,
} from '../types/docClassification';

const SOR_API_URL = (import.meta.env.VITE_SOR_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
export const isSorApiConfigured = SOR_API_URL.length > 0;

/** The six SOR array fields (+ their raw strings) that the SOR tabs render. */
export type SorFields = Pick<DocClassificationDocument,
  'sorHintsNormalized' | 'sorHintsNormalizedRaw' | 'sorHintsExtracted' | 'sorHintsExtractedRaw' |
  'sorMasterNormalized' | 'sorMasterNormalizedRaw' | 'sorMasterExtracted' | 'sorMasterExtractedRaw' |
  'systemHintsNormalized' | 'systemHintsNormalizedRaw' | 'systemHintsExtracted' | 'systemHintsExtractedRaw'>;

/** True when the doc already carries SOR data (bundled files do) — skip fetching. */
export function hasSorData(doc: DocClassificationDocument): boolean {
  return !!(
    doc.sorHintsNormalized || doc.sorHintsExtracted ||
    doc.sorMasterNormalized || doc.sorMasterExtracted ||
    doc.systemHintsNormalized || doc.systemHintsExtracted ||
    doc.sorHintsNormalizedRaw || doc.sorHintsExtractedRaw ||
    doc.sorMasterNormalizedRaw || doc.sorMasterExtractedRaw ||
    doc.systemHintsNormalizedRaw || doc.systemHintsExtractedRaw
  );
}

// Cache by documentId so re-opening a doc's SOR tab doesn't re-fetch. (A backend cache keyed by
// (tenant, vendorName) collapses the far larger cross-document duplication.)
const cache = new Map<string, SorFields>();

// Accept either a parsed array or a raw JSON string from the backend, degrading like the file path.
function coerce(v: unknown): { arr: SorLookupResult[] | null; raw: string | null } {
  if (v == null) return { arr: null, raw: null };
  if (Array.isArray(v)) return { arr: v as SorLookupResult[], raw: JSON.stringify(v) };
  const { raw, parsed } = parseJsonColumn<SorLookupResult[]>(v);
  return { arr: parsed, raw };
}

/**
 * Fetch SOR fields for one document. Returns null when unconfigured or already-present (no-op).
 * Contract: POST {VITE_SOR_API_URL}/api/sor/lookup
 *   { tenantId, lookups: [{ documentId, normalizedVendorName, extractedVendorName }] }
 *   → { [documentId]: { sorHintsNormalized, sorHintsExtracted, sorMasterNormalized,
 *                       sorMasterExtracted, systemHintsNormalized, systemHintsExtracted } }
 * Each value may be a parsed array or a raw JSON string.
 */
export async function fetchSorForDoc(doc: DocClassificationDocument): Promise<SorFields | null> {
  if (!isSorApiConfigured || hasSorData(doc)) return null;
  const cached = cache.get(doc.documentId);
  if (cached) return cached;

  const res = await fetch(`${SOR_API_URL}/api/sor/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: doc.tenantId,
      lookups: [{
        documentId: doc.documentId,
        normalizedVendorName: doc.normalizedVendorName,
        extractedVendorName: doc.extractedVendorName,
      }],
    }),
  });
  if (!res.ok) throw new Error(`SOR backend returned HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, Record<string, unknown>>;
  const r = json[doc.documentId] || {};

  const hn = coerce(r.sorHintsNormalized), he = coerce(r.sorHintsExtracted);
  const mn = coerce(r.sorMasterNormalized), me = coerce(r.sorMasterExtracted);
  const sn = coerce(r.systemHintsNormalized), se = coerce(r.systemHintsExtracted);
  const fields: SorFields = {
    sorHintsNormalized: hn.arr, sorHintsNormalizedRaw: hn.raw,
    sorHintsExtracted: he.arr, sorHintsExtractedRaw: he.raw,
    sorMasterNormalized: mn.arr, sorMasterNormalizedRaw: mn.raw,
    sorMasterExtracted: me.arr, sorMasterExtractedRaw: me.raw,
    systemHintsNormalized: sn.arr, systemHintsNormalizedRaw: sn.raw,
    systemHintsExtracted: se.arr, systemHintsExtractedRaw: se.raw,
  };
  cache.set(doc.documentId, fields);
  return fields;
}
