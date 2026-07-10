import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Upload, File, AlertCircle, Check, X, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { DocClassificationDocument, ReviewedDocClassification, DOC_CLASSIFICATION_REQUIRED_COLUMNS, DOC_CLASSIFICATION_COLUMNS, DOC_CLASSIFICATION_ALL_COLUMNS, parseDocClassificationRow, parseExcelDate } from '../../types/docClassification';

interface ExcelUploaderProps {
  onUpload: (documents: DocClassificationDocument[], reviewedDocs?: ReviewedDocClassification[]) => void;
  onClose: () => void;
}

type UploadState = 'idle' | 'processing' | 'preview' | 'error';

/**
 * Check if document is eligible for auto-review
 * Criteria:
 * 1. finalRecordType === 'Invoice'
 * 2. originalRecordType === 'Invoice'
 * 3. originalVendorName matches coalesced_name in any SOR column
 */
export function checkAutoReviewEligibility(doc: DocClassificationDocument): boolean {
  // Check record types
  const finalInvoice = doc.finalRecordType?.toLowerCase().trim() === 'invoice';
  const originalInvoice = doc.originalRecordType?.toLowerCase().trim() === 'invoice';

  if (!finalInvoice || !originalInvoice) return false;

  // Get original vendor name
  const originalVendor = doc.originalVendorName?.toLowerCase().trim();
  if (!originalVendor) return false;

  // Check all 6 SOR columns for coalesced_name match
  const sorColumns = [
    doc.sorHintsNormalized,
    doc.sorHintsExtracted,
    doc.sorMasterNormalized,
    doc.sorMasterExtracted,
    doc.systemHintsNormalized,
    doc.systemHintsExtracted,
  ];

  // Match on any of the SOR name fields (master uses coalesced_name; hints/system-hints
  // use vendor_name / acceptable_name) — mirrors the details panel's match logic so a
  // hint-only match auto-reviews consistently.
  return sorColumns.some(sorArray =>
    sorArray && sorArray.length > 0 && sorArray.some(entry =>
      entry.coalesced_name?.toLowerCase().trim() === originalVendor ||
      entry.vendor_name?.toLowerCase().trim() === originalVendor ||
      entry.acceptable_name?.toLowerCase().trim() === originalVendor
    )
  );
}

// NOTE: auto-review is suggestion-only — the details panel PRE-FILLS the form for eligible docs
// (via checkAutoReviewEligibility) but never saves until the user clicks Mark/Update & Next. There
// is intentionally no createAutoReview() writer here; isAutoReviewed is only set when a resume file
// carries an "Auto-Reviewed" column.

export function ExcelUploader({ onUpload, onClose }: ExcelUploaderProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [allDocuments, setAllDocuments] = useState<DocClassificationDocument[]>([]);
  const [reviewedDocuments, setReviewedDocuments] = useState<ReviewedDocClassification[]>([]);
  const [previewData, setPreviewData] = useState<DocClassificationDocument[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [isResumeFile, setIsResumeFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileCount, setFileCount] = useState(0);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    // Filter valid Excel files
    const validFiles = fileArray.filter(file => 
      file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    );

    if (validFiles.length === 0) {
      setError('Please upload Excel files (.xlsx or .xls)');
      setState('error');
      return;
    }

    setState('processing');
    setError(null);
    setFileCount(validFiles.length);

    try {
      // Process all files and merge data
      const allRows: Record<string, unknown>[] = [];
      let hasReviewedColumn = false;

      for (const file of validFiles) {
        console.log(`Processing file: ${file.name}`);
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });

        // Read all sheets from this file
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const sheetRows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
          if (sheetRows.length > 0) {
            console.log(`  Sheet "${sheetName}": ${sheetRows.length} rows`);
            allRows.push(...sheetRows);
            
            // Check for Reviewed column
            if (sheetRows.length > 0 && Object.keys(sheetRows[0]).includes('Reviewed')) {
              hasReviewedColumn = true;
            }
          }
        }
      }
      
      console.log(`Total rows from ${validFiles.length} files: ${allRows.length}`);

      // Normalize column names case-insensitively to match expected column names.
      // This allows sheets with e.g. "VendorName" to match the expected "vendorname".
      const allKnownColumns = [
        ...DOC_CLASSIFICATION_REQUIRED_COLUMNS,
        ...DOC_CLASSIFICATION_COLUMNS,
        ...DOC_CLASSIFICATION_ALL_COLUMNS,
      ];
      const colNormMap = new Map<string, string>();
      for (const col of allKnownColumns) {
        colNormMap.set(col.toLowerCase(), col);
      }
      const rows = allRows.map(row => {
        const normalized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          const mappedKey = colNormMap.get(key.trim().toLowerCase()) ?? key.trim();
          normalized[mappedKey] = value;
        }
        return normalized;
      });

      if (rows.length === 0) {
        setError('Excel files are empty (no data in any sheet)');
        setState('error');
        return;
      }

      // Guard the #1 data-integrity bug: 18-digit Snowflake IDs exceed JS 2^53. If the source
      // workbook stored an ID column as a NUMBER cell, SheetJS already rounded it during read and
      // the precision is unrecoverable. Detect it (any ID cell arriving as a JS number) and refuse
      // the upload with a clear instruction, rather than silently corrupting IDs.
      const ID_COLUMNS = ['Document ID', 'Message ID', 'Tenant ID', 'vendorid'];
      const numericIdColumns = ID_COLUMNS.filter(col =>
        rows.some(r => typeof r[col] === 'number' && Number.isFinite(r[col] as number) && Math.abs(r[col] as number) >= 1e15)
      );
      if (numericIdColumns.length > 0) {
        setError(
          `These ID column(s) are stored as numbers, which corrupts 18-digit IDs: ${numericIdColumns.join(', ')}. ` +
          `Re-export the file with those columns formatted as Text (or prefixed so Excel treats them as text), then upload again.`
        );
        setState('error');
        return;
      }

      // Validate required columns only
      const firstRow = rows[0];
      const actualColumns = Object.keys(firstRow);
      const requiredColumns = Array.from(DOC_CLASSIFICATION_REQUIRED_COLUMNS);

      const missingColumns = requiredColumns.filter(col => !actualColumns.includes(col));

      if (missingColumns.length > 0) {
        setError(`Missing required columns: ${missingColumns.join(', ')}`);
        setState('error');
        return;
      }

      setIsResumeFile(hasReviewedColumn);

      // Parse all rows
      const documents = rows
        .map(row => parseDocClassificationRow(row))
        .filter((doc): doc is DocClassificationDocument => doc !== null);

      if (documents.length === 0) {
        setError('No valid documents found in Excel files');
        setState('error');
        return;
      }

      // If this is a resume file, extract reviewed documents
      let reviewed: ReviewedDocClassification[] = [];
      if (hasReviewedColumn) {
        reviewed = rows
          .filter(row => row['Reviewed'] === 'Yes')
          .map(row => {
            const doc = parseDocClassificationRow(row);
            if (!doc) return null;

            // Parse review data
            return {
              ...doc,
              isAnInvoice: (row['Is an Invoice'] as string) || 'Others',
              expectedDocType: (row['Expected Doc Type'] as string) || '',
              docClassificationIssue: (row['Doc Classification Issue'] as string) || 'No',
              vendor21MatchingIssue: (row['Vendor 2.1 Matching Issue'] as string) || null,
              expectedVendorName: (row['Expected Vendor Name'] as string) || '',
              existsInMastSor: (row['Exists in mast_sor'] as string) || null,
              comments: (row['Comments'] as string) || '',
              reviewedAt: parseExcelDate(row['Reviewed At']) || new Date(),
              isAutoReviewed: (row['Auto-Reviewed'] as string) === 'Yes',
            } as ReviewedDocClassification;
          })
          .filter((doc): doc is ReviewedDocClassification => doc !== null);
      }

      // Auto-review is suggestion-only now: we do NOT auto-save eligible docs. Only reviews
      // restored from a resume file are persisted here. Eligible docs get their review form
      // pre-filled in the details panel and are saved only when the user clicks Mark & Next.
      const allReviews = [...reviewed];

      setAllDocuments(documents);
      setReviewedDocuments(allReviews);
      setTotalRows(documents.length);
      setPreviewData(documents.slice(0, 5)); // Show first 5 for preview
      setState('preview');

    } catch (err) {
      console.error('Error parsing Excel files:', err);
      setError(err instanceof Error ? err.message : 'Failed to parse Excel files');
      setState('error');
    }
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }, [handleFiles]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleConfirmUpload = useCallback(() => {
    // Upload all documents, not just preview
    onUpload(allDocuments, reviewedDocuments.length > 0 ? reviewedDocuments : undefined);
    onClose();
  }, [allDocuments, reviewedDocuments, onUpload, onClose]);

  const handleRetry = useCallback(() => {
    setState('idle');
    setError(null);
    setAllDocuments([]);
    setReviewedDocuments([]);
    setPreviewData([]);
    setTotalRows(0);
    setIsResumeFile(false);
    setFileCount(0);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Upload Excel Files</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Idle State - Upload Area */}
          {state === 'idle' && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                border-2 border-dashed rounded-lg p-12 text-center transition-colors
                ${isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-300 hover:border-slate-400'
                }
              `}
            >
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-700 mb-2">
                Drop Excel files here or click to browse
              </p>
              <p className="text-sm text-slate-500 mb-4">
                Upload multiple Excel files at once - data will be merged
              </p>
              <p className="text-xs text-slate-400">
                Expected format: GA_Iowa_CRC_StockX (24 columns)
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="excel-upload"
                multiple
              />
              <label htmlFor="excel-upload" className="cursor-pointer">
                <span className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors">
                  <File className="w-4 h-4" />
                  Select Excel Files
                </span>
              </label>
            </div>
          )}

          {/* Processing State */}
          {state === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
              <p className="text-lg font-medium text-slate-700">
                Parsing {fileCount > 1 ? `${fileCount} Excel files` : 'Excel file'}...
              </p>
              <p className="text-sm text-slate-500 mt-2">This may take a moment</p>
            </div>
          )}

          {/* Error State */}
          {state === 'error' && error && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-red-900 mb-1">Upload Failed</h3>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
              <div className="flex justify-center gap-3">
                <Button onClick={handleRetry} variant="primary">
                  Try Again
                </Button>
                <Button onClick={onClose} variant="ghost">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Preview State */}
          {state === 'preview' && previewData.length > 0 && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-green-900 mb-1">
                    {isResumeFile ? 'Resume File Detected!' : `${fileCount > 1 ? `${fileCount} Files` : 'File'} Parsed Successfully`}
                  </h3>
                  <p className="text-sm text-green-700">
                    Found {totalRows} documents{fileCount > 1 ? ` from ${fileCount} files` : ''}{isResumeFile && reviewedDocuments.length > 0
                      ? ` (${reviewedDocuments.length} already reviewed)`
                      : reviewedDocuments.filter(r => r.isAutoReviewed).length > 0
                        ? ` (${reviewedDocuments.filter(r => r.isAutoReviewed).length} auto-reviewed ✨)`
                        : ''}. Preview of first 5:
                  </p>                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider whitespace-nowrap">
                          Document ID
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider whitespace-nowrap">
                          Tenant Name
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider whitespace-nowrap">
                          Invoice #
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider whitespace-nowrap">
                          Record Type
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-slate-600 uppercase tracking-wider whitespace-nowrap">
                          Vendor Name
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                      {previewData.map((doc, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-sm text-slate-900 font-mono truncate max-w-[200px]" title={doc.documentId}>
                            {doc.documentId.slice(0, 16)}...
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-900 truncate max-w-[150px]" title={doc.tenantName}>
                            {doc.tenantName}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-900">
                            {doc.invoiceNumber || '-'}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-900">
                            {doc.finalRecordType}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-900 truncate max-w-[200px]" title={doc.vendorName}>
                            {doc.vendorName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button onClick={handleRetry} variant="ghost">
                  Upload Different Files
                </Button>
                <Button onClick={handleConfirmUpload} variant="primary">
                  <Check className="w-4 h-4 mr-2" />
                  Confirm & Upload ({totalRows} documents)
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
