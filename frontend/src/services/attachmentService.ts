/**
 * Attachment service — integration point for fetching invoice PDFs from a backend.
 *
 * TODAY: PDFs are loaded client-side from a ZIP upload (see ZipHandler) and matched to
 * documents by S3-UUID. There is no backend.
 *
 * FUTURE (planned): a backend API backed by a database + AWS S3. Given a document's S3
 * key, the API resolves the object location from the DB and streams the PDF from S3.
 * This module is the single place the frontend calls that endpoint, so wiring the real
 * backend later is a config change, not a code hunt.
 *
 * ── Endpoint contract (to implement on the backend) ────────────────────────────────
 *   GET  {VITE_ATTACHMENT_API_URL}/attachments?s3Key=<url-encoded S3 key>
 *   Headers: Authorization: Bearer <VITE_ATTACHMENT_API_TOKEN>   (optional)
 *   Responses:
 *     200  application/pdf            → binary PDF body (the resolved S3 object)
 *     404                             → attachment not found  → service returns null
 *     4xx/5xx                         → error                → service throws
 *   The backend is responsible for: looking up the S3 bucket/key in the DB by the
 *   provided key, generating a presigned URL or proxying the S3 GetObject, and returning
 *   the bytes. The `s3Key` passed is the document's extractedFileS3Location (preferred)
 *   or s3Location (e.g. "674288818571972608/861.../<uuid>").
 * ────────────────────────────────────────────────────────────────────────────────────
 */

const API_BASE = (import.meta.env.VITE_ATTACHMENT_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
const API_TOKEN = import.meta.env.VITE_ATTACHMENT_API_TOKEN as string | undefined;

/** True when a backend attachment endpoint is configured. UI hides "fetch from server" otherwise. */
export const isAttachmentApiConfigured = API_BASE.length > 0;

export interface FetchedAttachment {
  data: Uint8Array;
  filename: string;
  s3Key: string;
}

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}

/** Build the endpoint URL for a given S3 key (also usable as an <a href> / iframe src). */
export function getAttachmentUrl(s3Key: string): string {
  return `${API_BASE}/attachments?s3Key=${encodeURIComponent(s3Key)}`;
}

/**
 * Fetch a single attachment by S3 key. Returns null if unconfigured or 404;
 * throws on other errors so callers can surface a message.
 */
export async function fetchAttachmentByS3Key(
  s3Key: string,
  suggestedFilename?: string,
): Promise<FetchedAttachment | null> {
  if (!isAttachmentApiConfigured || !s3Key) return null;

  const res = await fetch(getAttachmentUrl(s3Key), { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Attachment API ${res.status}: ${res.statusText}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  const lastSeg = s3Key.split('/').filter(Boolean).pop() || 'attachment';
  const filename = suggestedFilename || (lastSeg.endsWith('.pdf') ? lastSeg : `${lastSeg}.pdf`);
  return { data: buf, filename, s3Key };
}
