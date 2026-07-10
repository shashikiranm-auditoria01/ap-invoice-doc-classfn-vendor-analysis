import { ReviewedDocClassification, DocClassificationDocument } from '../../types/docClassification';
import { Button } from '../ui/Button';
import { X, Download, Trash2, FileSpreadsheet } from 'lucide-react';
import { exportReviewedDocClassifications, exportAllDocClassifications } from '../../utils/docClassificationExport';
import { ReviewedTable } from './ReviewedTable';

interface DocClassificationReviewedSheetProps {
  reviewedDocs: ReviewedDocClassification[];
  allDocs: DocClassificationDocument[];
  onRemove: (documentId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

export function DocClassificationReviewedSheet({
  reviewedDocs,
  allDocs,
  onRemove,
  onClearAll,
  onClose,
}: DocClassificationReviewedSheetProps) {
  const handleExport = () => {
    exportReviewedDocClassifications(reviewedDocs);
  };

  const handleExportAll = () => {
    exportAllDocClassifications(allDocs, reviewedDocs);
  };

  const handleClearAll = () => {
    if (confirm(`Are you sure you want to clear all ${reviewedDocs.length} reviewed documents?`)) {
      onClearAll();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Reviewed Documents</h2>
            <p className="text-sm text-slate-600 mt-1">{reviewedDocs.length} documents reviewed</p>
          </div>
          <div className="flex items-center gap-2">
            {reviewedDocs.length > 0 && (
              <>
                <Button onClick={handleExportAll} variant="outline" size="sm">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Download All (with reviewed)
                </Button>
                <Button onClick={handleExport} variant="primary" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Download Reviewed Only
                </Button>
                <Button onClick={handleClearAll} variant="ghost" size="sm">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear All
                </Button>
              </>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <ReviewedTable reviewedDocs={reviewedDocs} onRemove={onRemove} />
        </div>
      </div>
    </div>
  );
}
