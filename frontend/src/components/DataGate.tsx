import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Database, Calendar, Loader2, ArrowRight, Upload, AlertTriangle, FileStack, GitCompare } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { loadManifest, DataManifest, DatasetKind, ReviewScenario, isDataApiConfigured } from '../services/dataSource';
import { ExcelUploader } from './docClassification/ExcelUploader';
import { DocClassificationDocument, ReviewedDocClassification } from '../types/docClassification';

/**
 * Pre-load "Get Data" gate. The user picks a tenant + created_at range (app_def_code is fixed to the
 * AP-Invoice code from the manifest, shown read-only). "Get Data" fetches via the data-source seam
 * and only then does the dashboard render.
 */
export function DataGate() {
  const { loadDataset, setDocClassificationData } = useAppContext();

  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [kind, setKind] = useState<DatasetKind>('regular');
  const [scenario, setScenario] = useState<ReviewScenario>('all');
  const [tenantName, setTenantName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);

  useEffect(() => {
    loadManifest().then(setManifest).catch(e => setManifestError(e instanceof Error ? e.message : 'Failed to load datasets'));
  }, []);

  // Tenants available for the selected mode (regular vs mismatch).
  const tenantNames = useMemo(() => {
    if (!manifest) return [];
    return Array.from(new Set(manifest.datasets.filter(d => d.kind === kind).map(d => d.tenantName))).sort();
  }, [manifest, kind]);

  const selectedEntry = useMemo(
    () => manifest?.datasets.find(d => d.kind === kind && d.tenantName === tenantName) || null,
    [manifest, kind, tenantName],
  );
  const appDefCode = manifest?.appDefCode ?? 'VIDE';

  // Switching mode resets the tenant/date/scenario selection (the tenant lists differ per mode).
  const onPickKind = (k: DatasetKind) => {
    setKind(k);
    setScenario('all');
    setTenantName('');
    setFrom(''); setTo('');
    setError(null);
  };

  // When a tenant is picked, default the created_at range to that dataset's coverage.
  const onPickTenant = (name: string) => {
    setTenantName(name);
    setError(null);
    const entry = manifest?.datasets.find(d => d.kind === kind && d.tenantName === name);
    if (entry) { setFrom(entry.createdFrom); setTo(entry.createdTo); }
  };

  const canGetData = !!tenantName && !!from && !!to && from <= to && !loading;

  const handleGetData = async () => {
    if (!selectedEntry) return;
    setLoading(true);
    setError(null);
    try {
      const { count } = await loadDataset({
        kind,
        scenario: kind === 'mismatch' ? scenario : undefined,
        tenantId: selectedEntry.tenantId,
        tenantName: selectedEntry.tenantName,
        appDefCode,
        from,
        to,
      });
      if (count === 0) {
        setError(kind === 'mismatch' && scenario !== 'all'
          ? `No ${scenarioLabel(scenario).toLowerCase()} mismatches for this tenant in the selected range. Try "All mismatches" or a wider range.`
          : 'No documents found for this tenant in the selected date range. Widen the range and try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  };

  // Manual upload path — bypass the gate with the user's own workbook.
  const handleUpload = (documents: DocClassificationDocument[], _reviewed?: ReviewedDocClassification[]) => {
    setShowUploader(false);
    if (documents.length > 0) setDocClassificationData(documents);
  };

  const scenarioLabel = (s: ReviewScenario) =>
    s === 'all' ? 'All mismatches' : s === 'recordType' ? 'Record Type mismatches'
      : s === 'vendorName' ? 'Vendor Name mismatches' : 'Entity Name mismatches';
  const scenarioCount = (s: ReviewScenario) => selectedEntry?.scenarioCounts?.[s];

  const inputCls = 'w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-purple-50/40 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 bg-gradient-to-br from-purple-600 to-purple-500 rounded-xl shadow-lg shadow-purple-500/30">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">AP Invoice Doc Classfn &amp; VendorName Analysis</h1>
            <p className="text-xs text-slate-500">Choose a tenant and date range to load the dashboard</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-[#6B21A8] to-[#8B5CF6] text-white px-6 py-4 flex items-center gap-2">
            <Database className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Get Data</h2>
          </div>

          <div className="p-6 space-y-4">
            {manifestError && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{manifestError}</span>
              </div>
            )}

            {/* No datasets bundled (e.g. a fresh clone): guide the user to the pipeline or upload. */}
            {manifest && manifest.datasets.length === 0 && (
              <div className="flex items-start gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                <span>No datasets are bundled with this build. Run the data pipeline to generate one (see <code className="font-mono">data-pipeline/README.md</code>) and drop it into <code className="font-mono">public/data/</code>, or upload an Excel file below.</span>
              </div>
            )}

            {/* Mode toggle: full document set vs customer-edit mismatch review */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1.5">What to load</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { k: 'regular' as DatasetKind, icon: <FileStack className="w-4 h-4" />, title: 'Regular DA Analysis', sub: 'Regular review for a tenant + date range' },
                  { k: 'mismatch' as DatasetKind, icon: <GitCompare className="w-4 h-4" />, title: 'Mismatch review', sub: 'AAI vs customer edits' },
                ]).map(opt => (
                  <button
                    key={opt.k}
                    onClick={() => onPickKind(opt.k)}
                    className={`flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      kind === opt.k
                        ? 'border-[#6B21A8] bg-purple-50 ring-1 ring-[#6B21A8]'
                        : 'border-slate-200 hover:border-purple-300 hover:bg-purple-50/40'
                    }`}
                  >
                    <span className={`flex items-center gap-1.5 text-sm font-semibold ${kind === opt.k ? 'text-[#6B21A8]' : 'text-slate-700'}`}>
                      {opt.icon}{opt.title}
                    </span>
                    <span className="text-[11px] text-slate-500">{opt.sub}</span>
                  </button>
                ))}
              </div>
              {kind === 'mismatch' && (
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Reviews the three edit scenarios — record type, entity name, and vendor name — where the customer changed AAI's value.
                </p>
              )}
            </div>

            {/* Tenant */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1.5">Tenant Name</label>
              <select
                className={inputCls}
                value={tenantName}
                onChange={e => onPickTenant(e.target.value)}
                disabled={!manifest || tenantNames.length === 0}
              >
                <option value="">{manifest ? 'Select a tenant…' : 'Loading tenants…'}</option>
                {tenantNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              {selectedEntry && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Tenant ID <span className="font-mono">{selectedEntry.tenantId}</span>
                  {selectedEntry.rowCount ? ` · ~${selectedEntry.rowCount.toLocaleString()} docs available` : ''}
                </p>
              )}
            </div>

            {/* Review scenario — which mismatch to review (mismatch mode only) */}
            {kind === 'mismatch' && (
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">Which mismatches to review</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['all', 'entityName', 'vendorName', 'recordType'] as ReviewScenario[]).map(s => {
                    const n = scenarioCount(s);
                    const disabled = !!selectedEntry && typeof n === 'number' && n === 0 && s !== 'all';
                    return (
                      <button
                        key={s}
                        onClick={() => !disabled && setScenario(s)}
                        disabled={disabled}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                          scenario === s
                            ? 'border-[#6B21A8] bg-purple-50 text-[#6B21A8] font-semibold ring-1 ring-[#6B21A8]'
                            : disabled
                              ? 'border-slate-100 text-slate-300 cursor-not-allowed'
                              : 'border-slate-200 text-slate-700 hover:border-purple-300 hover:bg-purple-50/40'
                        }`}
                      >
                        <span>{scenarioLabel(s)}</span>
                        {typeof n === 'number' && <span className="text-[11px] tabular-nums opacity-70 shrink-0">{n}</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  "All mismatches" includes entity name, vendor name and record type together.
                  {selectedEntry && (scenarioCount('entityName') ?? 0) === 0 &&
                    ' Entity-name mismatches need the live pull (the bundled report has record-type & vendor-name only).'}
                </p>
              </div>
            )}

            {/* app_def_code — auto, read-only */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1.5">
                App Def Code <span className="font-normal text-slate-400">(auto)</span>
              </label>
              <input className={`${inputCls} font-mono`} value={appDefCode} readOnly disabled />
            </div>

            {/* created_at range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Created From
                </label>
                <input type="date" className={inputCls} value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setError(null); }} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Created To
                </label>
                <input type="date" className={inputCls} value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setError(null); }} />
              </div>
            </div>
            {selectedEntry && (
              <p className="text-[11px] text-slate-400 -mt-2">
                Available coverage: {selectedEntry.createdFrom} → {selectedEntry.createdTo}
              </p>
            )}
            {from && to && from > to && (
              <p className="text-[11px] text-red-500 -mt-2">"From" must be on or before "To".</p>
            )}

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleGetData}
              disabled={!canGetData}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white
                         bg-gradient-to-r from-[#6B21A8] to-[#8B5CF6] shadow-md shadow-purple-500/30
                         hover:from-[#581C87] hover:to-[#7C3AED] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {loading ? 'Loading data…' : 'Get Data'}
            </button>

            {!isDataApiConfigured && (
              <p className="text-[11px] text-slate-400 text-center">
                Loading from bundled datasets. A live Metabase backend can be enabled later via <span className="font-mono">VITE_DATA_API_URL</span>.
              </p>
            )}

            {/* Fallback: upload your own file */}
            <div className="pt-2 border-t border-slate-100 text-center">
              <button
                onClick={() => setShowUploader(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-800"
              >
                <Upload className="w-3.5 h-3.5" /> Or upload an Excel file instead
              </button>
            </div>
          </div>
        </div>
      </div>

      {showUploader && (
        <ExcelUploader onUpload={handleUpload} onClose={() => setShowUploader(false)} />
      )}
    </div>
  );
}
