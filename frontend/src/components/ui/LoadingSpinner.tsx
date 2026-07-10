import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <Loader2 className={`animate-spin text-blue-500 ${sizeClasses[size]} ${className}`} />
  );
}

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <LoadingSpinner size="lg" />
      <p className="mt-4 text-sm text-slate-500">{message}</p>
    </div>
  );
}

// Skeleton loaders
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-6 animate-pulse ${className}`}>
      <div className="h-4 bg-slate-200 rounded w-1/3 mb-3" />
      <div className="h-8 bg-slate-200 rounded w-1/2 mb-2" />
      <div className="h-3 bg-slate-200 rounded w-2/3" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      <div className="h-10 bg-slate-200 rounded mb-2" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-slate-100 rounded mb-1" />
      ))}
    </div>
  );
}

export function SkeletonChart({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-6 animate-pulse ${className}`}>
      <div className="h-4 bg-slate-200 rounded w-1/4 mb-4" />
      <div className="h-48 bg-slate-100 rounded" />
    </div>
  );
}
