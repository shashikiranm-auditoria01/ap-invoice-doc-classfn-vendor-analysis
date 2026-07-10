import { Document } from '../types/document';

/**
 * Extract the UUID/identifier from a PDF filename
 * Example: "924b0482-f146-11f0-b3cd-b7a39ee49af9.pdf" -> "924b0482-f146-11f0-b3cd-b7a39ee49af9"
 */
export function extractIdFromPdfFilename(filename: string): string {
  // Remove .pdf extension and any path prefix
  const baseName = filename.replace(/\.pdf$/i, '').split('/').pop() || '';
  return baseName;
}

/**
 * Extract the last path segment from an S3 location
 * Example: "665247456933969920/924b0482-f146-11f0-b3cd-b7a39ee49af9" -> "924b0482-f146-11f0-b3cd-b7a39ee49af9"
 * Example: "665247456933969920/f422c510-d681-11f0-8ba0-af12248b8f06/5ed38212-d5d7-11f0-8ba0-af12248b8f06" -> "5ed38212-d5d7-11f0-8ba0-af12248b8f06"
 */
export function extractIdFromS3Location(s3Location: string): string {
  if (!s3Location) return '';
  
  // Split by '/' and get the last non-empty segment
  const segments = s3Location.split('/').filter(s => s.trim() !== '');
  return segments[segments.length - 1] || '';
}

/**
 * Get the primary S3 ID for a document
 * Priority: extractedFileS3Location > s3Location > s3Key
 * Only falls back if the higher priority field is empty
 */
export function getPrimaryS3Id(doc: Document): string {
  // Priority 1: extractedFileS3Location (if not empty)
  if (doc.extractedFileS3Location && doc.extractedFileS3Location.trim() !== '') {
    return extractIdFromS3Location(doc.extractedFileS3Location);
  }
  
  // Priority 2: s3Location (if extractedFileS3Location is empty)
  if (doc.s3Location && doc.s3Location.trim() !== '') {
    return extractIdFromS3Location(doc.s3Location);
  }
  
  // Priority 3: s3Key (if both above are empty)
  if (doc.s3Key && doc.s3Key.trim() !== '') {
    return extractIdFromS3Location(doc.s3Key);
  }
  
  return '';
}

/**
 * Match a PDF file to a document based on S3 location
 * Priority: extractedFileS3Location first, then s3Location only if extractedFileS3Location is empty
 * Returns the matched document or null if no match found
 */
export function matchPdfToDocument(
  pdfFilename: string,
  documents: Document[]
): Document | null {
  const pdfId = extractIdFromPdfFilename(pdfFilename);
  
  if (!pdfId) return null;
  
  // Find document where the primary S3 ID matches the PDF ID
  for (const doc of documents) {
    const docS3Id = getPrimaryS3Id(doc);
    if (docS3Id === pdfId) {
      return doc;
    }
  }
  
  return null;
}

/**
 * Match all PDFs to documents and return a map
 */
export function matchAllPdfsToDocuments(
  pdfFilenames: string[],
  documents: Document[]
): Map<string, Document | null> {
  const matches = new Map<string, Document | null>();
  
  for (const filename of pdfFilenames) {
    matches.set(filename, matchPdfToDocument(filename, documents));
  }
  
  return matches;
}

/**
 * Get all documents that have a matching PDF
 */
export function getDocumentsWithPdfMatch(
  pdfFilenames: string[],
  documents: Document[]
): Document[] {
  const pdfIds = new Set(pdfFilenames.map(f => extractIdFromPdfFilename(f)));
  
  return documents.filter(doc => {
    const docS3Id = getPrimaryS3Id(doc);
    return pdfIds.has(docS3Id);
  });
}

/**
 * Get documents that don't have a matching PDF (for exclusion)
 */
export function getDocumentsWithoutPdfMatch(
  pdfFilenames: string[],
  documents: Document[]
): Document[] {
  const matchedDocs = getDocumentsWithPdfMatch(pdfFilenames, documents);
  const matchedIds = new Set(matchedDocs.map(d => d.documentId));
  
  return documents.filter(doc => !matchedIds.has(doc.documentId));
}
