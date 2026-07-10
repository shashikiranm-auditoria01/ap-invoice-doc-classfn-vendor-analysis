import { useMemo } from 'react';
import { DocClassificationDocument, ReviewedDocClassification } from '../../types/docClassification';
import { computeReviewKpis } from '../../utils/reviewMetrics';

interface LiveReviewStripProps {
  data: DocClassificationDocument[];
  reviewed: ReviewedDocClassification[];
}

function Stat({ label, value, sub, tone = 'slate' }: {
  label: string; value: string | number; sub?: string;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo';
}) {
  const toneCls: Record<string, string> = {
    slate: 'text-slate-800', green: 'text-green-600', amber: 'text-amber-600',
    red: 'text-red-600', indigo: 'text-indigo-600',
  };
  return (
    <div className="flex flex-col leading-tight whitespace-nowrap">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${toneCls[tone]}`}>
        {value}{sub && <span className="text-[10px] font-normal text-slate-400 ml-1">{sub}</span>}
      </span>
    </div>
  );
}

const accTone = (v: number) => (v >= 80 ? 'green' : v >= 50 ? 'amber' : 'red') as 'green' | 'amber' | 'red';

/**
 * Compact, always-visible KPI strip for the Analysis tab. Recomputes from `reviewed`
 * on every render, so the numbers move the instant a document is marked/updated —
 * the reviewer watches metrics change without leaving the review workspace.
 * Uses the same computeReviewKpis() as the Metrics tab, so the two never disagree.
 */
export function LiveReviewStrip({ data, reviewed }: LiveReviewStripProps) {
  const k = useMemo(() => computeReviewKpis(data, reviewed), [data, reviewed]);

  return (
    <div className="flex-shrink-0 flex items-center gap-4 px-3 py-1.5 mb-2 bg-white border border-slate-200 rounded shadow-sm overflow-x-auto">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 whitespace-nowrap" title="Updates live as you review">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> LIVE
      </span>

      <Stat label="Reviewed" value={`${k.reviewedCount}/${k.total}`} sub={`${k.reviewProgress}%`} tone="indigo" />

      {/* progress bar */}
      <div className="w-24 shrink-0">
        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${k.reviewProgress}%` }} />
        </div>
      </div>

      <div className="h-7 w-px bg-slate-200 shrink-0" />

      {/* Accuracy/issues are over YOUR reviews — shown as "—" until you review, so auto-reviews don't pin them at 100% */}
      <Stat label="Doc Acc" value={k.hasUserReviews ? `${k.docAccuracy}%` : '—'} tone={k.hasUserReviews ? accTone(k.docAccuracy) : 'slate'} />
      <Stat label="Vendor Acc" value={k.hasVendorReviews ? `${k.vendorAccuracy}%` : '—'} tone={k.hasVendorReviews ? accTone(k.vendorAccuracy) : 'slate'} />

      <div className="h-7 w-px bg-slate-200 shrink-0" />

      <Stat label="Doc Issues" value={k.docIssues} tone={k.docIssues > 0 ? 'red' : 'slate'} />
      <Stat label="Vendor Issues" value={k.vendorIssues} tone={k.vendorIssues > 0 ? 'amber' : 'slate'} />

      <div className="h-7 w-px bg-slate-200 shrink-0" />

      <Stat label="By You / Auto" value={`${k.userReviewedCount} / ${k.autoReviewed}`} />
    </div>
  );
}
