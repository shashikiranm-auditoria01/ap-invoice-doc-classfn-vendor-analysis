import { useState, useEffect, useRef, useCallback } from 'react';
import { pdfjs } from 'react-pdf';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileText,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Button } from '../ui/Button';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  pdfData: Uint8Array | null;
  filename?: string;
  onTextExtracted?: (text: string) => void;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const DEFAULT_ZOOM_INDEX = 5; // 200%
const ZOOM_STORAGE_KEY = 'pdf-viewer-zoom-index';

// Get initial zoom from sessionStorage or use default
const getInitialZoomIndex = (): number => {
  try {
    const stored = sessionStorage.getItem(ZOOM_STORAGE_KEY);
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < ZOOM_LEVELS.length) {
        return parsed;
      }
    }
  } catch (e) {
    // SessionStorage not available or error
  }
  return DEFAULT_ZOOM_INDEX;
};

// Try multiple MIME types to render raw bytes as an image
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/tiff', 'image/bmp', 'image/webp'];

function tryCreateImageUrl(data: Uint8Array): Promise<string | null> {
  return new Promise((resolve) => {
    let attempted = 0;

    function tryNext() {
      if (attempted >= IMAGE_MIME_TYPES.length) {
        resolve(null);
        return;
      }
      const mime = IMAGE_MIME_TYPES[attempted++];
      const blob = new Blob([new Uint8Array(data)], { type: mime });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => {
        URL.revokeObjectURL(url);
        tryNext();
      };
      img.src = url;
    }

    tryNext();
  });
}

export function PDFViewer({ pdfData, filename, onTextExtracted }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [zoomIndex, setZoomIndex] = useState<number>(getInitialZoomIndex());
  const [rotation, setRotation] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPdfDataRef = useRef<Uint8Array | null>(null);

  const scale = ZOOM_LEVELS[zoomIndex];

  // Save zoom level to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(ZOOM_STORAGE_KEY, zoomIndex.toString());
    } catch (e) {
      // SessionStorage not available or error
    }
  }, [zoomIndex]);

  // Load PDF document when pdfData changes
  useEffect(() => {
    if (!pdfData) {
      pdfDocRef.current = null;
      setNumPages(0);
      setPageNumber(1);
      setError(null);
      setFallbackImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      prevPdfDataRef.current = null;
      return;
    }

    // Only reload if data actually changed
    if (pdfData === prevPdfDataRef.current) {
      return;
    }

    prevPdfDataRef.current = pdfData;
    setLoading(true);
    setError(null);
    setFallbackImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });

    // Create a fresh copy of the data to avoid detachment issues
    const dataCopy = pdfData.slice();

    const loadPdf = async () => {
      try {
        // Destroy previous document if exists
        if (pdfDocRef.current) {
          await pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const loadingTask = pdfjs.getDocument({ data: dataCopy });
        const pdf = await loadingTask.promise;

        pdfDocRef.current = pdf;

        // Set all state at once, then render after a small delay
        // to ensure state is settled
        setNumPages(pdf.numPages);
        setPageNumber(1);
        // Don't reset zoom - preserve user's zoom preference from sessionStorage
        setRotation(0);
        setLoading(false);

        // Explicitly render the first page at 150% zoom after state updates
        // Use setTimeout to ensure React has processed state updates
        setTimeout(async () => {
          if (!canvasRef.current || !pdfDocRef.current) return;
          try {
            const page = await pdf.getPage(1);
            const canvas = canvasRef.current;
            if (!canvas) return;
            const context = canvas.getContext('2d');
            if (!context) return;

            // Use DEFAULT_ZOOM_INDEX directly (150%)
            const initialScale = ZOOM_LEVELS[DEFAULT_ZOOM_INDEX];
            const viewport = page.getViewport({ scale: initialScale, rotation: 0 });

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            context.clearRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: context, viewport, canvas }).promise;
          } catch (err) {
            console.error('Failed to render initial page:', err);
          }
        }, 100);
      } catch (err) {
        console.error('Failed to load PDF, trying image fallback:', err);
        // Try rendering the raw bytes as an image (PNG, JPEG, etc.)
        const imageUrl = await tryCreateImageUrl(dataCopy);
        if (imageUrl) {
          setFallbackImageUrl(imageUrl);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
        }
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      // Cleanup on unmount or when pdfData changes
      // Note: we don't destroy here to allow re-use on quick tab switches
      // The main cleanup happens in the unmount effect
    };
  }, [pdfData]);

  // Render current page to canvas
  const renderPage = useCallback(async () => {
    if (!pdfDocRef.current || !canvasRef.current) return;

    // Cancel any pending render
    if (renderTaskRef.current) {
      clearTimeout(renderTaskRef.current);
    }

    // Get the current scale from zoomIndex directly to ensure we use the latest value
    const currentScale = ZOOM_LEVELS[zoomIndex];

    // Debounce rendering to avoid too many renders during zoom/page changes
    renderTaskRef.current = setTimeout(async () => {
      try {
        const pdf = pdfDocRef.current;
        if (!pdf) return;

        const page = await pdf.getPage(pageNumber);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Calculate viewport with rotation
        const viewport = page.getViewport({ scale: currentScale, rotation });

        // Set canvas dimensions
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Render page
        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas,
        };

        await page.render(renderContext).promise;
      } catch (err) {
        console.error('Failed to render page:', err);
      }
    }, 50);
  }, [pageNumber, zoomIndex, rotation]);

  // Render page when dependencies change
  useEffect(() => {
    if (pdfDocRef.current && numPages > 0) {
      renderPage();
    }
  }, [renderPage, numPages]);

  // Extract text for search
  useEffect(() => {
    if (!pdfData || !onTextExtracted) return;

    let cancelled = false;

    const extractText = async () => {
      try {
        const dataCopy = pdfData.slice();
        const loadingTask = pdfjs.getDocument({ data: dataCopy });
        const pdf = await loadingTask.promise;

        if (cancelled) {
          await pdf.destroy();
          return;
        }

        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) break;
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: unknown) => {
              const textItem = item as { str?: string };
              return textItem.str || '';
            })
            .join(' ');
          fullText += pageText + '\n';
        }

        await pdf.destroy();

        if (!cancelled) {
          onTextExtracted(fullText);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to extract text:', err);
        }
      }
    };

    extractText();

    return () => {
      cancelled = true;
    };
  }, [pdfData, onTextExtracted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        clearTimeout(renderTaskRef.current);
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
      }
      setFallbackImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, []);

  const goToPrevPage = () => setPageNumber(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setPageNumber(prev => Math.min(numPages, prev + 1));

  const handleZoomIn = () => setZoomIndex(prev => Math.min(ZOOM_LEVELS.length - 1, prev + 1));
  const handleZoomOut = () => setZoomIndex(prev => Math.max(0, prev - 1));

  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  const toggleFullscreen = () => setIsFullscreen(prev => !prev);

  if (!pdfData) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-100 rounded-lg p-8">
        <FileText className="w-16 h-16 text-slate-300 mb-4" />
        <p className="text-slate-500 text-center">
          Select a PDF from the list to preview
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50 bg-white' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200 rounded-t-lg flex-shrink-0">
        <div className="flex items-center gap-2">
          {fallbackImageUrl ? (
            /* Image fallback mode — no page navigation */
            <span className="text-xs font-medium px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
              Image preview
            </span>
          ) : (
            <>
              {/* Page Navigation */}
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPrevPage}
                disabled={pageNumber <= 1 || loading}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-slate-600 min-w-[80px] text-center">
                {loading ? '...' : `${pageNumber} / ${numPages}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNextPage}
                disabled={pageNumber >= numPages || loading}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Zoom Controls */}
          <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={zoomIndex <= 0 || loading}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm text-slate-600 min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={zoomIndex >= ZOOM_LEVELS.length - 1 || loading}>
            <ZoomIn className="w-4 h-4" />
          </Button>

          {/* Rotate */}
          <div className="w-px h-4 bg-slate-300 mx-1" />
          <Button variant="ghost" size="sm" onClick={handleRotate} disabled={loading}>
            <RotateCw className="w-4 h-4" />
          </Button>

          {/* Fullscreen */}
          <Button variant="ghost" size="sm" onClick={toggleFullscreen}>
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Filename */}
      {filename && (
        <div className="px-3 py-1 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 truncate flex-shrink-0">
          {filename}
        </div>
      )}

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-slate-200 p-2 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full p-4">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
            <p className="text-slate-600 text-sm">Loading PDF...</p>
          </div>
        ) : fallbackImageUrl ? (
          /* Image fallback — pdfjs failed but raw bytes decoded as an image */
          <div className="flex justify-center">
            <img
              src={fallbackImageUrl}
              alt={filename ?? 'Document preview'}
              className="shadow-lg bg-white"
              style={{
                maxWidth: '100%',
                height: 'auto',
                transform: `rotate(${rotation}deg) scale(${scale})`,
                transformOrigin: 'top center',
                transition: 'transform 0.15s ease',
              }}
            />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-4">
            <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
            <p className="text-red-600 text-center font-medium mb-2">Failed to load document</p>
            <p className="text-red-500 text-sm text-center">{error}</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <canvas
              ref={canvasRef}
              className="shadow-lg bg-white"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
