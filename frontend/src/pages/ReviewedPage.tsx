import { useMemo, useState } from 'react';
import { Search, Download, FileSpreadsheet, Trash2, X, ClipboardCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ReviewedTable, REVIEWED_COLUMNS, ColumnOption } from '../components/docClassification/ReviewedTable';
import { useAppContext } from '../context/AppContext';
import { exportReviewedDocClassifications, exportAllDocClassifications } from '../utils/docClassificationExport';
import { recordTypeStatus, reviewVendorStatus } from '../utils/reviewStatus';

type FilterKey =
  | 'tenant' | 'isAnInvoice' | 'docIssue' | 'vendorIssue'
  | 'existsInMastSor' | 'reviewSource' | 'recordStatus' | 'vendorStatus';

const ALL = '__all__';

export function ReviewedPage() {
  const {
    docClassificationData,
    reviewedDocClassifications,
    removeReviewedDocClassification,
    removeReviewedDocClassifications,
  } = useAppContext();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    tenant: ALL, isAnInvoice: ALL, docIssue: ALL, vendorIssue: ALL,
    existsInMastSor: ALL, reviewSource: ALL, recordStatus: ALL, vendorStatus: ALL,
  });

  // Per-column filters (keyed by REVIEWED_COLUMNS key → selected values). Empty = no filter.
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const setColumnFilter = (key: string, values: string[]) =>
    setColumnFilters(prev => {
      const next = { ...prev };
      if (values.length === 0) delete next[key]; else next[key] = values;
      return next;
    });
  const columnFilterCount = Object.keys(columnFilters).length;

  const setFilter = (k: FilterKey, v: string) => setFilters(prev => ({ ...prev, [k]: v }));
  const resetFilters = () => {
    setFilters({
      tenant: ALL, isAnInvoice: ALL, docIssue: ALL, vendorIssue: ALL,
      existsInMastSor: ALL, reviewSource: ALL, recordStatus: ALL, vendorStatus: ALL,
    });
    setColumnFilters({});
    setSearch('');
  };

  // Complete reviews (isAnInvoice set) that belong to the CURRENTLY LOADED dataset. Reviews persist
  // in localStorage across datasets/sessions, so scoping to the loaded dataset's document IDs keeps
  // this tab's count consistent with the Analysis "User Reviewed" badge and the Metrics tab, and
  // prevents stale reviews from other tenants leaking in as a bogus "1k+ reviewed".
  const completeReviews = useMemo(() => {
    const ids = new Set(docClassificationData.map(d => d.documentId));
    return reviewedDocClassifications.filter(d => !!d.isAnInvoice && ids.has(d.documentId));
  }, [reviewedDocClassifications, docClassificationData]);

  const tenantOptions = useMemo(() => {
    const s = new Set<string>();
    completeReviews.forEach(d => { if (d.tenantName) s.add(d.tenantName); });
    return Array.from(s).sort();
  }, [completeReviews]);

  // Rows after the top-bar dropdowns + search (but NOT the per-column filters). Column-filter option
  // lists are computed from this set so options stay stable as you check/uncheck.
  const baseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return completeReviews.filter(d => {
      if (filters.tenant !== ALL && d.tenantName !== filters.tenant) return false;
      if (filters.isAnInvoice !== ALL && d.isAnInvoice !== filters.isAnInvoice) return false;
      if (filters.docIssue !== ALL && (d.docClassificationIssue || 'No') !== filters.docIssue) return false;
      if (filters.vendorIssue !== ALL) {
        const vi = d.vendor21MatchingIssue || 'None';
        if (vi !== filters.vendorIssue) return false;
      }
      if (filters.existsInMastSor !== ALL && (d.existsInMastSor || 'Not Set') !== filters.existsInMastSor) return false;
      if (filters.reviewSource !== ALL) {
        const src = d.isAutoReviewed ? 'Auto' : 'Manual';
        if (src !== filters.reviewSource) return false;
      }
      if (filters.recordStatus !== ALL) {
        // Use the shared helper so the filter matches the "Record Type Status" column exactly.
        const rec = recordTypeStatus(d.finalRecordType, d.originalRecordType);
        if (rec !== filters.recordStatus) return false;
      }
      if (filters.vendorStatus !== ALL) {
        // Shared helper — matches the computed "Vendor Match Status" column (incl. "Does not Exist" / "—").
        const vs = reviewVendorStatus(d);
        if (vs !== filters.vendorStatus) return false;
      }
      if (q) {
        const hay = [
          d.documentId, d.vendorName, d.originalVendorName, d.invoiceNumber,
          d.messageId, d.tenantName, d.expectedVendorName, d.comments,
        ].map(x => (x || '').toString().toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [completeReviews, filters, search]);

  // Distinct value options (with counts) per column, from baseFiltered — feeds each header filter.
  const columnOptions = useMemo(() => {
    const out: Record<string, ColumnOption[]> = {};
    for (const col of REVIEWED_COLUMNS) {
      const counts = new Map<string, number>();
      for (const d of baseFiltered) {
        const v = col.value(d);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      out[col.key] = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value));
    }
    return out;
  }, [baseFiltered]);

  const valueByKey = useMemo(() => {
    const m = new Map(REVIEWED_COLUMNS.map(c => [c.key, c.value]));
    return m;
  }, []);

  // Final rows: baseFiltered narrowed by the active per-column filters (AND across columns).
  const filtered = useMemo(() => {
    const active = Object.entries(columnFilters).filter(([, v]) => v.length > 0);
    if (active.length === 0) return baseFiltered;
    return baseFiltered.filter(d =>
      active.every(([key, vals]) => {
        const acc = valueByKey.get(key);
        return acc ? vals.includes(acc(d)) : true;
      })
    );
  }, [baseFiltered, columnFilters, valueByKey]);

  const activeFilterCount =
    (Object.values(filters).filter(v => v !== ALL).length) + (search.trim() ? 1 : 0) + columnFilterCount;

  const handleClearAll = () => {
    // Scope the clear to the loaded dataset's reviews (what this tab shows), so it can't silently
    // wipe reviews belonging to other datasets.
    if (completeReviews.length === 0) return;
    if (confirm(`Remove all ${completeReviews.length} reviewed documents for this dataset? This cannot be undone.`)) {
      removeReviewedDocClassifications(completeReviews.map(d => d.documentId));
    }
  };

  const selectCls =
    'text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="w-full px-2 sm:px-3 py-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-purple-600" />
          <h2 className="text-lg font-semibold text-slate-900">Reviewed Documents</h2>
          <span className="text-sm text-slate-500">
            {filtered.length.toLocaleString()}
            {filtered.length !== completeReviews.length && ` of ${completeReviews.length.toLocaleString()}`} shown
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={() => exportReviewedDocClassifications(filtered)}
            variant="primary"
            size="sm"
            leftIcon={<Download className="w-4 h-4" />}
            disabled={filtered.length === 0}
          >
            Export Reviewed{activeFilterCount > 0 ? ' (filtered)' : ''}
          </Button>
          <Button
            onClick={() => exportAllDocClassifications(docClassificationData, reviewedDocClassifications)}
            variant="outline"
            size="sm"
            leftIcon={<FileSpreadsheet className="w-4 h-4" />}
            disabled={docClassificationData.length === 0}
          >
            Export Full Data (with reviewed)
          </Button>
          <Button
            onClick={handleClearAll}
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 className="w-4 h-4" />}
            disabled={completeReviews.length === 0}
          >
            Clear All
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search vendor, doc ID, invoice…"
              className="text-xs border border-slate-300 rounded-md pl-7 pr-2 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          <select className={selectCls} value={filters.tenant} onChange={e => setFilter('tenant', e.target.value)}>
            <option value={ALL}>All tenants</option>
            {tenantOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select className={selectCls} value={filters.isAnInvoice} onChange={e => setFilter('isAnInvoice', e.target.value)}>
            <option value={ALL}>Invoice / Others</option>
            <option value="Invoice">Invoice</option>
            <option value="Others">Others</option>
          </select>

          <select className={selectCls} value={filters.docIssue} onChange={e => setFilter('docIssue', e.target.value)}>
            <option value={ALL}>Classification issue</option>
            <option value="Yes">Issue: Yes</option>
            <option value="No">Issue: No</option>
          </select>

          <select className={selectCls} value={filters.vendorIssue} onChange={e => setFilter('vendorIssue', e.target.value)}>
            <option value={ALL}>Vendor 2.1 issue</option>
            <option value="Does not Exist">Does not Exist</option>
            <option value="Vendor Matching Issue">Vendor Matching Issue</option>
            <option value="None">No issue</option>
          </select>

          <select className={selectCls} value={filters.existsInMastSor} onChange={e => setFilter('existsInMastSor', e.target.value)}>
            <option value={ALL}>Exists in mast_sor</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="Not Set">Not set</option>
          </select>

          <select className={selectCls} value={filters.recordStatus} onChange={e => setFilter('recordStatus', e.target.value)}>
            <option value={ALL}>Record type status</option>
            <option value="Record Match">Record Match</option>
            <option value="Record Mismatch">Record Mismatch</option>
            <option value="No Original">No Original</option>
          </select>

          <select className={selectCls} value={filters.vendorStatus} onChange={e => setFilter('vendorStatus', e.target.value)}>
            <option value={ALL}>Vendor match status</option>
            <option value="Vendor Match">Vendor Match</option>
            <option value="Vendor Mismatch">Vendor Mismatch</option>
            <option value="Does not Exist">Does not Exist</option>
            <option value="—">— (Others / N/A)</option>
          </select>

          <select className={selectCls} value={filters.reviewSource} onChange={e => setFilter('reviewSource', e.target.value)}>
            <option value={ALL}>Auto / Manual</option>
            <option value="Manual">Manual</option>
            <option value="Auto">Auto</option>
          </select>

          {activeFilterCount > 0 && (
            <button
              onClick={resetFilters}
              className="text-xs text-purple-600 hover:text-purple-800 flex items-center gap-1 px-2 py-1.5"
            >
              <X className="w-3.5 h-3.5" />
              Clear filters ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-260px)]">
        <ReviewedTable
          reviewedDocs={filtered}
          onRemove={removeReviewedDocClassification}
          columnFilters={columnFilters}
          columnOptions={columnOptions}
          onColumnFilterChange={setColumnFilter}
        />
      </div>
    </div>
  );
}
