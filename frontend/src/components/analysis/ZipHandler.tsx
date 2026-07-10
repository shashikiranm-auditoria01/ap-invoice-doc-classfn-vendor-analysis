import { useState, useCallback, useRef } from 'react';
import { FileArchive, CheckCircle, AlertTriangle, Loader2, X } from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '../ui/Button';

export interface PdfFile {
  name: string;
  data: Uint8Array;  // Changed from ArrayBuffer - Uint8Array doesn't get detached
  isCorrupted: boolean;
  errorMessage?: string;
}

interface ZipHandlerProps {
  onPdfsLoaded: (pdfs: PdfFile[]) => void;
  onCorruptedPdfs?: (corrupted: PdfFile[]) => void;
  isLoading?: boolean;
}

// Check if a file is a valid PDF by checking the header
function isPdfValid(data: Uint8Array): { valid: boolean; error?: string } {
  try {
    const header = data.slice(0, 8);
    const headerString = String.fromCharCode(...header);
    
    // PDF files should start with %PDF-
    if (!headerString.startsWith('%PDF-')) {
      return { valid: false, error: 'Invalid PDF header' };
    }
    
    // Check minimum size (a valid PDF should be at least a few hundred bytes)
    if (data.byteLength < 100) {
      return { valid: false, error: 'File too small to be a valid PDF' };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Failed to read file' };
  }
}

export function ZipHandler({ onPdfsLoaded, onCorruptedPdfs, isLoading }: ZipHandlerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; zipName?: string } | null>(null);
  const [loadedFiles, setLoadedFiles] = useState<{ valid: number; corrupted: number; zipCount: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Process a single ZIP file and return the results
  const processSingleZip = useCallback(async (file: File): Promise<{ valid: PdfFile[]; corrupted: PdfFile[] }> => {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Get all PDF files from the ZIP
    const pdfEntries: { name: string; file: JSZip.JSZipObject }[] = [];

    zip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir && relativePath.toLowerCase().endsWith('.pdf')) {
        pdfEntries.push({ name: relativePath, file: zipEntry });
      }
    });

    const validPdfs: PdfFile[] = [];
    const corruptedPdfs: PdfFile[] = [];

    // Process each PDF
    for (const entry of pdfEntries) {
      try {
        // Get data as Uint8Array directly - this doesn't get detached like ArrayBuffer
        const uint8Data = await entry.file.async('uint8array');
        const validation = isPdfValid(uint8Data);

        // Get just the filename without path
        const filename = entry.name.split('/').pop() || entry.name;

        if (validation.valid) {
          validPdfs.push({
            name: filename,
            data: uint8Data,
            isCorrupted: false,
          });
        } else {
          corruptedPdfs.push({
            name: filename,
            data: uint8Data,
            isCorrupted: true,
            errorMessage: validation.error,
          });
        }
      } catch (error) {
        const filename = entry.name.split('/').pop() || entry.name;
        corruptedPdfs.push({
          name: filename,
          data: new Uint8Array(0),
          isCorrupted: true,
          errorMessage: error instanceof Error ? error.message : 'Failed to extract file',
        });
      }
    }

    return { valid: validPdfs, corrupted: corruptedPdfs };
  }, []);

  // Process multiple ZIP files
  const processZipFiles = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    setProgress(null);
    setLoadedFiles(null);

    const allValidPdfs: PdfFile[] = [];
    const allCorruptedPdfs: PdfFile[] = [];
    let totalZipsProcessed = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({ current: i + 1, total: files.length, zipName: file.name });

        try {
          const { valid, corrupted } = await processSingleZip(file);
          allValidPdfs.push(...valid);
          allCorruptedPdfs.push(...corrupted);
          totalZipsProcessed++;
        } catch (error) {
          console.error(`Failed to process ZIP file ${file.name}:`, error);
          // Continue processing other files
        }
      }

      if (allValidPdfs.length === 0 && allCorruptedPdfs.length === 0) {
        alert('No PDF files found in the selected ZIP archive(s)');
        setIsProcessing(false);
        return;
      }

      setLoadedFiles({
        valid: allValidPdfs.length,
        corrupted: allCorruptedPdfs.length,
        zipCount: totalZipsProcessed,
      });

      // Send all PDFs (valid + corrupted) — corrupted ones may still render
      // as images via the fallback renderer in PDFViewer
      onPdfsLoaded([...allValidPdfs, ...allCorruptedPdfs]);
      if (onCorruptedPdfs && allCorruptedPdfs.length > 0) {
        onCorruptedPdfs(allCorruptedPdfs);
      }
    } catch (error) {
      console.error('Failed to process ZIP files:', error);
      alert(`Failed to process ZIP files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [processSingleZip, onPdfsLoaded, onCorruptedPdfs]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      // Filter for ZIP files only
      const zipFiles: File[] = [];
      for (let i = 0; i < droppedFiles.length; i++) {
        if (droppedFiles[i].name.toLowerCase().endsWith('.zip')) {
          zipFiles.push(droppedFiles[i]);
        }
      }

      if (zipFiles.length === 0) {
        alert('Please upload ZIP file(s)');
        return;
      }

      processZipFiles(zipFiles);
    }
  }, [processZipFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Filter for ZIP files only
      const zipFiles: File[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        if (e.target.files[i].name.toLowerCase().endsWith('.zip')) {
          zipFiles.push(e.target.files[i]);
        }
      }

      if (zipFiles.length === 0) {
        alert('Please upload ZIP file(s)');
        e.target.value = '';
        return;
      }

      processZipFiles(zipFiles);
    }
    e.target.value = '';
  }, [processZipFiles]);

  const clearFiles = useCallback(() => {
    setLoadedFiles(null);
    onPdfsLoaded([]);
  }, [onPdfsLoaded]);

  return (
    <div className="space-y-2">
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-lg p-4 text-center cursor-pointer
          transition-colors duration-200
          ${isDragging 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
          }
          ${isProcessing || isLoading ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          multiple
          onChange={handleInputChange}
          className="hidden"
        />

        <div className="flex items-center justify-center gap-3">
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              {progress && (
                <div className="text-sm text-slate-600">
                  <p>Processing ZIP {progress.current} of {progress.total}...</p>
                  {progress.zipName && (
                    <p className="text-xs text-slate-500 truncate max-w-[200px]">{progress.zipName}</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <FileArchive className="w-5 h-5 text-slate-400" />
              <p className="text-sm text-slate-600">
                Drop ZIP file(s) here or <span className="text-blue-600 font-medium">click to upload</span>
                <span className="text-slate-400 text-xs block">Multiple ZIP files supported</span>
              </p>
            </>
          )}
        </div>
      </div>

      {/* Loaded Files Summary */}
      {loadedFiles && (
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div className="flex items-center gap-4">
            {loadedFiles.zipCount > 1 && (
              <div className="flex items-center gap-2">
                <FileArchive className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-blue-700">
                  {loadedFiles.zipCount} ZIPs
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-slate-700">
                {loadedFiles.valid} valid PDFs
              </span>
            </div>
            {loadedFiles.corrupted > 0 && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-amber-700">
                  {loadedFiles.corrupted} non-standard (image fallback)
                </span>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFiles}
            leftIcon={<X className="w-3 h-3" />}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
