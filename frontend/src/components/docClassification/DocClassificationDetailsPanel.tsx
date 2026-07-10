import { useState, useEffect } from 'react';
import { DocClassificationDocument, DocClassificationReview, SorLookupResult } from '../../types/docClassification';
import { StatusBadge } from '../ui/StatusBadge';
import { CopyButton } from '../ui/CopyButton';
import { Button } from '../ui/Button';
import { FileText, Calendar, SkipForward, ArrowRight, CheckCircle, File, Wand2 } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { recordTypeStatus, canonicalVendorMatch, customerEditMismatches } from '../../utils/reviewStatus';
import { isSorApiConfigured, hasSorData, fetchSorForDoc, SorFields } from '../../services/sorService';
import { checkAutoReviewEligibility } from './ExcelUploader';

/** Normalize a string for case/whitespace-insensitive comparison. */
const norm = (s?: string | null) => (s || '').trim().toLowerCase();

interface DocClassificationDetailsPanelProps {
  document: DocClassificationDocument | null;
  isReviewed?: boolean;
  onMarkAndNext?: (review: DocClassificationReview) => void;
  onSkip?: () => void;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractFilenameFromS3(s3Location: string | null): string {
  if (!s3Location) return '-';
  // Extract the last part of the S3 path (the filename/ID)
  const parts = s3Location.split('/');
  const lastPart = parts[parts.length - 1];
  // Add .pdf extension if not present
  return lastPart.endsWith('.pdf') ? lastPart : `${lastPart}.pdf`;
}

function explainVendorNameReason(reason: string | null): string {
  if (!reason) return 'No reason provided';

  switch (reason) {
    case 'withHints':
      return 'Vendor matched using SOR hints. Check sor_hints columns for matching values.';
    case 'withLLM':
      return 'Vendor matched using LLM-based matching against SOR master data.';
    case 'fromSystemHints':
      return 'Vendor matched from system hints. Check Systemhints columns for matching values.';
    case 'noMatchWithHintsLLM':
      return 'No match found even after checking hints and LLM. May require manual verification.';
    case 'fromSystemHintsCached':
      return 'Vendor matched from cached system hints for faster processing.';
    default:
      return `Reason: ${reason}`;
  }
}

interface SORMatchSectionProps {
  title: string;
  matches: SorLookupResult[] | null | undefined;
  originalVendor: string | null;
  columnType: 'hints' | 'master' | 'system';
  raw?: string | null; // raw source string, so a parse failure reads as "unparseable" not "no matches"
}

function SORMatchSection({ title, matches, originalVendor, columnType, raw }: SORMatchSectionProps) {
  if (!matches || matches.length === 0) {
    // Distinguish a genuine empty result ([] / absent) from a value that was present but failed to
    // parse (raw is a non-empty, non-"[]" string) — otherwise "No matches" misrepresents the data.
    const unparseable = !!raw && raw.trim() !== '' && raw.trim() !== '[]';
    if (unparseable) {
      return (
        <details className="text-xs border border-amber-200 rounded">
          <summary className="cursor-pointer font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 py-1.5 px-2 transition-colors rounded">
            {title}: unparseable (truncated) — show raw
          </summary>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto bg-white border-t border-amber-200 p-2 text-slate-700">{raw}</pre>
        </details>
      );
    }
    return (
      <div className="text-xs text-slate-400 py-1 px-2 bg-slate-50 rounded">
        {title}: No matches
      </div>
    );
  }

  const originalVendorLower = originalVendor?.toLowerCase().trim();

  return (
    <details className="text-xs border border-slate-200 rounded" open>
      <summary className="cursor-pointer font-medium text-slate-700 hover:bg-slate-50 py-1.5 px-2 transition-colors">
        {title} ({matches.length} {matches.length === 1 ? 'match' : 'matches'})
      </summary>
      <div className="px-2 pb-2 pt-1 space-y-1 bg-slate-50/50">
        {matches.map((match, idx) => {
          // sor_master uses coalesced_name; sor_hints uses vendor_name
          const displayName = match.coalesced_name || match.vendor_name || '';
          const isExactMatch = displayName.toLowerCase().trim() === originalVendorLower;

          return (
            <div
              key={idx}
              className={`p-1.5 rounded border text-xs ${
                isExactMatch
                  ? 'bg-green-50 border-green-300'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start gap-1">
                {isExactMatch && (
                  <span className="text-green-600 font-bold text-sm" title="Exact match with OriginalVendorName">✓</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${isExactMatch ? 'text-green-800' : 'text-slate-800'}`} title={displayName}>
                    {displayName}
                  </div>
                  {match.acceptable_name && (
                    <div className="text-slate-600 truncate" title={match.acceptable_name}>
                      Acceptable Name: {match.acceptable_name}
                    </div>
                  )}
                  <div className="text-slate-600 truncate" title={match.search_value_used}>
                    Search: {match.search_value_used}
                  </div>
                  {match.status && (
                    <div className="text-slate-500">
                      Status: <span className={match.status === 'active' ? 'text-green-600 font-medium' : 'text-slate-500'}>
                        {match.status}
                      </span>
                    </div>
                  )}
                  {match.active_hints && (
                    <div className="text-slate-500">
                      Hints Type: <span className="text-slate-700">{match.active_hints}</span>
                    </div>
                  )}
                  {columnType === 'hints' && match.address && (
                    <div className="text-slate-600 truncate" title={match.address}>
                      Address: {match.address}
                    </div>
                  )}
                  {columnType === 'master' && match.address1 && (
                    <div className="text-slate-600 truncate" title={match.address1}>
                      Address 1: {match.address1}
                    </div>
                  )}
                  {columnType === 'master' && match.address2 && (
                    <div className="text-slate-600 truncate" title={match.address2}>
                      Address 2: {match.address2}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function DocClassificationDetailsPanel({
  document,
  isReviewed = false,
  onMarkAndNext,
  onSkip,
}: DocClassificationDetailsPanelProps) {
  const { getReviewedDocClassification } = useAppContext();
  const reviewedDoc = document ? getReviewedDocClassification(document.documentId) : null;

  // Tab state
  const [activeTab, setActiveTab] = useState<'details' | 'json' | 'extracted' | 'sorhintstab' | 'mastersor'>('details');

  // Document Classification state
  const [isAnInvoice, setIsAnInvoice] = useState<'Invoice' | 'Others' | null>(null);
  const [expectedDocType, setExpectedDocType] = useState('');
  // Note: docClassificationIssue is auto-calculated based on isAnInvoice vs originalRecordType

  // Vendor 2.1 state
  const [vendor21MatchingIssue, setVendor21MatchingIssue] = useState<'Does not Exist' | 'Vendor Matching Issue' | null>(null);
  const [expectedVendorName, setExpectedVendorName] = useState('');
  const [existsInMastSor, setExistsInMastSor] = useState<'Yes' | 'No' | null>(null);

  // Reviewer comments
  const [comments, setComments] = useState('');

  // True when the form was pre-filled with an auto-suggestion (not yet saved).
  const [isAutoSuggested, setIsAutoSuggested] = useState(false);

  // Lazily-fetched SOR enrichment, keyed by documentId (Stage 2 seam). Empty today — the bundled
  // dataset already carries SOR, so nothing is fetched unless VITE_SOR_API_URL is set AND the doc
  // arrived without SOR (the live base pull omits it).
  const [sorOverlay, setSorOverlay] = useState<Record<string, SorFields>>({});
  useEffect(() => {
    if (!document || !isSorApiConfigured) return;
    if (activeTab !== 'sorhintstab' && activeTab !== 'mastersor') return;
    if (hasSorData(document) || sorOverlay[document.documentId]) return;
    let cancelled = false;
    fetchSorForDoc(document)
      .then(f => { if (f && !cancelled) setSorOverlay(prev => ({ ...prev, [document.documentId]: f })); })
      .catch(() => { /* SOR tabs degrade gracefully to "No matches" */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.documentId, activeTab]);

  // Load existing review data, or pre-fill an auto-suggestion, or reset — when the document changes.
  useEffect(() => {
    if (!document) return;

    const existingReview = getReviewedDocClassification(document.documentId);

    if (existingReview) {
      // Populate form with existing review data
      setIsAnInvoice(existingReview.isAnInvoice);
      setExpectedDocType(existingReview.expectedDocType);
      // docClassificationIssue is auto-calculated, no need to load
      setVendor21MatchingIssue(existingReview.vendor21MatchingIssue);
      setExpectedVendorName(existingReview.expectedVendorName);
      setExistsInMastSor(existingReview.existsInMastSor);
      setComments(existingReview.comments ?? '');
      setIsAutoSuggested(false);
    } else if (checkAutoReviewEligibility(document)) {
      // Suggestion-only: pre-fill the high-confidence values, but DO NOT save. The user
      // reviews the suggestion and clicks Mark & Next to persist it (as a human review).
      setIsAnInvoice('Invoice');
      setExpectedDocType('');
      setVendor21MatchingIssue('Does not Exist');
      setExpectedVendorName('');
      setExistsInMastSor('Yes');
      setComments('');
      setIsAutoSuggested(true);
    } else {
      // Reset form for unreviewed, non-eligible documents
      setIsAnInvoice(null);
      setExpectedDocType('');
      // docClassificationIssue is auto-calculated
      setVendor21MatchingIssue(null);
      setExpectedVendorName('');
      setExistsInMastSor(null);
      setComments('');
      setIsAutoSuggested(false);
    }
  }, [document?.documentId, getReviewedDocClassification]);

  const handleMarkAndNext = () => {
    if (!onMarkAndNext || !document) return;

    // Validation: the Invoice/Others classification is REQUIRED — it drives docClassificationIssue
    // and every downstream metric. Never silently default to "Others" (that fabricated a spurious
    // classification issue when a reviewer only edited the vendor name).
    if (!isAnInvoice) {
      alert('Please select "Is an Invoice" (Invoice or Others) before marking this document reviewed.');
      return;
    }

    // Auto-calculate docClassificationIssue based on isAnInvoice vs originalRecordType.
    // If originalRecordType is blank (missing from source data), fall back to finalRecordType
    // so we don't incorrectly flag agreed-upon classifications as issues.
    // Exception: VB_CREDIT_MEMO marked as Others is NOT a classification issue (credit memos
    // are correctly classified as non-invoice documents). Compare normalized (case-insensitive)
    // so mixed-case source data agrees with the recordTypeStatus badge shown above.
    const selectedType = isAnInvoice;
    const baseRecordType = norm(document.originalRecordType) || norm(document.finalRecordType) || '';
    const calculatedIssue: 'Yes' | 'No' =
      (selectedType === 'Others' && baseRecordType === 'vb_credit_memo')
        ? 'No'
        : (selectedType === 'Invoice' && baseRecordType !== 'invoice') ||
          (selectedType === 'Others' && baseRecordType !== 'others')
          ? 'Yes' : 'No';

    const review: DocClassificationReview = {
      isAnInvoice: selectedType,
      expectedDocType,
      docClassificationIssue: calculatedIssue,
      vendor21MatchingIssue,
      expectedVendorName,
      existsInMastSor,
      comments,
    };

    onMarkAndNext(review);
  };

  if (!document) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-50 rounded-lg p-4">
        <FileText className="w-12 h-12 text-slate-300 mb-2" />
        <p className="text-slate-500 text-center text-sm">No document selected</p>
        <p className="text-xs text-slate-400 mt-1 text-center">
          Navigate through documents using the arrows above
        </p>
      </div>
    );
  }

  // Merge any lazily-fetched SOR enrichment over the document for the SOR-tab renders. Identical to
  // `document` today (overlay empty); becomes populated when the Stage-2 SOR backend is enabled.
  const sorDoc = { ...document, ...(sorOverlay[document.documentId] || {}) };

  // The Invoice/Others classification is mandatory to save a review.
  const canMarkAndNext = !!isAnInvoice;

  // Canonical vendor status from the shared helper — the SAME value shown in Analysis filters,
  // the Reviewed table, and Metrics. NOT folded with the reviewer's live form choice (that's a
  // separate reviewer-intent signal), so the badge reads identically across every view.
  const canonicalVendor = canonicalVendorMatch(document);
  const vendorBadge: 'match' | 'mismatch' | 'no-original' =
    canonicalVendor === 'No Original Data' ? 'no-original'
      : canonicalVendor === 'Vendor Match' ? 'match'
        : 'mismatch';

  // Auto-fill button condition: canonical vendor match + original record type Invoice + record match.
  const isVendorMatch = canonicalVendor === 'Vendor Match';
  const origIsInvoice = norm(document.originalRecordType) === 'invoice';
  const isRecordMatch = recordTypeStatus(document.finalRecordType, document.originalRecordType) === 'Record Match';
  const showAutoFill = isVendorMatch && origIsInvoice && isRecordMatch;

  const handleAutoFill = () => {
    // The button only shows when origIsInvoice (normalized), so map to 'Invoice' unconditionally
    // — matching the button's own label instead of a case-sensitive literal compare.
    setIsAnInvoice('Invoice');
    setVendor21MatchingIssue('Does not Exist');
    setIsAutoSuggested(false);
  };

  return (
    <div className={`bg-white rounded-lg border shadow-md overflow-hidden h-full flex flex-col ${
      isReviewed && reviewedDoc?.isAutoReviewed
        ? 'border-blue-300 bg-blue-50/10'
        : 'border-slate-300'
    }`}>
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Document Info Header - Compact */}
        <div className="p-3 border-b border-slate-200 bg-slate-50 space-y-2">
          {/* Top Row: Document ID (left) and Tenant Name (right) */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-slate-500 block">Document ID</span>
              <div className="flex items-center gap-1">
                <code className="text-sm font-mono text-slate-900 truncate">{document.documentId}</code>
                <CopyButton text={document.documentId} size="sm" />
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="text-xs font-medium text-slate-500 block">Tenant Name</span>
              <span className="text-sm text-purple-700 font-bold">{document.tenantName || '-'}</span>
              {isReviewed && !reviewedDoc?.isAutoReviewed && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 ml-1">
                  <CheckCircle className="w-2.5 h-2.5" />
                  User Reviewed
                </span>
              )}
              {isReviewed && reviewedDoc?.isAutoReviewed && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 border border-blue-300 ml-1">
                  ✨ Auto-Reviewed
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs font-medium text-slate-500 block">Message ID</span>
              <div className="flex items-center gap-1">
                <code className="text-xs font-mono text-slate-700 truncate">{document.messageId}</code>
                <CopyButton text={document.messageId} size="sm" />
              </div>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500 block">Created At</span>
              <div className="flex items-center gap-1 text-xs text-slate-700">
                <Calendar className="w-3 h-3" />
                {formatDate(document.createdAt)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs font-medium text-slate-500 block">Tenant ID</span>
              <div className="flex items-center gap-1">
                <code className="text-xs font-mono text-slate-700 truncate">{document.tenantId}</code>
                <CopyButton text={document.tenantId} size="sm" />
              </div>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500 block">Invoice #</span>
              <span className="text-sm text-slate-700 font-medium">{document.invoiceNumber || '-'}</span>
            </div>
          </div>

          {/* Email provenance — who the invoice email came from / went to (mia.intent From/To) */}
          {(document.senderEmail || document.recipientEmail) && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-slate-500 block">Sender Email (From)</span>
                  <div className="flex items-center gap-1">
                    <code className="text-xs font-mono text-slate-700 truncate" title={document.senderEmail || ''}>{document.senderEmail || '-'}</code>
                    {document.senderEmail && <CopyButton text={document.senderEmail} size="sm" />}
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-medium text-slate-500 block">Recipient Email (To)</span>
                  <div className="flex items-center gap-1">
                    <code className="text-xs font-mono text-slate-700 truncate" title={document.recipientEmail || ''}>{document.recipientEmail || '-'}</code>
                    {document.recipientEmail && <CopyButton text={document.recipientEmail} size="sm" />}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-1">
            {/* Only render a badge when the source value is known — a missing column read as
                'Unknown' should not surface a meaningless gray "Unknown" pill. */}
            {document.onUI !== 'Unknown' && <StatusBadge status={document.onUI} size="sm" />}
            {document.written !== 'Unknown' && <StatusBadge status={document.written} size="sm" />}
            {document.manual !== 'Unknown' && <StatusBadge status={document.manual} size="sm" />}
          </div>

          {/* Customer Edits — AAI (NLU) value vs the customer's edited value, for the three review
              scenarios (record type / entity name / vendor name). Shown ONLY for the Mismatch Review
              dataset; the regular full pull doesn't carry these fields. */}
          {(() => {
            const edits = customerEditMismatches(document);
            if (!edits.isCustomerEditRecord) return null;
            const Row = ({ label, aai, cust, mismatch }: { label: string; aai: string; cust: string; mismatch: boolean }) => (
              <div className="grid grid-cols-[110px_1fr_auto_1fr] items-center gap-2 text-xs py-1">
                <span className="text-slate-500 font-medium">{label}</span>
                <span className="font-mono text-slate-700 truncate" title={aai}>{aai || '—'}</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className={`font-mono truncate flex items-center gap-1.5 ${mismatch ? 'text-amber-700 font-semibold' : 'text-slate-700'}`} title={cust}>
                  {cust || '—'}
                  {mismatch && <span className="text-[9px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1 py-0.5 rounded">changed</span>}
                </span>
              </div>
            );
            return (
              <div className="mt-3 border border-amber-200 rounded-lg overflow-hidden">
                <div className="bg-amber-50 px-3 py-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-800">Customer Edits — AAI → Customer</span>
                  <span className="text-[10px] text-amber-700">
                    {edits.any ? `${[edits.recordType && 'Record Type', edits.entityName && 'Entity', edits.vendorName && 'Vendor'].filter(Boolean).join(' · ')} changed` : 'no field changed'}
                  </span>
                </div>
                <div className="px-3 py-2 bg-white">
                  <div className="grid grid-cols-[110px_1fr_auto_1fr] gap-2 text-[10px] uppercase tracking-wide text-slate-400 pb-1 border-b border-slate-100">
                    <span>Field</span><span>AAI / NLU</span><span></span><span>Customer</span>
                  </div>
                  <Row label="Record Type" aai={document.aaiRecordType || document.originalRecordType || ''} cust={document.customerRecordType || document.finalRecordType || ''} mismatch={edits.recordType} />
                  <Row label="Entity Name" aai={document.aaiEntityName || ''} cust={document.customerEntityName || ''} mismatch={edits.entityName} />
                  <Row label="Entity ID" aai={document.aaiEntityId || ''} cust={document.customerEntityId || ''} mismatch={(document.aaiEntityId || '').trim() !== (document.customerEntityId || '').trim()} />
                  {/* Vendor Name edit = AAI original NLU vendor → the resolved record vendor
                      (`vendorName`), matching the pipeline's mismatch definition and the "Customer
                      VendorName" card above. NOT customerVendorName (final_json.vendorName), which for
                      these rows often equals the AAI value and would show a no-op "changed" arrow. */}
                  <Row label="Vendor Name" aai={document.originalVendorName || ''} cust={document.vendorName || ''} mismatch={edits.vendorName} />
                </div>
              </div>
            );
          })()}

        </div>

        {/* Tab Navigation */}
        <div className="border-b border-slate-200 bg-white">
          <div className="flex">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('json')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'json'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              NLU Extraction
            </button>
            <button
              onClick={() => setActiveTab('extracted')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'extracted'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Vendor Name Extraction
            </button>
            <button
              onClick={() => setActiveTab('sorhintstab')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === 'sorhintstab'
                  ? 'border-green-500 text-green-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              SOR Hints
            </button>
            <button
              onClick={() => setActiveTab('mastersor')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'mastersor'
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Master SOR Record
            </button>
          </div>
        </div>

        {/* Details Tab Content */}
        {activeTab === 'details' && (
          <>
        {/* Auto-suggestion banner — form is pre-filled but NOT saved until the user confirms */}
        {isAutoSuggested && !isReviewed && (
          <div className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-800">
            <Wand2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span><strong>Auto-suggested:</strong> Invoice · Does not Exist · Exists in mast_sor. Not saved yet — review and click <strong>Mark &amp; Next</strong> to confirm.</span>
          </div>
        )}
        {/* JSON Data Display - Side by Side */}
        {(document.docClassificationJson || document.vendorNameJson || document.docClassificationJsonRaw || document.vendorNameJsonRaw) && (
          <div className="p-3 border-b border-slate-200 bg-slate-50">
            <h4 className="text-xs font-semibold text-slate-700 mb-2">
              Extracted Data (JSON)
            </h4>
            <div className="grid grid-cols-2 gap-3">
              {/* Left: Document Classification JSON */}
              <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
                <div className="font-medium text-blue-700 mb-1">Document Classification</div>
                {document.docClassificationJson && document.docClassificationJson.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {document.docClassificationJson.map((entry, idx) => (
                      <div key={idx} className="bg-white p-1.5 rounded text-xs">
                        <div className="font-medium text-blue-800">{entry.prediction.classification}</div>
                        <div className="text-slate-600">
                          Confidence: {(entry.prediction.confidence * 100).toFixed(1)}%
                        </div>
                        <div className="text-slate-500">Model: {entry.prediction.model}</div>
                      </div>
                    ))}
                  </div>
                ) : document.docClassificationJsonRaw ? (
                  <div className="text-amber-700">Truncated — see <span className="font-medium">NLU Extraction</span> tab</div>
                ) : (
                  <div className="text-slate-400">No data</div>
                )}
              </div>

              {/* Right: Vendor Name JSON */}
              <div className="bg-purple-50 border border-purple-200 rounded p-2 text-xs">
                <div className="font-medium text-purple-700 mb-1">Vendor Name Extraction</div>
                {document.vendorNameJson && document.vendorNameJson.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {document.vendorNameJson.map((entry, idx) => (
                      <div key={idx} className="bg-white p-1.5 rounded text-xs">
                        <div className="font-medium text-purple-800">Extracted: {entry.Value}</div>
                        <div className="text-slate-600">Normalized: {entry.NormalizedValue}</div>
                        <div className="text-slate-500">
                          Confidence: {(entry.Confidence * 100).toFixed(1)}%
                        </div>
                        <div className="text-slate-500">Reason: {entry.Reason}</div>
                      </div>
                    ))}
                  </div>
                ) : document.vendorNameJsonRaw ? (
                  <div className="text-amber-700">Truncated — see <span className="font-medium">Vendor Name Extraction</span> tab</div>
                ) : (
                  <div className="text-slate-400">No data</div>
                )}
              </div>
            </div>

            {/* Display ExtractedVendorName and NormalizedVendorName for Message ID */}
            {document.messageId && (
              <div className="mt-2 pt-2 border-t border-slate-300">
                <div className="text-xs text-slate-600">
                  <span className="font-medium">Message ID:</span> {document.messageId}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div className="text-xs">
                    <span className="text-slate-600">Extracted:</span>{' '}
                    <span className="font-medium text-green-700">{document.extractedVendorName || 'N/A'}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-slate-600">Normalized:</span>{' '}
                    <span className="font-medium text-amber-700">{document.normalizedVendorName || 'N/A'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Document Classification Section - Compact */}
        <div className="p-3 border-b border-blue-100 bg-blue-50/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-1">
              <FileText className="w-4 h-4" />
              Document Classification
            </h3>
            {/* Record Match/Mismatch Label — based on AAI original vs final record type (normalized) */}
            {recordTypeStatus(document.finalRecordType, document.originalRecordType) !== 'Record Mismatch' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300">
                <CheckCircle className="w-3 h-3" />
                {recordTypeStatus(document.finalRecordType, document.originalRecordType) === 'No Original' ? 'No Original Type' : 'Record Match'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
                <span className="w-3 h-3 flex items-center justify-center text-xs">✗</span>
                Record Mismatch
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs font-medium text-slate-600 block">Original Record Type</span>
                <span className="text-sm text-slate-900 font-semibold">{document.originalRecordType}</span>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-600 block">Final Record Type</span>
                <span className="text-sm text-slate-900 font-semibold">{document.finalRecordType}</span>
              </div>
            </div>

            <div className="bg-white p-2 rounded border border-slate-300 space-y-2">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Is an Invoice</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 px-2 py-1 rounded transition-colors">
                    <input
                      type="radio"
                      name="isAnInvoice"
                      checked={isAnInvoice === 'Invoice'}
                      onChange={() => { setIsAnInvoice('Invoice'); setIsAutoSuggested(false); }}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">Invoice</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 px-2 py-1 rounded transition-colors">
                    <input
                      type="radio"
                      name="isAnInvoice"
                      checked={isAnInvoice === 'Others'}
                      onChange={() => {
                        setIsAnInvoice('Others');
                        setVendor21MatchingIssue(null);
                        setExistsInMastSor(null);
                        setIsAutoSuggested(false);
                      }}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-slate-700">Others</span>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="expectedDocType" className="text-xs font-medium text-slate-700 block mb-1">
                  Expected Doc Type
                </label>
                <input
                  id="expectedDocType"
                  type="text"
                  value={expectedDocType}
                  onChange={(e) => setExpectedDocType(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter expected document type"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Vendor 2.1 Analysis Section - Compact */}
        <div className="p-3 bg-purple-50/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-purple-900">Vendor Matching Info</h3>
            {/* Vendor Match/Mismatch Label (source-column-aware, normalized) */}
            {vendorBadge === 'match' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300">
                <CheckCircle className="w-3 h-3" />
                Vendor Match
              </span>
            ) : vendorBadge === 'no-original' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                No Original Data
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
                <span className="w-3 h-3 flex items-center justify-center text-xs">✗</span>
                Vendor Mismatch
              </span>
            )}
          </div>

          <div className="space-y-2">
            {/* Vendor Info Cards - Row 1 */}
            <div className="grid grid-cols-2 gap-2">
              {/* AAI VendorName (originalVendorName — the normalized/SOR-resolved value AAI wrote) */}
              <div className="bg-purple-50 border border-purple-200 rounded p-2">
                <span className="text-xs font-medium text-purple-600 uppercase tracking-wider block">
                  AAI VendorName
                </span>
                <span className="text-sm text-slate-900 font-medium break-words">
                  {document.originalVendorName || '-'}
                </span>
              </div>
              {/* Customer VendorName (final vendorname) */}
              <div className="bg-blue-50 border border-blue-200 rounded p-2">
                <span className="text-xs font-medium text-blue-600 uppercase tracking-wider block">
                  Customer VendorName
                </span>
                <span className="text-sm text-slate-900 font-semibold break-words">
                  {document.vendorName || '-'}
                </span>
              </div>
            </div>

            {/* Vendor Info Cards - Row 2 */}
            <div className="grid grid-cols-2 gap-2">
              {/* Extracted Vendor Name - Green Theme */}
              <div className="bg-green-50 border border-green-200 rounded p-2">
                <span className="text-xs font-medium text-green-600 uppercase tracking-wider block">
                  Extracted Vendor Name
                </span>
                <span className="text-sm text-slate-900 font-medium break-words">
                  {document.extractedVendorName || '-'}
                </span>
              </div>
              {/* Normalized Vendor Name - Amber Theme */}
              <div className="bg-amber-50 border border-amber-200 rounded p-2">
                <span className="text-xs font-medium text-amber-600 uppercase tracking-wider block">
                  Normalized Vendor Name
                </span>
                <span className="text-sm text-slate-900 font-medium break-words">
                  {document.normalizedVendorName || '-'}
                </span>
              </div>
            </div>

            {/* Entity — shown once for both modes (name + id). Populated from the customer-edit /
                live-query entity fields; '-' when the dataset doesn't carry entity data. */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-indigo-50 border border-indigo-200 rounded p-2">
                <span className="text-xs font-medium text-indigo-600 uppercase tracking-wider block">
                  Entity Name
                </span>
                <span className="text-sm text-slate-900 font-medium break-words">
                  {document.customerEntityName || document.aaiEntityName || '-'}
                </span>
              </div>
              <div className="bg-indigo-50 border border-indigo-200 rounded p-2">
                <span className="text-xs font-medium text-indigo-600 uppercase tracking-wider block">
                  Entity ID
                </span>
                <span className="text-sm text-slate-900 font-mono break-words">
                  {document.customerEntityId || document.aaiEntityId || '-'}
                </span>
              </div>
            </div>

            {/* VendorNameReason - Slate Theme (Full Width) */}
            <div className="bg-slate-100 border border-slate-300 rounded p-2">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wider block">
                VendorNameReason
              </span>
              <span className="text-sm text-slate-900 font-medium break-words">
                {document.vendorNameReason || '-'}
              </span>
            </div>

            {/* VendorNameReason Explanation */}
            {document.vendorNameReason && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2">
                <span className="text-xs font-medium text-blue-600 uppercase tracking-wider block mb-1">
                  Reason Explanation
                </span>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {explainVendorNameReason(document.vendorNameReason)}
                </p>
              </div>
            )}

            {/* SOR Match Source for Original Vendor */}
            {document.originalVendorName && (() => {
              const origLower = document.originalVendorName!.trim().toLowerCase();
              const hasMatch = (arr: SorLookupResult[] | null | undefined) =>
                arr?.some(e =>
                  (e.coalesced_name?.trim().toLowerCase() === origLower) ||
                  (e.vendor_name?.trim().toLowerCase() === origLower) ||
                  (e.acceptable_name?.trim().toLowerCase() === origLower)
                ) ?? false;
              const hintsMatch = hasMatch(sorDoc.sorHintsNormalized) || hasMatch(sorDoc.sorHintsExtracted);
              const masterMatch = hasMatch(sorDoc.sorMasterNormalized) || hasMatch(sorDoc.sorMasterExtracted);
              const systemMatch = hasMatch(sorDoc.systemHintsNormalized) || hasMatch(sorDoc.systemHintsExtracted);
              if (!hintsMatch && !masterMatch && !systemMatch) return null;
              return (
                <div className="bg-slate-50 border border-slate-200 rounded p-2">
                  <span className="text-xs font-medium text-slate-600 uppercase tracking-wider block mb-1.5">
                    Match Source for Original Vendor
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {hintsMatch && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300">
                        sor_hints
                      </span>
                    )}
                    {masterMatch && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-300">
                        master_sor
                      </span>
                    )}
                    {systemMatch && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-300">
                        system_hints
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* SOR Matching Results */}
            <div className="bg-white border border-slate-300 rounded p-2">
              <h4 className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                SOR Matching Results
              </h4>

              <div className="space-y-1.5">
                <SORMatchSection
                  title="SOR Hints (Normalized)"
                  matches={sorDoc.sorHintsNormalized}
                  raw={sorDoc.sorHintsNormalizedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="hints"
                />
                <SORMatchSection
                  title="SOR Hints (Extracted)"
                  matches={sorDoc.sorHintsExtracted}
                  raw={sorDoc.sorHintsExtractedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="hints"
                />
                <SORMatchSection
                  title="SOR Master (Normalized)"
                  matches={sorDoc.sorMasterNormalized}
                  raw={sorDoc.sorMasterNormalizedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="master"
                />
                <SORMatchSection
                  title="SOR Master (Extracted)"
                  matches={sorDoc.sorMasterExtracted}
                  raw={sorDoc.sorMasterExtractedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="master"
                />
                <SORMatchSection
                  title="System Hints (Normalized)"
                  matches={sorDoc.systemHintsNormalized}
                  raw={sorDoc.systemHintsNormalizedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="system"
                />
                <SORMatchSection
                  title="System Hints (Extracted)"
                  matches={sorDoc.systemHintsExtracted}
                  raw={sorDoc.systemHintsExtractedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="system"
                />
              </div>

              {/* Matching Status Summary */}
              <div className="mt-3 pt-3 border-t border-slate-300">
                <div className="text-xs font-semibold text-slate-700 mb-1.5 uppercase tracking-wider">
                  Matching Status
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 p-1.5 rounded">
                    <span className="text-slate-600 block mb-0.5">Normalized vs Original:</span>
                    <span className={`font-semibold ${
                      document.normalizedMatchedWithOriginalVendorName === 'Yes' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {document.normalizedMatchedWithOriginalVendorName || 'N/A'}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-1.5 rounded">
                    <span className="text-slate-600 block mb-0.5">Extracted vs Original:</span>
                    <span className={`font-semibold ${
                      document.extractedMatchedWithOriginalVendorName === 'Yes' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {document.extractedMatchedWithOriginalVendorName || 'N/A'}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-1.5 rounded">
                    <span className="text-slate-600 block mb-0.5">Normalized vs Final:</span>
                    <span className={`font-semibold ${
                      document.normalizedMatchedWithFinalVendorName === 'Yes' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {document.normalizedMatchedWithFinalVendorName || 'N/A'}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-1.5 rounded">
                    <span className="text-slate-600 block mb-0.5">Extracted vs Final:</span>
                    <span className={`font-semibold ${
                      document.extractionMatchedWithFinalVendorName === 'Yes' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {document.extractionMatchedWithFinalVendorName || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-2 rounded border border-slate-300 space-y-2">
              <div>
                <label className={`text-xs font-medium block mb-1 ${isAnInvoice === 'Others' ? 'text-slate-400' : 'text-slate-700'}`}>Vendor 2.1 Matching Issue</label>
                <div className="flex flex-col gap-1">
                  <label className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${isAnInvoice === 'Others' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-50'}`}>
                    <input
                      type="radio"
                      name="vendor21MatchingIssue"
                      checked={vendor21MatchingIssue === 'Does not Exist'}
                      onChange={() => { setVendor21MatchingIssue('Does not Exist'); setIsAutoSuggested(false); }}
                      disabled={isAnInvoice === 'Others'}
                      className="w-4 h-4 text-purple-600"
                    />
                    <span className="text-sm text-slate-700">Does not Exist</span>
                  </label>
                  <label className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${isAnInvoice === 'Others' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-50'}`}>
                    <input
                      type="radio"
                      name="vendor21MatchingIssue"
                      checked={vendor21MatchingIssue === 'Vendor Matching Issue'}
                      onChange={() => { setVendor21MatchingIssue('Vendor Matching Issue'); setIsAutoSuggested(false); }}
                      disabled={isAnInvoice === 'Others'}
                      className="w-4 h-4 text-purple-600"
                    />
                    <span className="text-sm text-slate-700">Vendor Matching Issue</span>
                  </label>
                </div>
              </div>

              <div>
                <label className={`text-xs font-medium block mb-1 ${isAnInvoice === 'Others' ? 'text-slate-400' : 'text-slate-700'}`}>Exists in mast_sor</label>
                <div className="flex gap-3">
                  <label className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${isAnInvoice === 'Others' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-50'}`}>
                    <input
                      type="radio"
                      name="existsInMastSor"
                      checked={existsInMastSor === 'Yes'}
                      onChange={() => { setExistsInMastSor('Yes'); setIsAutoSuggested(false); }}
                      disabled={isAnInvoice === 'Others'}
                      className="w-4 h-4 text-purple-600"
                    />
                    <span className="text-sm text-slate-700">Yes</span>
                  </label>
                  <label className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${isAnInvoice === 'Others' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-50'}`}>
                    <input
                      type="radio"
                      name="existsInMastSor"
                      checked={existsInMastSor === 'No'}
                      onChange={() => { setExistsInMastSor('No'); setIsAutoSuggested(false); }}
                      disabled={isAnInvoice === 'Others'}
                      className="w-4 h-4 text-purple-600"
                    />
                    <span className="text-sm text-slate-700">No</span>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="expectedVendorName" className="text-xs font-medium text-slate-700 block mb-1">
                  Expected Vendor Name
                </label>
                <input
                  id="expectedVendorName"
                  type="text"
                  value={expectedVendorName}
                  onChange={(e) => setExpectedVendorName(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="Enter expected vendor name"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Comments Section */}
        <div className="p-3">
          <div className="bg-white p-2 rounded border border-slate-300">
            <label htmlFor="reviewComments" className="text-xs font-medium text-slate-700 block mb-1">
              Comments
            </label>
            <textarea
              id="reviewComments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={3}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
              placeholder="Add notes or comments about this document..."
            />
          </div>
        </div>
          </>
        )}

        {/* JSON Data Tab Content */}
        {activeTab === 'json' && (
          <div className="p-4 space-y-4">
            {/* Vendor Name Matching */}
            <div className="bg-white border border-slate-300 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Vendor Name Matching</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className={`p-3 rounded-lg border-2 ${
                  document.originalVendorName && document.vendorNameJson?.some(v =>
                    v.Value?.toLowerCase() === document.originalVendorName?.toLowerCase()
                  ) ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-300'
                }`}>
                  <div className="text-xs font-medium text-slate-600 mb-1">OriginalVendorName</div>
                  <div className="text-sm font-semibold text-slate-900">{document.originalVendorName || '-'}</div>
                </div>
                <div className={`p-3 rounded-lg border-2 ${
                  document.extractedVendorName && document.vendorNameJson?.some(v =>
                    v.Value?.toLowerCase() === document.extractedVendorName?.toLowerCase()
                  ) ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-300'
                }`}>
                  <div className="text-xs font-medium text-slate-600 mb-1">ExtractedVendorName</div>
                  <div className="text-sm font-semibold text-slate-900">{document.extractedVendorName || '-'}</div>
                </div>
                <div className={`p-3 rounded-lg border-2 ${
                  document.normalizedVendorName && document.vendorNameJson?.some(v =>
                    v.NormalizedValue?.toLowerCase() === document.normalizedVendorName?.toLowerCase()
                  ) ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-300'
                }`}>
                  <div className="text-xs font-medium text-slate-600 mb-1">NormalizedVendorName</div>
                  <div className="text-sm font-semibold text-slate-900">{document.normalizedVendorName || '-'}</div>
                </div>
              </div>
            </div>

            {/* Document Classification JSON */}
            {document.docClassificationJson && document.docClassificationJson.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-blue-800 mb-3">Document Classification JSON</h3>
                <div className="space-y-2">
                  {document.docClassificationJson.map((entry, idx) => (
                    <div key={idx} className="bg-white border border-blue-200 rounded p-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-slate-600">Classification:</span>{' '}
                          <span className="font-semibold text-blue-700">{entry.prediction.classification}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">Model:</span>{' '}
                          <span className="font-medium">{entry.prediction.model}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">Confidence:</span>{' '}
                          <span className="font-semibold text-green-600">
                            {(entry.prediction.confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-600">Pages:</span>{' '}
                          <span className="font-medium">{entry.start_page} - {entry.end_page}</span>
                        </div>
                      </div>
                      {entry.prediction.Reason && (
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-medium">Reason:</span> {entry.prediction.Reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw fallback: doc_classification_json is exported via CAST(... AS CHAR(10000)) and is
                often truncated mid-string, so it can't be JSON-parsed. Show the raw text instead of
                silently hiding the section. */}
            {(!document.docClassificationJson || document.docClassificationJson.length === 0) && document.docClassificationJsonRaw && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-1 flex items-center gap-2">
                  Document Classification JSON
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">raw · truncated</span>
                </h3>
                <p className="text-xs text-amber-700 mb-2">The source value was truncated at export and could not be parsed — showing the raw text.</p>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-white border border-amber-200 rounded p-2 text-slate-700">{document.docClassificationJsonRaw}</pre>
              </div>
            )}

            {/* Vendor Name JSON */}
            {document.vendorNameJson && document.vendorNameJson.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-purple-800 mb-3">Vendor Name Extraction JSON</h3>
                <div className="space-y-2">
                  {document.vendorNameJson.map((entry, idx) => {
                    const hintsAddress = entry.Reason === 'withHints'
                      ? [...(sorDoc.sorHintsNormalized || []), ...(sorDoc.sorHintsExtracted || [])].find(m => m.address)?.address
                      : undefined;
                    const masterMatch = (entry.Reason === 'withLLM' || entry.Reason === 'fromSystemHintsCached')
                      ? [...(sorDoc.sorMasterNormalized || []), ...(sorDoc.sorMasterExtracted || [])].find(m => m.address1 || m.address2)
                      : undefined;
                    return (
                      <div key={idx} className="bg-white border border-purple-200 rounded p-3">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-slate-600">Extracted:</span>{' '}
                            <span className="font-semibold text-purple-700">{entry.Value}</span>
                          </div>
                          <div>
                            <span className="text-slate-600">Normalized:</span>{' '}
                            <span className="font-semibold text-amber-700">{entry.NormalizedValue}</span>
                          </div>
                          <div>
                            <span className="text-slate-600">Confidence:</span>{' '}
                            <span className="font-semibold text-green-600">
                              {(entry.Confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600">Reason:</span>{' '}
                            <span className="font-medium">{entry.Reason}</span>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-slate-600">
                          <span className="font-medium">Type:</span> {entry.Type} |
                          <span className="font-medium ml-2">Field:</span> {entry.aaiFieldName}
                        </div>
                        {hintsAddress && (
                          <div className="mt-2 text-sm text-slate-700 border-t border-purple-100 pt-2">
                            <span className="font-medium">Address:</span> {hintsAddress}
                          </div>
                        )}
                        {masterMatch?.address1 && (
                          <div className="mt-2 text-sm text-slate-700 border-t border-purple-100 pt-2">
                            <span className="font-medium">Address 1:</span> {masterMatch.address1}
                          </div>
                        )}
                        {masterMatch?.address2 && (
                          <div className="text-sm text-slate-700">
                            <span className="font-medium">Address 2:</span> {masterMatch.address2}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Raw fallback for a truncated/unparseable vendorname_json */}
            {(!document.vendorNameJson || document.vendorNameJson.length === 0) && document.vendorNameJsonRaw && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-1 flex items-center gap-2">
                  Vendor Name Extraction JSON
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">raw · truncated</span>
                </h3>
                <p className="text-xs text-amber-700 mb-2">The source value could not be parsed — showing the raw text.</p>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto bg-white border border-amber-200 rounded p-2 text-slate-700">{document.vendorNameJsonRaw}</pre>
              </div>
            )}

            {!document.docClassificationJson && !document.docClassificationJsonRaw &&
             !document.vendorNameJson && !document.vendorNameJsonRaw && (
              <div className="text-center py-8 text-slate-500">
                No JSON data available for this document
              </div>
            )}
          </div>
        )}

        {/* Extracted Data Tab Content */}
        {activeTab === 'extracted' && (
          <div className="p-4 space-y-4">
            {/* Message ID Display */}
            <div className="bg-slate-100 border border-slate-300 rounded-lg p-3">
              <div className="text-sm font-medium text-slate-700 mb-1">Message ID</div>
              <code className="text-sm font-mono text-slate-900 break-all">{document.messageId}</code>
            </div>

            {/* Side by Side JSON Display */}
            <div className="grid grid-cols-2 gap-4">
              {/* Left Column: Document Classification JSON */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-blue-800 mb-3 uppercase tracking-wide">
                  Document Classification
                </h3>
                {document.docClassificationJson && document.docClassificationJson.length > 0 ? (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {document.docClassificationJson.map((entry, idx) => (
                      <div key={idx} className="bg-white border border-blue-200 rounded p-3">
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-slate-600 font-medium">Classification:</span>{' '}
                            <span className="font-semibold text-blue-700">
                              {entry.prediction.classification}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 font-medium">Confidence:</span>{' '}
                            <span className="font-semibold text-green-600">
                              {(entry.prediction.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-600 font-medium">Model:</span>{' '}
                            <span className="font-medium text-slate-800">{entry.prediction.model}</span>
                          </div>
                          <div>
                            <span className="text-slate-600 font-medium">Pages:</span>{' '}
                            <span className="font-medium text-slate-800">
                              {entry.start_page} - {entry.end_page}
                            </span>
                          </div>
                          {entry.prediction.Reason && (
                            <div className="text-xs text-slate-600 pt-1 border-t border-blue-100">
                              <span className="font-medium">Reason:</span> {entry.prediction.Reason}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm py-4 text-center">No classification data</div>
                )}
              </div>

              {/* Right Column: Vendor Name JSON */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-purple-800 mb-3 uppercase tracking-wide">
                  Vendor Name Extraction
                </h3>
                {document.vendorNameJson && document.vendorNameJson.length > 0 ? (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {document.vendorNameJson.map((entry, idx) => {
                      const hintsAddress = entry.Reason === 'withHints'
                        ? [...(sorDoc.sorHintsNormalized || []), ...(sorDoc.sorHintsExtracted || [])].find(m => m.address)?.address
                        : undefined;
                      const masterMatch = (entry.Reason === 'withLLM' || entry.Reason === 'fromSystemHintsCached')
                        ? [...(sorDoc.sorMasterNormalized || []), ...(sorDoc.sorMasterExtracted || [])].find(m => m.address1 || m.address2)
                        : undefined;
                      return (
                        <div key={idx} className="bg-white border border-purple-200 rounded p-3">
                          <div className="space-y-2 text-sm">
                            <div className="pb-2 mb-2 border-b border-purple-100">
                              <span className="text-xs text-slate-500 font-medium">Entry {idx + 1}</span>
                            </div>
                            <div>
                              <span className="text-slate-600 font-medium">ExtractedVendorName (Value):</span>
                              <div className="font-semibold text-green-700 mt-1 break-words">
                                {entry.Value || 'N/A'}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-600 font-medium">NormalizedVendorName:</span>
                              <div className="font-semibold text-amber-700 mt-1 break-words">
                                {entry.NormalizedValue || 'N/A'}
                              </div>
                            </div>
                            <div>
                              <span className="text-slate-600 font-medium">Confidence:</span>{' '}
                              <span className="font-semibold text-green-600">
                                {(entry.Confidence * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-600 font-medium">Reason:</span>{' '}
                              <span className="font-medium text-slate-800">{entry.Reason}</span>
                            </div>
                            {entry.Type && (
                              <div className="text-xs text-slate-600 pt-1 border-t border-purple-100">
                                <span className="font-medium">Type:</span> {entry.Type}
                              </div>
                            )}
                            {hintsAddress && (
                              <div className="text-sm text-slate-700 pt-1 border-t border-purple-100">
                                <span className="font-medium">Address:</span> {hintsAddress}
                              </div>
                            )}
                            {masterMatch?.address1 && (
                              <div className="text-sm text-slate-700 pt-1 border-t border-purple-100">
                                <span className="font-medium">Address 1:</span> {masterMatch.address1}
                              </div>
                            )}
                            {masterMatch?.address2 && (
                              <div className="text-sm text-slate-700">
                                <span className="font-medium">Address 2:</span> {masterMatch.address2}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : document.vendorNameJsonRaw ? (
                  // vendorname_json is exported via CAST(... AS CHAR) and is often truncated
                  // mid-string, so it can't be JSON-parsed. Show the raw text instead of a
                  // misleading "No vendor data" (matches the NLU Extraction tab's fallback).
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">raw · truncated</span>
                      <span className="text-xs text-amber-700">Source value truncated at export — showing raw text.</span>
                    </div>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-white border border-amber-200 rounded p-2 text-slate-700">{document.vendorNameJsonRaw}</pre>
                  </div>
                ) : (
                  <div className="text-slate-400 text-sm py-4 text-center">No vendor data</div>
                )}
              </div>
            </div>

            {/* Empty State */}
            {!document.docClassificationJson && !document.vendorNameJson && !document.vendorNameJsonRaw && (
              <div className="text-center py-8 text-slate-500">
                No extracted data available for this document
              </div>
            )}
          </div>
        )}

        {/* SOR Hints Tab Content */}
        {activeTab === 'sorhintstab' && (
          <div className="p-4 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-xs text-green-700">
                SOR Hints lookup results from <span className="font-semibold">sor_hints_value</span> columns. These show acceptable name matches used when Vendor Name Reason is <span className="font-semibold">withHints</span>.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Normalized — sor_hints_value_normalized_matched_with_OriginalvendorName
                </h4>
                <SORMatchSection
                  title="SOR Hints (Normalized)"
                  matches={sorDoc.sorHintsNormalized}
                  raw={sorDoc.sorHintsNormalizedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="hints"
                />
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Extracted — sor_hints_value_Extracted_matched_with_OriginalvendorName
                </h4>
                <SORMatchSection
                  title="SOR Hints (Extracted)"
                  matches={sorDoc.sorHintsExtracted}
                  raw={sorDoc.sorHintsExtractedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="hints"
                />
              </div>
            </div>
          </div>
        )}

        {/* Master SOR Record Tab Content */}
        {activeTab === 'mastersor' && (
          <div className="p-4 space-y-4">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <p className="text-xs text-purple-700">
                Displays SOR Master lookup results for both <span className="font-semibold">Normalized</span> and <span className="font-semibold">Extracted</span> vendor name columns, regardless of Vendor Name Reason.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Normalized — sor_master_value_normalized_matched_with_OriginalvendorName
                </h4>
                <SORMatchSection
                  title="SOR Master (Normalized)"
                  matches={sorDoc.sorMasterNormalized}
                  raw={sorDoc.sorMasterNormalizedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="master"
                />
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                  Extracted — sor_master_value_Extracted_matched_with_OriginalvendorName
                </h4>
                <SORMatchSection
                  title="SOR Master (Extracted)"
                  matches={sorDoc.sorMasterExtracted}
                  raw={sorDoc.sorMasterExtractedRaw}
                  originalVendor={document.originalVendorName}
                  columnType="master"
                />
              </div>
            </div>
          </div>
        )}

        {/* Attachment & S3 source — expected PDF name plus the raw S3 locations (bottom of panel) */}
        <div className="p-3 border-t border-slate-200">
          <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-1.5">
            <div className="flex items-center gap-1">
              <File className="w-3 h-3 text-amber-600" />
              <span className="text-xs font-medium text-amber-700">Attachment &amp; S3 Source</span>
            </div>

            <div>
              <span className="text-[11px] font-medium text-amber-700/80 block">Expected PDF Filename</span>
              <div className="flex items-start gap-1">
                <code className="text-xs font-mono text-amber-900 break-all flex-1">
                  {extractFilenameFromS3(document.extractedFileS3Location || document.s3Location)}
                </code>
                <CopyButton text={extractFilenameFromS3(document.extractedFileS3Location || document.s3Location)} size="sm" />
              </div>
            </div>

            {document.extractedFileS3Location && document.extractedFileS3Location.trim() !== '' && (
              <div className="pt-1.5 border-t border-amber-200/70">
                <span className="text-[11px] font-medium text-amber-700/80 block">Extracted File S3 Location</span>
                <div className="flex items-start gap-1">
                  <code className="text-xs font-mono text-amber-900 break-all flex-1">{document.extractedFileS3Location}</code>
                  <CopyButton text={document.extractedFileS3Location} size="sm" />
                </div>
              </div>
            )}

            {document.s3Location && document.s3Location.trim() !== '' && (
              <div className="pt-1.5 border-t border-amber-200/70">
                <span className="text-[11px] font-medium text-amber-700/80 block">S3 Location</span>
                <div className="flex items-start gap-1">
                  <code className="text-xs font-mono text-amber-900 break-all flex-1">{document.s3Location}</code>
                  <CopyButton text={document.s3Location} size="sm" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons - Compact */}
      {onMarkAndNext && onSkip && (
        <div className="border-t border-slate-200 bg-slate-50">
          {/* Auto-fill helper row */}
          {showAutoFill && (
            <div className="px-2 pt-2">
              <button
                onClick={handleAutoFill}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-300 rounded hover:bg-teal-100 transition-colors"
                title="Vendor Match + Record Match detected — click to auto-fill review fields"
              >
                <Wand2 className="w-3.5 h-3.5" />
                Auto-fill: Invoice + Does not Exist
                <span className="ml-1 text-[10px] text-teal-500">(Vendor Match · Record Match)</span>
              </button>
            </div>
          )}
          {/* Main action row */}
          <div className="p-2 flex items-center gap-2">
            <Button onClick={onSkip} variant="ghost" size="sm" className="flex-1 text-sm px-3 py-1.5 hover:bg-slate-100 transition-colors">
              <SkipForward className="w-4 h-4 mr-1" />
              Skip
            </Button>
            {isReviewed && !reviewedDoc?.isAutoReviewed && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-700 border border-green-300 shrink-0">
                <CheckCircle className="w-3 h-3" />
                User Reviewed
              </span>
            )}
            <Button
              onClick={handleMarkAndNext}
              variant="primary"
              size="sm"
              className="flex-1 text-sm px-3 py-1.5 shadow-sm hover:shadow transition-all"
              disabled={!canMarkAndNext}
            >
              <ArrowRight className="w-4 h-4 mr-1" />
              {isReviewed ? 'Update & Next' : 'Mark & Next'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
