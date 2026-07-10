import React from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className = '' }: TabsProps) {
  return (
    <div className={`border-b border-slate-200 ${className}`}>
      <nav className="flex gap-4" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`
                flex items-center gap-2 px-1 py-3 text-sm font-medium
                border-b-2 transition-colors
                ${isActive
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }
              `}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// Simple pill-style tabs
interface PillTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export function PillTabs({ tabs, activeTab, onChange, className = '' }: PillTabsProps) {
  return (
    <div className={`inline-flex bg-slate-100 rounded-lg p-1 ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`
              flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md
              transition-colors
              ${isActive
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
