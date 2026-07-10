
/**
 * Storage utilities for persisting application state across page refreshes
 * Uses localStorage for small data and IndexedDB for large binary data (PDFs)
 */

import { ReviewedDocument } from '../types/document';
import { PdfFile } from '../components/analysis/ZipHandler';
import { ReviewedDocClassification } from '../types/docClassification';

// Storage keys
const STORAGE_KEYS = {
  REVIEWED_DOCUMENTS: 'ap_dashboard_reviewed_docs',
  ANALYSIS_STATE: 'ap_dashboard_analysis_state',
  ACTIVE_TAB: 'ap_dashboard_active_tab',
  ANALYSIS_DATA_IDS: 'ap_dashboard_analysis_data_ids',
  DOC_CLASSIFICATION_REVIEWED: 'ap_dashboard_doc_classification_reviewed',
} as const;

// IndexedDB configuration
const DB_NAME = 'ap_dashboard_db';
const DB_VERSION = 2; // Increment version to add new store
const PDF_STORE = 'pdf_files';
const DOC_CLASSIFICATION_PDF_STORE = 'doc_classification_pdfs';

// Types for serialization - stores ReviewedDocument with dates as ISO strings
// We use 'unknown' and cast because ReviewedDocument has Date fields that become strings
type SerializedReviewedDocument = Omit<ReviewedDocument, 'createdAt' | 'reviewedAt'> & {
  createdAt: string;
  reviewedAt: string;
};

// Type for serialized doc classification reviewed documents
type SerializedReviewedDocClassification = Omit<ReviewedDocClassification, 'createdAt' | 'updatedAt' | 'reviewedAt'> & {
  createdAt: string;
  updatedAt: string | null;
  reviewedAt: string;
};

export interface AnalysisPageState {
  currentIndex: number;
  viewMode: 'matched' | 'all';
  searchQuery: string;
  selectedVendors: string[];
  selectedFieldNames: string[];
  vendorFilterMode: 'include' | 'exclude' | null;
  fieldNameFilterMode: 'include' | 'exclude' | null;
  showFilters: boolean;
  showZipUploader: boolean;
}

interface StoredPdfFile {
  name: string;
  data: number[]; // Uint8Array as regular array for JSON serialization
  isCorrupted: boolean;
  errorMessage?: string;
}

// ============================================================================
// localStorage Utilities
// ============================================================================

/**
 * Serialize data for localStorage, handling Date objects
 */
function serializeForStorage<T>(data: T): string {
  return JSON.stringify(data, (key, value) => {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  });
}

/**
 * Deserialize data from localStorage, restoring Date objects
 */
function deserializeFromStorage<T>(json: string): T {
  return JSON.parse(json, (key, value) => {
    if (value && typeof value === 'object' && value.__type === 'Date') {
      return new Date(value.value);
    }
    return value;
  });
}

// ============================================================================
// Reviewed Documents Persistence (localStorage)
// ============================================================================

/**
 * Save reviewed documents to localStorage
 * Serializes Date fields to ISO strings
 */
export function saveReviewedDocuments(docs: ReviewedDocument[]): void {
  try {
    const serialized: SerializedReviewedDocument[] = docs.map(doc => ({
      ...doc,
      createdAt: doc.createdAt.toISOString(),
      reviewedAt: doc.reviewedAt.toISOString(),
    }));
    localStorage.setItem(STORAGE_KEYS.REVIEWED_DOCUMENTS, JSON.stringify(serialized));
  } catch (error) {
    console.error('Failed to save reviewed documents:', error);
  }
}

/**
 * Load reviewed documents from localStorage
 * Deserializes ISO strings back to Date objects
 */
export function loadReviewedDocuments(): ReviewedDocument[] | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.REVIEWED_DOCUMENTS);
    if (!stored) return null;

    const serialized: SerializedReviewedDocument[] = JSON.parse(stored);
    return serialized.map(doc => ({
      ...doc,
      createdAt: new Date(doc.createdAt),
      reviewedAt: new Date(doc.reviewedAt),
    }));
  } catch (error) {
    console.error('Failed to load reviewed documents:', error);
    return null;
  }
}

/**
 * Clear reviewed documents from localStorage
 */
export function clearReviewedDocumentsStorage(): void {
  localStorage.removeItem(STORAGE_KEYS.REVIEWED_DOCUMENTS);
}

// ============================================================================
// Analysis Page State Persistence (localStorage)
// ============================================================================

/**
 * Save analysis page state to localStorage
 */
export function saveAnalysisState(state: AnalysisPageState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ANALYSIS_STATE, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save analysis state:', error);
  }
}

/**
 * Load analysis page state from localStorage
 */
export function loadAnalysisState(): AnalysisPageState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ANALYSIS_STATE);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load analysis state:', error);
    return null;
  }
}

/**
 * Clear analysis state from localStorage
 */
export function clearAnalysisStateStorage(): void {
  localStorage.removeItem(STORAGE_KEYS.ANALYSIS_STATE);
}

// ============================================================================
// Active Tab Persistence (localStorage)
// ============================================================================

// Import the actual TabState type from TabNavigation
import { TabState } from '../components/layout/TabNavigation';
export type { TabState };

/**
 * Save active tab to localStorage
 */
export function saveActiveTab(tab: TabState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, JSON.stringify(tab));
  } catch (error) {
    console.error('Failed to save active tab:', error);
  }
}

/**
 * Load active tab from localStorage
 */
export function loadActiveTab(): TabState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load active tab:', error);
    return null;
  }
}

// ============================================================================
// Analysis Data IDs Persistence (localStorage)
// ============================================================================

/**
 * Save analysis data document IDs to localStorage
 * We only store IDs to avoid duplicating large data
 */
export function saveAnalysisDataIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ANALYSIS_DATA_IDS, JSON.stringify(ids));
  } catch (error) {
    console.error('Failed to save analysis data IDs:', error);
  }
}

/**
 * Load analysis data document IDs from localStorage
 */
export function loadAnalysisDataIds(): string[] | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ANALYSIS_DATA_IDS);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load analysis data IDs:', error);
    return null;
  }
}

/**
 * Clear analysis data IDs from localStorage
 */
export function clearAnalysisDataIdsStorage(): void {
  localStorage.removeItem(STORAGE_KEYS.ANALYSIS_DATA_IDS);
}

// ============================================================================
// IndexedDB Utilities for PDF Files
// ============================================================================

/**
 * Open the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create PDF store if it doesn't exist
      if (!db.objectStoreNames.contains(PDF_STORE)) {
        db.createObjectStore(PDF_STORE, { keyPath: 'name' });
      }

      // Create Doc Classification PDF store if it doesn't exist
      if (!db.objectStoreNames.contains(DOC_CLASSIFICATION_PDF_STORE)) {
        db.createObjectStore(DOC_CLASSIFICATION_PDF_STORE, { keyPath: 'name' });
      }
    };
  });
}

/**
 * Save PDF files to IndexedDB
 */
export async function savePdfFiles(files: PdfFile[]): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(PDF_STORE, 'readwrite');
    const store = transaction.objectStore(PDF_STORE);

    // Clear existing files first
    store.clear();

    // Store each file
    for (const file of files) {
      const storedFile: StoredPdfFile = {
        name: file.name,
        data: Array.from(file.data), // Convert Uint8Array to regular array
        isCorrupted: file.isCorrupted,
        errorMessage: file.errorMessage,
      };
      store.put(storedFile);
    }

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(new Error('Failed to save PDF files'));
      };
    });
  } catch (error) {
    console.error('Failed to save PDF files to IndexedDB:', error);
    throw error;
  }
}

/**
 * Load PDF files from IndexedDB
 */
export async function loadPdfFiles(): Promise<PdfFile[]> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(PDF_STORE, 'readonly');
    const store = transaction.objectStore(PDF_STORE);

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        db.close();
        const storedFiles: StoredPdfFile[] = request.result;
        const files: PdfFile[] = storedFiles.map(stored => ({
          name: stored.name,
          data: new Uint8Array(stored.data), // Convert back to Uint8Array
          isCorrupted: stored.isCorrupted,
          errorMessage: stored.errorMessage,
        }));
        resolve(files);
      };

      request.onerror = () => {
        db.close();
        reject(new Error('Failed to load PDF files'));
      };
    });
  } catch (error) {
    console.error('Failed to load PDF files from IndexedDB:', error);
    return [];
  }
}

/**
 * Clear PDF files from IndexedDB
 */
export async function clearPdfFiles(): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(PDF_STORE, 'readwrite');
    const store = transaction.objectStore(PDF_STORE);
    store.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(new Error('Failed to clear PDF files'));
      };
    });
  } catch (error) {
    console.error('Failed to clear PDF files from IndexedDB:', error);
  }
}

// ============================================================================
// Clear All Session Data
// ============================================================================

/**
 * Clear all persisted session data (both localStorage and IndexedDB)
 */
export async function clearAllSessionData(): Promise<void> {
  // Clear localStorage
  localStorage.removeItem(STORAGE_KEYS.REVIEWED_DOCUMENTS);
  localStorage.removeItem(STORAGE_KEYS.ANALYSIS_STATE);
  localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
  localStorage.removeItem(STORAGE_KEYS.ANALYSIS_DATA_IDS);

  // Clear IndexedDB
  await clearPdfFiles();
}

/**
 * Check if there is any saved session data
 */
export async function hasSessionData(): Promise<boolean> {
  const hasReviewed = localStorage.getItem(STORAGE_KEYS.REVIEWED_DOCUMENTS) !== null;
  const hasState = localStorage.getItem(STORAGE_KEYS.ANALYSIS_STATE) !== null;

  let hasPdfs = false;
  try {
    const pdfs = await loadPdfFiles();
    hasPdfs = pdfs.length > 0;
  } catch {
    // Ignore errors
  }

  return hasReviewed || hasState || hasPdfs;
}

// ============================================================================
// Doc Classification Storage Functions
// ============================================================================

// Heavy per-document fields NOT persisted with reviews — the raw + parsed JSON blobs and all six
// SOR arrays. A single doc's payload can be tens of KB; 676 of them blow past the ~5MB localStorage
// quota and silently lose every review. These fields are only needed by the Details panel (which
// reads them from the live dataset) and re-hydrated on load by joining against docClassificationData,
// so dropping them from storage is lossless for the reviewer's own reviews.
const HEAVY_REVIEW_KEYS = [
  'docClassificationJsonRaw', 'docClassificationJson', 'vendorNameJsonRaw', 'vendorNameJson',
  'sorHintsNormalizedRaw', 'sorHintsNormalized', 'sorHintsExtractedRaw', 'sorHintsExtracted',
  'sorMasterNormalizedRaw', 'sorMasterNormalized', 'sorMasterExtractedRaw', 'sorMasterExtracted',
  'systemHintsNormalizedRaw', 'systemHintsNormalized', 'systemHintsExtractedRaw', 'systemHintsExtracted',
] as const;

/**
 * Save reviewed doc classifications to localStorage.
 * Returns false (and surfaces a console error) if the browser quota is exceeded, so callers/users
 * can be told instead of silently losing reviews.
 */
export function saveReviewedDocClassifications(docs: ReviewedDocClassification[]): boolean {
  try {
    const serialized = docs.map(doc => {
      const slim: Record<string, unknown> = {
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
        reviewedAt: doc.reviewedAt.toISOString(),
      };
      for (const k of HEAVY_REVIEW_KEYS) delete slim[k];
      return slim;
    });
    localStorage.setItem(STORAGE_KEYS.DOC_CLASSIFICATION_REVIEWED, JSON.stringify(serialized));
    return true;
  } catch (error) {
    const quota = error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    console.error(
      quota
        ? 'Reviews could not be saved: browser storage quota exceeded. Export your reviews to avoid losing them.'
        : 'Failed to save reviewed doc classifications:',
      error,
    );
    return false;
  }
}

/**
 * Load reviewed doc classifications from localStorage
 */
export function loadReviewedDocClassifications(): ReviewedDocClassification[] | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DOC_CLASSIFICATION_REVIEWED);
    if (!stored) return null;

    const serialized: SerializedReviewedDocClassification[] = JSON.parse(stored);
    return serialized.map(doc => ({
      ...doc,
      createdAt: new Date(doc.createdAt),
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : null,
      reviewedAt: new Date(doc.reviewedAt),
    }));
  } catch (error) {
    console.error('Failed to load reviewed doc classifications:', error);
    return null;
  }
}

/**
 * Clear reviewed doc classifications from localStorage
 */
export function clearReviewedDocClassificationsStorage(): void {
  localStorage.removeItem(STORAGE_KEYS.DOC_CLASSIFICATION_REVIEWED);
}

/**
 * Save doc classification PDF files to IndexedDB
 */
export async function saveDocClassificationPdfFiles(files: PdfFile[]): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(DOC_CLASSIFICATION_PDF_STORE, 'readwrite');
    const store = transaction.objectStore(DOC_CLASSIFICATION_PDF_STORE);

    // Convert Uint8Array to regular array for JSON serialization
    const storedFiles: StoredPdfFile[] = files.map(file => ({
      name: file.name,
      data: Array.from(file.data),
      isCorrupted: file.isCorrupted,
      errorMessage: file.errorMessage,
    }));

    // Clear existing files and add new ones
    store.clear();
    storedFiles.forEach(file => store.add(file));

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(new Error('Failed to save doc classification PDF files'));
      };
    });
  } catch (error) {
    console.error('Failed to save doc classification PDF files to IndexedDB:', error);
  }
}

/**
 * Load doc classification PDF files from IndexedDB
 */
export async function loadDocClassificationPdfFiles(): Promise<PdfFile[]> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(DOC_CLASSIFICATION_PDF_STORE, 'readonly');
    const store = transaction.objectStore(DOC_CLASSIFICATION_PDF_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        const storedFiles = request.result as StoredPdfFile[];

        // Convert regular array back to Uint8Array
        const pdfFiles: PdfFile[] = storedFiles.map(file => ({
          name: file.name,
          data: new Uint8Array(file.data),
          isCorrupted: file.isCorrupted,
          errorMessage: file.errorMessage,
        }));

        resolve(pdfFiles);
      };
      request.onerror = () => {
        db.close();
        reject(new Error('Failed to load doc classification PDF files'));
      };
    });
  } catch (error) {
    console.error('Failed to load doc classification PDF files from IndexedDB:', error);
    return [];
  }
}

/**
 * Clear doc classification PDF files from IndexedDB
 */
export async function clearDocClassificationPdfFiles(): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(DOC_CLASSIFICATION_PDF_STORE, 'readwrite');
    const store = transaction.objectStore(DOC_CLASSIFICATION_PDF_STORE);
    store.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(new Error('Failed to clear doc classification PDF files'));
      };
    });
  } catch (error) {
    console.error('Failed to clear doc classification PDF files from IndexedDB:', error);
  }
}

/**
 * Clear all doc classification session data
 */
export async function clearDocClassificationSession(): Promise<void> {
  clearReviewedDocClassificationsStorage();
  await clearDocClassificationPdfFiles();
}

/**
 * Check if there is any saved doc classification session data
 */
export async function hasDocClassificationSessionData(): Promise<boolean> {
  const hasReviewed = localStorage.getItem(STORAGE_KEYS.DOC_CLASSIFICATION_REVIEWED) !== null;

  let hasPdfs = false;
  try {
    const pdfs = await loadDocClassificationPdfFiles();
    hasPdfs = pdfs.length > 0;
  } catch {
    // Ignore errors
  }

  return hasReviewed || hasPdfs;
}
