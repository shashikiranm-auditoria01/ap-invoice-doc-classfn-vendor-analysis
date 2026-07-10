import { BarChart2, FileSearch, ClipboardCheck } from 'lucide-react';

export type TabId = 'analysis' | 'reviewed' | 'metrics';

// For compatibility with storage.ts
export interface TabState {
  activeTab: TabId;
}

interface TabNavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="bg-white border-b border-slate-200">
      <div className="w-full px-6 sm:px-8 lg:px-10">
        <div className="flex items-center">
          {/* Tab: Analysis */}
          <button
            onClick={() => onTabChange('analysis')}
            className={`
              flex items-center gap-2 py-3 px-4 text-base font-medium
              border-b-2 transition-colors -mb-px
              ${activeTab === 'analysis'
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }
            `}
            aria-current={activeTab === 'analysis' ? 'page' : undefined}
          >
            <FileSearch className="w-5 h-5" />
            Analysis
          </button>

          {/* Tab: Reviewed */}
          <button
            onClick={() => onTabChange('reviewed')}
            className={`
              flex items-center gap-2 py-3 px-4 text-base font-medium
              border-b-2 transition-colors -mb-px
              ${activeTab === 'reviewed'
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }
            `}
            aria-current={activeTab === 'reviewed' ? 'page' : undefined}
          >
            <ClipboardCheck className="w-5 h-5" />
            Reviewed
          </button>

          {/* Tab: Metrics */}
          <button
            onClick={() => onTabChange('metrics')}
            className={`
              flex items-center gap-2 py-3 px-4 text-base font-medium
              border-b-2 transition-colors -mb-px
              ${activeTab === 'metrics'
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }
            `}
            aria-current={activeTab === 'metrics' ? 'page' : undefined}
          >
            <BarChart2 className="w-5 h-5" />
            Metrics
          </button>
        </div>
      </div>
    </div>
  );
}
