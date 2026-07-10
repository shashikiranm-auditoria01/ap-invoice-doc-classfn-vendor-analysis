import { useMemo } from 'react';
import { FileText, Target, Users, BarChart3, AlertTriangle, Download } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { computeReviewKpis } from '../utils/reviewMetrics';
import { exportMetricsReport } from '../utils/docClassificationExport';

const norm = (s?: string | null) => (s || '').trim().toLowerCase();
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/* Gradient KPI card (mirrors the annotation tool's four headline tiles) */
function KpiCard({ label, value, sub, gradient }: { label: string; value: string; sub: string; gradient: string }) {
  return (
    <div className={`rounded-xl p-4 text-white shadow-sm ${gradient}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{label}</p>
      <p className="text-3xl font-bold mt-1 tabular-nums">{value}</p>
      <p className="text-[11px] mt-1 opacity-90">{sub}</p>
    </div>
  );
}

function AccPill({ v }: { v: number | null }) {
  if (v === null) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-400" title="No user reviews yet">—</span>;
  const tone = v >= 80 ? 'bg-green-100 text-green-700' : v >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${tone}`}>{v.toFixed(1)}%</span>;
}

function IssuePill({ count, total, kind }: { count: number; total: number; kind: 'doc' | 'vendor' }) {
  const has = count > 0;
  const tone = has
    ? (kind === 'doc' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200')
    : 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <div className={`inline-flex flex-col items-center px-3 py-1 rounded-md border ${tone}`}>
      <span className="text-sm font-bold tabular-nums">{count} {count === 1 ? 'Issue' : 'Issues'}</span>
      <span className="text-[10px] opacity-80">of {total} reviewed</span>
    </div>
  );
}

export function DocClassificationMetricsPage() {
  const { docClassificationData, reviewedDocClassifications, activeSelection } = useAppContext();
  const isMismatch = activeSelection?.kind === 'mismatch';

  const m = useMemo(() => {
    const data = docClassificationData;
    const total = data.length;
    const dataIds = new Set(data.map(d => d.documentId));
    const reviews = reviewedDocClassifications.filter(d => !!d.isAnInvoice && dataIds.has(d.documentId));
    const reviewedCount = reviews.length;

    // Overall KPIs via the shared helper (accuracy/issues over USER reviews only).
    const kpi = computeReviewKpis(data, reviewedDocClassifications);
    const { userReviewedCount, autoReviewed, hasUserReviews, docAccuracy, vendorAccuracy,
      vendorReviewedCount, hasVendorReviews } = kpi;

    // On UI distribution (all docs)
    let active = 0, dismissed = 0, uiUnknown = 0;
    // Write status (all docs) — track Unknown/blank separately so it isn't folded into "No".
    let written = 0, notWritten = 0, writtenUnknown = 0;
    for (const d of data) {
      if (d.onUI === 'Active') active++; else if (d.onUI === 'Dismissed') dismissed++; else uiUnknown++;
      if (d.written === 'Written') written++; else if (d.written === 'No') notWritten++; else writtenUnknown++;
    }

    // Per-tenant breakdown. `reviewed` = all dispositioned (coverage); accuracy/issues are
    // computed over USER (manual) reviews only (`userReviewed`), matching the overall KPIs.
    // vendorReviewed = invoice user-reviews only (the vendor-accuracy denominator).
    type T = { name: string; total: number; reviewed: number; userReviewed: number; vendorReviewed: number; docCorrect: number; vendorCorrect: number; docIssues: number; vendorIssues: number };
    const byId = new Map<string, T>();
    const key = (d: { tenantId?: string | null; tenantName?: string | null }) => (d.tenantId || d.tenantName || 'Unknown');
    for (const d of data) {
      const k = key(d);
      if (!byId.has(k)) byId.set(k, { name: d.tenantName || k, total: 0, reviewed: 0, userReviewed: 0, vendorReviewed: 0, docCorrect: 0, vendorCorrect: 0, docIssues: 0, vendorIssues: 0 });
      byId.get(k)!.total++;
    }
    for (const r of reviews) {
      const k = key(r);
      const t = byId.get(k); if (!t) continue;
      t.reviewed++;
      if (r.isAutoReviewed) continue; // accuracy/issues only from human reviews
      t.userReviewed++;
      if (r.docClassificationIssue !== 'Yes') t.docCorrect++; else t.docIssues++;
      // Vendor matching applies to invoices only ("Others" has no vendor).
      if (r.isAnInvoice === 'Invoice') {
        t.vendorReviewed++;
        if (r.vendor21MatchingIssue !== 'Vendor Matching Issue') t.vendorCorrect++; else t.vendorIssues++;
      }
    }
    const tenants = Array.from(byId.values()).sort((a, b) => b.total - a.total);

    // Weekly trend of documents (by created_at, Monday-start weeks)
    const weekMap = new Map<number, number>();
    for (const d of data) {
      const dt = d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt);
      if (isNaN(dt.getTime())) continue;
      const day = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      const dow = (day.getDay() + 6) % 7; // Mon=0
      day.setDate(day.getDate() - dow);
      const kkey = day.getTime();
      weekMap.set(kkey, (weekMap.get(kkey) || 0) + 1);
    }
    const weekly = Array.from(weekMap.entries()).sort((a, b) => a[0] - b[0])
      .map(([ts, count]) => ({ label: new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count }));
    const weeklyMax = Math.max(1, ...weekly.map(w => w.count));

    // Other documents AAI classified as Invoice but reviewer marked Others
    const otherAsInvoice = reviews.filter(r => norm(r.originalRecordType) === 'invoice' && r.isAnInvoice === 'Others')
      .map(r => ({ documentId: r.documentId, tenantName: r.tenantName, vendorName: r.vendorName, expectedDocType: r.expectedDocType }));

    return {
      total, reviewedCount, userReviewedCount, autoReviewed, hasUserReviews,
      vendorReviewedCount, hasVendorReviews,
      reviewProgress: pct(reviewedCount, total),
      docAccuracy, vendorAccuracy,
      active, dismissed, uiUnknown, written, notWritten, writtenUnknown,
      tenants, weekly, weeklyMax, otherAsInvoice,
    };
  }, [docClassificationData, reviewedDocClassifications]);

  const empty = m.total === 0;
  const uiTotal = m.active + m.dismissed + m.uiUnknown;
  const activePct = pct(m.active, uiTotal);
  const dismissedPct = pct(m.dismissed, uiTotal);
  // donut: purple = Active, green = Dismissed, slate = Unknown
  const donut = `conic-gradient(#7c3aed 0 ${activePct}%, #10b981 ${activePct}% ${activePct + dismissedPct}%, #cbd5e1 ${activePct + dismissedPct}% 100%)`;

  return (
    <div className="h-[calc(100vh-118px)] overflow-auto bg-slate-50">
      {/* Gradient header bar */}
      <div className="bg-gradient-to-r from-purple-700 to-purple-500 text-white px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            <span className="font-semibold">AP Invoice Overall Metrics</span>
          </div>
          <button
            onClick={() => exportMetricsReport({
              total: m.total, reviewedCount: m.reviewedCount, reviewProgress: m.reviewProgress,
              docAccuracy: m.hasUserReviews ? `${m.docAccuracy}%` : '—',
              vendorAccuracy: m.hasVendorReviews ? `${m.vendorAccuracy}%` : '—',
              active: m.active, dismissed: m.dismissed, uiUnknown: m.uiUnknown,
              written: m.written, notWritten: m.notWritten, writtenUnknown: m.writtenUnknown,
              tenants: m.tenants.map(t => ({
                name: t.name, total: t.total, reviewed: t.reviewed,
                docAccuracy: t.userReviewed > 0 ? `${pct(t.docCorrect, t.userReviewed)}%` : '—',
                vendorAccuracy: t.vendorReviewed > 0 ? `${pct(t.vendorCorrect, t.vendorReviewed)}%` : '—',
                docIssues: t.docIssues, vendorIssues: t.vendorIssues,
              })),
              weekly: m.weekly,
            })}
            disabled={empty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white/15 hover:bg-white/25 border border-white/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            Export Report
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <h2 className="text-center text-lg font-bold text-slate-800">AP Vendor 2.1 Reviewed Metrics</h2>

        {empty ? (
          <div className="bg-white rounded-lg border border-slate-200 p-10 text-center text-slate-500">
            No data loaded yet. Upload an Excel file on the Analysis tab to see metrics.
          </div>
        ) : (
          <>
            {/* 4 headline KPI cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total Documents" value={m.total.toLocaleString()} sub={isMismatch ? 'In this mismatch set' : 'In this dataset'} gradient="bg-gradient-to-br from-indigo-500 to-purple-500" />
              <KpiCard label="Reviewed Documents" value={m.reviewedCount.toLocaleString()} sub={`${m.reviewProgress}% dispositioned · ${m.userReviewedCount} by you · ${m.autoReviewed} auto`} gradient="bg-gradient-to-br from-emerald-600 to-green-500" />
              <KpiCard label="Doc Classfn Accuracy" value={m.hasUserReviews ? `${m.docAccuracy.toFixed(1)}%` : '—'} sub={m.hasUserReviews ? `of ${m.userReviewedCount} you reviewed` : 'review documents to populate'} gradient="bg-gradient-to-br from-blue-600 to-blue-400" />
              <KpiCard label="Vendor Matching Accuracy" value={m.hasVendorReviews ? `${m.vendorAccuracy.toFixed(1)}%` : '—'} sub={m.hasVendorReviews ? `of ${m.vendorReviewedCount} invoices you reviewed` : 'review invoices to populate'} gradient="bg-gradient-to-br from-amber-500 to-orange-500" />
            </div>

            {/* On UI donut + Write Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4 border-l-2 border-purple-500 pl-2">On UI Distribution</h3>
                <div className="flex items-center justify-center gap-8">
                  <div className="relative w-40 h-40 rounded-full" style={{ background: donut }}>
                    <div className="absolute inset-[22%] bg-white rounded-full flex items-center justify-center">
                      <span className="text-xs text-slate-500">{uiTotal.toLocaleString()} docs</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#7c3aed' }} />Active <span className="text-slate-500 tabular-nums">{m.active} ({activePct}%)</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#10b981' }} />Dismissed <span className="text-slate-500 tabular-nums">{m.dismissed} ({dismissedPct}%)</span></div>
                    {m.uiUnknown > 0 && <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: '#cbd5e1' }} />Unknown <span className="text-slate-500 tabular-nums">{m.uiUnknown}</span></div>}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4 border-l-2 border-green-500 pl-2">Write Status</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                      <th className="py-2">Field</th><th className="py-2 text-right">Count</th><th className="py-2 text-right">Percentage</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100"><td className="py-2">No</td><td className="py-2 text-right tabular-nums">{m.notWritten.toLocaleString()}</td><td className="py-2 text-right"><span className="text-emerald-600 font-medium">{pct(m.notWritten, m.total)}%</span></td></tr>
                    <tr className={m.writtenUnknown > 0 ? 'border-b border-slate-100' : ''}><td className="py-2">Written</td><td className="py-2 text-right tabular-nums">{m.written.toLocaleString()}</td><td className="py-2 text-right"><span className="text-emerald-600 font-medium">{pct(m.written, m.total)}%</span></td></tr>
                    {m.writtenUnknown > 0 && <tr><td className="py-2">Unknown</td><td className="py-2 text-right tabular-nums">{m.writtenUnknown.toLocaleString()}</td><td className="py-2 text-right"><span className="text-slate-500 font-medium">{pct(m.writtenUnknown, m.total)}%</span></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tenant-wise breakdown */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <h3 className="text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-500 px-4 py-2 flex items-center gap-2">
                <Users className="w-4 h-4" /> Tenant-wise Doc Classification and Vendor Assignment Breakdown
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                      <th className="px-4 py-2">Tenant Name</th>
                      <th className="px-4 py-2 text-right">Total Docs</th>
                      <th className="px-4 py-2 text-right">Reviewed</th>
                      <th className="px-4 py-2 text-center">Doc Classfn Accuracy</th>
                      <th className="px-4 py-2 text-center">Vendor Matching Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.tenants.map(t => (
                      <tr key={t.name} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 text-slate-800">{t.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{t.total.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{t.reviewed.toLocaleString()}</td>
                        <td className="px-4 py-2 text-center"><AccPill v={t.userReviewed > 0 ? pct(t.docCorrect, t.userReviewed) : null} /></td>
                        <td className="px-4 py-2 text-center"><AccPill v={t.vendorReviewed > 0 ? pct(t.vendorCorrect, t.vendorReviewed) : null} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary statistics: issues per tenant */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <h3 className="text-sm font-semibold text-slate-700 px-4 py-2 border-l-2 border-red-500 bg-slate-50 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" /> Summary Statistics: Vendor Name Assignment &amp; Doc Classification
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                      <th className="px-4 py-2">Tenant Name</th>
                      <th className="px-4 py-2 text-center">Doc Classification Issues</th>
                      <th className="px-4 py-2 text-center">Vendor Name Assignment Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.tenants.map(t => (
                      <tr key={t.name} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 text-slate-800">{t.name}</td>
                        <td className="px-4 py-3 text-center"><IssuePill count={t.docIssues} total={t.userReviewed} kind="doc" /></td>
                        <td className="px-4 py-3 text-center"><IssuePill count={t.vendorIssues} total={t.vendorReviewed} kind="vendor" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Weekly trend */}
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-500" /> Doc Classification Weekly Trend
              </h3>
              {m.weekly.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No dated documents.</p>
              ) : (
                <div className="flex items-end gap-3 h-40 overflow-x-auto pb-1">
                  {m.weekly.map(w => (
                    <div key={w.label} className="flex flex-col items-center justify-end gap-1 min-w-[44px] flex-1">
                      <span className="text-[11px] font-medium text-slate-600 tabular-nums">{w.count}</span>
                      <div className="w-full rounded-t bg-gradient-to-t from-blue-500 to-blue-400" style={{ height: `${(w.count / m.weeklyMax) * 100}%` }} />
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{w.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Other documents classified as Invoice by AAI */}
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-500" /> Other Documents Classified as Invoice by AAI
              </h3>
              {m.otherAsInvoice.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No data available — no reviewed document where AAI said "Invoice" but the reviewer marked it "Others".</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                        <th className="px-3 py-2">Document ID</th><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Reviewer's Expected Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.otherAsInvoice.map(d => (
                        <tr key={d.documentId} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{d.documentId}</td>
                          <td className="px-3 py-2">{d.tenantName}</td>
                          <td className="px-3 py-2">{d.vendorName}</td>
                          <td className="px-3 py-2">{d.expectedDocType || 'Others'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 flex items-center gap-1 justify-center">
              <Target className="w-3 h-3" /> Accuracy &amp; issue metrics are computed from reviewed documents and update live as you review; distributions &amp; trend cover {isMismatch ? 'the loaded mismatch set' : 'the loaded dataset'}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
