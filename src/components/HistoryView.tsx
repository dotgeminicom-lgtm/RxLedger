import React, { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Copy,
  FileSpreadsheet,
  History,
  MessageCircle,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { PrescriptionRecord } from '../types/prescription.ts';
import { exportPrescriptionsToExcel } from '../lib/excelExport.ts';
import { formatSerialNo, formatWhatsAppRecord, normalizeDateInput } from '../lib/formatters.ts';
import { deletePrescriptionRecord } from '../lib/prescriptionService.ts';

interface HistoryViewProps {
  uid: string;
  records: PrescriptionRecord[];
  onOpenWhatsApp: (formattedText: string) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  uid,
  records,
  onOpenWhatsApp,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PrescriptionRecord | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const df = dateFilter.trim();
    const normalizedDate = df ? normalizeDateInput(df) : null;

    return records.filter((rec) => {
      if (df) {
        if (normalizedDate) {
          if (rec.date !== normalizedDate) return false;
        } else if (!rec.date.includes(df)) {
          return false;
        }
      }
      if (!q) return true;
      return (
        rec.patientName.toLowerCase().includes(q) ||
        rec.prescriberName.toLowerCase().includes(q) ||
        rec.prescribedMedicine.toLowerCase().includes(q) ||
        rec.remarks.toLowerCase().includes(q) ||
        formatSerialNo(rec.serialNo).includes(q)
      );
    });
  }, [records, searchQuery, dateFilter]);

  const handleCopy = async (rec: PrescriptionRecord) => {
    try {
      await navigator.clipboard.writeText(formatWhatsAppRecord(rec));
      onNotify(`Copied Serial #${formatSerialNo(rec.serialNo)} to clipboard.`, 'success');
    } catch {
      onNotify('Clipboard access denied.', 'error');
    }
  };

  const handleExportOne = async (rec: PrescriptionRecord) => {
    try {
      await exportPrescriptionsToExcel([rec], `prescription-${formatSerialNo(rec.serialNo)}`);
      onNotify(`Downloaded Excel for Serial #${formatSerialNo(rec.serialNo)}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deletePrescriptionRecord(uid, confirmDelete.id);
      onNotify(`Deleted Serial #${formatSerialNo(confirmDelete.serialNo)}.`, 'success');
      setConfirmDelete(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Prescription History</h1>
            <p className="text-xs text-slate-500">
              Persistent searchable archive ·{' '}
              <span className="font-mono tabular-nums font-medium text-slate-800">
                {filtered.length}
              </span>{' '}
              record(s)
            </p>
          </div>

          {filtered.length > 0 && (
            <button
              type="button"
              onClick={() =>
                void exportPrescriptionsToExcel(filtered, 'pharmacy-prescription-history')
              }
              className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-2 whitespace-nowrap self-start sm:self-auto"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Filtered ({filtered.length})
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-8 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient, prescriber, medicine, serial no, or remarks..."
              className="w-full min-h-[44px] pl-10 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="sm:col-span-4 relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              placeholder="Date DD/MM/YYYY"
              className="w-full min-h-[44px] pl-10 pr-8 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
          <History className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-base font-semibold text-slate-900">No history records found</p>
          <p className="text-sm text-slate-500">
            Saved prescriptions remain securely stored here across sessions and device restarts.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
          {filtered.map((rec) => {
            const isExpanded = expandedId === rec.id;
            return (
              <div key={rec.id} className="p-4 sm:p-5">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                  className="w-full text-left flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono tabular-nums font-semibold text-emerald-700">
                        Serial #{formatSerialNo(rec.serialNo)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{rec.date}</span>
                      {rec.remarks && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-slate-700">{rec.remarks}</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 mt-0.5 truncate">
                      {rec.patientName || 'Patient Not Mentioned'}
                    </h3>
                    <p className="text-xs text-slate-600 truncate">
                      {rec.prescriberName || 'Prescriber Not Mentioned'} · Age: {rec.age || '—'} ·
                      Sex: {rec.sex || '—'}
                    </p>
                  </div>

                  <span className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400">
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs sm:text-sm text-slate-800 whitespace-pre-line leading-relaxed">
                      {rec.prescribedMedicine || 'No medicines recorded'}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-700">Duration: </span>
                        {rec.duration || '—'}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-700">Pharmacist: </span>
                        {rec.pharmacistSignature || 'Not signed'}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-700">Remarks: </span>
                        {rec.remarks || 'None'}
                      </div>
                    </div>

                    {rec.signatureDrawing && (
                      <div>
                        <p className="text-[11px] text-slate-500 mb-1">Digital Signature:</p>
                        <img
                          src={rec.signatureDrawing}
                          alt="Pharmacist signature"
                          className="h-12 object-contain bg-white border border-slate-200 rounded-lg px-2"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleCopy(rec)}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"
                      >
                        <Copy className="w-4 h-4" />
                        COPY RECORD
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(formatWhatsAppRecord(rec))}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5"
                      >
                        <MessageCircle className="w-4 h-4" />
                        SHARE TO WHATSAPP
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExportOne(rec)}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        EXPORT EXCEL
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(rec)}
                        className="min-h-[42px] px-3.5 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 inline-flex items-center gap-1.5 ml-auto"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              Delete Serial #{formatSerialNo(confirmDelete.serialNo)}?
            </h2>
            <p className="text-sm text-slate-600">
              This will permanently remove the record for{' '}
              <strong>{confirmDelete.patientName || 'this patient'}</strong>.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
