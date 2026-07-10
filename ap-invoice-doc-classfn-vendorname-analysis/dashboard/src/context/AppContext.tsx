import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  saveReviewedDocClassifications,
  loadReviewedDocClassifications,
} from '../utils/storage';
import { PdfFile } from '../components/analysis/ZipHandler';
import { DocClassificationDocument, ReviewedDocClassification, DocClassificationReview } from '../types/docClassification';
import { getData, GetDataParams } from '../services/dataSource';

interface AppContextState {
  // Initialization
  isInitialized: boolean;
  initError: string | null;

  // Pre-load "Get Data" gate: the dashboard renders only after data is chosen & loaded.
  dataGatePassed: boolean;
  setDataGatePassed: (passed: boolean) => void;
  activeSelection: { kind: 'regular' | 'mismatch'; scenario?: string; tenantName: string; from: string; to: string } | null;
  loadDataset: (params: GetDataParams) => Promise<{ count: number; source?: string }>;

  // Doc Classification data (uploaded Excel)
  docClassificationData: DocClassificationDocument[];
  setDocClassificationData: (data: DocClassificationDocument[]) => void;
  clearDocClassificationData: () => void;

  // Reviewed doc classifications
  reviewedDocClassifications: ReviewedDocClassification[];
  addReviewedDocClassification: (doc: DocClassificationDocument, review: DocClassificationReview, opts?: { reviewedAt?: Date; isAutoReviewed?: boolean }) => void;
  removeReviewedDocClassification: (documentId: string) => void;
  removeReviewedDocClassifications: (documentIds: string[]) => void;
  clearReviewedDocClassifications: () => void;
  isDocClassificationReviewed: (documentId: string) => boolean;
  getReviewedDocClassification: (documentId: string) => ReviewedDocClassification | null;

  // Doc Classification PDF files
  docClassificationPdfFiles: PdfFile[];
  setDocClassificationPdfFiles: (files: PdfFile[]) => void;
  addDocClassificationPdfFiles: (files: PdfFile[]) => void;
  clearDocClassificationPdfFiles: () => void;

  // Email Sender modal (opened from the header button, rendered app-wide)
  emailSenderOpen: boolean;
  setEmailSenderOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextState | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [isInitialized, setIsInitialized] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // Doc Classification data state
  const [docClassificationData, setDocClassificationDataState] = useState<DocClassificationDocument[]>([]);

  // Reviewed doc classifications state - persisted to localStorage
  const [reviewedDocClassifications, setReviewedDocClassifications] = useState<ReviewedDocClassification[]>(() => {
    const saved = loadReviewedDocClassifications();
    return saved || [];
  });

  // Persist reviewed doc classifications to localStorage when they change. If the browser quota
  // is hit, warn the user ONCE (not on every keystroke) so they can export before losing work.
  const quotaWarnedRef = useRef(false);
  useEffect(() => {
    const ok = saveReviewedDocClassifications(reviewedDocClassifications);
    if (!ok && !quotaWarnedRef.current) {
      quotaWarnedRef.current = true;
      toast.error('Reviews could not be saved — browser storage is full. Export your reviews to avoid losing them.', { duration: 8000 });
    } else if (ok) {
      quotaWarnedRef.current = false;
    }
  }, [reviewedDocClassifications]);

  // Email Sender modal open state (app-wide)
  const [emailSenderOpen, setEmailSenderOpen] = useState(false);

  // Doc Classification PDF files state - in memory only
  const [docClassificationPdfFilesState, setDocClassificationPdfFilesState] = useState<PdfFile[]>([]);

  // Pre-load gate: the dashboard renders only after the user picks a tenant + created_at range
  // and clicks "Get Data" (or uploads their own file). No auto-seed on startup.
  const [dataGatePassed, setDataGatePassed] = useState(false);
  const [activeSelection, setActiveSelection] = useState<{ kind: 'regular' | 'mismatch'; scenario?: string; tenantName: string; from: string; to: string } | null>(null);

  // Merge freshly-loaded documents' heavy JSON/SOR fields back into persisted reviews (storage strips
  // them to stay under the localStorage quota). Reviews for docs not in this dataset are untouched.
  const rehydrateReviews = useCallback((documents: DocClassificationDocument[]) => {
    const docById = new Map(documents.map(d => [d.documentId, d]));
    setReviewedDocClassifications(prev => prev.map(r => {
      const doc = docById.get(r.documentId);
      // Spread `doc` LAST so the freshly-loaded document fields (status columns AND the heavy
      // JSON/SOR blobs that storage strips) win; the review-only fields (isAnInvoice, reviewedAt,
      // …) exist only on `r` and survive. Avoids a stale scalar snapshot in `r` overriding the
      // current dataset and disagreeing with the Metrics tab.
      return doc ? { ...r, ...doc } : r;
    }));
  }, []);

  // Fetch documents for the chosen tenant + created_at range via the data-source seam, load them,
  // rehydrate reviews, and open the dashboard.
  const loadDataset = useCallback(async (params: GetDataParams) => {
    const result = await getData(params);
    // Don't open an empty dashboard — if nothing matched, stay on the gate so the user can widen
    // the range (the gate shows a "no documents found" message from the returned count).
    if (result.documents.length === 0) return { count: 0, source: result.sourceFile };
    setDocClassificationDataState(result.documents);
    rehydrateReviews(result.documents);
    setActiveSelection({ kind: params.kind, scenario: params.scenario, tenantName: params.tenantName, from: params.from, to: params.to });
    setDataGatePassed(true);
    return { count: result.documents.length, source: result.sourceFile };
  }, [rehydrateReviews]);

  // Set doc classification data (used by manual Excel upload). Rehydrate reviews and pass the gate.
  const setDocClassificationData = useCallback((data: DocClassificationDocument[]) => {
    setDocClassificationDataState(data);
    rehydrateReviews(data);
    if (data.length > 0) {
      // Only stamp a fresh (regular/upload) selection when there ISN'T already an active one — an
      // in-session "Upload Excel" that merges into a Mismatch dataset must NOT relabel the context
      // bar to "Daily Data Review" or drop the scenario/date range.
      setActiveSelection(prev => prev ?? { kind: 'regular', tenantName: data[0]?.tenantName || 'Uploaded file', from: '', to: '' });
      setDataGatePassed(true);
    }
  }, [rehydrateReviews]);

  // Clear doc classification data — return to the "Get Data" gate.
  const clearDocClassificationData = useCallback(() => {
    setDocClassificationDataState([]);
    setActiveSelection(null);
    setDataGatePassed(false);
  }, []);

  // Add a reviewed doc classification.
  // `opts` lets a resume-restore preserve the original reviewedAt / auto-reviewed flag
  // instead of stamping "now" and defaulting to manual.
  const addReviewedDocClassification = useCallback((
    doc: DocClassificationDocument,
    review: DocClassificationReview,
    opts?: { reviewedAt?: Date; isAutoReviewed?: boolean }
  ) => {
    const reviewedDoc: ReviewedDocClassification = {
      ...doc,
      ...review,
      reviewedAt: opts?.reviewedAt ?? new Date(),
      ...(opts?.isAutoReviewed !== undefined ? { isAutoReviewed: opts.isAutoReviewed } : {}),
    };

    setReviewedDocClassifications(prev => {
      // Remove existing review for same document if exists
      const filtered = prev.filter(d => d.documentId !== doc.documentId);
      return [...filtered, reviewedDoc];
    });
  }, []);

  // Remove a reviewed doc classification
  const removeReviewedDocClassification = useCallback((documentId: string) => {
    setReviewedDocClassifications(prev => prev.filter(d => d.documentId !== documentId));
  }, []);

  // Remove many reviews at once (e.g. "clear reviews for the loaded dataset") in a single update.
  const removeReviewedDocClassifications = useCallback((documentIds: string[]) => {
    const ids = new Set(documentIds);
    setReviewedDocClassifications(prev => prev.filter(d => !ids.has(d.documentId)));
  }, []);

  // Clear all reviewed doc classifications
  const clearReviewedDocClassifications = useCallback(() => {
    setReviewedDocClassifications([]);
  }, []);

  // Check if a doc classification is reviewed (requires isAnInvoice to be set — incomplete reviews don't count)
  const isDocClassificationReviewed = useCallback((documentId: string): boolean => {
    return reviewedDocClassifications.some(d => d.documentId === documentId && !!d.isAnInvoice);
  }, [reviewedDocClassifications]);

  // Get review data for a specific document
  const getReviewedDocClassification = useCallback((documentId: string): ReviewedDocClassification | null => {
    return reviewedDocClassifications.find(d => d.documentId === documentId) || null;
  }, [reviewedDocClassifications]);

  // Set doc classification PDF files (replace all)
  const setDocClassificationPdfFiles = useCallback((files: PdfFile[]) => {
    setDocClassificationPdfFilesState(files);
  }, []);

  // Add doc classification PDF files — append to what's already loaded, de-duplicating by
  // filename so a second ZIP/PDF upload adds to (rather than replaces) the first batch.
  const addDocClassificationPdfFiles = useCallback((files: PdfFile[]) => {
    setDocClassificationPdfFilesState(prev => {
      const byName = new Map(prev.map(p => [p.name, p]));
      files.forEach(f => byName.set(f.name, f)); // newer file with same name wins
      return Array.from(byName.values());
    });
  }, []);

  // Clear all doc classification PDF files
  const clearDocClassificationPdfFiles = useCallback(() => {
    setDocClassificationPdfFilesState([]);
  }, []);

  const value: AppContextState = {
    isInitialized,
    initError,
    dataGatePassed,
    setDataGatePassed,
    activeSelection,
    loadDataset,
    docClassificationData,
    setDocClassificationData,
    clearDocClassificationData,
    reviewedDocClassifications,
    addReviewedDocClassification,
    removeReviewedDocClassification,
    removeReviewedDocClassifications,
    clearReviewedDocClassifications,
    isDocClassificationReviewed,
    getReviewedDocClassification,
    docClassificationPdfFiles: docClassificationPdfFilesState,
    setDocClassificationPdfFiles,
    addDocClassificationPdfFiles,
    clearDocClassificationPdfFiles,
    emailSenderOpen,
    setEmailSenderOpen,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextState {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
