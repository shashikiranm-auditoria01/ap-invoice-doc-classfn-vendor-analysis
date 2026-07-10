import { FileStack, GitCompare, Calendar, Building2, RotateCcw } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';

const SCENARIO_LABEL: Record<string, string> = {
  all: 'All mismatches',
  any: 'All mismatches',
  recordType: 'Record Type mismatches',
  vendorName: 'Vendor Name mismatches',
  entityName: 'Entity Name mismatches',
};

/** Format a YYYY-MM-DD range as "Jun 1 – Jun 26, 2026" (or single date). */
function fmtRange(from: string, to: string): string {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  try {
    const a = p(from), b = p(to);
    if (from === to) return a.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
    const sameYear = a.getFullYear() === b.getFullYear();
    // Show the start year too when the range spans years, so it's never ambiguous.
    const aStr = a.toLocaleDateString('en-US', sameYear ? opts : { ...opts, year: 'numeric' });
    return `${aStr} – ${b.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
  } catch { return `${from} – ${to}`; }
}

/**
 * Persistent context strip under the tabs: tells anyone looking at the dashboard exactly which
 * pull they're viewing — Daily Data Review vs Mismatch Review (and which scenario) — plus the
 * tenant, date range and document count, with a one-click path back to the gate.
 */
export function ContextBar() {
  const { activeSelection, docClassificationData, setDataGatePassed } = useAppContext();
  if (!activeSelection) return null;

  const { kind, scenario, tenantName, from, to } = activeSelection;
  const isMismatch = kind === 'mismatch';
  const count = docClassificationData.length;

  // Amber for mismatch review (you're reviewing customer edits), purple for the regular daily review.
  const tone = isMismatch
    ? 'bg-amber-50 border-amber-200'
    : 'bg-purple-50/60 border-purple-100';
  const pill = isMismatch
    ? 'bg-amber-500 text-white'
    : 'bg-gradient-to-r from-[#6B21A8] to-[#8B5CF6] text-white';

  return (
    <div className={`border-b ${tone}`}>
      <div className="w-full px-4 sm:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${pill}`}>
            {isMismatch ? <GitCompare className="w-3.5 h-3.5" /> : <FileStack className="w-3.5 h-3.5" />}
            {isMismatch ? 'Mismatch Review' : 'Regular DA Analysis'}
          </span>

          {isMismatch && scenario && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-white border border-amber-300 text-amber-800">
              {SCENARIO_LABEL[scenario] || scenario}
            </span>
          )}

          <span className="inline-flex items-center gap-1 text-slate-600">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium text-slate-800">{tenantName}</span>
          </span>

          {from && to && (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              {fmtRange(from, to)}
            </span>
          )}

          <span className="text-slate-400">·</span>
          <span className="text-slate-600 tabular-nums">
            <span className="font-semibold text-slate-800">{count.toLocaleString()}</span> document{count === 1 ? '' : 's'}
          </span>
        </div>

        <button
          onClick={() => setDataGatePassed(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 border border-slate-300 bg-white hover:bg-slate-50 hover:text-slate-800 transition-colors shrink-0"
          title="Go back to the Get Data screen to load a different tenant, date range, or review type"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Change data
        </button>
      </div>
    </div>
  );
}
