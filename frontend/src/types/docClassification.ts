// Type definitions for AP Invoice Doc Classification and Vendor 2.1 Analysis

// JSON Structure Interfaces for 37-column format

// Document classification JSON structure
export interface DocClassificationPrediction {
  model: string;           // e.g., "LSTM"
  Reason: string;
  raw_text: string;
  languages?: Record<string, number>;
  confidence: number;
  time_taken: number;
  orientation: number;
  classification: string;  // "Invoices" or "Others"
}

export interface DocClassificationEntry {
  end_page: number;
  start_page: number;
  prediction: DocClassificationPrediction;
}

// Vendor name JSON structure
export interface VendorNameJsonEntry {
  ID: string;
  Name: string;
  Type: string;
  Value: string;              // ExtractedVendorName
  Reason: string;             // e.g., "withLLM", "withHints"
  Confidence: number;
  NormalizedValue: string;    // NormalizedVendorName
  aaiFieldName: string;
  Action?: string | null;
  Metadata?: unknown | null;
  aaiFields?: unknown | null;
  Customized?: boolean;
  Validation?: Record<string, unknown>;
  ParentIntent?: string | null;
  aaiFieldType?: string;
  aaiNamespace?: string;
  aaiAttributeType?: string | null;
  FuzzyMatchEnabled?: boolean;
  CorrelatedDetection?: boolean;
  ExtractionReference?: unknown | null;
  OtherDocsReprocessed?: boolean;
  UserDocTypeReprocessed?: boolean;
}

// SOR lookup result structure (sor_master and sor_hints have different schemas)
export interface SorLookupResult {
  created_at: string;
  updated_at: string;
  // sor_master columns schema
  coalesced_name?: string;    // Vendor name (master schema)
  status?: string;            // "active" or "inactive" (master schema)
  dirty_name?: string;
  // sor_hints columns schema (different keys)
  vendor_name?: string;       // Vendor name (hints schema)
  acceptable_name?: string;   // Acceptable name (hints schema)
  active_hints?: string;      // Hints type e.g. "acceptableNames" (hints schema)
  // common
  search_value_used: string;
  tenant_id: string;
  address?: string | null;    // Present in sor_hints columns
  address1?: string | null;   // Present in sor_master columns
  address2?: string | null;   // Present in sor_master columns
}

// Base document from Excel (extended to 37 columns)
export interface DocClassificationDocument {
  // Identifiers
  documentId: string;
  createdAt: Date;
  updatedAt: Date | null;
  messageId: string;
  tenantName: string;
  tenantId: string;

  // Status fields
  onUI: 'Active' | 'Dismissed' | 'Unknown';
  reasonForDismissal: string | null;
  written: 'Written' | 'No' | 'Unknown';
  manual: 'Bot' | 'Manual' | 'Unknown';

  // Document classification
  finalRecordType: string;
  originalRecordType: string;
  invoiceNumber: string | null;

  // Vendor information
  vendorId: string | null;
  vendorName: string;
  originalVendorName: string | null;
  extractedVendorName: string | null;
  normalizedVendorName: string | null;
  vendorNameReason: string | null;
  vendorMatchStatus: string | null;

  // File locations
  attachmentFileName: string | null;
  extractedFileS3Location: string;
  originalAttachmentFileName: string;
  s3Location: string;

  // Email provenance (mia.intent From/To)
  senderEmail?: string | null;
  recipientEmail?: string | null;

  // Customer-edit / mismatch fields (from wk_result_edits: original_json = AAI/NLU value,
  // final_json = customer-edited value). Present ONLY in the Mismatch Review dataset; undefined
  // for the regular full pull. Drive the recordType / entityName / vendorName mismatch scenarios.
  editMessageId?: string | null;
  customerEntityName?: string | null;   // final_json entity (customer entity_name)
  aaiEntityName?: string | null;        // original_json entity name (AAI/NLU) — from live query
  aaiEntityId?: string | null;          // original_json.aaiEntityId (AAI/NLU) — from live query
  customerEntityId?: string | null;     // final_json.aaiEntityId (customer edit) — from live query
  aaiRecordType?: string | null;        // original_json.recordType (AAI/NLU)
  customerRecordType?: string | null;   // final_json.recordType (customer edit)
  customerVendorName?: string | null;   // final_json.vendorName (customer edit); AAI value is originalVendorName
  // Authoritative mismatch scenario(s) for this doc, from the source sheet's WHERE clause
  // (RecordType_Mismatch / VendorName_Mismatch / EntityName_Mismatch). Union when a doc appears in
  // multiple scenario sheets. Preferred over re-deriving from field comparison.
  mismatchScenarios?: ('recordType' | 'vendorName' | 'entityName')[];

  // JSON columns (dual storage: raw + parsed) - NEW for 37-column format
  docClassificationJsonRaw?: string | null;
  docClassificationJson?: DocClassificationEntry[] | null;
  vendorNameJsonRaw?: string | null;
  vendorNameJson?: VendorNameJsonEntry[] | null;

  // Matching status columns - NEW for 37-column format
  normalizedMatchedWithOriginalVendorName?: 'Yes' | 'No' | null;
  normalizedMatchedWithFinalVendorName?: 'Yes' | 'No' | null;
  extractedMatchedWithOriginalVendorName?: 'Yes' | 'No' | null;
  extractionMatchedWithFinalVendorName?: 'Yes' | 'No' | null;

  // Data source - NEW for 37-column format
  dataSource?: string | null;

  // SOR matching columns (dual storage: raw + parsed) - NEW for 37-column format
  sorHintsNormalizedRaw?: string | null;
  sorHintsNormalized?: SorLookupResult[] | null;
  sorHintsExtractedRaw?: string | null;
  sorHintsExtracted?: SorLookupResult[] | null;
  sorMasterNormalizedRaw?: string | null;
  sorMasterNormalized?: SorLookupResult[] | null;
  sorMasterExtractedRaw?: string | null;
  sorMasterExtracted?: SorLookupResult[] | null;
  systemHintsNormalizedRaw?: string | null;
  systemHintsNormalized?: SorLookupResult[] | null;
  systemHintsExtractedRaw?: string | null;
  systemHintsExtracted?: SorLookupResult[] | null;
}

// Review selections made by user
export interface DocClassificationReview {
  // Document Classification section
  isAnInvoice: 'Invoice' | 'Others';
  expectedDocType: string;
  docClassificationIssue: 'Yes' | 'No';

  // Vendor 2.1 section
  vendor21MatchingIssue: 'Does not Exist' | 'Vendor Matching Issue' | null;
  expectedVendorName: string;
  existsInMastSor: 'Yes' | 'No' | null;

  // Reviewer notes
  comments?: string;
}

// Combined reviewed document
export interface ReviewedDocClassification extends DocClassificationDocument, DocClassificationReview {
  reviewedAt: Date;
  isAutoReviewed?: boolean;  // NEW: Flag for auto-reviewed documents
}

// Expected Excel columns (supports both 24-column and 37-column formats)
export const DOC_CLASSIFICATION_COLUMNS = [
  'Document ID',
  'created_at',
  'updated_at',
  'Message ID',
  'Tenant Name',
  'Tenant ID',
  'On UI',
  'Reason for Dismissal', // Added to match actual Excel format
  'Written',
  'Manual',
  'Final Record Type',
  'Original Record Type',
  'Invoice #',
  'vendorid',
  'vendorname',
  'OriginalVendorName',
  'ExtractedVendorName',
  'NormalizedVendorName', // Optional - not all rows have this
  'VendorNameReason',
  'Vendor Match Status',
  'attachmentFileName',
  'extractedFileS3Location',
  'originalAttachmentFileName',
  'S3Location',
] as const;

// All 37 columns for extended format (AP_Invoice_CRCGroup_10_to_17.xlsx)
export const DOC_CLASSIFICATION_ALL_COLUMNS = [
  // Original 24 columns
  'Document ID', 'created_at', 'updated_at', 'Message ID', 'Tenant Name', 'Tenant ID',
  'On UI', 'Reason for Dismissal', 'Written', 'Manual', 'Final Record Type',
  'Original Record Type', 'Invoice #', 'vendorid', 'vendorname', 'OriginalVendorName',
  'ExtractedVendorName', 'NormalizedVendorName', 'VendorNameReason', 'Vendor Match Status',
  'attachmentFileName', 'extractedFileS3Location', 'originalAttachmentFileName', 'S3Location',
  'recipient_email', 'sender_email',

  // New 13 columns for extended format
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

  // Mismatch Review (customer edits) extra columns
  'Edit Message ID', 'customer entity_name', 'AAI RecordType', 'Customer RecordType', 'Customer vendorName',
  'AAI entityID', 'Customer entityID', 'AAI entity_name',
] as const;

// Required columns (must be present for validation)
export const DOC_CLASSIFICATION_REQUIRED_COLUMNS = [
  'Document ID',
  'created_at',
  'Message ID',
  'Tenant Name',
  'Tenant ID',
] as const;

// Helper function to parse Excel dates
export function parseExcelDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    let normalized = value.trim();
    // Convert "YYYY-MM-DD HH:mm:ss.SSS" (our UTC export format) to ISO UTC so all
    // browsers parse it consistently as UTC, matching how formatDateForExcel writes it.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized) &&
        !normalized.includes('T') && !normalized.includes('Z') && !normalized.includes('+')) {
      normalized = normalized.replace(' ', 'T') + 'Z';
    }
    // Explicitly parse the "Month D, YYYY, H:MM AM/PM" locale format the exports produce
    // (e.g. "June 24, 2026, 9:29 PM"). `new Date(<that>)` works in V8/Chrome but NOT reliably in
    // Safari/JavaScriptCore, which would return Invalid Date and silently drop the whole dataset
    // from any date-range filter. Parse it deterministically instead.
    const m = normalized.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (m) {
      const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const mi = MONTHS.indexOf(m[1].toLowerCase());
      if (mi >= 0) {
        let hr = parseInt(m[4], 10) % 12;
        if (/pm/i.test(m[6])) hr += 12;
        const d = new Date(parseInt(m[3], 10), mi, parseInt(m[2], 10), hr, parseInt(m[5], 10));
        return isNaN(d.getTime()) ? null : d;
      }
    }
    const parsed = new Date(normalized);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Excel serial date number (days since 1900-01-01)
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

// Helper function to parse status fields
export function parseOnUIStatus(value: string): 'Active' | 'Dismissed' | 'Unknown' {
  if (value === 'Active' || value === 'Dismissed') {
    return value;
  }
  return 'Unknown';
}

export function parseWrittenStatus(value: string): 'Written' | 'No' | 'Unknown' {
  if (value === 'Written' || value === 'No') {
    return value;
  }
  return 'Unknown';
}

export function parseManualStatus(value: string): 'Bot' | 'Manual' | 'Unknown' {
  if (value === 'Bot' || value === 'Manual') {
    return value;
  }
  return 'Unknown';
}

// Helper function to parse Yes/No values
export function parseYesNo(value: unknown): 'Yes' | 'No' | null {
  if (!value) return null;
  const str = String(value).trim();
  if (str === 'Yes') return 'Yes';
  if (str === 'No') return 'No';
  return null;
}

// Helper function to parse JSON columns safely
export function parseJsonColumn<T>(value: unknown): { raw: string | null; parsed: T | null } {
  if (!value) return { raw: null, parsed: null };

  const rawString = String(value);
  if (rawString.trim() === '[]') return { raw: rawString, parsed: [] as T };
  if (rawString.trim() === '') return { raw: null, parsed: null };

  try {
    const parsed = JSON.parse(rawString) as T;
    return { raw: rawString, parsed };
  } catch {
    // Expected for doc_classification_json, which the extractor pulls via CAST(... AS CHAR(10000)):
    // long OCR text arrives truncated/unterminated. Degrade gracefully — keep the raw string,
    // set parsed=null — and don't spam the console (this used to log hundreds of times per load).
    return { raw: rawString, parsed: null };
  }
}

// Parse a row from Excel to DocClassificationDocument
export function parseDocClassificationRow(row: Record<string, unknown>): DocClassificationDocument | null {
  try {
    const documentId = String(row['Document ID'] || '');
    if (!documentId) return null;

    // Parse new JSON columns (for 37-column format)
    const docClassJson = parseJsonColumn<DocClassificationEntry[]>(row['doc_classification_json']);
    const vendorJson = parseJsonColumn<VendorNameJsonEntry[]>(row['vendorname_json']);
    const sorHintsNorm = parseJsonColumn<SorLookupResult[]>(row['sor_hints_value_normalized_matched_with_OriginalvendorName']);
    const sorHintsExt = parseJsonColumn<SorLookupResult[]>(row['sor_hints_value_Extracted_matched_with_OriginalvendorName']);
    const sorMasterNorm = parseJsonColumn<SorLookupResult[]>(row['sor_master_value_normalized_matched_with_OriginalvendorName']);
    const sorMasterExt = parseJsonColumn<SorLookupResult[]>(row['sor_master_value_Extracted_matched_with_OriginalvendorName']);
    const sysHintsNorm = parseJsonColumn<SorLookupResult[]>(row['Systemhints_value_for_Normalized_VendorName']);
    const sysHintsExt = parseJsonColumn<SorLookupResult[]>(row['Systemhints_value_for_Extracted_VendorName']);

    return {
      // Identifiers
      documentId,
      createdAt: parseExcelDate(row['created_at']) || new Date(),
      updatedAt: parseExcelDate(row['updated_at']),
      messageId: String(row['Message ID'] || ''),
      tenantName: String(row['Tenant Name'] || ''),
      tenantId: String(row['Tenant ID'] || ''),

      // Status fields
      onUI: parseOnUIStatus(String(row['On UI'] || '')),
      reasonForDismissal: row['Reason for Dismissal'] ? String(row['Reason for Dismissal']) : null,
      written: parseWrittenStatus(String(row['Written'] || '')),
      manual: parseManualStatus(String(row['Manual'] || '')),

      // Document classification
      finalRecordType: String(row['Final Record Type'] || ''),
      originalRecordType: String(row['Original Record Type'] || ''),
      invoiceNumber: row['Invoice #'] ? String(row['Invoice #']) : null,

      // Vendor information
      vendorId: row['vendorid'] ? String(row['vendorid']) : null,
      vendorName: String(row['vendorname'] || ''),
      originalVendorName: row['OriginalVendorName'] ? String(row['OriginalVendorName']) : null,
      extractedVendorName: row['ExtractedVendorName'] ? String(row['ExtractedVendorName']) : null,
      normalizedVendorName: row['NormalizedVendorName'] ? String(row['NormalizedVendorName']) : null,
      vendorNameReason: row['VendorNameReason'] ? String(row['VendorNameReason']) : null,
      vendorMatchStatus: row['Vendor Match Status'] ? String(row['Vendor Match Status']) : null,

      // File locations
      attachmentFileName: row['attachmentFileName'] ? String(row['attachmentFileName']) : null,
      extractedFileS3Location: String(row['extractedFileS3Location'] || ''),
      originalAttachmentFileName: String(row['originalAttachmentFileName'] || ''),
      s3Location: String(row['S3Location'] || ''),

      // Email provenance
      senderEmail: row['sender_email'] ? String(row['sender_email']) : null,
      recipientEmail: row['recipient_email'] ? String(row['recipient_email']) : null,

      // Customer-edit / mismatch fields (only present in the Mismatch Review dataset)
      editMessageId: row['Edit Message ID'] ? String(row['Edit Message ID']) : null,
      customerEntityName: row['customer entity_name'] ? String(row['customer entity_name']) : null,
      aaiEntityName: row['AAI entity_name'] ? String(row['AAI entity_name']) : null,
      aaiEntityId: row['AAI entityID'] ? String(row['AAI entityID']) : null,
      customerEntityId: row['Customer entityID'] ? String(row['Customer entityID']) : null,
      aaiRecordType: row['AAI RecordType'] ? String(row['AAI RecordType']) : null,
      customerRecordType: row['Customer RecordType'] ? String(row['Customer RecordType']) : null,
      customerVendorName: row['Customer vendorName'] ? String(row['Customer vendorName']) : null,

      // NEW: JSON columns (dual storage)
      docClassificationJsonRaw: docClassJson.raw,
      docClassificationJson: docClassJson.parsed,
      vendorNameJsonRaw: vendorJson.raw,
      vendorNameJson: vendorJson.parsed,

      // NEW: Matching columns
      normalizedMatchedWithOriginalVendorName: parseYesNo(row['normalized_matched_with_OriginalvendorName']),
      normalizedMatchedWithFinalVendorName: parseYesNo(row['normalized_matched_with_finalvendorName']),
      extractedMatchedWithOriginalVendorName: parseYesNo(row['Extracted_matched_with_OriginalvendorName']),
      extractionMatchedWithFinalVendorName: parseYesNo(row['Extraction_matched_with_finalvendorName']),

      // NEW: Data source
      dataSource: row['Data_Source'] ? String(row['Data_Source']) : null,

      // NEW: SOR columns (dual storage)
      sorHintsNormalizedRaw: sorHintsNorm.raw,
      sorHintsNormalized: sorHintsNorm.parsed,
      sorHintsExtractedRaw: sorHintsExt.raw,
      sorHintsExtracted: sorHintsExt.parsed,
      sorMasterNormalizedRaw: sorMasterNorm.raw,
      sorMasterNormalized: sorMasterNorm.parsed,
      sorMasterExtractedRaw: sorMasterExt.raw,
      sorMasterExtracted: sorMasterExt.parsed,
      systemHintsNormalizedRaw: sysHintsNorm.raw,
      systemHintsNormalized: sysHintsNorm.parsed,
      systemHintsExtractedRaw: sysHintsExt.raw,
      systemHintsExtracted: sysHintsExt.parsed,
    };
  } catch (error) {
    console.error('Error parsing doc classification row:', error);
    return null;
  }
}
