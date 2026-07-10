// Filter types

export interface DateRangeFilter {
  start: Date | null;
  end: Date | null;
}

export type ExtractedDataStatus = 'has_value' | 'no_value' | null;

export type FilterMode = 'include' | 'exclude' | null;

export interface FilterParams {
  dateRange?: DateRangeFilter;
  onUI?: string[];
  written?: string[];
  manual?: string[];
  reasonForDismissal?: string[];
  recordType?: string[];
  fieldName?: string[];
  extractedDataStatus?: ExtractedDataStatus;
  // New filter fields
  vendorName?: string[];
  vendorFilterMode?: FilterMode;
  editedFieldName?: string[];
  editedFieldNameFilterMode?: FilterMode;
  editedValue?: string[];
  editedOriginalValue?: string[];
  extractedValueFromIntent?: string[];
  search?: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  randomSampleByField?: boolean; // If true, randomly sample to show variety of field names
}

export interface FilterOption {
  value: string;
  count: number;
  label?: string;
}

export interface FilterOptions {
  onUI: FilterOption[];
  written: FilterOption[];
  manual: FilterOption[];
  reasonForDismissal: FilterOption[];
  recordType: FilterOption[];
  fieldName: FilterOption[];
  // New filter options
  vendorName: FilterOption[];
  editedFieldName: FilterOption[];
  editedValue: FilterOption[];
  editedOriginalValue: FilterOption[];
  extractedValueFromIntent: FilterOption[];
  // Data date range for absolute time filter
  dataDateRange?: DateRangeFilter;
}

export const DEFAULT_FILTER_PARAMS: FilterParams = {
  page: 1,
  pageSize: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

export const PAGE_SIZE_OPTIONS = [10, 20, 50];

// Date range presets
export type DatePreset = 'last7d' | 'last30d' | 'last90d' | 'custom' | 'all';

export interface DatePresetOption {
  value: DatePreset;
  label: string;
  getDates: () => DateRangeFilter;
}

export const DATE_PRESETS: DatePresetOption[] = [
  {
    value: 'all',
    label: 'All Time',
    getDates: () => ({ start: null, end: null }),
  },
  {
    value: 'last7d',
    label: 'Last 7 Days',
    getDates: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 7);
      return { start, end };
    },
  },
  {
    value: 'last30d',
    label: 'Last 30 Days',
    getDates: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      return { start, end };
    },
  },
  {
    value: 'last90d',
    label: 'Last 90 Days',
    getDates: () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 90);
      return { start, end };
    },
  },
  {
    value: 'custom',
    label: 'Custom Range',
    getDates: () => ({ start: null, end: null }),
  },
];
