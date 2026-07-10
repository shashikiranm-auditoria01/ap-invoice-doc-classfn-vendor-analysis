/**
 * Export utilities for reviewed doc classification documents
 * Uses xlsx-js-style for cell background color support
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import XLSX from 'xlsx-js-style';
import { DocClassificationDocument, ReviewedDocClassification } from '../types/docClassification';
import { recordTypeStatus, reviewVendorStatus } from './reviewStatus';

/**
 * Format date for Excel as UTC "YYYY-MM-DD HH:mm:ss".
 * This round-trips losslessly: parseExcelDate recognizes this exact shape and re-parses it as UTC
 * (with seconds), so exporting on one machine and re-importing on another no longer drifts by the
 * timezone offset or drops the seconds — the bug the old locale-string format had.
 */
function formatDateForExcel(date: Date | null | undefined): string {
  if (!date || isNaN(date.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}

/**
 * Serialize JSON column value for Excel export
 * Preserves raw string if available, otherwise stringifies the parsed value
 */
function serializeJsonColumn(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value) && value.length === 0) return '[]';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Column layout constants
// ---------------------------------------------------------------------------

// Column index ranges (0-based) used for background fills
// Reviewed export: 48 columns total
//   0-23:   original columns (white)
//   24-36:  JSON/SOR/matching columns (amber)
//   37-45:  review columns (green, 9 cols incl. Review Source)
//   46-47:  status columns (blue)

// All-docs export: 49 columns total (same layout + 'Reviewed' at index 37, review cols 38-46, status 47-48)

const AMBER_FILL = { fgColor: { rgb: 'FFF3CD' } };
const GREEN_FILL = { fgColor: { rgb: 'DCFCE7' } };
const BLUE_FILL  = { fgColor: { rgb: 'DBEAFE' } };

const AMBER_HEADER_FONT = { bold: true, sz: 10, color: { rgb: '92400E' } };
const GREEN_HEADER_FONT = { bold: true, sz: 10, color: { rgb: '166534' } };
const BLUE_HEADER_FONT  = { bold: true, sz: 10, color: { rgb: '1E40AF' } };
const DEFAULT_HEADER_FONT = { bold: true, sz: 10, color: { rgb: '000000' } };

interface CellStyle {
  fill?: { patternType?: string; fgColor?: { rgb: string } };
  font?: { bold?: boolean; sz?: number; color?: { rgb: string } };
  alignment?: { wrapText?: boolean; horizontal?: string };
}

interface CellDef {
  v: string | number;
  t: string;
  s?: CellStyle;
}

// Per-value badge color overrides (matching the UI pill colors exactly)
const VALUE_STYLES: Record<string, CellStyle> = {
  // On UI
  'active':            { fill: { patternType: 'solid', fgColor: { rgb: 'DCFCE7' } }, font: { color: { rgb: '166534' }, sz: 10 } },
  'dismissed':         { fill: { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } }, font: { color: { rgb: '991B1B' }, sz: 10 } },
  // Written
  'written':           { fill: { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } }, font: { color: { rgb: '1D4ED8' }, sz: 10 } },
  // Manual/Bot
  'manual':            { fill: { patternType: 'solid', fgColor: { rgb: 'F3E8FF' } }, font: { color: { rgb: '6B21A8' }, sz: 10 } },
  'bot':               { fill: { patternType: 'solid', fgColor: { rgb: 'CFFAFE' } }, font: { color: { rgb: '155E75' }, sz: 10 } },
  // Generic Yes/No for match columns
  'yes':               { fill: { patternType: 'solid', fgColor: { rgb: 'DCFCE7' } }, font: { color: { rgb: '166534' }, sz: 10 } },
  'no':                { fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }, font: { color: { rgb: '374151' }, sz: 10 } },
  // Invoice type
  'invoice':           { fill: { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } }, font: { color: { rgb: '1D4ED8' }, sz: 10 } },
  'others':            { fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }, font: { color: { rgb: '374151' }, sz: 10 } },
  // Status computed
  'record match':      { fill: { patternType: 'solid', fgColor: { rgb: 'DCFCE7' } }, font: { color: { rgb: '166534' }, sz: 10 } },
  'record mismatch':   { fill: { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } }, font: { color: { rgb: '991B1B' }, sz: 10 } },
  'vendor match':      { fill: { patternType: 'solid', fgColor: { rgb: 'DCFCE7' } }, font: { color: { rgb: '166534' }, sz: 10 } },
  'vendor mismatch':   { fill: { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } }, font: { color: { rgb: '991B1B' }, sz: 10 } },
};

// Columns that show colored badges in the UI — value style takes precedence over column-group fill
const BADGE_COLUMNS = new Set([
  'On UI', 'Written', 'Manual',
  'normalized_matched_with_OriginalvendorName', 'normalized_matched_with_finalvendorName',
  'Extracted_matched_with_OriginalvendorName', 'Extraction_matched_with_finalvendorName',
  'Is an Invoice',
  'Doc Classification Issue',
  'Exists in mast_sor',
  'Record Type Status', 'Vendor Match Status (Computed)',
]);

// Doc Classification Issue has inverted Yes/No semantics (Yes = red, No = green)
const ISSUE_COLUMNS = new Set(['Doc Classification Issue']);

function getValueStyle(colHeader: string, value: string | number): CellStyle | undefined {
  if (!BADGE_COLUMNS.has(colHeader)) return undefined;
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === '-') return undefined;

  // Inverted: Yes = red, No = green for issue columns
  if (ISSUE_COLUMNS.has(colHeader)) {
    if (v === 'yes') return VALUE_STYLES['dismissed']; // red
    if (v === 'no')  return VALUE_STYLES['active'];    // green
  }

  // Exists in mast_sor: Yes = green, No = red
  if (colHeader === 'Exists in mast_sor') {
    if (v === 'yes') return VALUE_STYLES['active'];    // green
    if (v === 'no')  return VALUE_STYLES['dismissed']; // red
  }

  return VALUE_STYLES[v];
}

function makeCell(
  value: string | number,
  colFill?: typeof AMBER_FILL,
  colFont?: typeof AMBER_HEADER_FONT,
  colHeader?: string,
): CellDef {
  const cell: CellDef = { v: value ?? '', t: 's' };
  const valueStyle = colHeader ? getValueStyle(colHeader, value) : undefined;

  if (valueStyle) {
    // Value-based style overrides column-group fill
    cell.s = { ...valueStyle };
  } else if (colFill || colFont) {
    cell.s = {};
    if (colFill) cell.s.fill = { patternType: 'solid', ...colFill };
    if (colFont) cell.s.font = colFont;
  }
  return cell;
}


// ---------------------------------------------------------------------------
// Reviewed-only export
// ---------------------------------------------------------------------------

export function exportReviewedDocClassifications(
  reviewedDocs: ReviewedDocClassification[]
): void {
  if (reviewedDocs.length === 0) {
    alert('No reviewed documents to export');
    return;
  }

  // Column groups (0-based indices, header row = row 0)
  // 0-23:  original  → no fill
  // 24-36: JSON/SOR  → amber
  // 37-44: review    → green (Is Invoice … Comments)
  // 45-46: status    → blue

  const AMBER_START = 24;
  const GREEN_START = 37;
  const BLUE_START  = 46; // review group is now 9 cols (…Comments, Auto-Reviewed)

  const headers: string[] = [
    // Original 24
    'Document ID', 'created_at', 'updated_at', 'Message ID', 'Tenant Name', 'Tenant ID',
    'On UI', 'Reason for Dismissal', 'Written', 'Manual', 'Final Record Type',
    'Original Record Type', 'Invoice #', 'vendorid', 'vendorname', 'OriginalVendorName',
    'ExtractedVendorName', 'NormalizedVendorName', 'VendorNameReason', 'Vendor Match Status',
    'attachmentFileName', 'extractedFileS3Location', 'originalAttachmentFileName', 'S3Location',
    // 13 JSON/SOR
    'doc_classification_json', 'vendorname_json',
    'normalized_matched_with_OriginalvendorName', 'normalized_matched_with_finalvendorName',
    'Extracted_matched_with_OriginalvendorName', 'Extraction_matched_with_finalvendorName',
    'Data_Source',
    'sor_hints_value_normalized_matched_with_OriginalvendorName',
    'sor_hints_value_Extracted_matched_with_OriginalvendorName',
    'sor_master_value_normalized_matched_with_OriginalvendorName',
    'sor_master_value_Extracted_matched_with_OriginalvendorName',
    'Systemhints_value_for_Normalized_VendorName',
    'Systemhints_value_for_Extracted_VendorName',
    // 9 review columns
    'Is an Invoice', 'Expected Doc Type', 'Doc Classification Issue',
    'Vendor 2.1 Matching Issue', 'Expected Vendor Name', 'Exists in mast_sor',
    'Reviewed At', 'Comments', 'Auto-Reviewed',
    // 2 status columns
    'Record Type Status', 'Vendor Match Status (Computed)',
  ];

  // Build header row with styles
  const headerRow: CellDef[] = headers.map((h, c) => {
    if (c >= BLUE_START)  return makeCell(h, BLUE_FILL,  BLUE_HEADER_FONT);
    if (c >= GREEN_START) return makeCell(h, GREEN_FILL, GREEN_HEADER_FONT);
    if (c >= AMBER_START) return makeCell(h, AMBER_FILL, AMBER_HEADER_FONT);
    return makeCell(h, undefined, DEFAULT_HEADER_FONT);
  });

  // Build data rows
  const dataRows: CellDef[][] = reviewedDocs.map(doc => {
    const origValues: (string | number)[] = [
      doc.documentId,
      formatDateForExcel(doc.createdAt),
      formatDateForExcel(doc.updatedAt),
      doc.messageId,
      doc.tenantName,
      doc.tenantId,
      doc.onUI,
      doc.reasonForDismissal || '',
      doc.written,
      doc.manual,
      doc.finalRecordType,
      doc.originalRecordType,
      doc.invoiceNumber || '',
      doc.vendorId || '',
      doc.vendorName,
      doc.originalVendorName || '',
      doc.extractedVendorName || '',
      doc.normalizedVendorName || '',
      doc.vendorNameReason || '',
      doc.vendorMatchStatus || '',
      doc.attachmentFileName || '',
      doc.extractedFileS3Location,
      doc.originalAttachmentFileName,
      doc.s3Location,
    ];

    const amberValues: (string | number)[] = [
      serializeJsonColumn(doc.docClassificationJsonRaw || doc.docClassificationJson),
      serializeJsonColumn(doc.vendorNameJsonRaw || doc.vendorNameJson),
      doc.normalizedMatchedWithOriginalVendorName || '',
      doc.normalizedMatchedWithFinalVendorName || '',
      doc.extractedMatchedWithOriginalVendorName || '',
      doc.extractionMatchedWithFinalVendorName || '',
      doc.dataSource || '',
      serializeJsonColumn(doc.sorHintsNormalizedRaw || doc.sorHintsNormalized),
      serializeJsonColumn(doc.sorHintsExtractedRaw || doc.sorHintsExtracted),
      serializeJsonColumn(doc.sorMasterNormalizedRaw || doc.sorMasterNormalized),
      serializeJsonColumn(doc.sorMasterExtractedRaw || doc.sorMasterExtracted),
      serializeJsonColumn(doc.systemHintsNormalizedRaw || doc.systemHintsNormalized),
      serializeJsonColumn(doc.systemHintsExtractedRaw || doc.systemHintsExtracted),
    ];

    const greenValues: (string | number)[] = [
      doc.isAnInvoice,
      doc.expectedDocType,
      doc.docClassificationIssue,
      doc.vendor21MatchingIssue || '',
      doc.expectedVendorName,
      doc.existsInMastSor || '',
      formatDateForExcel(doc.reviewedAt),
      doc.comments || '',
      doc.isAutoReviewed ? 'Yes' : 'No',
    ];

    const blueValues: (string | number)[] = [
      recordTypeStatus(doc.finalRecordType, doc.originalRecordType),
      reviewVendorStatus(doc),
    ];

    const row: CellDef[] = [
      ...origValues.map((v, i) => makeCell(v, undefined, undefined, headers[i])),
      ...amberValues.map((v, i) => makeCell(v, AMBER_FILL, undefined, headers[AMBER_START + i])),
      ...greenValues.map((v, i) => makeCell(v, GREEN_FILL, undefined, headers[GREEN_START + i])),
      ...blueValues.map((v, i) => makeCell(v, BLUE_FILL, undefined, headers[BLUE_START + i])),
    ];

    return row;
  });

  const aoa: CellDef[][] = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto-size columns (cap at 60)
  const colCount = headers.length;
  const colWidths: { wch: number }[] = Array.from({ length: colCount }, (_, c) => {
    let max = headers[c].length;
    for (let r = 1; r < aoa.length; r++) {
      const cell = aoa[r][c];
      if (cell) max = Math.max(max, String(cell.v ?? '').length);
    }
    return { wch: Math.min(max + 2, 60) };
  });
  ws['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, 'Reviewed Documents');

  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `doc_classification_reviewed_${date}.xlsx`);
}

// ---------------------------------------------------------------------------
// All-docs export
// ---------------------------------------------------------------------------

export function exportAllDocClassifications(
  allDocs: DocClassificationDocument[],
  reviewedDocs: ReviewedDocClassification[]
): void {
  if (allDocs.length === 0) {
    alert('No documents to export');
    return;
  }

  const reviewedMap = new Map<string, ReviewedDocClassification>();
  reviewedDocs.forEach(doc => reviewedMap.set(doc.documentId, doc));

  // 0-23:  original  → no fill
  // 24-36: JSON/SOR  → amber
  // 37:    Reviewed  → no fill
  // 38-46: review    → green (…Comments, Auto-Reviewed)
  // 47-48: status    → blue

  const AMBER_START = 24;
  const GREEN_START = 38;
  const BLUE_START  = 47;

  const headers: string[] = [
    // Original 24
    'Document ID', 'created_at', 'updated_at', 'Message ID', 'Tenant Name', 'Tenant ID',
    'On UI', 'Reason for Dismissal', 'Written', 'Manual', 'Final Record Type',
    'Original Record Type', 'Invoice #', 'vendorid', 'vendorname', 'OriginalVendorName',
    'ExtractedVendorName', 'NormalizedVendorName', 'VendorNameReason', 'Vendor Match Status',
    'attachmentFileName', 'extractedFileS3Location', 'originalAttachmentFileName', 'S3Location',
    // 13 JSON/SOR
    'doc_classification_json', 'vendorname_json',
    'normalized_matched_with_OriginalvendorName', 'normalized_matched_with_finalvendorName',
    'Extracted_matched_with_OriginalvendorName', 'Extraction_matched_with_finalvendorName',
    'Data_Source',
    'sor_hints_value_normalized_matched_with_OriginalvendorName',
    'sor_hints_value_Extracted_matched_with_OriginalvendorName',
    'sor_master_value_normalized_matched_with_OriginalvendorName',
    'sor_master_value_Extracted_matched_with_OriginalvendorName',
    'Systemhints_value_for_Normalized_VendorName',
    'Systemhints_value_for_Extracted_VendorName',
    // Reviewed indicator
    'Reviewed',
    // 9 review columns
    'Is an Invoice', 'Expected Doc Type', 'Doc Classification Issue',
    'Vendor 2.1 Matching Issue', 'Expected Vendor Name', 'Exists in mast_sor',
    'Reviewed At', 'Comments', 'Auto-Reviewed',
    // 2 status columns
    'Record Type Status', 'Vendor Match Status (Computed)',
  ];

  const headerRow: CellDef[] = headers.map((h, c) => {
    if (c >= BLUE_START)  return makeCell(h, BLUE_FILL,  BLUE_HEADER_FONT);
    if (c >= GREEN_START) return makeCell(h, GREEN_FILL, GREEN_HEADER_FONT);
    if (c >= AMBER_START) return makeCell(h, AMBER_FILL, AMBER_HEADER_FONT);
    return makeCell(h, undefined, DEFAULT_HEADER_FONT);
  });

  const dataRows: CellDef[][] = allDocs.map(doc => {
    const reviewed = reviewedMap.get(doc.documentId);
    const isReviewed = !!reviewed;

    const origValues: (string | number)[] = [
      doc.documentId,
      formatDateForExcel(doc.createdAt),
      formatDateForExcel(doc.updatedAt),
      doc.messageId,
      doc.tenantName,
      doc.tenantId,
      doc.onUI,
      doc.reasonForDismissal || '',
      doc.written,
      doc.manual,
      doc.finalRecordType,
      doc.originalRecordType,
      doc.invoiceNumber || '',
      doc.vendorId || '',
      doc.vendorName,
      doc.originalVendorName || '',
      doc.extractedVendorName || '',
      doc.normalizedVendorName || '',
      doc.vendorNameReason || '',
      doc.vendorMatchStatus || '',
      doc.attachmentFileName || '',
      doc.extractedFileS3Location,
      doc.originalAttachmentFileName,
      doc.s3Location,
    ];

    const amberValues: (string | number)[] = [
      serializeJsonColumn(doc.docClassificationJsonRaw || doc.docClassificationJson),
      serializeJsonColumn(doc.vendorNameJsonRaw || doc.vendorNameJson),
      doc.normalizedMatchedWithOriginalVendorName || '',
      doc.normalizedMatchedWithFinalVendorName || '',
      doc.extractedMatchedWithOriginalVendorName || '',
      doc.extractionMatchedWithFinalVendorName || '',
      doc.dataSource || '',
      serializeJsonColumn(doc.sorHintsNormalizedRaw || doc.sorHintsNormalized),
      serializeJsonColumn(doc.sorHintsExtractedRaw || doc.sorHintsExtracted),
      serializeJsonColumn(doc.sorMasterNormalizedRaw || doc.sorMasterNormalized),
      serializeJsonColumn(doc.sorMasterExtractedRaw || doc.sorMasterExtracted),
      serializeJsonColumn(doc.systemHintsNormalizedRaw || doc.systemHintsNormalized),
      serializeJsonColumn(doc.systemHintsExtractedRaw || doc.systemHintsExtracted),
    ];

    const greenValues: (string | number)[] = isReviewed ? [
      reviewed.isAnInvoice,
      reviewed.expectedDocType,
      reviewed.docClassificationIssue,
      reviewed.vendor21MatchingIssue || '',
      reviewed.expectedVendorName,
      reviewed.existsInMastSor || '',
      formatDateForExcel(reviewed.reviewedAt),
      reviewed.comments || '',
      reviewed.isAutoReviewed ? 'Yes' : 'No',
    ] : ['', '', '', '', '', '', '', '', ''];

    // Record Type Status is computable for EVERY doc (needs only original/final record type), so
    // emit it for all rows — matching the on-screen Analysis filter/Details badge. Only the
    // vendor "Computed" status depends on a review, so it stays review-gated.
    const blueValues: (string | number)[] = [
      recordTypeStatus(doc.finalRecordType, doc.originalRecordType),
      isReviewed ? reviewVendorStatus(reviewed) : '',
    ];

    return [
      ...origValues.map((v, i) => makeCell(v, undefined, undefined, headers[i])),
      ...amberValues.map((v, i) => makeCell(v, AMBER_FILL, undefined, headers[AMBER_START + i])),
      makeCell(isReviewed ? 'Yes' : 'No', undefined, undefined, 'Reviewed'),
      ...greenValues.map((v, i) => makeCell(v, GREEN_FILL, undefined, headers[GREEN_START + i])),
      ...blueValues.map((v, i) => makeCell(v, BLUE_FILL, undefined, headers[BLUE_START + i])),
    ];
  });

  const aoa: CellDef[][] = [headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const colCount = headers.length;
  const colWidths: { wch: number }[] = Array.from({ length: colCount }, (_, c) => {
    let max = headers[c].length;
    for (let r = 1; r < aoa.length; r++) {
      const cell = aoa[r][c];
      if (cell) max = Math.max(max, String(cell.v ?? '').length);
    }
    return { wch: Math.min(max + 2, 60) };
  });
  ws['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws, 'All Documents');

  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `doc_classification_all_${date}.xlsx`);
}

// ---------------------------------------------------------------------------
// Metrics report export (the Metrics tab "Export Report" button)
// ---------------------------------------------------------------------------

export interface MetricsReportTenant {
  name: string; total: number; reviewed: number;
  // Pre-formatted accuracy strings (e.g. "100%" or "—" when there are no user reviews),
  // so the export matches exactly what the screen shows.
  docAccuracy: string; vendorAccuracy: string; docIssues: number; vendorIssues: number;
}
export interface MetricsReport {
  total: number; reviewedCount: number; reviewProgress: number;
  docAccuracy: string; vendorAccuracy: string;
  active: number; dismissed: number; uiUnknown: number;
  written: number; notWritten: number;
  tenants: MetricsReportTenant[];
  weekly: { label: string; count: number }[];
}

const H = (v: string): CellDef => makeCell(v, undefined, DEFAULT_HEADER_FONT);

/** Build a styled multi-sheet metrics report and trigger a download. */
export function exportMetricsReport(r: MetricsReport): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Summary (KPIs + distributions)
  const summary: CellDef[][] = [
    [H('AP Vendor 2.1 Reviewed Metrics'), H('')],
    [makeCell('Metric'), makeCell('Value')],
    [makeCell('Total Documents'), makeCell(r.total)],
    [makeCell('Reviewed Documents'), makeCell(r.reviewedCount)],
    [makeCell('Review Completed %'), makeCell(`${r.reviewProgress}%`)],
    [makeCell('Doc Classification Accuracy'), makeCell(r.docAccuracy)],
    [makeCell('Vendor Matching Accuracy'), makeCell(r.vendorAccuracy)],
    [makeCell('On UI — Active'), makeCell(r.active)],
    [makeCell('On UI — Dismissed'), makeCell(r.dismissed)],
    [makeCell('On UI — Unknown'), makeCell(r.uiUnknown)],
    [makeCell('Written to ERP'), makeCell(r.written)],
    [makeCell('Not Written'), makeCell(r.notWritten)],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summary);
  ws1['!cols'] = [{ wch: 32 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  // Sheet 2 — Tenant breakdown
  const tRows: CellDef[][] = [[
    H('Tenant Name'), H('Total Docs'), H('Reviewed'),
    H('Doc Classfn Accuracy %'), H('Vendor Matching Accuracy %'),
    H('Doc Classification Issues'), H('Vendor Name Assignment Issues'),
  ]];
  r.tenants.forEach(t => tRows.push([
    makeCell(t.name), makeCell(t.total), makeCell(t.reviewed),
    makeCell(t.docAccuracy), makeCell(t.vendorAccuracy),
    makeCell(t.docIssues), makeCell(t.vendorIssues),
  ]));
  const ws2 = XLSX.utils.aoa_to_sheet(tRows);
  ws2['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 24 }, { wch: 22 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'By Tenant');

  // Sheet 3 — Weekly trend
  const wRows: CellDef[][] = [[H('Week Starting'), H('Documents')]];
  r.weekly.forEach(w => wRows.push([makeCell(w.label), makeCell(w.count)]));
  const ws3 = XLSX.utils.aoa_to_sheet(wRows);
  ws3['!cols'] = [{ wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Weekly Trend');

  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `ap_vendor21_metrics_${date}.xlsx`);
}
