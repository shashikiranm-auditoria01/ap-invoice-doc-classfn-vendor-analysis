/**
 * Email service — compose/send an email about an invoice document.
 *
 * TODAY (no backend): "Compose Email" opens the reviewer's own mail client via a `mailto:`
 * link, pre-filled with To / Subject / Body from the document. mailto CANNOT carry
 * attachments (not supported by the spec/clients), so the PDF is referenced, not attached.
 *
 * FUTURE (backend, for true send + attachments): when VITE_EMAIL_API_URL is set, the app
 * POSTs to that endpoint and the backend sends via SMTP/provider and attaches the invoice
 * PDF (resolved from S3 by the document's s3Key). Contract below.
 *
 * ── Backend contract (to implement) ──────────────────────────────────────────────
 *   POST {VITE_EMAIL_API_URL}/send-email
 *   Authorization: Bearer <VITE_EMAIL_API_TOKEN>   (optional)
 *   Body (JSON): { to: string[], cc?: string[], subject: string, body: string,
 *                  attachmentS3Keys?: string[], documentId?: string }
 *   → 200 { sent: true, id } ; the backend resolves attachmentS3Keys from S3 and attaches them.
 * ────────────────────────────────────────────────────────────────────────────────
 */
import { DocClassificationDocument } from '../types/docClassification';

const API_BASE = (import.meta.env.VITE_EMAIL_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
const API_TOKEN = import.meta.env.VITE_EMAIL_API_TOKEN as string | undefined;

/** True when a backend send endpoint (with real attachments) is configured. */
export const isEmailApiConfigured = API_BASE.length > 0;

// ── Email backend (Gmail-SMTP sender, served by the consolidated backend/app.py) ────────────────
// Default to the local backend; override with VITE_EMAIL_BACKEND_URL.
export const EMAIL_BACKEND_URL =
  ((import.meta.env.VITE_EMAIL_BACKEND_URL as string | undefined) || 'http://localhost:8787').replace(/\/+$/, '');

/**
 * fetch() with a hard timeout via AbortController, so a backend that accepts the socket but never
 * replies can't hang the health check or a send loop forever. Also merges an optional external
 * signal (the send-loop cancel button) so either can abort the request.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 45000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const external = init.signal;
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Health-check the email backend (used to show "start the backend" hints). 5s timeout. */
export async function checkEmailBackend(): Promise<boolean> {
  try {
    const r = await fetchWithTimeout(`${EMAIL_BACKEND_URL}/api/health`, { method: 'GET' }, 5000);
    return r.ok;
  } catch {
    return false;
  }
}

/** Base64-encode raw bytes (browser-safe, chunked to avoid call-stack limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

export interface SimpleAttachment { name: string; base64: string; mimeType?: string; }
export interface SimpleSendPayload {
  senderEmail: string;
  appPassword: string;
  recipient: string;
  subject: string;
  body: string;
  attachments: SimpleAttachment[];
  signal?: AbortSignal;   // to cancel from the send loop's Stop button
}

/** HelpDesk bulk mode — one email with any number of attachments via /api/email/send-simple. */
export async function sendSimpleEmail(p: SimpleSendPayload): Promise<SendResult> {
  try {
    const res = await fetchWithTimeout(`${EMAIL_BACKEND_URL}/api/email/send-simple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: p.signal,
      body: JSON.stringify({
        sender_email: p.senderEmail,
        app_password: p.appPassword,
        recipient: p.recipient,
        subject: p.subject,
        body: p.body,
        attachments: p.attachments.map(a => ({ name: a.name, base64Data: a.base64, mimeType: a.mimeType || 'application/pdf' })),
      }),
    });
    const j = await res.json().catch(() => ({}));
    return { sent: !!j.success, error: j.error };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'Network error — is the email backend running?' };
  }
}

export interface SingleSendPayload {
  senderEmail: string;
  senderPassword: string;   // Gmail App Password
  recipientEmail: string;
  subject: string;
  body: string;
  file?: { name: string; base64: string };   // optional PDF attachment
  signal?: AbortSignal;   // to cancel from the send loop's Stop button
}

/** Send one email (AP Invoice mode) via the backend's /api/send_email. */
export async function sendSingleEmail(p: SingleSendPayload): Promise<SendResult> {
  try {
    const res = await fetchWithTimeout(`${EMAIL_BACKEND_URL}/api/send_email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: p.signal,
      body: JSON.stringify({
        sender_email: p.senderEmail,
        sender_password: p.senderPassword,
        recipient_email: p.recipientEmail,
        email_subject: p.subject,
        email_body: p.body,
        file: p.file ? { name: p.file.name, data: p.file.base64 } : undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    return { sent: !!j.success, error: j.error };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'Network error — is the backend running? (cd backend && uvicorn app:app --port 8787)' };
  }
}

export interface InvoiceEmailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

/** Build the default draft (To / Subject / Body) for a document. */
export function buildInvoiceEmailDraft(doc: DocClassificationDocument): InvoiceEmailDraft {
  const to = (doc.senderEmail || doc.recipientEmail || '').trim();
  const cc = (doc.senderEmail && doc.recipientEmail && doc.senderEmail !== doc.recipientEmail)
    ? doc.recipientEmail.trim() : '';
  const subject = `Invoice ${doc.invoiceNumber || '(no number)'} — ${doc.vendorName || 'Vendor'}`;
  const body = [
    `Hello,`,
    ``,
    `Regarding invoice ${doc.invoiceNumber || '(no number)'} from ${doc.vendorName || 'the vendor'}.`,
    ``,
    `  • Document ID: ${doc.documentId}`,
    `  • Tenant: ${doc.tenantName}`,
    `  • Vendor: ${doc.vendorName}${doc.originalVendorName && doc.originalVendorName !== doc.vendorName ? ` (originally: ${doc.originalVendorName})` : ''}`,
    doc.recipientEmail ? `  • AP mailbox: ${doc.recipientEmail}` : ``,
    doc.extractedFileS3Location ? `  • Attachment reference: ${doc.extractedFileS3Location}` : ``,
    ``,
    `Thanks,`,
  ].filter(l => l !== undefined).join('\n');
  return { to, cc, subject, body };
}

/** Build a mailto: URL from a draft (opens the reviewer's mail client). */
export function buildMailto(draft: InvoiceEmailDraft): string {
  const params = new URLSearchParams();
  if (draft.cc) params.set('cc', draft.cc);
  params.set('subject', draft.subject);
  params.set('body', draft.body);
  // URLSearchParams encodes spaces as '+', but mail clients expect %20 in mailto — fix it.
  const qs = params.toString().replace(/\+/g, '%20');
  return `mailto:${draft.to}?${qs}`;
}

export interface SendResult { sent: boolean; error?: string }

/**
 * Send via the backend (real email + PDF attachment). Only works when configured.
 * `attachmentS3Keys` lets the backend attach the invoice PDF resolved from S3.
 */
export async function sendInvoiceEmailViaApi(
  draft: InvoiceEmailDraft,
  opts: { documentId?: string; attachmentS3Keys?: string[] } = {},
): Promise<SendResult> {
  if (!isEmailApiConfigured) return { sent: false, error: 'No email backend configured' };
  try {
    const res = await fetch(`${API_BASE}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}) },
      body: JSON.stringify({
        to: draft.to ? draft.to.split(',').map(s => s.trim()).filter(Boolean) : [],
        cc: draft.cc ? draft.cc.split(',').map(s => s.trim()).filter(Boolean) : [],
        subject: draft.subject,
        body: draft.body,
        attachmentS3Keys: opts.attachmentS3Keys || [],
        documentId: opts.documentId,
      }),
    });
    if (!res.ok) return { sent: false, error: `Email API ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
