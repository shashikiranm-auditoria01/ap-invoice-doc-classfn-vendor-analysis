// Document types based on new Excel data structure (query_result format)

export type OnUIStatus = 'Active' | 'Dismissed' | 'Unknown';
export type WrittenStatus = 'Written' | 'No' | 'Unknown';
export type ManualStatus = 'Bot' | 'Manual' | 'Unknown';
export type FieldName = 'vendorName' | 'currency' | 'dueDate' | 'freight' | string;
export type RecordType = 'Invoice' | string;
export type FieldType = 'Header' | 'Line' | string;

// New document interface matching the query_result Excel format
export interface Document {
  // Identifiers - stored as strings to preserve precision for large integers
  documentId: string;
  id: string;
  messageId: string;
  tenantId: string;
  
  // Timestamps
  createdAt: Date;
  
  // Vendor info (new column)
  vendorName: string;
  
  // Status fields
  onUI: OnUIStatus;
  reasonForDismissal: string | null;
  written: WrittenStatus;
  manual: ManualStatus;
  
  // Record info
  recordType: RecordType;
  stdHeaderEdits: number;
  stdLineEdits: number;
  headerEdits: number;
  lineEdits: number;
  
  // Edited field info (new columns)
  editedFieldName: string;
  editedFieldType: FieldType;
  editedValue: string;
  editedOriginalValue: string | null;
  extractedValueFromIntent: string | null;
  normalizedValueFromIntent: string | null;
  
  // Field type from edits_detail (Standard/Extended)
  detailFieldType: string | null;
  
  // File info
  fileName?: string;
  s3Key: string;
  extractedFileS3Location?: string;
  originalAttachmentFileName: string;
  s3Location: string;
  
  // JSON blobs (lazy loaded - stored as strings)
  originalJson?: string;
  finalJson?: string;
  editsDetail?: string;
}

// Legacy document interface for backward compatibility
export interface LegacyDocument {
  documentId: string;
  id: string;
  messageId: string;
  tenantId: string;
  createdAt: Date;
  onUI: OnUIStatus;
  reasonForDismissal: string | null;
  written: WrittenStatus;
  manual: ManualStatus;
  recordType: RecordType;
  stdHeaderEdits: number;
  stdLineEdits: number;
  headerEdits: number;
  lineEdits: number;
  fieldName: FieldName;
  type: FieldType;
  value: string;
  originalValue: string | null;
  extractedVendorName?: string;
  normalizedVendorName?: string;
  extractedCurrency?: string;
  extractedDueDate?: string;
  extractedInvoiceDate?: string;
  extractedTotalAmount?: string;
  extractedSupplierDate?: string;
  extractedInvoiceNumber?: string;
  extractedTotalTaxAmount?: string;
  extractedPurchaseOrder?: string;
  normalizedCurrency?: string;
  normalizedDueDate?: string;
  normalizedInvoiceDate?: string;
  normalizedTotalAmount?: string;
  normalizedSupplierDate?: string;
  normalizedInvoiceNumber?: string;
  normalizedTotalTaxAmount?: string;
  normalizedPurchaseOrder?: string;
  vendorMatchStatusValue?: string;
  vendorMatchStatusOriginalValue?: string;
  fileName?: string;
  s3Key: string;
  extractedFileS3Location?: string;
  originalAttachmentFileName: string;
  s3Location: string;
  originalJson?: string;
  finalJson?: string;
  editsDetail?: string;
}

export interface DocumentDetail extends Document {
  // Parsed JSON for detail view
  parsedOriginalJson?: Record<string, unknown>;
  parsedFinalJson?: Record<string, unknown>;
  parsedEditsDetail?: EditsDetail;
}

export interface EditsDetail {
  fields: EditField[];
  linesAdded?: number;
  linesTotal?: number;
  linesDeleted?: number;
  newLinesAdded?: number;
  previousLineEdits?: number;
  previousHeaderEdits?: number;
}

export interface EditField {
  type: string;
  field: string;
  value: unknown;
  extended: boolean;
  fieldType: string;
  manualEdit: boolean;
  displayName: string;
  displayValue: unknown;
  originalValue: unknown;
  extractionSupported: boolean;
  displayOriginalValue: unknown;
}

// Vendor analytics aggregation
export interface VendorAnalytics {
  vendorName: string;
  totalRecords: number;
  uniqueDocuments: number; // Count of distinct documentId per vendor
  stdLineEdits: number;
  headerEdits: number;
  lineEdits: number;
  mostEditedFieldName: string;
  mostEditedFieldNameCount: number;
  mostEditedFieldType: string;
  mostEditedFieldTypeCount: number;
  topFieldPercentage: number; // Percentage of most edited field within vendor's edits
  editPercentage: number; // Percentage of vendor's edits out of total edits
}

// Edited values by vendor
export interface VendorEditedValues {
  vendorName: string;
  editedValue: string;
  editedOriginalValue: string | null;
  count: number;
}

// Vendor field details
export interface VendorFieldDetails {
  vendorName: string;
  editedFieldName: string;
  editedOriginalValue: string | null;
  extractedValueFromIntent: string | null;
  count: number;
}

// Expected value source options
export type ExpectedValueSource = 'finalEdit' | 'original' | 'extracted' | 'normalized' | 'custom';

// Reviewed document with expected value
export interface ReviewedDocument extends Document {
  expectedValue: string;
  expectedValueSource: ExpectedValueSource;
  reviewedAt: Date;
}

// Expected columns in the new Excel format
export const EXPECTED_COLUMNS = [
  'Document ID',
  'id',
  'message_id',
  'tenant_id',
  'created_at',
  'vendorName',
  'On UI',
  'Reason for Dismissal',
  'Written',
  'Manual',
  'original_json',
  'final_json',
  'edits_detail',
  'std_header_edits',
  'record_type',
  'std_line_edits',
  'header_edits',
  'line_edits',
  'edited_field_name',
  'edited_field_type',
  'edited_value',
  'edited_original_value',
  'extracted_value_from_intent',
  'normalized_value_from_intent',
  'file_name',
  's3_key',
  'extractedFileS3Location',
  'originalAttachmentFileName',
  'S3Location',
] as const;

// Required columns for validation
export const REQUIRED_COLUMNS = [
  'Document ID',
  'created_at',
  'vendorName',
  'On UI',
  'Written',
  'Manual',
  'std_header_edits',
  'std_line_edits',
  'header_edits',
  'line_edits',
  'edited_field_name',
  'edited_field_type',
  'edited_value',
] as const;

// Mapping from field_name to which extracted fields to show
export const FIELD_EXTRACTED_MAPPING: Record<string, string[]> = {
  currency: ['extractedCurrency'],
  duedate: ['extractedInvoiceDate'],
  vendorname: ['extractedVendorName', 'normalizedVendorName'],
  invoicedate: ['extractedInvoiceDate'],
  totalamount: ['extractedTotalAmount'],
  invoicenumber: ['extractedInvoiceNumber'],
  totaltaxamount: ['extractedTotalTaxAmount'],
  purchaseorder: ['extractedPurchaseOrder'],
};

// Human-readable labels for extracted fields
export const EXTRACTED_FIELD_LABELS: Record<string, string> = {
  extractedCurrency: 'Extracted Currency',
  extractedInvoiceDate: 'Extracted Invoice Date',
  extractedVendorName: 'Extracted Vendor Name',
  normalizedVendorName: 'Normalized Vendor Name',
  extractedTotalAmount: 'Extracted Total Amount',
  extractedInvoiceNumber: 'Extracted Invoice Number',
  extractedTotalTaxAmount: 'Extracted Total Tax Amount',
  extractedPurchaseOrder: 'Extracted Purchase Order',
  extractedDueDate: 'Extracted Due Date',
};
