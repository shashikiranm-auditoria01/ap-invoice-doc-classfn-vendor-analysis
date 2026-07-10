import React from 'react';
import { AlertCircle, CheckCircle, Info, XCircle, X } from 'lucide-react';

type AlertType = 'info' | 'success' | 'warning' | 'error';

interface AlertBannerProps {
  type: AlertType;
  title?: string;
  message: string;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const alertStyles: Record<AlertType, {
  bg: string;
  border: string;
  text: string;
  icon: typeof Info;
}> = {
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: Info,
  },
  success: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    icon: CheckCircle,
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: AlertCircle,
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: XCircle,
  },
};

export function AlertBanner({
  type,
  title,
  message,
  onClose,
  action,
  className = '',
}: AlertBannerProps) {
  const styles = alertStyles[type];
  const Icon = styles.icon;

  return (
    <div
      className={`
        flex items-start gap-3 p-4 rounded-lg border
        ${styles.bg} ${styles.border}
        ${className}
      `}
      role="alert"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${styles.text}`} />
      
      <div className="flex-1 min-w-0">
        {title && (
          <h4 className={`font-medium ${styles.text}`}>{title}</h4>
        )}
        <p className={`text-sm ${styles.text} ${title ? 'mt-1' : ''}`}>
          {message}
        </p>
        {action && (
          <button
            onClick={action.onClick}
            className={`mt-2 text-sm font-medium underline hover:no-underline ${styles.text}`}
          >
            {action.label}
          </button>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className={`p-1 rounded hover:bg-black/5 ${styles.text}`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

// No data alert specifically for filter results
interface NoDataAlertProps {
  onClearFilters?: () => void;
  className?: string;
}

export function NoDataAlert({ onClearFilters, className = '' }: NoDataAlertProps) {
  return (
    <AlertBanner
      type="warning"
      title="No data found"
      message="No data found for the selected filters. Try adjusting your criteria."
      action={onClearFilters ? {
        label: 'Clear Filters',
        onClick: onClearFilters,
      } : undefined}
      className={className}
    />
  );
}
