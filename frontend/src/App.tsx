import { useState, useCallback } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { Header } from './components/layout/Header';
import { TabNavigation, TabId } from './components/layout/TabNavigation';
import { DocClassificationPage } from './pages/DocClassificationPage';
import { ReviewedPage } from './pages/ReviewedPage';
import { DocClassificationMetricsPage } from './pages/DocClassificationMetricsPage';
import { EmailSenderModal } from './components/docClassification/EmailSenderModal';
import { DataGate } from './components/DataGate';
import { ContextBar } from './components/layout/ContextBar';
import { ErrorBoundary } from './components/ErrorBoundary';

function AppContent() {
  const { isInitialized, initError, dataGatePassed, docClassificationPdfFiles, emailSenderOpen, setEmailSenderOpen } = useAppContext();
  const [activeTab, setActiveTab] = useState<TabId>('analysis');

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  if (!isInitialized && !initError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600">Loading application...</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white rounded-lg border border-red-200 p-6">
          <h2 className="text-lg font-semibold text-red-600 mb-2">Failed to load application</h2>
          <p className="text-slate-600 mb-4">{initError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  function renderPage() {
    if (activeTab === 'reviewed') return <ReviewedPage />;
    if (activeTab === 'metrics') return <DocClassificationMetricsPage />;
    return <DocClassificationPage />;
  }

  // Pre-load gate: pick tenant + created_at range, then "Get Data" loads & renders the dashboard.
  if (!dataGatePassed) {
    return <DataGate />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      <ContextBar />
      <main>
        {renderPage()}
      </main>
      {emailSenderOpen && (
        <EmailSenderModal
          pdfs={docClassificationPdfFiles}
          onClose={() => setEmailSenderOpen(false)}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
