import { useEffect, useMemo, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { X, Mail, FileText, Send, Loader2, Paperclip, Trash2, Upload, CheckCircle2 } from 'lucide-react';
import { PdfFile } from '../analysis/ZipHandler';
import {
  sendSingleEmail, sendSimpleEmail, checkEmailBackend, bytesToBase64, EMAIL_BACKEND_URL,
} from '../../services/emailService';

interface EmailSenderModalProps {
  pdfs: PdfFile[];                 // all loaded PDFs (for AP Invoice tab)
  preselectPdfName?: string | null; // optionally pre-select the current doc's PDF
  onClose: () => void;
}

type Tab = 'ap' | 'helpdesk';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fileToBase64 = (data: Uint8Array) => bytesToBase64(data);

interface HdRow { subject: string; body: string; recipient: string; attachKey: string; status: 'pending' | 'sending' | 'sent' | 'failed'; error?: string; }

export function EmailSenderModal({ pdfs, preselectPdfName, onClose }: EmailSenderModalProps) {
  const [tab, setTab] = useState<Tab>('ap');
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  useEffect(() => { checkEmailBackend().then(setBackendUp); }, []);

  /* ── AP Invoice tab ── */
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectPdfName && pdfs.some(p => p.name === preselectPdfName) ? [preselectPdfName] : []));
  const [recipient, setRecipient] = useState('halifax.vendormatching@aaienv1.com');
  const [sender, setSender] = useState(() => sessionStorage.getItem('email_sender') || '');
  const [password, setPassword] = useState(() => sessionStorage.getItem('email_app_password') || '');
  const [subject, setSubject] = useState('Automated Invoice Delivery');
  const [body, setBody] = useState('Please find the attached invoice PDF for your review and processing.');
  const [delay, setDelay] = useState(1.5);
  const [apSending, setApSending] = useState(false);
  // Cancel flag for an in-flight send loop (both tabs). Checked at the top of each iteration and
  // wired to an AbortController so the current request is aborted too.
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Live send tracker (sent / failed / total) surfaced as a floating popup during & after a run.
  const [apProgress, setApProgress] = useState<{ sent: number; failed: number; total: number; done: boolean } | null>(null);
  const [localPdfs, setLocalPdfs] = useState<PdfFile[]>([]);   // PDFs dropped/added inside the modal
  const [apDrag, setApDrag] = useState(false);
  const [log, setLog] = useState<{ ok: boolean; text: string; ts: string }[]>([
    { ok: true, text: 'Email Sender initializing…', ts: new Date().toLocaleTimeString() },
  ]);
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'end' }); }, [log]);
  const addLog = (ok: boolean, text: string) => setLog(p => [...p, { ok, text, ts: new Date().toLocaleTimeString() }]);

  // PDFs loaded in the app + any dropped/added inside the modal (dedup by name)
  const apPdfs = useMemo(() => {
    const map = new Map<string, PdfFile>();
    [...pdfs, ...localPdfs].forEach(p => map.set(p.name, p));
    return Array.from(map.values());
  }, [pdfs, localPdfs]);

  // Turn dropped/selected files into PdfFile[] (.pdf directly; .zip extracted)
  const filesToPdfs = async (files: FileList | File[]): Promise<PdfFile[]> => {
    const out: PdfFile[] = [];
    for (const f of Array.from(files)) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !entry.name.toLowerCase().endsWith('.pdf')) continue;
          out.push({ name: entry.name.split('/').pop() || entry.name, data: new Uint8Array(await entry.async('arraybuffer')), isCorrupted: false });
        }
      } else if (lower.endsWith('.pdf')) {
        out.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), isCorrupted: false });
      }
    }
    return out;
  };
  const handleApFiles = async (files: FileList | File[]) => {
    const added = await filesToPdfs(files);
    if (added.length === 0) { addLog(false, 'No PDF/ZIP files found in the drop.'); return; }
    setLocalPdfs(prev => { const m = new Map(prev.map(p => [p.name, p])); added.forEach(p => m.set(p.name, p)); return Array.from(m.values()); });
    setSelected(s => { const n = new Set(s); added.forEach(p => n.add(p.name)); return n; }); // auto-select newly added
    addLog(true, `Added ${added.length} PDF(s).`);
  };

  const toggle = (name: string) => setSelected(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const allSelected = apPdfs.length > 0 && selected.size === apPdfs.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(apPdfs.map(p => p.name)));

  // Enabled once sender + app password + recipient are present AND the backend is reachable.
  // PDFs are optional — with none selected it sends a single body-only email.
  const apCanSend = !apSending && backendUp !== false && !!sender.trim() && !!password.trim() && !!recipient.trim();

  // Stop an in-flight run: set the cancel flag and abort the current request.
  const stopSending = () => { cancelRef.current = true; abortRef.current?.abort(); };

  const handleApSend = async () => {
    sessionStorage.setItem('email_sender', sender.trim());
    sessionStorage.setItem('email_app_password', password);
    cancelRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setApSending(true);

    // Never email a PDF the app already flagged corrupt — skip and report it.
    const selectedPdfs = apPdfs.filter(p => selected.has(p.name));
    const corrupt = selectedPdfs.filter(p => p.isCorrupted);
    const targets = selectedPdfs.filter(p => !p.isCorrupted);
    if (corrupt.length > 0) addLog(false, `Skipping ${corrupt.length} corrupt PDF(s): ${corrupt.map(p => p.name).join(', ')}`);

    // No (valid) PDFs selected → send one email without an attachment.
    if (targets.length === 0) {
      setApProgress({ sent: 0, failed: 0, total: 1, done: false });
      addLog(true, `Sending 1 email (no attachment) to ${recipient}…`);
      const res = await sendSingleEmail({
        senderEmail: sender.trim(), senderPassword: password, recipientEmail: recipient.trim(), subject, body, signal,
      });
      addLog(res.sent, res.sent ? `✓ Sent to ${recipient}` : `✗ ${res.error || 'failed'}`);
      setApProgress({ sent: res.sent ? 1 : 0, failed: res.sent ? 0 : 1, total: 1, done: true });
      setApSending(false);
      return;
    }

    setApProgress({ sent: 0, failed: 0, total: targets.length, done: false });
    addLog(true, `Starting: ${targets.length} email(s) to ${recipient}, ${delay}s apart…`);
    let sent = 0, failed = 0;
    for (const pdf of targets) {
      if (cancelRef.current) { addLog(false, `Stopped by user — ${sent} sent, ${failed} failed, ${targets.length - sent - failed} not sent.`); break; }
      addLog(true, `Sending ${pdf.name}…`);
      const res = await sendSingleEmail({
        senderEmail: sender.trim(), senderPassword: password, recipientEmail: recipient.trim(),
        subject, body, file: { name: pdf.name, base64: fileToBase64(pdf.data) }, signal,
      });
      if (res.sent) { sent++; addLog(true, `✓ Sent ${pdf.name}`); }
      else { failed++; addLog(false, `✗ ${pdf.name}: ${res.error || 'failed'}`); }
      setApProgress({ sent, failed, total: targets.length, done: false });
      if (!res.sent && /auth/i.test(res.error || '')) { addLog(false, 'Stopping — fix Gmail App Password.'); break; }
      if (!cancelRef.current && targets.indexOf(pdf) < targets.length - 1) await sleep(delay * 1000);
    }
    addLog(sent > 0 && failed === 0, `Done — ${sent} sent, ${failed} failed.`);
    setApProgress({ sent, failed, total: targets.length, done: true });
    setApSending(false);
  };

  /* ── Helpdesk tab ── */
  const [hdRows, setHdRows] = useState<HdRow[]>([]);
  const [hdAttachments, setHdAttachments] = useState<Map<string, { base64: string; mimeType: string }>>(new Map());
  const [hdRecipient, setHdRecipient] = useState('');
  const [hdSender, setHdSender] = useState(() => sessionStorage.getItem('email_sender') || '');
  const [hdPassword, setHdPassword] = useState(() => sessionStorage.getItem('email_app_password') || '');
  const [hdDelay, setHdDelay] = useState(2);
  const [hdSending, setHdSending] = useState(false);
  const [hdProgressOpen, setHdProgressOpen] = useState(false); // show the live sent/remaining/failed popup
  const [hdSheetDrag, setHdSheetDrag] = useState(false);
  const [hdAttDrag, setHdAttDrag] = useState(false);

  const handleSheet = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    const pick = (r: Record<string, unknown>, keys: string[]) => {
      const map = new Map(Object.keys(r).map(k => [k.toLowerCase().trim(), k]));
      for (const key of keys) { const hit = map.get(key); if (hit) return String(r[hit] ?? ''); }
      return '';
    };
    setHdRows(rows.map(r => ({
      subject: pick(r, ['subject', 'email subject']),
      body: pick(r, ['body', 'email body', 'message']),
      recipient: pick(r, ['recipient', 'to', 'email', 'recipient email']),
      attachKey: pick(r, ['s3_key', 's3key', 'attachment', 'filename', 'file']),
      status: 'pending',
    })));
  };

  const handleHdAttachments = async (files: FileList) => {
    const map = new Map(hdAttachments);
    for (const f of Array.from(files)) {
      if (f.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          const bytes = new Uint8Array(await entry.async('arraybuffer'));
          map.set(entry.name.split('/').pop() || entry.name, { base64: bytesToBase64(bytes), mimeType: 'application/pdf' });
        }
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        map.set(f.name, { base64: bytesToBase64(bytes), mimeType: f.type || 'application/pdf' });
      }
    }
    setHdAttachments(map);
  };

  // A sheet's s3_key cell may be a single path ("tenant/uuid") OR a JSON array of paths
  // ('["tenant/uuidA","tenant/uuidB"]'). Parse both into a list of last-path-segment keys.
  const parseS3Keys = (raw: string): string[] => {
    const val = (raw || '').trim();
    if (!val) return [];
    let items: string[] = [val];
    if (val.startsWith('[')) {
      try {
        const arr = JSON.parse(val);
        if (Array.isArray(arr)) items = arr.map(x => String(x));
      } catch {
        // strip brackets/quotes and split on commas as a fallback
        items = val.replace(/^\[|\]$/g, '').split(',').map(s => s.replace(/^["'\s]+|["'\s]+$/g, ''));
      }
    }
    return items.map(k => (k.split('/').pop() || k).trim()).filter(Boolean);
  };

  // Return ALL attachments matching an s3_key cell (exact match first, then a tightened fuzzy
  // fallback), so multi-attachment rows send every file instead of just one.
  const matchAttachments = (rawKey: string) => {
    const keys = parseS3Keys(rawKey);
    if (keys.length === 0) return [];
    const out: { name: string; base64: string; mimeType: string }[] = [];
    const seen = new Set<string>();
    for (const base of keys) {
      let hit: { name: string; base64: string; mimeType: string } | null = null;
      for (const [name, val] of hdAttachments) {
        if (name === base || name === `${base}.pdf` || name.replace(/\.[^.]+$/, '') === base) { hit = { name, ...val }; break; }
      }
      if (!hit) { // looser fallback only if no exact hit
        for (const [name, val] of hdAttachments) {
          if (name.startsWith(base) && base.length >= 8) { hit = { name, ...val }; break; }
        }
      }
      if (hit && !seen.has(hit.name)) { seen.add(hit.name); out.push(hit); }
    }
    return out;
  };

  const hdStats = useMemo(() => ({
    sent: hdRows.filter(r => r.status === 'sent').length,
    failed: hdRows.filter(r => r.status === 'failed').length,
    pending: hdRows.filter(r => r.status === 'pending' || r.status === 'sending').length,
  }), [hdRows]);

  const handleHdSend = async () => {
    sessionStorage.setItem('email_sender', hdSender.trim());
    sessionStorage.setItem('email_app_password', hdPassword);
    cancelRef.current = false;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setHdSending(true);
    setHdProgressOpen(true);
    // Reset every row to pending so the tracker's Sent/Remaining/Failed reflect THIS run, not a
    // previous one (stale "sent" rows made a re-run show Sent=N / Remaining=0 instantly).
    setHdRows(rs => rs.map(r => ({ ...r, status: 'pending', error: undefined })));
    for (let i = 0; i < hdRows.length; i++) {
      if (cancelRef.current) break;
      setHdRows(rs => rs.map((r, idx) => idx === i ? { ...r, status: 'sending' } : r));
      const row = hdRows[i];
      const atts = matchAttachments(row.attachKey);
      const res = await sendSimpleEmail({
        senderEmail: hdSender.trim(), appPassword: hdPassword,
        recipient: (row.recipient || hdRecipient).trim(),
        subject: row.subject || '(no subject)', body: row.body || '',
        attachments: atts,
        signal,
      });
      setHdRows(rs => rs.map((r, idx) => idx === i ? { ...r, status: res.sent ? 'sent' : 'failed', error: res.error } : r));
      // Stop the whole run on an auth failure (wrong App Password) instead of hammering Gmail.
      if (!res.sent && /auth|password|credential/i.test(res.error || '')) break;
      if (!cancelRef.current && i < hdRows.length - 1) await sleep(hdDelay * 1000);
    }
    setHdSending(false);
  };

  const inputCls = 'w-full text-sm border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400';
  // Tabs mirror the annotation tool: white active tab with a 3px #6B21A8 bottom border on a #f1f5f9 rail.
  const tabBtn = (t: Tab) =>
    `flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-[3px] -mb-0.5 transition-all ${tab === t ? 'border-[#6B21A8] text-[#6B21A8] bg-white' : 'border-transparent text-slate-500 hover:text-[#6B21A8] hover:bg-[#6B21A8]/5'}`;
  // Backend badge — exact annotation-tool palette (connected #48bb78, disconnected #f56565, checking #e2e8f0).
  const badgeCls = backendUp === false
    ? 'bg-[#f56565] text-white'
    : backendUp ? 'bg-[#48bb78] text-white' : 'bg-[#e2e8f0] text-[#718096]';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2">
      <div className="relative bg-white rounded-2xl shadow-2xl w-[98vw] max-w-[2400px] h-[94vh] overflow-hidden flex flex-col border border-slate-200">
        {/* Gradient header — linear-gradient(135deg, #6B21A8, #8B5CF6) */}
        <div className="bg-gradient-to-br from-[#6B21A8] to-[#8B5CF6] text-white px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="w-6 h-6" />
            <h2 className="text-2xl font-semibold">Email Sender</h2>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-full ${badgeCls}`}>
              {backendUp === null ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</>
              ) : backendUp ? '● Connected' : '● Disconnected'}
            </span>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg border border-white/40 flex items-center justify-center hover:bg-white/15 text-2xl leading-none"><X className="w-5 h-5" /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-slate-200 bg-[#f1f5f9] px-6">
          <button className={tabBtn('ap')} onClick={() => setTab('ap')}><FileText className="w-4 h-4" />AP Invoice</button>
          <button className={tabBtn('helpdesk')} onClick={() => setTab('helpdesk')}><Mail className="w-4 h-4" />Helpdesk Email Sender</button>
        </div>

        {backendUp === false && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
            Backend not reachable at <code className="font-mono">{EMAIL_BACKEND_URL}</code> — start it: <code className="font-mono">cd backend && uvicorn app:app --port 8787</code>
          </div>
        )}

        {/* ── AP INVOICE TAB ── */}
        {tab === 'ap' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 grid grid-cols-2 gap-4 p-4 overflow-hidden">
              {/* Left: PDF selection (drag & drop PDFs/ZIPs here, or click to browse) */}
              <div className="border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold flex items-center gap-1.5"><FileText className="w-4 h-4" />Select PDFs to Send</span>
                  <div className="flex items-center gap-3">
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 border border-white/40 transition-colors">
                      <Upload className="w-3.5 h-3.5" /> Add PDFs/ZIP
                      <input type="file" multiple accept=".pdf,.zip" className="hidden" onChange={e => e.target.files && handleApFiles(e.target.files)} />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={apPdfs.length === 0} />Select All
                    </label>
                  </div>
                </div>
                <div
                  className={`flex-1 overflow-y-auto p-3 space-y-1 transition-colors ${apDrag ? 'bg-purple-50 ring-2 ring-inset ring-purple-300' : ''}`}
                  onDragOver={e => { e.preventDefault(); setApDrag(true); }}
                  onDragLeave={() => setApDrag(false)}
                  onDrop={e => { e.preventDefault(); setApDrag(false); if (e.dataTransfer.files.length) handleApFiles(e.dataTransfer.files); }}
                >
                  {apPdfs.length === 0 ? (
                    <label
                      className={`h-full min-h-[220px] flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl cursor-pointer transition-colors text-center px-6 ${apDrag ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-300 text-slate-500 hover:border-purple-400 hover:bg-purple-50/40'}`}
                    >
                      <Upload className="w-12 h-12 mb-1 text-slate-400" />
                      <p className="text-sm font-semibold text-slate-700">Click to browse, or drag &amp; drop</p>
                      <p className="text-xs">PDFs or ZIP archives — multiple files supported.</p>
                      <input type="file" multiple accept=".pdf,.zip" className="hidden" onChange={e => e.target.files && handleApFiles(e.target.files)} />
                    </label>
                  ) : apPdfs.map(pdf => (
                    <label key={pdf.name} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs">
                      <input type="checkbox" checked={selected.has(pdf.name)} onChange={() => toggle(pdf.name)} />
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-mono truncate flex-1" title={pdf.name}>{pdf.name}</span>
                      <span className="text-slate-400">{(pdf.data.length / 1024).toFixed(0)} KB</span>
                    </label>
                  ))}
                </div>
                <div className="px-3 py-1.5 border-t border-slate-100 text-xs text-slate-500">
                  Selected: <span className="font-semibold text-purple-600">{selected.size}</span>/{apPdfs.length}
                </div>
              </div>

              {/* Right: config */}
              <div className="border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-3 py-2 text-sm font-semibold">Email Configuration</div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  <div><label className="text-xs font-medium text-slate-600 block mb-1">Recipient Email</label><input className={inputCls} value={recipient} onChange={e => setRecipient(e.target.value)} /></div>
                  <div><label className="text-xs font-medium text-slate-600 block mb-1">Sender Email (Gmail)</label><input className={inputCls} value={sender} onChange={e => setSender(e.target.value)} placeholder="you@gmail.com" /></div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 block mb-1">Gmail App Password <span className="text-red-500">*</span></label>
                    <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter Gmail App Password" />
                    <p className="text-[11px] text-red-500 mt-0.5">Required: use a Gmail App Password (not your regular password). <a className="text-blue-600 underline" href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noreferrer">How →</a></p>
                  </div>
                  <div><label className="text-xs font-medium text-slate-600 block mb-1">Email Subject</label><input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} /></div>
                  <div><label className="text-xs font-medium text-slate-600 block mb-1">Email Body</label><textarea className={`${inputCls} h-20 resize-none`} value={body} onChange={e => setBody(e.target.value)} /></div>
                  <div><label className="text-xs font-medium text-slate-600 block mb-1">Delay Between Emails (seconds)</label><input className={inputCls} type="number" min={0} max={60} step={0.1} value={delay} onChange={e => setDelay(Number(e.target.value))} /></div>
                  <div className="flex gap-2 pt-1">
                    {apSending ? (
                      <button onClick={stopSending}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                        <X className="w-4 h-4" /> Stop
                      </button>
                    ) : (
                      <button onClick={handleApSend} disabled={!apCanSend}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={backendUp === false ? 'Backend not reachable — start the backend (uvicorn app:app --port 8787)' : undefined}>
                        <Send className="w-4 h-4" /> Send to Gmail
                      </button>
                    )}
                    <button onClick={() => { setSelected(new Set()); }} className="px-3 py-2 rounded-md text-sm font-medium text-slate-600 border border-slate-300 hover:bg-slate-50">Clear</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Activity log — full-width terminal, taller & more readable */}
            <div className="border-t border-slate-200 bg-slate-900 text-slate-100 h-56 flex flex-col">
              <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-700">
                <span className="text-sm font-semibold flex items-center gap-2 tracking-wide">
                  <span className="text-emerald-400 font-mono">›_</span> Real-Time Activity Log
                </span>
                <div className="flex items-center gap-3">
                  {apProgress && (
                    <div className="flex items-center gap-2 text-[11px] font-semibold">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">Sent {apProgress.sent}</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">Remaining {Math.max(0, apProgress.total - apProgress.sent - apProgress.failed)}</span>
                      <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">Failed {apProgress.failed}</span>
                    </div>
                  )}
                  <button onClick={() => setLog([])} className="text-slate-400 hover:text-white" title="Clear log"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-2 font-mono text-xs leading-relaxed space-y-1">
                {log.map((l, i) => (
                  <div key={i} className={l.ok ? 'text-slate-300' : 'text-red-400'}>
                    <span className="text-slate-500">[{l.ts}]</span> {l.text}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* ── HELPDESK TAB ── */}
        {tab === 'helpdesk' && (
          <div className="flex-1 overflow-hidden grid grid-cols-[minmax(400px,460px)_1fr] gap-5 p-5">
            {/* Left config */}
            <div className="overflow-y-auto space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-800">
                <div className="font-semibold">Gmail App Password Required</div>
                <div>Regular Gmail passwords won't work — create an App Password (<a className="text-blue-600 underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Google App Passwords</a> → Mail → Generate).</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-800">Sheet needs <strong>subject</strong> &amp; <strong>body</strong> columns (plus <code>recipient</code> and <code>s3_key</code>/filename).</div>

              <label
                className={`flex flex-col items-center justify-center gap-2 px-4 py-7 border-2 border-dashed rounded-xl text-sm cursor-pointer transition-colors text-center ${hdSheetDrag ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-300 text-slate-600 hover:border-purple-400 hover:bg-purple-50/40'}`}
                onDragOver={e => { e.preventDefault(); setHdSheetDrag(true); }}
                onDragLeave={() => setHdSheetDrag(false)}
                onDrop={e => { e.preventDefault(); setHdSheetDrag(false); if (e.dataTransfer.files?.[0]) handleSheet(e.dataTransfer.files[0]); }}
              >
                <FileText className="w-8 h-8 text-slate-400" />
                <span className="font-semibold text-slate-700">Upload Excel/CSV</span>
                <span className="text-[11px] text-slate-400">Click to browse, or drag &amp; drop</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && handleSheet(e.target.files[0])} />
              </label>
              <label
                className={`flex flex-col items-center justify-center gap-2 px-4 py-7 border-2 border-dashed rounded-xl text-sm cursor-pointer transition-colors text-center ${hdAttDrag ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-300 text-slate-600 hover:border-purple-400 hover:bg-purple-50/40'}`}
                onDragOver={e => { e.preventDefault(); setHdAttDrag(true); }}
                onDragLeave={() => setHdAttDrag(false)}
                onDrop={e => { e.preventDefault(); setHdAttDrag(false); if (e.dataTransfer.files?.length) handleHdAttachments(e.dataTransfer.files); }}
              >
                <Paperclip className="w-8 h-8 text-slate-400" />
                <span className="font-semibold text-slate-700">Upload Attachments</span>
                <span className="text-[11px] text-slate-400">ZIP, PDF, PNG, JPG, TIFF, XLSX — multiple. Click or drag &amp; drop</span>
                <input type="file" multiple accept=".zip,.pdf,.png,.jpg,.jpeg,.tiff,.xlsx" className="hidden" onChange={e => e.target.files && handleHdAttachments(e.target.files)} />
              </label>
              {hdAttachments.size > 0 && <div className="text-[11px] text-slate-500">{hdAttachments.size} attachment file(s) loaded</div>}

              <div className="space-y-2">
                <div><label className="text-xs font-medium text-slate-600 block mb-0.5">Recipient (fallback)</label><input className={inputCls} value={hdRecipient} onChange={e => setHdRecipient(e.target.value)} placeholder="recipient@example.com" /></div>
                <div><label className="text-xs font-medium text-slate-600 block mb-0.5">Sender (Gmail)</label><input className={inputCls} value={hdSender} onChange={e => setHdSender(e.target.value)} placeholder="you@gmail.com" /></div>
                <div><label className="text-xs font-medium text-slate-600 block mb-0.5">App Password</label><input className={inputCls} type="password" value={hdPassword} onChange={e => setHdPassword(e.target.value)} /></div>
                <div className="flex items-center gap-2"><label className="text-xs font-medium text-slate-600">Delay</label><input className="w-20 text-sm border border-slate-300 rounded-md px-2 py-1" type="number" min={0.5} max={30} step={0.5} value={hdDelay} onChange={e => setHdDelay(Number(e.target.value))} /><span className="text-xs text-slate-500">sec</span></div>
              </div>

              {hdSending ? (
                <button onClick={stopSending}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                  <X className="w-4 h-4" /> Stop
                </button>
              ) : (
                <button onClick={handleHdSend} disabled={hdRows.length === 0 || !hdSender.trim() || !hdPassword.trim() || backendUp === false}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-500 hover:from-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={backendUp === false ? 'Backend not reachable — start the backend (uvicorn app:app --port 8787)' : undefined}>
                  <Send className="w-4 h-4" /> Start Sending
                </button>
              )}

              {hdRows.length > 0 && (
                <div className="flex gap-3 text-xs">
                  <span className="text-green-600">Sent: {hdStats.sent}</span>
                  <span className="text-red-600">Failed: {hdStats.failed}</span>
                  <span className="text-slate-500">Pending: {hdStats.pending}</span>
                </div>
              )}
            </div>

            {/* Right queue */}
            <div className="border border-slate-200 rounded-lg overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Email Queue</span>
                <span className="text-xs text-slate-400">{hdRows.length || ''}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {hdRows.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
                    <FileText className="w-12 h-12 mb-2" /><span className="text-sm">Upload a sheet to see emails</span>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-1.5">Recipient</th><th className="px-3 py-1.5">Subject</th><th className="px-3 py-1.5">Attachment</th><th className="px-3 py-1.5">Status</th>
                    </tr></thead>
                    <tbody>
                      {hdRows.map((r, i) => {
                        const atts = matchAttachments(r.attachKey);
                        const tone = r.status === 'sent' ? 'bg-green-100 text-green-700' : r.status === 'failed' ? 'bg-red-100 text-red-700' : r.status === 'sending' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500';
                        return (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="px-3 py-1.5 truncate max-w-[150px]">{r.recipient || hdRecipient || '—'}</td>
                            <td className="px-3 py-1.5 truncate max-w-[200px]" title={r.subject}>{r.subject || '—'}</td>
                            <td className="px-3 py-1.5">{atts.length > 0 ? <span className="text-green-600" title={atts.map(a => a.name).join(', ')}>✓ {atts.length} file{atts.length === 1 ? '' : 's'}</span> : <span className="text-slate-400">{r.attachKey ? 'not found' : '—'}</span>}</td>
                            <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded-full ${tone}`}>{r.status}{r.error ? ` · ${r.error.slice(0, 20)}` : ''}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Floating send tracker (AP Invoice) ── */}
        {tab === 'ap' && apProgress && (
          <SendTracker
            title="AP Invoice Send"
            sent={apProgress.sent}
            failed={apProgress.failed}
            total={apProgress.total}
            done={apProgress.done}
            onClose={() => setApProgress(null)}
          />
        )}

        {/* ── Floating send tracker (Helpdesk) ── */}
        {tab === 'helpdesk' && hdProgressOpen && (
          <SendTracker
            title="Helpdesk Send"
            sent={hdStats.sent}
            failed={hdStats.failed}
            total={hdRows.length}
            done={!hdSending}
            onClose={() => setHdProgressOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/* Floating popup showing live Sent / Remaining / Failed counts with a progress bar. */
function SendTracker({ title, sent, failed, total, done, onClose }: {
  title: string; sent: number; failed: number; total: number; done: boolean; onClose: () => void;
}) {
  const remaining = Math.max(0, total - sent - failed);
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;
  return (
    <div className="absolute bottom-6 right-6 z-10 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-br from-[#6B21A8] to-[#8B5CF6] text-white">
        <span className="text-sm font-semibold flex items-center gap-2">
          {done ? <CheckCircle2 className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
          {title}
        </span>
        <button onClick={onClose} className="w-6 h-6 rounded-md hover:bg-white/20 flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-emerald-50 border border-emerald-100 py-2">
            <div className="text-xl font-bold text-emerald-600 tabular-nums">{sent}</div>
            <div className="text-[11px] font-medium text-emerald-700">Sent</div>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-100 py-2">
            <div className="text-xl font-bold text-amber-600 tabular-nums">{remaining}</div>
            <div className="text-[11px] font-medium text-amber-700">Remaining</div>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-100 py-2">
            <div className="text-xl font-bold text-red-600 tabular-nums">{failed}</div>
            <div className="text-[11px] font-medium text-red-700">Failed</div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
            <span>{done ? 'Completed' : 'Sending…'}</span>
            <span className="tabular-nums">{sent + failed}/{total} · {pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${failed > 0 && done ? 'bg-gradient-to-r from-emerald-500 to-red-400' : 'bg-gradient-to-r from-[#6B21A8] to-[#8B5CF6]'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
