/**
 * Single source of truth for vendor-match and record-type status.
 * Every view (Analysis filters, Reviewed table, Details panel, Metrics, Export) must use
 * these helpers so the same document reads the same everywhere.
 */
import { DocClassificationDocument, ReviewedDocClassification } from '../types/docClassification';

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

export type VendorMatchCategory = 'Vendor Match' | 'Vendor Mismatch' | 'No Original Data';
export const VENDOR_MATCH_CATEGORIES: VendorMatchCategory[] = ['Vendor Match', 'Vendor Mismatch', 'No Original Data'];

/**
 * Canonical vendor-match status for a document. Prefers the source `Vendor Match Status`
 * column (exact, normalized); if absent, derives it from original vs final vendor name.
 * Keeps "No Original Data" as its own category instead of folding it into Mismatch.
 */
export function canonicalVendorMatch(doc: Pick<DocClassificationDocument, 'vendorMatchStatus' | 'originalVendorName' | 'vendorName'>): VendorMatchCategory {
  const s = norm(doc.vendorMatchStatus);
  if (s === 'vendor match') return 'Vendor Match';
  if (s === 'vendor mismatch') return 'Vendor Mismatch';
  if (s === 'no original data') return 'No Original Data';
  const orig = norm(doc.originalVendorName);
  if (!orig) return 'No Original Data';
  return orig === norm(doc.vendorName) ? 'Vendor Match' : 'Vendor Mismatch';
}

export type RecordTypeStatus = 'Record Match' | 'Record Mismatch' | 'No Original';

/**
 * Record-type status = AAI original record type vs final record type (normalized).
 * NOTE: this compares the raw record types, NOT the reviewer's binary Invoice/Others choice —
 * so a VB_CREDIT_MEMO whose original == final is "Record Match", not a false "Mismatch".
 */
export function recordTypeStatus(finalRecordType?: string | null, originalRecordType?: string | null): RecordTypeStatus {
  const o = norm(originalRecordType);
  const f = norm(finalRecordType);
  if (!o) return 'No Original';
  return o === f ? 'Record Match' : 'Record Mismatch';
}

/**
 * The review's vendor outcome, for the computed "Vendor Match Status" column in the
 * reviewed table / export. Distinguishes "Does not Exist" from a true match.
 */
export function reviewVendorStatus(doc: Pick<ReviewedDocClassification, 'vendor21MatchingIssue' | 'isAnInvoice'>): 'Vendor Match' | 'Vendor Mismatch' | 'Does not Exist' | '—' {
  if (doc.isAnInvoice === 'Others') return '—';                 // vendor N/A for non-invoices
  if (doc.vendor21MatchingIssue === 'Vendor Matching Issue') return 'Vendor Mismatch';
  if (doc.vendor21MatchingIssue === 'Does not Exist') return 'Does not Exist';
  return 'Vendor Match';
}

/**
 * Customer-edit mismatch scenarios (from query.md / wk_result_edits): AAI/NLU value (original_json)
 * vs the customer-edited value (final_json), for the three review scenarios. Only meaningful for the
 * Mismatch Review dataset; for regular docs the customer-* fields are absent and everything is false.
 */
export type MismatchScenario = 'recordType' | 'vendorName' | 'entityName';

export function customerEditMismatches(doc: Pick<DocClassificationDocument,
  'aaiRecordType' | 'customerRecordType' | 'originalVendorName' | 'customerVendorName' |
  'aaiEntityId' | 'customerEntityId' | 'customerEntityName' | 'editMessageId' | 'mismatchScenarios'>) {
  // Prefer the authoritative scenario tags from the source sheet's WHERE clause; these define
  // exactly which mismatch the row was pulled for (query.md), which a column comparison can't
  // always reproduce (e.g. OriginalVendorName != original_json.vendorName).
  const tags = doc.mismatchScenarios;
  if (tags && tags.length > 0) {
    return {
      recordType: tags.includes('recordType'),
      vendorName: tags.includes('vendorName'),
      entityName: tags.includes('entityName'),
      any: true,
      isCustomerEditRecord: true,
    };
  }
  // Fallback: derive from AAI vs customer field comparison (untagged sources / live query rows).
  const has = (a?: string | null, b?: string | null) => !!(a && b) && norm(a) !== norm(b);
  const recordType = has(doc.aaiRecordType, doc.customerRecordType);
  const vendorName = has(doc.originalVendorName, doc.customerVendorName);
  const entityName = has(doc.aaiEntityId, doc.customerEntityId);
  const isCustomerEditRecord = !!(doc.editMessageId || doc.customerRecordType || doc.customerVendorName ||
    doc.customerEntityName || doc.customerEntityId);
  return { recordType, vendorName, entityName, any: recordType || vendorName || entityName, isCustomerEditRecord };
}
