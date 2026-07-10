import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
  valueClassName?: string;
  compact?: boolean;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-blue-500',
  trend,
  className = '',
  valueClassName = '',
  compact = false,
}: MetricCardProps) {
  return (
    <div className={`card ${compact ? 'p-5' : 'p-6'} ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-slate-500 mb-2 ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
          <p className={`font-semibold text-slate-900 tracking-tight truncate ${compact ? 'text-xl' : 'text-2xl'} ${valueClassName}`}>
            {value}
          </p>
          {subtitle && (
            <p className={`text-slate-500 mt-2 ${compact ? 'text-sm' : 'text-base'}`}>{subtitle}</p>
          )}
          {trend && (
            <div className={`flex items-center mt-3 text-sm ${
              trend.isPositive ? 'text-green-600' : 'text-red-600'
            }`}>
              <span>{trend.isPositive ? '↑' : '↓'}</span>
              <span className="ml-1">{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={`rounded-lg bg-slate-50 ${iconColor} ${compact ? 'p-3' : 'p-4'}`}>
            <Icon className={compact ? 'w-5 h-5' : 'w-6 h-6'} />
          </div>
        )}
      </div>
    </div>
  );
}

interface HighlightedMetricCardProps extends MetricCardProps {
  accentColor?: string;
}

export function HighlightedMetricCard({
  accentColor = 'border-indigo-500',
  className = '',
  compact = false,
  ...props
}: HighlightedMetricCardProps) {
  return (
    <div className={`card ${compact ? 'p-5' : 'p-6'} border-l-4 ${accentColor} ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-slate-500 mb-2 ${compact ? 'text-sm' : 'text-base'}`}>{props.title}</p>
          <p className={`font-semibold text-slate-900 tracking-tight ${compact ? 'text-xl' : 'text-2xl'}`}>
            {props.value}
          </p>
          {props.subtitle && (
            <p className={`text-slate-500 mt-2 ${compact ? 'text-sm' : 'text-sm'}`}>{props.subtitle}</p>
          )}
        </div>
        {props.icon && (
          <div className={`rounded-lg bg-slate-50 ${props.iconColor || 'text-blue-500'} ${compact ? 'p-3' : 'p-4'}`}>
            <props.icon className={compact ? 'w-5 h-5' : 'w-6 h-6'} />
          </div>
        )}
      </div>
    </div>
  );
}
