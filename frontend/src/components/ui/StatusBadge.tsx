import React from 'react';

// Simple status badge that accepts a status string directly
interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}

// Color mappings for different status values
const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  // On UI statuses
  'Active': { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  'Dismissed': { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
  // Written statuses
  'Written': { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  'No': { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
  // Manual statuses
  'Bot': { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  'Manual': { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  // Default
  'Unknown': { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
};

export function StatusBadge({
  status,
  size = 'sm',
  className = '',
}: StatusBadgeProps) {
  const colors = statusColors[status] || statusColors['Unknown'];

  const sizeClasses = size === 'sm' 
    ? 'px-2 py-0.5 text-xs' 
    : 'px-3 py-1 text-sm';

  return (
    <span
      className={`
        inline-flex items-center font-medium rounded-full
        border ${colors.bg} ${colors.text} ${colors.border}
        ${sizeClasses}
        ${className}
      `}
    >
      {status || 'Unknown'}
    </span>
  );
}

interface StatusDotProps {
  status: 'active' | 'dismissed' | 'unknown' | 'success' | 'warning' | 'error';
  label?: string;
  className?: string;
}

const dotColors: Record<StatusDotProps['status'], string> = {
  active: 'bg-green-500',
  dismissed: 'bg-red-500',
  unknown: 'bg-slate-400',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

export function StatusDot({ status, label, className = '' }: StatusDotProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`w-2 h-2 rounded-full ${dotColors[status]}`} />
      {label && <span className="text-sm text-slate-600">{label}</span>}
    </div>
  );
}
