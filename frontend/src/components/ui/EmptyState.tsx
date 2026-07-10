import React from 'react';
import { FileQuestion, Search, Filter } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 text-center ${className}`}>
      {icon && (
        <div className="mb-4 text-slate-400">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-slate-900 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <Button variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Pre-configured empty states
export function NoResultsEmpty({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <EmptyState
      icon={<Search className="w-12 h-12" />}
      title="No results found"
      description="Try adjusting your search or filter criteria to find what you're looking for."
      action={onClearFilters ? {
        label: 'Clear Filters',
        onClick: onClearFilters,
      } : undefined}
    />
  );
}

export function NoDataEmpty() {
  return (
    <EmptyState
      icon={<FileQuestion className="w-12 h-12" />}
      title="No data available"
      description="There's no data to display at the moment."
    />
  );
}

export function NoFiltersEmpty() {
  return (
    <EmptyState
      icon={<Filter className="w-12 h-12" />}
      title="Select filters to view data"
      description="Use the filters above to narrow down the results."
    />
  );
}
