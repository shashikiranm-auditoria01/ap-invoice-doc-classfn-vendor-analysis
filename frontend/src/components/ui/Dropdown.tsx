import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X, Search, Square, CheckSquare } from 'lucide-react';

interface DropdownOption {
  value: string;
  label?: string;
  count?: number;
}

type FilterMode = 'include' | 'exclude' | null;

interface DropdownProps {
  options: DropdownOption[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label?: string;
  multiple?: boolean;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  showSelectAll?: boolean; // Show checkboxes with all selected by default
  showFilterActions?: boolean; // Show Select/Deselect action buttons
  filterMode?: FilterMode; // Current filter mode
  onFilterModeChange?: (mode: FilterMode) => void; // Callback when filter mode changes
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  multiple = true,
  searchable = false,
  disabled = false,
  className = '',
  showSelectAll = false,
  showFilterActions = false,
  filterMode = null,
  onFilterModeChange,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Flip the menu to right-alignment when a left-aligned panel would overflow the viewport
  // (filters near the right edge of the toolbar).
  const [alignRight, setAlignRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const MENU_MAX_WIDTH = 520;
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setAlignRight(rect.left + MENU_MAX_WIDTH > window.innerWidth - 8);
  }, [isOpen]);

  // For showSelectAll mode: checked items are EXCLUDED
  // Empty selection = no exclusions = all data shows

  const allSelected = options.length > 0 && value.length === options.length;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = searchable && search
    ? options.filter(opt => 
        (opt.label || opt.value).toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const handleSelect = (optionValue: string) => {
    if (multiple) {
      if (value.includes(optionValue)) {
        onChange(value.filter(v => v !== optionValue));
      } else {
        onChange([...value, optionValue]);
      }
    } else {
      onChange([optionValue]);
      setIsOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  // For showSelectAll mode, checked items are EXCLUDED
  const displayValue = showSelectAll && multiple
    ? value.length === 0
      ? 'All included'
      : value.length === options.length
        ? 'All excluded'
        : `${value.length} excluded`
    : value.length > 0
      ? value.length === 1
        ? options.find(o => o.value === value[0])?.label || value[0]
        : `${value.length} selected`
      : placeholder;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {label}
        </label>
      )}
      
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2 text-sm text-left cursor-pointer
          bg-white border border-slate-300 rounded-lg
          hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500
          ${disabled ? 'bg-slate-50 cursor-not-allowed opacity-60' : ''}
          ${isOpen ? 'ring-2 ring-blue-500' : ''}
        `}
      >
        <span className={value.length === 0 ? 'text-slate-400' : 'text-slate-900'}>
          {displayValue}
        </span>
        <div className="flex items-center gap-1">
          {value.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-slate-100 rounded"
              aria-label="Clear selection"
            >
              <X className="w-3 h-3 text-slate-400" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {isOpen && (
        <div className={`absolute z-50 w-max min-w-full max-w-[520px] mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-hidden ${alignRight ? 'right-0' : 'left-0'}`}>
          {searchable && (
            <div className="p-2 border-b border-slate-200">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Header for checkbox mode - checked items are EXCLUDED */}
          {showSelectAll && multiple && options.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50">
              <span className="text-xs text-slate-500">
                {value.length} of {options.length} excluded
              </span>
              <span className="text-xs text-slate-400">
                Check to exclude
              </span>
            </div>
          )}
          
          <div className="overflow-y-auto max-h-48">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500">No options found</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={`
                      w-full flex items-center gap-2
                      px-3 py-2 text-sm text-left
                      hover:bg-slate-50
                      ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}
                    `}
                  >
                    {/* Checkbox for all multi-select dropdowns */}
                    {multiple ? (
                      isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      )
                    ) : null}
                    <span className="truncate flex-1">{option.label || option.value}</span>
                    <div className="flex items-center gap-2">
                      {option.count !== undefined && (
                        <span className="text-xs text-slate-400">
                          {option.count.toLocaleString()}
                        </span>
                      )}
                      {!multiple && isSelected && <Check className="w-4 h-4 text-blue-600" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Select/Deselect Action Buttons */}
          {showFilterActions && multiple && value.length > 0 && (
            <div className="border-t border-slate-200 p-2 bg-slate-50">
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterModeChange?.('include');
                    setIsOpen(false);
                  }}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                    filterMode === 'include'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-blue-50 hover:border-blue-300'
                  }`}
                >
                  Select
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterModeChange?.('exclude');
                    setIsOpen(false);
                  }}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded transition-colors ${
                    filterMode === 'exclude'
                      ? 'bg-red-600 text-white'
                      : 'bg-white border border-slate-300 text-slate-700 hover:bg-red-50 hover:border-red-300'
                  }`}
                >
                  Deselect
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1.5 text-center">
                {value.length} item{value.length !== 1 ? 's' : ''} checked
                {filterMode === null && ' - not filtering'}
                {filterMode === 'include' && ' - showing only'}
                {filterMode === 'exclude' && ' - excluding'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
