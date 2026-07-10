import React, { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { DateRangeFilter, DATE_PRESETS, DatePreset } from '../../types/filters';

interface DateRangePickerProps {
  value: DateRangeFilter | undefined;
  onChange: (value: DateRangeFilter | undefined) => void;
  label?: string;
  className?: string;
  dataDateRange?: DateRangeFilter; // Actual date range from uploaded data
}

export function DateRangePicker({
  value,
  onChange,
  label,
  className = '',
  dataDateRange,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<DatePreset | 'absolute'>('all');

  const handlePresetSelect = (preset: DatePreset | 'absolute') => {
    setActivePreset(preset);
    
    if (preset === 'absolute' && dataDateRange) {
      // Use the absolute date range from the data
      onChange(dataDateRange);
      setIsOpen(false);
      return;
    }
    
    const presetOption = DATE_PRESETS.find(p => p.value === preset);
    if (presetOption) {
      const dates = presetOption.getDates();
      onChange(dates.start || dates.end ? dates : undefined);
    }
    if (preset !== 'custom') {
      setIsOpen(false);
    }
  };

  const handleCustomDateChange = (type: 'start' | 'end', dateStr: string) => {
    const date = dateStr ? new Date(dateStr) : null;
    onChange({
      start: type === 'start' ? date : value?.start || null,
      end: type === 'end' ? date : value?.end || null,
    });
  };

  const displayValue = value?.start && value?.end
    ? `${format(value.start, 'MMM d, yyyy')} - ${format(value.end, 'MMM d, yyyy')}`
    : 'All Time';

  // Format the absolute date range label
  const absoluteRangeLabel = dataDateRange?.start && dataDateRange?.end
    ? `${format(dataDateRange.start, 'MMM d, yyyy')} - ${format(dataDateRange.end, 'MMM d, yyyy')}`
    : 'Data Range';

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {label}
        </label>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2 text-sm text-left
          bg-white border border-slate-300 rounded-lg
          hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500
          ${isOpen ? 'ring-2 ring-blue-500' : ''}
        `}
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="text-slate-900">{displayValue}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-80 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-slate-200">
            {/* Absolute Range from Data - highlighted */}
            {dataDateRange?.start && dataDateRange?.end && (
              <div className="mb-2">
                <button
                  onClick={() => handlePresetSelect('absolute')}
                  className={`
                    w-full px-3 py-2 text-sm rounded text-left
                    ${activePreset === 'absolute'
                      ? 'bg-blue-100 text-blue-700 border border-blue-300'
                      : 'hover:bg-slate-100 text-slate-700 border border-slate-200'
                    }
                  `}
                >
                  <div className="font-medium">Absolute Range (from data)</div>
                  <div className="text-xs mt-0.5 opacity-75">{absoluteRangeLabel}</div>
                </button>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-1">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handlePresetSelect(preset.value)}
                  className={`
                    px-3 py-1.5 text-sm rounded
                    ${activePreset === preset.value
                      ? 'bg-blue-100 text-blue-700'
                      : 'hover:bg-slate-100 text-slate-700'
                    }
                  `}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {activePreset === 'custom' && (
            <div className="p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={value?.start ? format(value.start, 'yyyy-MM-dd') : ''}
                  onChange={(e) => handleCustomDateChange('start', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={value?.end ? format(value.end, 'yyyy-MM-dd') : ''}
                  onChange={(e) => handleCustomDateChange('end', e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-full px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
