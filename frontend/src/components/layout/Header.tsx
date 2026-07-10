import { BarChart3, Mail } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';

export function Header() {
  const { setEmailSenderOpen } = useAppContext();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
      <div className="w-full px-6 sm:px-8 lg:px-10 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Logo and Title */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/30">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl sm:text-2xl font-bold text-black">
                AP Invoice Doc Classfn & VendorName Analysis
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                Interactive document classification and vendor analysis
              </p>
            </div>
          </div>

          {/* Prominent, always-visible Email Sender button (mirrors the annotation tool) */}
          <button
            data-testid="open-email-sender"
            onClick={() => setEmailSenderOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold shrink-0
                       bg-gradient-to-r from-[#6B21A8] to-[#8B5CF6] text-white shadow-md shadow-purple-500/30
                       hover:from-[#581C87] hover:to-[#7C3AED] hover:-translate-y-0.5 transition-all"
          >
            <Mail className="w-5 h-5" />
            Email Sender
          </button>
        </div>
      </div>
    </header>
  );
}
