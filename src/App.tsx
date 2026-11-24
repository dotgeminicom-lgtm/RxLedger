import React, { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Camera,
  CheckCircle2,
  FileSpreadsheet,
  History,
  Home,
  Loader2,
  LogOut,
  MessageCircle,
  Search,
  ShieldCheck,
  Table as TableIcon,
  Upload,
  XCircle,
} from 'lucide-react';
import { ExcelTableView } from './components/ExcelTableView.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { ScanReviewView } from './components/ScanReviewView.tsx';
import { WhatsAppShareModal } from './components/WhatsAppShareModal.tsx';
import { exportPrescriptionsToExcel } from './lib/excelExport.ts';
import { auth, googleProvider } from './lib/firebase.ts';
import { formatSerialNo, formatWhatsAppRecord } from './lib/formatters.ts';
import {
  ensureUserProfile,
  subscribeToNextSerial,
  subscribeToPrescriptions,
} from './lib/prescriptionService.ts';
import type { AppTab, PrescriptionRecord } from './types/prescription.ts';

interface ToastState {
  message: string;
  tone: 'success' | 'error';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [records, setRecords] = useState<PrescriptionRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [nextSerialNo, setNextSerialNo] = useState(1);

  const [whatsAppText, setWhatsAppText] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [emblemError, setEmblemError] = useState(false);
  const [recordsInitialSearch, setRecordsInitialSearch] = useState('');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);

  const dashboardUploadRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 3600);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (!currentUser) {
        setRecords([]);
        setNextSerialNo(1);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    setRecordsLoading(true);

    void ensureUserProfile(user).catch((err) => {
      notify(err instanceof Error ? err.message : 'Profile sync error.', 'error');
    });

    const unsubRx = subscribeToPrescriptions(
      user.uid,
      (list) => {
        setRecords(list);
        setRecordsLoading(false);
      },
      (err) => {
        setRecordsLoading(false);
        notify(err.message, 'error');
      }
    );

    const unsubSerial = subscribeToNextSerial(
      user.uid,
      (nextNum) => setNextSerialNo(nextNum),
      (err) => notify(err.message, 'error')
    );

    return () => {
      unsubRx();
      unsubSerial();
    };
  }, [user]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setWhatsAppText(null);
      setPendingUploadFile(null);
      setActiveTab('dashboard');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Sign-out failed.', 'error');
    }
  };

  const handleDashboardExportAll = async () => {
    if (records.length === 0) {
      notify('No saved prescription records to export yet.', 'error');
      return;
    }
    try {
      await exportPrescriptionsToExcel(records, 'pharmacy-prescription-records');
      notify(`Exported ${records.length} record(s) to Excel (.xlsx).`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Excel export failed.', 'error');
    }
  };

  const handleDashboardWhatsApp = () => {
    if (records.length === 0) {
      notify('Scan and save a prescription first to share via WhatsApp.', 'error');
      return;
    }
    setWhatsAppText(formatWhatsAppRecord(records[0]));
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F7FAF8] flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-slate-700 text-sm font-medium">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-700" />
          Loading RxLedger...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F7FAF8] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-7 sm:p-9 shadow-sm space-y-6">
          <div className="flex items-center gap-3.5">
            {!emblemError ? (
              <img
                src="/src/assets/images/pharmacy_emblem_mark_1795472816613.jpg"
                alt="RxLedger Pharmacy Emblem"
                referrerPolicy="no-referrer"
                onError={() => setEmblemError(true)}
                className="w-14 h-14 rounded-2xl object-cover border border-slate-200 bg-white"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-emerald-700 text-white flex items-center justify-center font-bold text-xl">
                Rx
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">RxLedger</h1>
              <p className="text-xs text-slate-500">
                AI Prescription Scanner &amp; Pharmacy Record System
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-slate-900 [text-wrap:balance]">
              Restricted Pharmacist Access
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Sign in with your verified Google account to access your private prescription
              scanner, Excel-style ledger, and persistent pharmacy history.
            </p>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-2 text-xs text-emerald-950">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              Patient Privacy &amp; Record Protection
            </div>
            <p className="leading-relaxed text-emerald-900">
              Patient records are strictly isolated per authenticated pharmacist account. Uploaded
              prescription photos are never saved publicly.
            </p>
          </div>

          {authError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={authLoading}
            onClick={() => void handleSignIn()}
            className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2.5"
          >
            {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAF8] text-slate-900 flex flex-col pb-20 md:pb-8">
      {/* Top Bar Contract: 3 zones (Brand | 4 nav links | 1 action) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {!emblemError ? (
              <img
                src="/src/assets/images/pharmacy_emblem_mark_1795472816613.jpg"
                alt="RxLedger"
                referrerPolicy="no-referrer"
                onError={() => setEmblemError(true)}
                className="w-7 h-7 rounded-lg object-cover border border-slate-200"
              />
            ) : (
              <span className="w-7 h-7 rounded-lg bg-emerald-700 text-white text-xs font-bold flex items-center justify-center">
                Rx
              </span>
            )}
            <span className="font-display">RxLedger</span>
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'dashboard'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('scan')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'scan'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Scan Rx
            </button>
            <button
              type="button"
              onClick={() => {
                setRecordsInitialSearch('');
                setActiveTab('records');
              }}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'records'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              Records
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'history'
                  ? 'text-emerald-700 font-semibold border-b-2 border-emerald-700'
                  : 'hover:text-slate-900'
              }`}
            >
              History
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-7">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Hero / Primary Pharmacy Workspace Header */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Pharmacy Counter Workspace</span>
                    <span aria-hidden="true">·</span>
                    <span>{user.email}</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight [text-wrap:balance]">
                    AI Prescription Scanner &amp; Pharmacy Record System
                  </h1>
                  <p className="text-sm text-slate-600 max-w-2xl">
                    Capture prescriptions with your mobile camera, verify AI-extracted medicines in
                    an Excel-compatible ledger, and share formatted records to WhatsApp groups.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
                  <div className="border border-slate-200 rounded-xl px-4 py-3 bg-[#F8FAF9]">
                    <span className="block text-[11px] text-slate-500">Total Records</span>
                    <span className="mt-0.5 block text-xl font-bold font-mono tabular-nums text-slate-900">
                      {recordsLoading ? '—' : records.length}
                    </span>
                  </div>
                  <div className="border border-slate-200 rounded-xl px-4 py-3 bg-[#F8FAF9]">
                    <span className="block text-[11px] text-slate-500">Next Serial</span>
                    <span className="mt-0.5 block text-xl font-bold font-mono tabular-nums text-emerald-700">
                      #{formatSerialNo(nextSerialNo)}
                    </span>
                  </div>
                  <div className="border border-slate-200 rounded-xl px-4 py-3 bg-[#F8FAF9]">
                    <span className="block text-[11px] text-slate-500">Latest Date</span>
                    <span className="mt-0.5 block text-sm sm:text-base font-semibold font-mono tabular-nums text-slate-900 pt-1">
                      {records[0]?.date || '—'}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 6 Required Dashboard Quick Controls (Section 13) */}
            <section aria-label="Pharmacy Quick Actions">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('scan')}
                  className="min-h-[84px] p-5 rounded-2xl bg-emerald-700 text-white text-left hover:bg-emerald-800 active:scale-[0.99] transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold tracking-wide">
                      SCAN NEW PRESCRIPTION
                    </span>
                    <span className="block text-xs text-emerald-100 mt-0.5">
                      Use smartphone camera or upload photo
                    </span>
                  </div>
                </button>

                <input
                  ref={dashboardUploadRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) {
                      setPendingUploadFile(file);
                      setActiveTab('scan');
                    }
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => dashboardUploadRef.current?.click()}
                  className="min-h-[84px] p-5 rounded-2xl bg-white border border-slate-200 text-slate-900 text-left hover:border-emerald-400 hover:bg-emerald-50/30 active:scale-[0.99] transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold tracking-wide">UPLOAD IMAGE</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Select prescription from gallery
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRecordsInitialSearch('');
                    setActiveTab('records');
                  }}
                  className="min-h-[84px] p-5 rounded-2xl bg-white border border-slate-200 text-slate-900 text-left hover:border-emerald-400 hover:bg-emerald-50/30 active:scale-[0.99] transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <TableIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold tracking-wide">
                      PRESCRIPTION RECORDS
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Open editable Excel-style ledger table
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="min-h-[84px] p-5 rounded-2xl bg-white border border-slate-200 text-slate-900 text-left hover:border-emerald-400 hover:bg-emerald-50/30 active:scale-[0.99] transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <Search className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold tracking-wide">SEARCH RECORDS</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Filter patient, doctor, medicine &amp; dates
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void handleDashboardExportAll()}
                  className="min-h-[84px] p-5 rounded-2xl bg-white border border-slate-200 text-slate-900 text-left hover:border-emerald-400 hover:bg-emerald-50/30 active:scale-[0.99] transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold tracking-wide">EXPORT EXCEL</span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Download formatted .xlsx workbook
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleDashboardWhatsApp}
                  className="min-h-[84px] p-5 rounded-2xl bg-white border border-slate-200 text-slate-900 text-left hover:border-emerald-400 hover:bg-emerald-50/30 active:scale-[0.99] transition-all flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <MessageCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="block text-sm font-bold tracking-wide">
                      WHATSAPP SHARING
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">
                      Share latest record to WhatsApp group
                    </span>
                  </div>
                </button>
              </div>
            </section>

            {/* Recent Saved Prescriptions */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Recent Prescription Entries</h2>
                  <p className="text-xs text-slate-500">
                    Saved persistently across restarts and sessions
                  </p>
                </div>
                {records.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('records')}
                    className="text-xs font-semibold text-emerald-700 hover:underline min-h-[36px] px-2"
                  >
                    View All in Excel Table
                  </button>
                )}
              </div>

              {recordsLoading ? (
                <div className="p-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                  Loading prescription records...
                </div>
              ) : records.length === 0 ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-sm text-slate-600">
                    No prescriptions recorded yet. Tap <strong>SCAN NEW PRESCRIPTION</strong> to
                    scan your first prescription.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {records.slice(0, 5).map((rec) => (
                    <div
                      key={rec.id}
                      className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono tabular-nums font-semibold text-emerald-700">
                            #{formatSerialNo(rec.serialNo)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{rec.date}</span>
                          {rec.remarks && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-700 font-medium">{rec.remarks}</span>
                            </>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-900 truncate mt-0.5">
                          {rec.patientName || 'Patient Not Mentioned'} —{' '}
                          <span className="font-normal text-slate-600">
                            {rec.prescriberName || 'Prescriber Not Mentioned'}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setWhatsAppText(formatWhatsAppRecord(rec))}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          Share
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('records')}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50"
                        >
                          Open Table
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'scan' && (
          <ScanReviewView
            uid={user.uid}
            nextSerialNo={nextSerialNo}
            initialFile={pendingUploadFile}
            onClearInitialFile={() => setPendingUploadFile(null)}
            onRecordSaved={() => {
              // Keeps user on review screen so they can Copy, Share to WhatsApp, Export Excel, or Scan Next
            }}
            onOpenWhatsApp={(text) => setWhatsAppText(text)}
            onNotify={notify}
          />
        )}

        {activeTab === 'records' && (
          <ExcelTableView
            uid={user.uid}
            records={records}
            onOpenWhatsApp={(text) => setWhatsAppText(text)}
            onNotify={notify}
            initialSearch={recordsInitialSearch}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            uid={user.uid}
            records={records}
            onOpenWhatsApp={(text) => setWhatsAppText(text)}
            onNotify={notify}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar (<= 15% mobile viewport height) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-4 h-16 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`h-full flex flex-col items-center justify-center gap-1 ${
              activeTab === 'dashboard' ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Home</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('scan')}
            className={`h-full flex flex-col items-center justify-center gap-1 ${
              activeTab === 'scan' ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            <Camera className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Scan Rx</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setRecordsInitialSearch('');
              setActiveTab('records');
            }}
            className={`h-full flex flex-col items-center justify-center gap-1 ${
              activeTab === 'records' ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            <TableIcon className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Records</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`h-full flex flex-col items-center justify-center gap-1 ${
              activeTab === 'history' ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            <History className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">History</span>
          </button>
        </div>
      </nav>

      {/* WhatsApp Group Share Sheet */}
      <WhatsAppShareModal
        isOpen={Boolean(whatsAppText)}
        formattedText={whatsAppText || ''}
        onClose={() => setWhatsAppText(null)}
      />

      {/* Non-blocking Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-20 md:bottom-6 right-4 left-4 sm:left-auto sm:max-w-sm z-50 rounded-2xl px-4 py-3 shadow-lg border flex items-center gap-2.5 text-sm font-medium ${
            toast.tone === 'error'
              ? 'bg-red-900 text-white border-red-700'
              : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          {toast.tone === 'error' ? (
            <XCircle className="w-4 h-4 text-red-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
