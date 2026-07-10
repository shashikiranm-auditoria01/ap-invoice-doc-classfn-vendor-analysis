import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster, toast } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 5000,
        style: {
          background: '#FFFFFF',
          color: '#0F172A',
          border: '1px solid #E2E8F0',
          borderRadius: '0.75rem',
          padding: '16px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          fontSize: '14px',
          maxWidth: '500px',
        },
        success: {
          duration: 8000,
          style: {
            background: '#F0FDF4',
            color: '#166534',
            border: '1px solid #BBF7D0',
          },
          iconTheme: {
            primary: '#22C55E',
            secondary: '#FFFFFF',
          },
        },
        error: {
          duration: 10000,
          style: {
            background: '#FEF2F2',
            color: '#991B1B',
            border: '1px solid #FECACA',
          },
          iconTheme: {
            primary: '#EF4444',
            secondary: '#FFFFFF',
          },
        },
        loading: {
          style: {
            background: '#EFF6FF',
            color: '#1E40AF',
            border: '1px solid #BFDBFE',
          },
          iconTheme: {
            primary: '#3B82F6',
            secondary: '#FFFFFF',
          },
        },
      }}
    />
    <App />
  </React.StrictMode>
);

// Show startup alert only once when app loads
const STARTUP_ALERT_KEY = 'docclassification_startup_shown';
const sessionShown = sessionStorage.getItem(STARTUP_ALERT_KEY);

if (!sessionShown) {
  setTimeout(() => {
    toast.success('Doc Classification app started successfully!', {
      duration: 4000,
      icon: '🚀',
    });
    sessionStorage.setItem(STARTUP_ALERT_KEY, 'true');
  }, 1000);
}
