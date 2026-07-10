import { useState, useEffect, useMemo } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

export type DatePreset = 'all' | '7d' | '30d' | '90d' | '180d' | '1y' | 'absolute';

interface DateRange {
  start: Date | null;
  end: Date | null;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  minDate?: Date | null;
  maxDate?: Date | null;
  label?: string;
}

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: '180d', label: 'Last 6 Months' },
  { value: '1y', label: 'Last 1 Year' },
  { value: 'absolute', label: 'Custom Range' },
];

function getPresetDateRange(preset: DatePreset, maxDate: Date | null): DateRange {
  if (preset === 'all' || preset === 'absolute') {
    return { start: null, end: null };
  }

  const end = maxDate || new Date();
  const start = new Date(end);

  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '90d':
      start.setDate(start.getDate() - 90);
      break;
    case '180d':
      start.setDate(start.getDate() - 180);
      break;
    case '1y':
      start.setFullYear(start.getFullYear() - 1);
      break;
  }

  return { start, end };
}

function detectPreset(range: DateRange, maxDate: Date | null): DatePreset {
  if (!range.start && !range.end) {
    return 'all';
  }

  if (!range.start || !range.end) {
    return 'absolute';
  }

  const end = maxDate || new Date();
  const diffDays = Math.round((range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24));
  const endDiff = Math.abs(Math.round((end.getTime() - range.end.getTime()) / (1000 * 60 * 60 * 24)));

  // Allow 1 day tolerance for end date comparison
  if (endDiff > 1) {
    return 'absolute';
  }

  if (diffDays >= 6 && diffDays <= 8) return '7d';
  if (diffDays >= 29 && diffDays <= 31) return '30d';
  if (diffDays >= 89 && diffDays <= 91) return '90d';
  if (diffDays >= 179 && diffDays <= 181) return '180d';
  if (diffDays >= 364 && diffDays <= 366) return '1y';

  return 'absolute';
}

export function DateRangeFilter({
  value,
  onChange,
  minDate,
  maxDate,
  label = 'Date Range',
}: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>(() => 
    detectPreset(value, maxDate ?? null)
  );
  const [showAbsolute, setShowAbsolute] = useState(selectedPreset === 'absolute');

  // Update preset detection when value changes externally
  useEffect(() => {
    const detected = detectPreset(value, maxDate ?? null);
    if (detected !== selectedPreset && detected !== 'absolute') {
      setSelectedPreset(detected);
      setShowAbsolute(false);
    }
  }, [value, maxDate]);

  const handlePresetChange = (preset: DatePreset) => {
    setSelectedPreset(preset);
    setIsOpen(false);

    if (preset === 'absolute') {
      setShowAbsolute(true);
      // Don't change the date range, just show the pickers
    } else if (preset === 'all') {
      setShowAbsolute(false);
      onChange({ start: null, end: null });
    } else {
      setShowAbsolute(false);
      const range = getPresetDateRange(preset, maxDate ?? null);
      onChange(range);
    }
  };

  const formatDateForInput = (date: Date | null): string => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  };

  const currentPresetLabel = PRESETS.find(p => p.value === selectedPreset)?.label || 'All Time';

  const displayText = useMemo(() => {
    if (selectedPreset === 'all') {
      return 'All Time';
    }
    if (selectedPreset === 'absolute' && value.start && value.end) {
      return `${value.start.toLocaleDateString()} - ${value.end.toLocaleDateString()}`;
    }
    if (selectedPreset !== 'absolute') {
      return currentPresetLabel;
    }
    return 'Select dates';
  }, [selectedPreset, value, currentPresetLabel]);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      
      <div className="flex flex-wrap items-center gap-2">
        {/* Preset Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
          >
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="flex-1 text-left text-slate-700">{currentPresetLabel}</span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOpen && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setIsOpen(false)} 
              />
              <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => handlePresetChange(preset.value)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                      selectedPreset === preset.value 
                        ? 'bg-blue-50 text-blue-700 font-medium' 
                        : 'text-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Absolute Date Pickers - Only show when "Custom Range" is selected */}
        {showAbsolute && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">From:</span>
              <input
                type="date"
                value={formatDateForInput(value.start)}
                min={minDate ? formatDateForInput(minDate) : undefined}
                max={maxDate ? formatDateForInput(maxDate) : undefined}
                onChange={(e) => {
                  const newStart = e.target.value ? new Date(e.target.value) : null;
                  onChange({ ...value, start: newStart });
                }}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">To:</span>
              <input
                type="date"
                value={formatDateForInput(value.end)}
                min={minDate ? formatDateForInput(minDate) : undefined}
                max={maxDate ? formatDateForInput(maxDate) : undefined}
                onChange={(e) => {
                  const newEnd = e.target.value ? new Date(e.target.value) : null;
                  onChange({ ...value, end: newEnd });
                }}
                className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {/* Display current range info */}
        {selectedPreset !== 'all' && selectedPreset !== 'absolute' && value.start && value.end && (
          <span className="text-xs text-slate-500">
            ({value.start.toLocaleDateString()} - {value.end.toLocaleDateString()})
          </span>
        )}
      </div>
    </div>
  );
}
