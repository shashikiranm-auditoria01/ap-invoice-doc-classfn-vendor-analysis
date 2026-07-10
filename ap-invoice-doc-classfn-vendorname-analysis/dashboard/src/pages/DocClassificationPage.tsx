import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { Search, ChevronLeft, ChevronRight, Upload, Trash2, FileSpreadsheet, Loader2, FileCheck, X, Filter, AlertTriangle, FileText, Download, RotateCcw, Database, ChevronDown, SkipForward, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../components/ui/Button';
import { Dropdown } from '../components/ui/Dropdown';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ExcelUploader } from '../components/docClassification/ExcelUploader';
import { DocClassificationDetailsPanel } from '../components/docClassification/DocClassificationDetailsPanel';
import { DocClassificationReviewedSheet } from '../components/docClassification/DocClassificationReviewedSheet';
import { LiveReviewStrip } from '../components/docClassification/LiveReviewStrip';
import { ZipHandler, PdfFile } from '../components/analysis/ZipHandler';
import { useAppContext } from '../context/AppContext';
import { DocClassificationDocument, DocClassificationReview, ReviewedDocClassification } from '../types/docClassification';
import { extractIdFromS3Location, extractIdFromPdfFilename } from '../utils/pdfMatcher';
import { exportAllDocClassifications } from '../utils/docClassificationExport';
import { fetchAttachmentByS3Key, isAttachmentApiConfigured } from '../services/attachmentService';
import { canonicalVendorMatch, VENDOR_MATCH_CATEGORIES, VendorMatchCategory, recordTypeStatus, RecordTypeStatus, customerEditMismatches } from '../utils/reviewStatus';

// Lazy load PDF components to avoid initialization errors
const PDFViewer = lazy(() => import('../components/analysis/PDFViewer').then(m => ({ default: m.PDFViewer })));

// PDF loading fallback
function PDFLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full bg-slate-100">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
        <p className="text-sm text-slate-500">Loading PDF viewer...</p>
      </div>
    </div>
  );
}

// Filter option interface
interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export function DocClassificationPage() {
  const {
    docClassificationData,
    setDocClassificationData,
    clearDocClassificationData,
    reviewedDocClassifications,
    addReviewedDocClassification,
    removeReviewedDocClassification,
    clearReviewedDocClassifications,
    isDocClassificationReviewed,
    docClassificationPdfFiles,
    addDocClassificationPdfFiles,
    setDocClassificationPdfFiles,
    clearDocClassificationPdfFiles,
  } = useAppContext();

  // Fetch-attachment-from-backend state (future AWS/DB integration; see attachmentService)
  const [fetchingAttachment, setFetchingAttachment] = useState(false);

  // Navigation state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // UI state
  const [showExcelUploader, setShowExcelUploader] = useState(false);
  const [showZipUploader, setShowZipUploader] = useState(false);
  const [showReviewedPanel, setShowReviewedPanel] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Skip tracking (session-level)
  const [skippedDocIds, setSkippedDocIds] = useState<Set<string>>(new Set());

  // Filter state
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  const [vendorFilterMode, setVendorFilterMode] = useState<'include' | 'exclude' | null>(null);
  const [selectedVendorMatchStatus, setSelectedVendorMatchStatus] = useState<string[]>([]);
  const [selectedRecordMatchStatus, setSelectedRecordMatchStatus] = useState<string[]>([]);
  const [selectedFinalRecordType, setSelectedFinalRecordType] = useState<string[]>([]);
  const [selectedOriginalRecordType, setSelectedOriginalRecordType] = useState<string[]>([]);
  const [selectedManual, setSelectedManual] = useState<string[]>([]);
  const [selectedWritten, setSelectedWritten] = useState<string[]>([]);
  const [selectedTenantName, setSelectedTenantName] = useState<string[]>([]);
  const [selectedOnUI, setSelectedOnUI] = useState<string[]>([]);
  const [selectedVendorNameReason, setSelectedVendorNameReason] = useState<string[]>([]);
  // Customer-edit mismatch scenario filter (only meaningful for the Mismatch Review dataset).
  const [mismatchScenario, setMismatchScenario] = useState<'' | 'recordType' | 'vendorName' | 'entityName' | 'any'>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'all' | 'user_reviewed' | 'not_reviewed' | 'skipped'>('not_reviewed');

  // Reset index when filters change
  useEffect(() => {
    setCurrentIndex(0);
  }, [selectedVendors, vendorFilterMode, selectedVendorMatchStatus, selectedRecordMatchStatus, selectedFinalRecordType, selectedOriginalRecordType, selectedManual, selectedWritten, selectedTenantName, selectedOnUI, selectedVendorNameReason, mismatchScenario, startDate, endDate, reviewStatusFilter]);

  // Auto-set vendor filter mode when vendors are selected
  const handleVendorChange = (values: string[]) => {
    setSelectedVendors(values);
    if (values.length > 0 && vendorFilterMode === null) {
      setVendorFilterMode('include');
    }
    if (values.length === 0) {
      setVendorFilterMode(null);
    }
  };

  // Compute Unknown Vendor count (excluded from main data)
  const unknownVendorCount = useMemo(() => {
    return docClassificationData.filter(doc => 
      doc.vendorName === 'Unknown Vendor' || 
      doc.vendorName === 'Unknown' || 
      !doc.vendorName ||
      doc.vendorName.trim() === ''
    ).length;
  }, [docClassificationData]);

  // Compute vendor name filter options with occurrences
  const vendorFilterOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const vendor = doc.vendorName || '';
      if (vendor) {
        counts.set(vendor, (counts.get(vendor) || 0) + 1);
      }
    });
    
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value.length > 40 ? value.slice(0, 40) + '...' : value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // True when the loaded dataset carries customer-edit records (Mismatch Review) — gates the
  // scenario filter so it only appears when relevant.
  const hasCustomerEdits = useMemo(
    () => docClassificationData.some(d => customerEditMismatches(d).isCustomerEditRecord),
    [docClassificationData],
  );

  // Vendor match status options — 3-way, from the source column (via canonicalVendorMatch)
  const vendorMatchStatusOptions = useMemo((): FilterOption[] => {
    const counts: Record<VendorMatchCategory, number> = {
      'Vendor Match': 0, 'Vendor Mismatch': 0, 'No Original Data': 0,
    };
    docClassificationData.forEach(doc => { counts[canonicalVendorMatch(doc)]++; });
    return VENDOR_MATCH_CATEGORIES
      .filter(k => counts[k] > 0)
      .map(k => ({ value: k, label: `${k} (${counts[k]})`, count: counts[k] }));
  }, [docClassificationData]);

  // Record match status via the shared helper — 3-way (Match / Mismatch / No Original),
  // so the filter agrees with the Details panel and Reviewed table.
  const recordMatchStatusOptions = useMemo((): FilterOption[] => {
    const counts: Record<RecordTypeStatus, number> = {
      'Record Match': 0, 'Record Mismatch': 0, 'No Original': 0,
    };
    docClassificationData.forEach(doc => { counts[recordTypeStatus(doc.finalRecordType, doc.originalRecordType)]++; });
    return ([
      ['match', 'Record Match'],
      ['mismatch', 'Record Mismatch'],
      ['no_original', 'No Original'],
    ] as [string, RecordTypeStatus][])
      .filter(([, k]) => counts[k] > 0)
      .map(([value, k]) => ({ value, label: `${k} (${counts[k]})`, count: counts[k] }));
  }, [docClassificationData]);

  // Compute Final Record Type filter options
  const finalRecordTypeOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const type = doc.finalRecordType || '';
      if (type) {
        counts.set(type, (counts.get(type) || 0) + 1);
      }
    });
    
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Compute Original Record Type filter options
  const originalRecordTypeOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const type = doc.originalRecordType || '';
      if (type) {
        counts.set(type, (counts.get(type) || 0) + 1);
      }
    });
    
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Compute Manual filter options
  const manualOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const manual = doc.manual || 'Unknown';
      counts.set(manual, (counts.get(manual) || 0) + 1);
    });
    
    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Compute Written filter options
  const writtenOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const written = doc.written || 'Unknown';
      counts.set(written, (counts.get(written) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Compute Tenant Name filter options
  const tenantNameOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const tenant = doc.tenantName || '';
      if (tenant) {
        counts.set(tenant, (counts.get(tenant) || 0) + 1);
      }
    });

    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Compute On UI filter options
  const onUIOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const status = doc.onUI || 'Unknown';
      counts.set(status, (counts.get(status) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Compute VendorNameReason filter options
  const vendorNameReasonOptions = useMemo((): FilterOption[] => {
    const counts = new Map<string, number>();
    docClassificationData.forEach(doc => {
      const reason = doc.vendorNameReason || 'Unknown';
      counts.set(reason, (counts.get(reason) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([value, count]) => ({
        value,
        label: `${value} (${count})`,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [docClassificationData]);

  // Apply the 12 dropdown filters + date range to the full dataset. (Unknown-vendor docs are NOT
  // excluded here — they remain in the queue; the count is only surfaced as a badge.)
  const filteredByFilters = useMemo(() => {
    let result = docClassificationData;

    // Apply vendor name filter
    if (selectedVendors.length > 0 && vendorFilterMode !== null) {
      if (vendorFilterMode === 'include') {
        result = result.filter(doc => selectedVendors.includes(doc.vendorName || ''));
      } else {
        result = result.filter(doc => !selectedVendors.includes(doc.vendorName || ''));
      }
    }

    // Apply vendor match status filter (3-way, using the canonical source-column status)
    if (selectedVendorMatchStatus.length > 0) {
      result = result.filter(doc => selectedVendorMatchStatus.includes(canonicalVendorMatch(doc)));
    }

    // Apply record match status filter (3-way, via the shared recordTypeStatus helper)
    if (selectedRecordMatchStatus.length > 0) {
      const valueToStatus: Record<string, RecordTypeStatus> = {
        match: 'Record Match', mismatch: 'Record Mismatch', no_original: 'No Original',
      };
      const wanted = new Set(selectedRecordMatchStatus.map(v => valueToStatus[v]).filter(Boolean));
      result = result.filter(doc => wanted.has(recordTypeStatus(doc.finalRecordType, doc.originalRecordType)));
    }

    // Apply customer-edit mismatch scenario filter (Mismatch Review dataset).
    if (mismatchScenario) {
      result = result.filter(doc => {
        const e = customerEditMismatches(doc);
        if (mismatchScenario === 'any') return e.any;
        return e[mismatchScenario];
      });
    }

    // Apply Final Record Type filter
    if (selectedFinalRecordType.length > 0) {
      result = result.filter(doc => selectedFinalRecordType.includes(doc.finalRecordType || ''));
    }

    // Apply Original Record Type filter
    if (selectedOriginalRecordType.length > 0) {
      result = result.filter(doc => selectedOriginalRecordType.includes(doc.originalRecordType || ''));
    }

    // Apply Manual filter
    if (selectedManual.length > 0) {
      result = result.filter(doc => selectedManual.includes(doc.manual || 'Unknown'));
    }

    // Apply Written filter
    if (selectedWritten.length > 0) {
      result = result.filter(doc => selectedWritten.includes(doc.written || 'Unknown'));
    }

    // Apply Tenant Name filter
    if (selectedTenantName.length > 0) {
      result = result.filter(doc => selectedTenantName.includes(doc.tenantName || ''));
    }

    // Apply On UI status filter
    if (selectedOnUI.length > 0) {
      result = result.filter(doc => selectedOnUI.includes(doc.onUI || 'Unknown'));
    }

    // Apply VendorNameReason filter
    if (selectedVendorNameReason.length > 0) {
      result = result.filter(doc => selectedVendorNameReason.includes(doc.vendorNameReason || 'Unknown'));
    }

    // Apply Date Range filter (created_at).
    // Parse the "YYYY-MM-DD" input as a LOCAL date (not UTC) so day boundaries don't shift
    // by one in negative-UTC timezones. new Date("YYYY-MM-DD") is UTC midnight; splitting the
    // parts and using the numeric Date ctor gives local midnight, matching how createdAt renders.
    const parseLocalDay = (s: string, endOfDay: boolean): Date | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
      if (!m) return null;
      const [, y, mo, d] = m;
      return endOfDay
        ? new Date(+y, +mo - 1, +d, 23, 59, 59, 999)
        : new Date(+y, +mo - 1, +d, 0, 0, 0, 0);
    };
    if (startDate || endDate) {
      const start = startDate ? parseLocalDay(startDate, false) : null;
      const end = endDate ? parseLocalDay(endDate, true) : null;
      result = result.filter(doc => {
        const docDate = new Date(doc.createdAt);
        if (isNaN(docDate.getTime())) return false;
        if (start && docDate < start) return false;
        if (end && docDate > end) return false;
        return true;
      });
    }

    return result;
  }, [docClassificationData, selectedVendors, vendorFilterMode, selectedVendorMatchStatus, selectedRecordMatchStatus, selectedFinalRecordType, selectedOriginalRecordType, selectedManual, selectedWritten, selectedTenantName, selectedOnUI, selectedVendorNameReason, mismatchScenario, startDate, endDate]);

  // Filter to only documents with matching PDFs (when PDFs are uploaded)
  const docsWithMatchingPdfs = useMemo(() => {
    if (docClassificationPdfFiles.length === 0) {
      return filteredByFilters; // Show all if no PDFs uploaded
    }
    
    // Create a Set of PDF IDs for fast lookup (include all PDFs — corrupted ones
    // may still be viewable via image fallback)
    const pdfIds = new Set(
      docClassificationPdfFiles
        .map(pdf => extractIdFromPdfFilename(pdf.name))
    );

    // Only include documents that have a matching PDF
    return filteredByFilters.filter(doc => {
      const s3Path = (doc.extractedFileS3Location && doc.extractedFileS3Location.trim() !== '')
        ? doc.extractedFileS3Location
        : doc.s3Location;
      if (!s3Path || s3Path.trim() === '') return false;
      const docS3Id = extractIdFromS3Location(s3Path);
      return pdfIds.has(docS3Id);
    });
  }, [filteredByFilters, docClassificationPdfFiles]);

  // Filter documents based on the review-status tab. All branches start from
  // `docsWithMatchingPdfs` (which already applies the 12 dropdown filters + date range + PDF
  // matching), so the dropdown filters take effect on EVERY tab — Not Reviewed, User Reviewed,
  // Skipped, and All — not just Not Reviewed.
  const docsToShow = useMemo(() => {
    const userReviewedIds = new Set(
      reviewedDocClassifications
        .filter(r => !!r.isAnInvoice && !r.isAutoReviewed)
        .map(r => r.documentId)
    );

    if (reviewStatusFilter === 'skipped') {
      // Skipped (and not subsequently reviewed), within the active filters.
      return docsWithMatchingPdfs.filter(doc =>
        skippedDocIds.has(doc.documentId) && !userReviewedIds.has(doc.documentId)
      );
    }
    if (reviewStatusFilter === 'not_reviewed') {
      // Default: exclude user-reviewed AND skipped.
      return docsWithMatchingPdfs.filter(doc =>
        !userReviewedIds.has(doc.documentId) && !skippedDocIds.has(doc.documentId)
      );
    }
    if (reviewStatusFilter === 'user_reviewed') {
      // Only docs the user explicitly reviewed, within the active filters.
      return docsWithMatchingPdfs.filter(doc => userReviewedIds.has(doc.documentId));
    }
    // 'all': every filter-passing doc, regardless of review status.
    return docsWithMatchingPdfs;
  }, [docsWithMatchingPdfs, reviewedDocClassifications, reviewStatusFilter, skippedDocIds]);

  // Skipped count scoped to the currently-visible (filtered) set, so the badges match what the
  // Skipped tab actually lists (a filter that excludes a skipped doc drops it from the count too).
  const skippedVisibleCount = useMemo(() => {
    const userReviewedIds = new Set(
      reviewedDocClassifications.filter(r => !!r.isAnInvoice && !r.isAutoReviewed).map(r => r.documentId)
    );
    return docsWithMatchingPdfs.filter(d => skippedDocIds.has(d.documentId) && !userReviewedIds.has(d.documentId)).length;
  }, [docsWithMatchingPdfs, skippedDocIds, reviewedDocClassifications]);

  // Reviewed docs shown in the Reviewed sheet, the "Reviewed N" badge, and "Download Reviewed Only".
  // Scope to the CURRENTLY LOADED dataset (complete reviews whose documentId is in this dataset) so
  // reviews from other tenants/datasets can't leak in — matching the Reviewed tab. Note: this is NOT
  // narrowed to PDF-matched docs (uploading a few PDFs must not make it look like reviews vanished).
  const reviewedDocsForSheet = useMemo(() => {
    const ids = new Set(docClassificationData.map(d => d.documentId));
    return reviewedDocClassifications.filter(doc => !!doc.isAnInvoice && ids.has(doc.documentId));
  }, [reviewedDocClassifications, docClassificationData]);

  // Apply search filter
  const filteredDocs = useMemo(() => {
    if (!searchQuery) return docsToShow;

    const query = searchQuery.toLowerCase();
    return docsToShow.filter(doc =>
      doc.documentId.toLowerCase().includes(query) ||
      doc.vendorName.toLowerCase().includes(query) ||
      doc.invoiceNumber?.toLowerCase().includes(query) ||
      doc.messageId.toLowerCase().includes(query) ||
      doc.originalVendorName?.toLowerCase().includes(query)
    );
  }, [docsToShow, searchQuery]);

  // Clamp index to valid range (guards against stale index during filter transitions)
  const safeIndex = filteredDocs.length === 0 ? 0 : Math.min(currentIndex, filteredDocs.length - 1);

  // Current document
  const currentDoc = filteredDocs[safeIndex] || null;

  // Reviewed docs that belong to the LOADED dataset (reviews persist across datasets in
  // localStorage) — used for the toolbar "reviewed / remaining" so counts never go negative.
  const reviewedInDatasetCount = useMemo(() => {
    const ids = new Set(docClassificationData.map(d => d.documentId));
    return reviewedDocClassifications.filter(r => ids.has(r.documentId) && !!r.isAnInvoice).length;
  }, [docClassificationData, reviewedDocClassifications]);

  // User (manual) reviews that belong to the LOADED dataset — the number shown on the
  // "User Reviewed" tab badge / "Show Reviewed" checkbox, so the badge always equals the
  // count of documents the tab actually lists (no cross-dataset leakage).
  const userReviewedInDatasetCount = useMemo(() => {
    const ids = new Set(docClassificationData.map(d => d.documentId));
    return reviewedDocClassifications.filter(r => ids.has(r.documentId) && !!r.isAnInvoice && !r.isAutoReviewed).length;
  }, [docClassificationData, reviewedDocClassifications]);

  // Match PDF to current document using proper S3 path extraction
  const matchedPdf = useMemo(() => {
    if (!currentDoc || docClassificationPdfFiles.length === 0) return null;

    // Get the S3 path - priority: extractedFileS3Location, then s3Location
    const s3Path = (currentDoc.extractedFileS3Location && currentDoc.extractedFileS3Location.trim() !== '')
      ? currentDoc.extractedFileS3Location
      : currentDoc.s3Location;
    
    if (!s3Path || s3Path.trim() === '') return null;

    // Extract the last segment from S3 path (e.g., "665247456933969920/751794047412604928/acbc629b-7c21-4aef-adb6-2f2cb4734975" -> "acbc629b-7c21-4aef-adb6-2f2cb4734975")
    const docS3Id = extractIdFromS3Location(s3Path);
    
    if (!docS3Id) return null;

    // Find matching PDF by comparing the extracted IDs
    return docClassificationPdfFiles.find(pdf => {
      const pdfId = extractIdFromPdfFilename(pdf.name);
      return pdfId === docS3Id;
    });
  }, [currentDoc, docClassificationPdfFiles]);

  // Count usable PDFs (all PDFs — corrupted ones may still render via image fallback)
  const validPdfCount = useMemo(() => {
    return docClassificationPdfFiles.length;
  }, [docClassificationPdfFiles]);

  // Active filter count
  const activeFilterCount = [
    selectedVendors.length > 0 && vendorFilterMode !== null,
    selectedVendorMatchStatus.length > 0,
    selectedRecordMatchStatus.length > 0,
    selectedFinalRecordType.length > 0,
    selectedOriginalRecordType.length > 0,
    selectedManual.length > 0,
    selectedWritten.length > 0,
    selectedTenantName.length > 0,
    selectedOnUI.length > 0,
    selectedVendorNameReason.length > 0,
    mismatchScenario !== '',
    startDate !== '' || endDate !== '',
    reviewStatusFilter !== 'not_reviewed',
  ].filter(Boolean).length;

  // Clear all filters
  const clearFilters = () => {
    setSelectedVendors([]);
    setVendorFilterMode(null);
    setSelectedVendorMatchStatus([]);
    setSelectedRecordMatchStatus([]);
    setSelectedFinalRecordType([]);
    setSelectedOriginalRecordType([]);
    setSelectedManual([]);
    setSelectedWritten([]);
    setSelectedTenantName([]);
    setSelectedOnUI([]);
    setSelectedVendorNameReason([]);
    setMismatchScenario('');
    setStartDate('');
    setEndDate('');
    setReviewStatusFilter('not_reviewed');
  };

  // Handlers
  const handleExcelUpload = async (documents: DocClassificationDocument[], reviewedDocs?: ReviewedDocClassification[]) => {
    // Merge with existing data, deduplicating by documentId — both against existing docs
    // AND within the incoming batch (a sheet may contain the same Document ID twice).
    const existingIds = new Set(docClassificationData.map(d => d.documentId));
    const seen = new Set<string>();
    const newDocuments = documents.filter(d => {
      if (existingIds.has(d.documentId) || seen.has(d.documentId)) return false;
      seen.add(d.documentId);
      return true;
    });
    const mergedData = [...docClassificationData, ...newDocuments];
    setDocClassificationData(mergedData);

    // If reviewed documents are provided (resume file), restore them.
    // MERGE — do NOT clear existing reviews (that wiped reviews belonging to other datasets).
    // addReviewedDocClassification dedups by documentId, so a resume file overwrites its own
    // docs' reviews while leaving unrelated reviews intact.
    if (reviewedDocs && reviewedDocs.length > 0) {
      reviewedDocs.forEach(reviewedDoc => {
        const { isAnInvoice, expectedDocType, docClassificationIssue, vendor21MatchingIssue, expectedVendorName, existsInMastSor, comments, reviewedAt, isAutoReviewed, ...baseDoc } = reviewedDoc;
        const review: DocClassificationReview = {
          isAnInvoice,
          expectedDocType,
          docClassificationIssue,
          vendor21MatchingIssue,
          expectedVendorName,
          existsInMastSor,
          comments,
        };
        // Preserve the original reviewedAt + auto-reviewed flag from the resume file.
        addReviewedDocClassification(baseDoc as DocClassificationDocument, review, { reviewedAt, isAutoReviewed });
      });

      // Count auto-reviewed documents
      const autoReviewedCount = reviewedDocs.filter(r => r.isAutoReviewed).length;
      const manualReviewedCount = reviewedDocs.length - autoReviewedCount;

      // Show success toast with auto-review count
      if (autoReviewedCount > 0) {
        if (manualReviewedCount > 0) {
          toast.success(
            `Uploaded ${documents.length.toLocaleString()} documents with ${reviewedDocs.length.toLocaleString()} reviews (${autoReviewedCount.toLocaleString()} auto-reviewed ✨, ${manualReviewedCount.toLocaleString()} manual)`,
            { duration: 6000 }
          );
        } else {
          toast.success(
            `✨ Auto-reviewed ${autoReviewedCount.toLocaleString()} of ${documents.length.toLocaleString()} documents`,
            { duration: 5000 }
          );
        }
      } else if (manualReviewedCount > 0) {
        toast.success(
          `Restored ${manualReviewedCount.toLocaleString()} manually reviewed documents`,
          { duration: 4000 }
        );
      }
    } else {
      // No reviewed documents provided. Report docs actually ADDED (after dedup), not raw rows.
      const skipped = documents.length - newDocuments.length;
      toast.success(
        `Added ${newDocuments.length.toLocaleString()} document${newDocuments.length === 1 ? '' : 's'}` +
        (skipped > 0 ? ` (${skipped.toLocaleString()} duplicate${skipped === 1 ? '' : 's'} skipped)` : ''),
        { duration: 3000 }
      );
    }

    setShowExcelUploader(false);
    setCurrentIndex(0);
    clearFilters();
  };

  const handlePdfUpload = async (pdfs: PdfFile[]) => {
    addDocClassificationPdfFiles(pdfs);
    toast.success(`${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'} loaded`);
    setTimeout(() => setShowZipUploader(false), 100);
  };

  // Fetch the current document's attachment from the backend (future AWS/S3 endpoint),
  // inject it named to match the doc's S3 UUID so the viewer resolves it. No-op unless configured.
  const handleFetchAttachment = async () => {
    if (!currentDoc) return;
    const s3Key = (currentDoc.extractedFileS3Location && currentDoc.extractedFileS3Location.trim() !== '')
      ? currentDoc.extractedFileS3Location
      : currentDoc.s3Location;
    if (!s3Key || !s3Key.trim()) { toast.error('This document has no S3 key to fetch.'); return; }
    setFetchingAttachment(true);
    const t = toast.loading('Fetching attachment from server…');
    try {
      const att = await fetchAttachmentByS3Key(s3Key, currentDoc.attachmentFileName || undefined);
      if (!att) { toast.error('Attachment not found on server.', { id: t }); return; }
      const id = extractIdFromS3Location(s3Key);
      const pdf: PdfFile = { name: `${id}.pdf`, data: att.data, isCorrupted: false };
      // Append (don't replace) so any already-loaded PDFs are kept.
      const existing = docClassificationPdfFiles.filter(p => extractIdFromPdfFilename(p.name) !== id);
      setDocClassificationPdfFiles([...existing, pdf]);
      toast.success('Attachment loaded from server.', { id: t });
    } catch (e) {
      toast.error(`Fetch failed: ${e instanceof Error ? e.message : 'unknown error'}`, { id: t });
    } finally {
      setFetchingAttachment(false);
    }
  };

  const handleMarkAndNext = (review: DocClassificationReview) => {
    if (!currentDoc) return;

    addReviewedDocClassification(currentDoc, review);

    // If this doc was previously skipped, remove it from skipped set
    if (skippedDocIds.has(currentDoc.documentId)) {
      setSkippedDocIds(prev => {
        const next = new Set(prev);
        next.delete(currentDoc.documentId);
        return next;
      });
    }

    if (reviewStatusFilter !== 'not_reviewed') {
      // In 'user_reviewed' or 'all' mode: doc stays visible after save, so explicitly advance
      if (safeIndex < filteredDocs.length - 1) {
        setCurrentIndex(safeIndex + 1);
      }
      // If already at last doc, stay in place
    } else {
      // Normal mode: reviewed doc is filtered out, so next doc slides into safeIndex automatically.
      // Only adjust if we're at the last document.
      if (filteredDocs.length === 1) {
        // Last document - stay at index 0 (will show "no docs" or move to first unreviewed)
        setCurrentIndex(0);
      } else if (safeIndex >= filteredDocs.length - 1) {
        // We're at the end, move back one position so we don't go out of bounds
        setCurrentIndex(Math.max(0, safeIndex - 1));
      }
      // Otherwise, keep safeIndex the same - next doc will slide into this position
    }
  };

  const handleSkip = () => {
    if (!currentDoc) return;

    // Mark the document as skipped (won't appear in normal review queue)
    setSkippedDocIds(prev => new Set([...prev, currentDoc.documentId]));

    // After marking skipped, the doc is removed from the queue (not_reviewed mode)
    // so the next doc slides into safeIndex — only adjust when at the last position
    if (filteredDocs.length === 1) {
      setCurrentIndex(0);
    } else if (safeIndex >= filteredDocs.length - 1) {
      setCurrentIndex(Math.max(0, safeIndex - 1));
    }
  };

  const handlePrev = () => {
    setCurrentIndex(Math.max(safeIndex - 1, 0));
  };

  const handleNext = () => {
    setCurrentIndex(Math.min(safeIndex + 1, filteredDocs.length - 1));
  };

  const handleClearData = () => {
    if (confirm('Clear all uploaded data? This will not affect reviewed documents.')) {
      clearDocClassificationData();
      setCurrentIndex(0);
      setSearchQuery('');
      setSkippedDocIds(new Set());
      clearFilters();
    }
  };

  const handleClearSession = () => {
    if (confirm('Clear all session data (PDFs + reviewed documents)?')) {
      clearDocClassificationPdfFiles();
      clearReviewedDocClassifications();
      setSkippedDocIds(new Set());
      setCurrentIndex(0);
    }
  };

  const confirmClearAllLocal = () => {
    clearDocClassificationData();
    clearReviewedDocClassifications();
    clearDocClassificationPdfFiles();
    setSkippedDocIds(new Set());
    toast.success('All local data cleared.');
    setShowDeleteConfirm(false);
  };

  // Empty state - no data loaded yet
  if (docClassificationData.length === 0) {
    return (
      <div className="h-[calc(100vh-172px)] flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center max-w-lg">
            <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileSpreadsheet className="w-10 h-10 text-purple-600" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">
              Upload Doc Classification Data
            </h2>
            <p className="text-slate-500 mb-6">
              Upload an Excel file containing document classification data to get started.
              Your data will be stored securely and available for 48 hours.
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setShowExcelUploader(true)}
              leftIcon={<Upload className="w-5 h-5" />}
            >
              Upload Excel File
            </Button>
            <p className="text-xs text-slate-400 mt-4">
              Supported columns: Document ID, Tenant Name, vendorname, OriginalVendorName, Final Record Type, etc.
            </p>
          </div>
        </div>

        {/* Excel Uploader Modal */}
        {showExcelUploader && (
          <ExcelUploader
            onUpload={handleExcelUpload}
            onClose={() => setShowExcelUploader(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-172px)] flex flex-col overflow-hidden">
      {/* Compact Header Bar */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-1">
        <div className="flex items-center justify-between max-w-full">
          <div>
            <h1 className="text-base font-bold text-black flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-black" />
              AP Invoice Doc Classfn & VendorName Analysis
            </h1>
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              {docClassificationPdfFiles.length > 0 ? (
                <>
                  <span className="text-blue-600 font-medium">{docsWithMatchingPdfs.length} docs with PDFs</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-600">{validPdfCount} valid PDFs</span>
                </>
              ) : (
                <>
                  <span className="text-slate-700 font-medium">{docClassificationData.length} total</span>
                  {filteredByFilters.length !== docClassificationData.length && (
                    <>
                      <span className="text-slate-400">•</span>
                      <span className="text-purple-600 font-medium">{filteredByFilters.length} filtered</span>
                    </>
                  )}
                </>
              )}
              {reviewedInDatasetCount > 0 && (
                <>
                  <span className="text-slate-400">•</span>
                  <span className="text-green-600 font-medium">{reviewedInDatasetCount} reviewed</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-blue-600 font-medium">{Math.max(0, docClassificationData.length - reviewedInDatasetCount)} remaining</span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Skipped Count Badge */}
            {skippedVisibleCount > 0 && (
              <button
                onClick={() => { setReviewStatusFilter('skipped'); setShowFilters(true); }}
                className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200 transition-colors"
                title="Click to view skipped documents"
              >
                <SkipForward className="w-3 h-3 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">
                  Skipped: {skippedVisibleCount}
                </span>
              </button>
            )}

            {/* Unknown Vendor Count Badge */}
            {unknownVendorCount > 0 && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded">
                <AlertTriangle className="w-3 h-3 text-amber-600" />
                <span className="text-xs font-medium text-amber-700">
                  Unknown Vendor: {unknownVendorCount}
                </span>
              </div>
            )}

            {/* Reviewed Documents Button with Badge */}
            {reviewedDocsForSheet.length > 0 && (
              <button
                onClick={() => setShowReviewedPanel(true)}
                className="relative flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
              >
                <FileSpreadsheet className="w-3 h-3" />
                Reviewed
                <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-xs font-bold text-white bg-green-500 rounded-full">
                  {reviewedDocsForSheet.length}
                </span>
              </button>
            )}

            {/* Download All Button */}
            {docClassificationData.length > 0 && (
              <Button
                onClick={() => exportAllDocClassifications(docClassificationData, reviewedDocClassifications)}
                variant="outline"
                size="sm"
                leftIcon={<Download className="w-3 h-3" />}
              >
                Download All
              </Button>
            )}

            {/* Reset everything (dataset + PDFs + reviews) — distinct from "Clear Data" which keeps reviews */}
            {docClassificationData.length > 0 && (
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                variant="outline"
                size="sm"
                className="text-orange-600 hover:bg-orange-50 hover:text-orange-700 border-orange-300"
                leftIcon={<Trash2 className="w-3 h-3" />}
                title="Remove the dataset, PDFs, and ALL reviews from this browser"
              >
                Reset All
              </Button>
            )}

            <Button onClick={() => setShowExcelUploader(true)} variant="outline" size="sm" leftIcon={<FileSpreadsheet className="w-3 h-3" />}>
              Upload Excel
            </Button>
            <Button onClick={() => setShowZipUploader(!showZipUploader)} variant="outline" size="sm" leftIcon={<Upload className="w-3 h-3" />}>
              Upload PDFs
            </Button>
            {docClassificationPdfFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearDocClassificationPdfFiles()}
                className="text-slate-500"
              >
                Clear PDFs
              </Button>
            )}
            <Button onClick={handleClearData} variant="outline" size="sm" leftIcon={<X className="w-3 h-3" />}>
              Clear Data
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSession}
              leftIcon={<Trash2 className="w-3 h-3" />}
              className="text-red-500 hover:bg-red-50 hover:text-red-600"
              title="Clear all session data (PDFs, reviewed documents)"
            >
              Clear Session
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 px-3 py-1 bg-slate-50 overflow-hidden">
        {/* ZIP Upload (collapsible) - Auto-hide when PDFs are loaded */}
        {showZipUploader && docClassificationPdfFiles.length === 0 && (
          <div className="flex-shrink-0 bg-white rounded border border-slate-200 p-2 mb-1">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-medium text-slate-700">Upload PDF Archive (ZIP)</h3>
              <button
                onClick={() => setShowZipUploader(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ZipHandler onPdfsLoaded={handlePdfUpload} />
          </div>
        )}

        {/* Filters Section */}
        <div className="flex-shrink-0 bg-white rounded border border-slate-200 p-1.5 mb-1">
          <div className="flex items-center justify-between gap-2">
            {/* Left: Filters toggle */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                <Filter className="w-3 h-3" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="bg-purple-100 text-purple-700 text-xs px-1.5 py-0.5 rounded-full">
                    {activeFilterCount} active
                  </span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <Button
                  onClick={clearFilters}
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs"
                >
                  <RotateCcw className="w-3 h-3 mr-0.5" />
                  Reset
                </Button>
              )}
            </div>

            {/* Center: Review Status Tab Bar — always visible */}
            <div className="flex items-center gap-0 border border-slate-200 rounded overflow-hidden shrink-0">
              {(
                [
                  { value: 'not_reviewed', label: 'Not Reviewed', count: null },
                  {
                    value: 'user_reviewed',
                    label: 'User Reviewed',
                    count: userReviewedInDatasetCount,
                  },
                  { value: 'skipped', label: 'Skipped', count: skippedVisibleCount },
                  { value: 'all', label: 'All', count: null },
                ] as const
              ).map(tab => {
                const isActive = reviewStatusFilter === tab.value;
                const activeStyle =
                  tab.value === 'user_reviewed'
                    ? 'bg-green-600 text-white border-green-600'
                    : tab.value === 'skipped'
                    ? 'bg-slate-600 text-white border-slate-600'
                    : 'bg-purple-600 text-white border-purple-600';
                return (
                  <button
                    key={tab.value}
                    onClick={() => setReviewStatusFilter(tab.value as typeof reviewStatusFilter)}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors border-r last:border-r-0 border-slate-200 ${
                      isActive ? activeStyle : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                    {tab.count !== null && (
                      <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Right: spacer */}
            <div className="flex-1" />
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-2 pt-2 mt-2 border-t border-slate-100">
              {/* Vendor Name Filter */}
              <div className="min-w-[200px]">
                <Dropdown
                  label="Vendor Name"
                  options={vendorFilterOptions}
                  value={selectedVendors}
                  onChange={handleVendorChange}
                  placeholder="Select vendors..."
                  multiple
                  searchable
                  showFilterActions
                  filterMode={vendorFilterMode}
                  onFilterModeChange={setVendorFilterMode}
                />
                {selectedVendors.length > 0 && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {vendorFilterMode === null && `${selectedVendors.length} vendor${selectedVendors.length !== 1 ? 's' : ''} checked (not filtering)`}
                    {vendorFilterMode === 'include' && `Showing only ${selectedVendors.length} vendor${selectedVendors.length !== 1 ? 's' : ''}`}
                    {vendorFilterMode === 'exclude' && `Excluding ${selectedVendors.length} vendor${selectedVendors.length !== 1 ? 's' : ''}`}
                  </p>
                )}
              </div>

              {/* Vendor Match Status Filter */}
              <div className="min-w-[160px]">
                <Dropdown
                  label="Vendor Match Status"
                  options={vendorMatchStatusOptions}
                  value={selectedVendorMatchStatus}
                  onChange={setSelectedVendorMatchStatus}
                  placeholder="All statuses"
                  multiple
                />
              </div>

              {/* Record Match Status Filter */}
              <div className="min-w-[160px]">
                <Dropdown
                  label="Record Match Status"
                  options={recordMatchStatusOptions}
                  value={selectedRecordMatchStatus}
                  onChange={setSelectedRecordMatchStatus}
                  placeholder="All statuses"
                  multiple
                />
              </div>

              {/* Final Record Type Filter */}
              <div className="min-w-[140px]">
                <Dropdown
                  label="Final Record Type"
                  options={finalRecordTypeOptions}
                  value={selectedFinalRecordType}
                  onChange={setSelectedFinalRecordType}
                  placeholder="All types"
                  multiple
                />
              </div>

              {/* Original Record Type Filter */}
              <div className="min-w-[140px]">
                <Dropdown
                  label="Original Record Type"
                  options={originalRecordTypeOptions}
                  value={selectedOriginalRecordType}
                  onChange={setSelectedOriginalRecordType}
                  placeholder="All types"
                  multiple
                />
              </div>

              {/* Manual Filter */}
              <div className="min-w-[100px]">
                <Dropdown
                  label="Manual"
                  options={manualOptions}
                  value={selectedManual}
                  onChange={setSelectedManual}
                  placeholder="All"
                  multiple
                />
              </div>

              {/* Written Filter */}
              <div className="min-w-[100px]">
                <Dropdown
                  label="Written"
                  options={writtenOptions}
                  value={selectedWritten}
                  onChange={setSelectedWritten}
                  placeholder="All"
                  multiple
                />
              </div>

              {/* Tenant Name Filter */}
              <div className="min-w-[120px]">
                <Dropdown
                  label="Tenant Name"
                  options={tenantNameOptions}
                  value={selectedTenantName}
                  onChange={setSelectedTenantName}
                  placeholder="All tenants"
                  multiple
                />
              </div>

              {/* On UI Status Filter */}
              <div className="min-w-[100px]">
                <Dropdown
                  label="On UI"
                  options={onUIOptions}
                  value={selectedOnUI}
                  onChange={setSelectedOnUI}
                  placeholder="All"
                  multiple
                />
              </div>

              {/* VendorNameReason Filter */}
              <div className="min-w-[140px]">
                <Dropdown
                  label="Vendor Name Reason"
                  options={vendorNameReasonOptions}
                  value={selectedVendorNameReason}
                  onChange={setSelectedVendorNameReason}
                  placeholder="All"
                  multiple
                />
              </div>

              {/* Date Range Filter */}
              <div className="min-w-[130px]">
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Created Date (From)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              <div className="min-w-[130px]">
                <label className="text-xs font-medium text-slate-700 block mb-1">
                  Created Date (To)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Customer-edit mismatch scenario — only for the Mismatch Review dataset */}
              {hasCustomerEdits && (
                <div className="min-w-[170px]">
                  <label className="text-xs font-medium text-slate-700 block mb-1">
                    Customer Edit (AAI → Customer)
                  </label>
                  <select
                    value={mismatchScenario}
                    onChange={(e) => setMismatchScenario(e.target.value as typeof mismatchScenario)}
                    className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="">All edits</option>
                    <option value="any">Any change</option>
                    <option value="recordType">Record Type changed</option>
                    <option value="vendorName">Vendor Name changed</option>
                    <option value="entityName">Entity Name changed</option>
                  </select>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Search, Navigation */}
        <div className="flex-shrink-0 flex items-center gap-2 bg-white rounded border border-slate-200 p-1.5 mb-1">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentIndex(0);
              }}
              placeholder="Search by Document ID, Vendor, Invoice #..."
              className="w-full pl-7 pr-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          {/* Progress indicator */}
          <div className="text-sm text-slate-500">
            {filteredDocs.length > 0 ? (
              <span>{filteredDocs.length} remaining</span>
            ) : (
              <span className="text-green-600 font-medium">All reviewed!</span>
            )}
          </div>

          {/* Show Reviewed checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={reviewStatusFilter === 'user_reviewed'}
              onChange={(e) => setReviewStatusFilter(e.target.checked ? 'user_reviewed' : 'not_reviewed')}
              className="w-3.5 h-3.5 rounded border-slate-300 text-green-600 focus:ring-green-500 cursor-pointer"
            />
            <Eye className="w-3 h-3 text-slate-400 group-hover:text-green-600" />
            <span className="text-xs text-slate-600 group-hover:text-green-700 font-medium">
              Show Reviewed
              {userReviewedInDatasetCount > 0 && (
                <span className="ml-1 text-[10px] bg-green-100 text-green-700 px-1 py-0.5 rounded-full">
                  {userReviewedInDatasetCount}
                </span>
              )}
            </span>
          </label>

          {/* Navigation */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrev}
              disabled={safeIndex <= 0}
              leftIcon={<ChevronLeft className="w-3 h-3" />}
            >
              Prev
            </Button>
            <div className="flex items-center gap-1.5 min-w-[100px] justify-center">
              <span className="text-sm text-slate-600 font-medium">
                {filteredDocs.length > 0
                  ? `${safeIndex + 1} of ${filteredDocs.length}`
                  : 'No documents'
                }
              </span>
              {currentDoc && isDocClassificationReviewed(currentDoc.documentId) && (
                <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full text-xs font-medium">
                  Reviewed
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNext}
              disabled={safeIndex >= filteredDocs.length - 1}
              rightIcon={<ChevronRight className="w-3 h-3" />}
            >
              Next
            </Button>
          </div>
        </div>

        {/* Live metrics strip — always visible while reviewing; updates on every Mark/Update */}
        {docClassificationData.length > 0 && (
          <LiveReviewStrip data={docClassificationData} reviewed={reviewedDocClassifications} />
        )}

        {/* Main Content - Split View */}
        {(filteredDocs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-white rounded border border-slate-200">
            <div className="text-center max-w-md">
              <FileCheck className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <h2 className="text-base font-semibold text-slate-700 mb-1">
                {docsToShow.length === 0 && filteredByFilters.length > 0 && reviewStatusFilter === 'not_reviewed'
                  ? 'All Documents Reviewed!'
                  : searchQuery
                    ? 'No Documents Match Search'
                    : 'No Documents Match Filters'}
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                {docsToShow.length === 0 && filteredByFilters.length > 0 && reviewStatusFilter === 'not_reviewed'
                  ? "You've reviewed all documents. Switch to 'User Reviewed' or 'All' in the Review Status filter to see them."
                  : searchQuery
                    ? `No documents found matching "${searchQuery}". Try a different search term.`
                    : 'Try adjusting your filter criteria to see more documents.'}
              </p>
              <div className="flex gap-2 justify-center">
                {reviewedDocClassifications.length > 0 && reviewStatusFilter === 'not_reviewed' && (
                  <Button onClick={() => setReviewStatusFilter('all')} variant="primary" size="sm">
                    <FileCheck className="w-3 h-3 mr-1" />
                    Show All Documents
                  </Button>
                )}
                {searchQuery && (
                  <Button onClick={() => setSearchQuery('')} variant="secondary" size="sm">
                    Clear Search
                  </Button>
                )}
                {activeFilterCount > 0 && (
                  <Button onClick={clearFilters} variant="secondary" size="sm">
                    Clear Filters
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex gap-2 min-h-0 overflow-hidden">
            {/* Left Panel - PDF Viewer - 55% width */}
            <div className="w-[55%] flex flex-col min-h-0 h-full">
              <div className="flex-1 bg-white rounded border border-slate-300 shadow-sm overflow-hidden min-h-0 flex flex-col">
                {docClassificationPdfFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full bg-slate-50 p-4">
                    <FileText className="w-12 h-12 text-slate-300 mb-3" />
                    <p className="text-sm text-slate-500 text-center mb-2 font-medium">No PDFs uploaded</p>
                    <p className="text-xs text-slate-400 text-center mb-3">
                      Upload ZIP files containing PDFs to view them alongside documents
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowZipUploader(true)}
                        leftIcon={<Upload className="w-3 h-3" />}
                      >
                        Upload ZIP
                      </Button>
                      {isAttachmentApiConfigured && currentDoc && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleFetchAttachment}
                          disabled={fetchingAttachment}
                          leftIcon={<Database className="w-3 h-3" />}
                        >
                          {fetchingAttachment ? 'Fetching…' : 'Fetch from server'}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : matchedPdf ? (
                  <Suspense fallback={<PDFLoadingFallback />}>
                    <PDFViewer 
                      pdfData={matchedPdf.data}
                      filename={matchedPdf.name}
                    />
                  </Suspense>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full bg-slate-50 p-4">
                    <FileText className="w-12 h-12 text-slate-300 mb-3" />
                    <p className="text-sm text-slate-500 text-center font-medium mb-2">No matching PDF found</p>
                    <p className="text-xs text-slate-400 text-center mt-1">
                      PDF filename should match the last segment of extractedFileS3Location or S3Location
                    </p>
                    {currentDoc && (
                      <div className="mt-2 p-2 bg-slate-100 rounded text-xs text-slate-600 max-w-md">
                        <p className="font-medium mb-1">Expected PDF name:</p>
                        <code className="text-purple-600 break-all text-xs">
                          {extractIdFromS3Location(
                            (currentDoc.extractedFileS3Location && currentDoc.extractedFileS3Location.trim() !== '')
                              ? currentDoc.extractedFileS3Location
                              : currentDoc.s3Location
                          )}.pdf
                        </code>
                      </div>
                    )}
                    {isAttachmentApiConfigured && currentDoc && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={handleFetchAttachment}
                        disabled={fetchingAttachment}
                        leftIcon={<Database className="w-3 h-3" />}
                      >
                        {fetchingAttachment ? 'Fetching…' : 'Fetch from server'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Document Details - 45% width */}
            <div className="w-[45%] min-h-0 flex flex-col h-full overflow-auto">
              <DocClassificationDetailsPanel
                key={currentDoc?.documentId ?? '__empty'}
                document={currentDoc}
                isReviewed={currentDoc ? isDocClassificationReviewed(currentDoc.documentId) : false}
                onMarkAndNext={handleMarkAndNext}
                onSkip={handleSkip}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {showExcelUploader && (
        <ExcelUploader
          onUpload={handleExcelUpload}
          onClose={() => setShowExcelUploader(false)}
        />
      )}

      {showReviewedPanel && (
        <DocClassificationReviewedSheet
          reviewedDocs={reviewedDocsForSheet}
          allDocs={docClassificationData}
          onRemove={removeReviewedDocClassification}
          onClearAll={clearReviewedDocClassifications}
          onClose={() => setShowReviewedPanel(false)}
        />
      )}

      {/* Clear all local data confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Reset all local data"
        message="Remove the loaded dataset, uploaded PDFs, and all reviewed documents from this browser? This cannot be undone. (Your exported files are not affected.)"
        confirmLabel="Reset all"
        cancelLabel="Cancel"
        onConfirm={confirmClearAllLocal}
        onClose={() => setShowDeleteConfirm(false)}
        variant="danger"
      />

    </div>
  );
}
