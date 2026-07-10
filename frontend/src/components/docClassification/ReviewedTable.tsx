import { useEffect, useRef, useState } from 'react';
import { ReviewedDocClassification } from '../../types/docClassification';
import { X, Filter, Search } from 'lucide-react';
import { recordTypeStatus, reviewVendorStatus } from '../../utils/reviewStatus';

export interface ColumnOption { value: string; count: number; }

interface ReviewedTableProps {
  reviewedDocs: ReviewedDocClassification[];
  onRemove: (documentId: string) => void;
  columnFilters?: Record<string, string[]>;
  columnOptions?: Record<string, ColumnOption[]>;
  onColumnFilterChange?: (key: string, values: string[]) => void;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '-';
  let d: Date;
  if (date instanceof Date) {
    d = date;
  } else {
    let normalized = (date as string).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized) &&
        !normalized.includes('T') && !normalized.includes('Z')) {
      normalized = normalized.replace(' ', 'T') + 'Z';
    }
    d = new Date(normalized);
  }
  if (isNaN(d.getTime())) return typeof date === 'string' ? date : '-';
  return d.toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const th = 'px-3 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap';
const trunc = (s: string | null | undefined, n = 50) =>
  s ? (s.length > n ? s.substring(0, n) + '...' : s) : '-';

/**
 * Column metadata IN THE SAME ORDER as the header/body below. `value(doc)` returns the exact string
 * shown in the cell — used for per-column distinct-value filters (and their option lists). Keep this
 * array in sync with the <th>/<td> order or the filter row will misalign.
 */
export interface ReviewedColumnMeta { key: string; value: (d: ReviewedDocClassification) => string; }
export const REVIEWED_COLUMNS: ReviewedColumnMeta[] = [
  { key: 'documentId', value: d => d.documentId },
  { key: 'createdAt', value: d => formatDate(d.createdAt) },
  { key: 'updatedAt', value: d => (d.updatedAt ? formatDate(d.updatedAt) : '-') },
  { key: 'messageId', value: d => d.messageId },
  { key: 'tenantName', value: d => d.tenantName },
  { key: 'tenantId', value: d => d.tenantId },
  { key: 'onUI', value: d => d.onUI },
  { key: 'reasonForDismissal', value: d => d.reasonForDismissal || '-' },
  { key: 'written', value: d => d.written },
  { key: 'manual', value: d => d.manual },
  { key: 'finalRecordType', value: d => d.finalRecordType || '-' },
  { key: 'originalRecordType', value: d => d.originalRecordType || '-' },
  { key: 'invoiceNumber', value: d => d.invoiceNumber || '-' },
  { key: 'vendorId', value: d => d.vendorId || '-' },
  { key: 'vendorName', value: d => d.vendorName || '-' },
  { key: 'originalVendorName', value: d => d.originalVendorName || '-' },
  { key: 'extractedVendorName', value: d => d.extractedVendorName || '-' },
  { key: 'normalizedVendorName', value: d => d.normalizedVendorName || '-' },
  { key: 'vendorNameReason', value: d => d.vendorNameReason || '-' },
  { key: 'vendorMatchStatus', value: d => d.vendorMatchStatus || '-' },
  { key: 'attachmentFileName', value: d => d.attachmentFileName || '-' },
  { key: 'extractedFileS3Location', value: d => d.extractedFileS3Location || '-' },
  { key: 'originalAttachmentFileName', value: d => d.originalAttachmentFileName || '-' },
  { key: 's3Location', value: d => d.s3Location || '-' },
  { key: 'docClassificationJson', value: d => trunc(d.docClassificationJsonRaw) },
  { key: 'vendorNameJson', value: d => trunc(d.vendorNameJsonRaw) },
  { key: 'normMatchOrig', value: d => d.normalizedMatchedWithOriginalVendorName || '-' },
  { key: 'normMatchFinal', value: d => d.normalizedMatchedWithFinalVendorName || '-' },
  { key: 'extMatchOrig', value: d => d.extractedMatchedWithOriginalVendorName || '-' },
  { key: 'extMatchFinal', value: d => d.extractionMatchedWithFinalVendorName || '-' },
  { key: 'dataSource', value: d => d.dataSource || '-' },
  { key: 'sorHintsNorm', value: d => trunc(d.sorHintsNormalizedRaw) },
  { key: 'sorHintsExt', value: d => trunc(d.sorHintsExtractedRaw) },
  { key: 'sorMasterNorm', value: d => trunc(d.sorMasterNormalizedRaw) },
  { key: 'sorMasterExt', value: d => trunc(d.sorMasterExtractedRaw) },
  { key: 'sysHintsNorm', value: d => trunc(d.systemHintsNormalizedRaw) },
  { key: 'sysHintsExt', value: d => trunc(d.systemHintsExtractedRaw) },
  { key: 'isAnInvoice', value: d => d.isAnInvoice },
  { key: 'expectedDocType', value: d => d.expectedDocType || '-' },
  { key: 'docClassificationIssue', value: d => d.docClassificationIssue },
  { key: 'vendor21MatchingIssue', value: d => d.vendor21MatchingIssue || '-' },
  { key: 'expectedVendorName', value: d => d.expectedVendorName || '-' },
  { key: 'existsInMastSor', value: d => d.existsInMastSor || '-' },
  { key: 'reviewedAt', value: d => formatDate(d.reviewedAt) },
  { key: 'reviewSource', value: d => (d.isAutoReviewed ? 'Auto' : 'Manual') },
  { key: 'comments', value: d => d.comments || '-' },
  { key: 'recordTypeStatusComputed', value: d => recordTypeStatus(d.finalRecordType, d.originalRecordType) },
  { key: 'vendorMatchStatusComputed', value: d => reviewVendorStatus(d) },
];

/** Per-column filter popover — searchable checkbox list with Select all / Clear. Uses fixed
 * positioning so it isn't clipped by the table's horizontal scroll container. */
function ColumnFilter({ options, selected, onChange }: {
  options: ColumnOption[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const active = selected.length > 0;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Close on scroll — the fixed-position popover is anchored at open time and would otherwise
    // float away from its button when the table (or window) scrolls.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const openPop = () => {
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) });
    setQ('');
    setOpen(true);
  };
  const shown = q ? options.filter(o => o.value.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openPop())}
        title="Filter column"
        className={`p-0.5 rounded hover:bg-slate-200 ${active ? 'text-purple-600' : 'text-slate-300'}`}
      >
        <Filter className="w-3 h-3" fill={active ? 'currentColor' : 'none'} />
      </button>
      {open && pos && (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 280, zIndex: 60 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search values…"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 text-[11px]">
            <button onClick={() => onChange(Array.from(new Set([...selected, ...shown.map(o => o.value)])))} className="text-purple-600 hover:text-purple-800 font-medium">Select all</button>
            <span className="text-slate-400">{selected.length} selected</span>
            <button onClick={() => onChange([])} className="text-slate-500 hover:text-slate-700 font-medium">Clear</button>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No values</div>
            ) : shown.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="rounded border-slate-300 text-purple-600" />
                <span className="flex-1 truncate text-slate-700" title={o.value}>{o.value}</span>
                <span className="text-slate-400 tabular-nums">{o.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Wide, scrollable table of reviewed documents. Shared by the Reviewed tab (page)
 * and the in-analysis Reviewed panel (modal). Column groups are color-coded:
 * white = original data, amber = JSON/SOR/match, green = review, blue = computed status.
 */
export function ReviewedTable({ reviewedDocs, onRemove, columnFilters, columnOptions, onColumnFilterChange }: ReviewedTableProps) {
  const filtersEnabled = !!onColumnFilterChange;
  if (reviewedDocs.length === 0 && !filtersEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
        <p className="text-slate-500 text-lg mb-2">No reviewed documents</p>
        <p className="text-sm text-slate-400">Documents you review (or that match your filters) will appear here.</p>
      </div>
    );
  }

  return (
    <table className="min-w-full divide-y divide-slate-200">
      <thead className="bg-slate-50 sticky top-0 z-10">
        <tr>
          <th className={`${th} text-slate-600`}>Document ID</th>
          <th className={`${th} text-slate-600`}>Created At</th>
          <th className={`${th} text-slate-600`}>Updated At</th>
          <th className={`${th} text-slate-600`}>Message ID</th>
          <th className={`${th} text-slate-600`}>Tenant Name</th>
          <th className={`${th} text-slate-600`}>Tenant ID</th>
          <th className={`${th} text-slate-600`}>On UI</th>
          <th className={`${th} text-slate-600`}>Reason for Dismissal</th>
          <th className={`${th} text-slate-600`}>Written</th>
          <th className={`${th} text-slate-600`}>Manual</th>
          <th className={`${th} text-slate-600`}>Final Record Type</th>
          <th className={`${th} text-slate-600`}>Original Record Type</th>
          <th className={`${th} text-slate-600`}>Invoice #</th>
          <th className={`${th} text-slate-600`}>Vendor ID</th>
          <th className={`${th} text-slate-600`}>Vendor Name</th>
          <th className={`${th} text-slate-600`}>Original Vendor Name</th>
          <th className={`${th} text-slate-600`}>Extracted Vendor Name</th>
          <th className={`${th} text-slate-600`}>Normalized Vendor Name</th>
          <th className={`${th} text-slate-600`}>Vendor Name Reason</th>
          <th className={`${th} text-slate-600`}>Vendor Match Status</th>
          <th className={`${th} text-slate-600`}>Attachment File Name</th>
          <th className={`${th} text-slate-600`}>Extracted File S3 Location</th>
          <th className={`${th} text-slate-600`}>Original Attachment File Name</th>
          <th className={`${th} text-slate-600`}>S3 Location</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Doc Classification JSON</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Vendor Name JSON</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Normalized Match (Original)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Normalized Match (Final)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Extracted Match (Original)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Extracted Match (Final)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>Data Source</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>SOR Hints (Normalized)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>SOR Hints (Extracted)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>SOR Master (Normalized)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>SOR Master (Extracted)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>System Hints (Normalized)</th>
          <th className={`${th} text-amber-700 bg-amber-50`}>System Hints (Extracted)</th>
          <th className={`${th} text-green-700 bg-green-50`}>Is an Invoice</th>
          <th className={`${th} text-green-700 bg-green-50`}>Expected Doc Type</th>
          <th className={`${th} text-green-700 bg-green-50`}>Doc Classification Issue</th>
          <th className={`${th} text-green-700 bg-green-50`}>Vendor 2.1 Matching Issue</th>
          <th className={`${th} text-green-700 bg-green-50`}>Expected Vendor Name</th>
          <th className={`${th} text-green-700 bg-green-50`}>Exists in mast_sor</th>
          <th className={`${th} text-green-700 bg-green-50`}>Reviewed At</th>
          <th className={`${th} text-green-700 bg-green-50`}>Review Source</th>
          <th className={`${th} text-green-700 bg-green-50`}>Comments</th>
          <th className={`${th} text-blue-700 bg-blue-50`}>Record Type Status</th>
          <th className={`${th} text-blue-700 bg-blue-50`}>Vendor Match Status (Computed)</th>
          <th className={`${th} text-slate-600 sticky right-0 bg-slate-50`}>Actions</th>
        </tr>
        {filtersEnabled && (
          <tr className="bg-slate-50 border-b border-slate-200">
            {REVIEWED_COLUMNS.map(col => (
              <th key={col.key} className="px-3 py-1 text-left">
                <ColumnFilter
                  options={columnOptions?.[col.key] || []}
                  selected={columnFilters?.[col.key] || []}
                  onChange={v => onColumnFilterChange!(col.key, v)}
                />
              </th>
            ))}
            <th className="px-3 py-1 sticky right-0 bg-slate-50" />
          </tr>
        )}
      </thead>
      <tbody className="bg-white divide-y divide-slate-200">
        {reviewedDocs.length === 0 && filtersEnabled && (
          <tr>
            <td colSpan={REVIEWED_COLUMNS.length + 1} className="px-4 py-10 text-center text-sm text-slate-400">
              No reviewed documents match the current filters.
            </td>
          </tr>
        )}
        {reviewedDocs.map((doc) => (
          <tr key={doc.documentId} className="hover:bg-slate-50">
            <td className="px-3 py-3 text-xs font-mono text-slate-900 whitespace-nowrap" title={doc.documentId}>{doc.documentId}</td>
            <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{formatDate(doc.createdAt)}</td>
            <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap">{doc.updatedAt ? formatDate(doc.updatedAt) : '-'}</td>
            <td className="px-3 py-3 text-xs font-mono text-slate-900 whitespace-nowrap" title={doc.messageId}>{doc.messageId}</td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap" title={doc.tenantName}>{doc.tenantName}</td>
            <td className="px-3 py-3 text-xs font-mono text-slate-900 whitespace-nowrap" title={doc.tenantId}>{doc.tenantId}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                doc.onUI === 'Active' ? 'bg-green-100 text-green-700' :
                doc.onUI === 'Dismissed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
              }`}>{doc.onUI}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[150px] truncate" title={doc.reasonForDismissal || ''}>{doc.reasonForDismissal || '-'}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                doc.written === 'Written' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
              }`}>{doc.written}</span>
            </td>
            <td className="px-3 py-3 text-xs whitespace-nowrap">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                doc.manual === 'Manual' ? 'bg-purple-100 text-purple-700' :
                doc.manual === 'Bot' ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-700'
              }`}>{doc.manual}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap">{doc.finalRecordType}</td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap">{doc.originalRecordType}</td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap">{doc.invoiceNumber || '-'}</td>
            <td className="px-3 py-3 text-xs font-mono text-slate-900 whitespace-nowrap">{doc.vendorId || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate" title={doc.vendorName}>{doc.vendorName}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate" title={doc.originalVendorName || ''}>{doc.originalVendorName || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate" title={doc.extractedVendorName || ''}>{doc.extractedVendorName || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate" title={doc.normalizedVendorName || ''}>{doc.normalizedVendorName || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[150px] truncate" title={doc.vendorNameReason || ''}>{doc.vendorNameReason || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap">{doc.vendorMatchStatus || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate" title={doc.attachmentFileName || ''}>{doc.attachmentFileName || '-'}</td>
            <td className="px-3 py-3 text-xs font-mono text-slate-900 max-w-[250px] truncate" title={doc.extractedFileS3Location}>{doc.extractedFileS3Location}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate" title={doc.originalAttachmentFileName}>{doc.originalAttachmentFileName}</td>
            <td className="px-3 py-3 text-xs font-mono text-slate-900 max-w-[250px] truncate" title={doc.s3Location}>{doc.s3Location}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.docClassificationJsonRaw || ''}>{trunc(doc.docClassificationJsonRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.vendorNameJsonRaw || ''}>{trunc(doc.vendorNameJsonRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap bg-amber-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.normalizedMatchedWithOriginalVendorName === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{doc.normalizedMatchedWithOriginalVendorName || '-'}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap bg-amber-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.normalizedMatchedWithFinalVendorName === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{doc.normalizedMatchedWithFinalVendorName || '-'}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap bg-amber-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.extractedMatchedWithOriginalVendorName === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{doc.extractedMatchedWithOriginalVendorName || '-'}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap bg-amber-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.extractionMatchedWithFinalVendorName === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{doc.extractionMatchedWithFinalVendorName || '-'}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 whitespace-nowrap bg-amber-50">{doc.dataSource || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.sorHintsNormalizedRaw || ''}>{trunc(doc.sorHintsNormalizedRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.sorHintsExtractedRaw || ''}>{trunc(doc.sorHintsExtractedRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.sorMasterNormalizedRaw || ''}>{trunc(doc.sorMasterNormalizedRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.sorMasterExtractedRaw || ''}>{trunc(doc.sorMasterExtractedRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.systemHintsNormalizedRaw || ''}>{trunc(doc.systemHintsNormalizedRaw)}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-amber-50" title={doc.systemHintsExtractedRaw || ''}>{trunc(doc.systemHintsExtractedRaw)}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap bg-green-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.isAnInvoice === 'Invoice' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{doc.isAnInvoice}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[150px] truncate bg-green-50" title={doc.expectedDocType}>{doc.expectedDocType || '-'}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap bg-green-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.docClassificationIssue === 'Yes' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{doc.docClassificationIssue}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[150px] truncate bg-green-50" title={doc.vendor21MatchingIssue || ''}>{doc.vendor21MatchingIssue || '-'}</td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-green-50" title={doc.expectedVendorName}>{doc.expectedVendorName || '-'}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap bg-green-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                doc.existsInMastSor === 'Yes' ? 'bg-green-100 text-green-700' :
                doc.existsInMastSor === 'No' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
              }`}>{doc.existsInMastSor || '-'}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap bg-green-50">{formatDate(doc.reviewedAt)}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap bg-green-50">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${doc.isAutoReviewed ? 'bg-cyan-100 text-cyan-700' : 'bg-purple-100 text-purple-700'}`}>{doc.isAutoReviewed ? 'Auto' : 'Manual'}</span>
            </td>
            <td className="px-3 py-3 text-xs text-slate-900 max-w-[200px] truncate bg-green-50" title={doc.comments || ''}>{doc.comments || '-'}</td>
            <td className="px-3 py-3 text-xs whitespace-nowrap bg-blue-50">
              {(() => {
                const rs = recordTypeStatus(doc.finalRecordType, doc.originalRecordType);
                return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rs === 'Record Mismatch' ? 'bg-red-100 text-red-700' : rs === 'No Original' ? 'bg-slate-100 text-slate-600' : 'bg-green-100 text-green-700'}`}>{rs}</span>;
              })()}
            </td>
            <td className="px-3 py-3 text-xs whitespace-nowrap bg-blue-50">
              {(() => {
                const vs = reviewVendorStatus(doc);
                return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${vs === 'Vendor Mismatch' ? 'bg-red-100 text-red-700' : vs === 'Does not Exist' ? 'bg-amber-100 text-amber-700' : vs === '—' ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-700'}`}>{vs}</span>;
              })()}
            </td>
            <td className="px-3 py-3 sticky right-0 bg-white">
              <button onClick={() => onRemove(doc.documentId)} className="text-red-600 hover:text-red-800 transition-colors" title="Remove">
                <X className="w-4 h-4" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
