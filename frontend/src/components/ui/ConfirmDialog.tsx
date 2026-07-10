import { useEffect, useState } from 'react';
import { X, AlertTriangle, AlertCircle } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  details?: string;
  variant?: 'danger' | 'warning';
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  details,
  variant = 'danger',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isLoading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isLoading, onClose]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error('Error in confirm action:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      icon: AlertCircle,
      iconColor: 'text-red-600',
      iconBg: 'bg-red-50',
      buttonClass: 'bg-red-600 hover:bg-red-700 text-white',
    },
    warning: {
      icon: AlertTriangle,
      iconColor: 'text-yellow-600',
      iconBg: 'bg-yellow-50',
      buttonClass: 'bg-yellow-600 hover:bg-yellow-700 text-white',
    },
  };

  const style = variantStyles[variant];
  const Icon = style.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={() => !isLoading && onClose()}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-full ${style.iconBg}`}>
              <Icon className={`w-5 h-5 ${style.iconColor}`} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          <p className="text-sm text-slate-600">{message}</p>
          {details && (
            <div className="mt-3 p-3 bg-slate-50 rounded text-xs text-slate-500 font-mono">
              {details}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-200 bg-slate-50">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isLoading}
            loading={isLoading}
            className={style.buttonClass}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
