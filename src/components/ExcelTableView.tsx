import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  Check,
  Copy,
  FileSpreadsheet,
  LayoutGrid,
  MessageCircle,
  PenTool,
  Plus,
  Search,
  Table as TableIcon,
  Trash2,
  X,
} from 'lucide-react';
import type {
  PrescriptionDraft,
  PrescriptionRecord,
  SortDirection,
  SortField,
} from '../types/prescription.ts';
import { REMARK_PRESETS } from '../types/prescription.ts';
import { exportPrescriptionsToExcel } from '../lib/excelExport.ts';
import {
  formatSerialNo,
  formatWhatsAppRecord,
  getTodayDDMMYYYY,
  normalizeDateInput,
  parseDDMMYYYYToTime,
} from '../lib/formatters.ts';
import {
  createPrescriptionWithSerial,
  deletePrescriptionRecord,
  updatePrescriptionRecord,
} from '../lib/prescriptionService.ts';
import { SignaturePadModal } from './SignaturePadModal.tsx';

interface ExcelTableViewProps {
  uid: string;
  records: PrescriptionRecord[];
  onOpenWhatsApp: (formattedText: string) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
  initialSearch?: string;
}

type EditableField =
  | 'date'
  | 'prescriberName'
  | 'patientName'
  | 'age'
  | 'sex'
  | 'prescribedMedicine'
  | 'duration'
  | 'pharmacistSignature'
  | 'remarks';

export const ExcelTableView: React.FC<ExcelTableViewProps> = ({
  uid,
  records,
  onOpenWhatsApp,
  onNotify,
  initialSearch = '',
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [dateFilter, setDateFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('serialNo');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState<PrescriptionRecord | null>(null);
  const [signatureTarget, setSignatureTarget] = useState<PrescriptionRecord | null>(null);
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [newRowDraft, setNewRowDraft] = useState<PrescriptionDraft>({
    date: getTodayDDMMYYYY(),
    dateIsRecordDate: true,
    prescriberName: '',
    patientName: '',
    age: '',
    sex: '',
    prescribedMedicine: '',
    duration: '',
    pharmacistSignature: '',
    remarks: '',
  });

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const df = dateFilter.trim();
    const normalizedFilterDate = df ? normalizeDateInput(df) : null;

    const filtered = records.filter((rec) => {
      if (df) {
        if (normalizedFilterDate) {
          if (rec.date !== normalizedFilterDate) return false;
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

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'serialNo') {
        cmp = a.serialNo - b.serialNo;
      } else {
        cmp = parseDDMMYYYYToTime(a.date) - parseDDMMYYYYToTime(b.date);
        if (cmp === 0) cmp = a.serialNo - b.serialNo;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [records, searchQuery, dateFilter, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const startCellEdit = (rec: PrescriptionRecord, field: EditableField) => {
    setEditingCell({ id: rec.id, field });
    setCellValue(String(rec[field] ?? ''));
  };

  const commitCellEdit = async (
    rec: PrescriptionRecord,
    field: EditableField,
    overrideValue?: string
  ) => {
    const val = overrideValue !== undefined ? overrideValue : cellValue;
    setEditingCell(null);

    if (String(rec[field] ?? '') === val) return;

    if (field === 'date') {
      const normalized = normalizeDateInput(val);
      if (!normalized) {
        onNotify('Date must be formatted as DD/MM/YYYY.', 'error');
        return;
      }
      setSavingRowId(rec.id);
      try {
        await updatePrescriptionRecord(uid, rec.id, { date: normalized, dateIsRecordDate: false });
        onNotify(`Updated Date for Serial #${formatSerialNo(rec.serialNo)}.`, 'success');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Failed to update cell.', 'error');
      } finally {
        setSavingRowId(null);
      }
      return;
    }

    setSavingRowId(rec.id);
    try {
      await updatePrescriptionRecord(uid, rec.id, { [field]: val });
      onNotify(`Saved change in Serial #${formatSerialNo(rec.serialNo)}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update cell.', 'error');
    } finally {
      setSavingRowId(null);
    }
  };

  const handleAddRowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedDate = normalizeDateInput(newRowDraft.date);
    if (!normalizedDate) {
      onNotify('Please enter a valid date (DD/MM/YYYY).', 'error');
      return;
    }
    try {
      const res = await createPrescriptionWithSerial(uid, {
        ...newRowDraft,
        date: normalizedDate,
      });
      setShowAddRowModal(false);
      setNewRowDraft({
        date: getTodayDDMMYYYY(),
        dateIsRecordDate: true,
        prescriberName: '',
        patientName: '',
        age: '',
        sex: '',
        prescribedMedicine: '',
        duration: '',
        pharmacistSignature: '',
        remarks: '',
      });
      onNotify(`Added record #${formatSerialNo(res.serialNo)}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add record.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteRecord) return;
    try {
      await deletePrescriptionRecord(uid, confirmDeleteRecord.id);
      onNotify(`Deleted Serial #${formatSerialNo(confirmDeleteRecord.serialNo)}.`, 'success');
      setConfirmDeleteRecord(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    }
  };

  const handleCopyRecord = async (rec: PrescriptionRecord) => {
    try {
      await navigator.clipboard.writeText(formatWhatsAppRecord(rec));
      onNotify(`Copied Serial #${formatSerialNo(rec.serialNo)} for WhatsApp.`, 'success');
    } catch {
      onNotify('Clipboard access denied.', 'error');
    }
  };

  const handleExportAll = async () => {
    try {
      await exportPrescriptionsToExcel(filteredRecords, 'pharmacy-prescription-records');
      onNotify(`Exported ${filteredRecords.length} record(s) to Excel (.xlsx).`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  };

  const handleExportSingle = async (rec: PrescriptionRecord) => {
    try {
      await exportPrescriptionsToExcel([rec], `prescription-${formatSerialNo(rec.serialNo)}`);
      onNotify(`Exported Serial #${formatSerialNo(rec.serialNo)} to Excel.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Prescription Records Ledger</h1>
            <p className="text-xs text-slate-500">
              Click any cell to edit inline · Showing{' '}
              <span className="font-mono tabular-nums font-medium text-slate-800">
                {filteredRecords.length}
              </span>{' '}
              of <span className="font-mono tabular-nums">{records.length}</span> records
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                Excel Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 ${
                  viewMode === 'cards'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Mobile Cards
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowAddRowModal(true)}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-emerald-700" />
              Add Row
            </button>

            <button
              type="button"
              disabled={filteredRecords.length === 0}
              onClick={handleExportAll}
              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export Excel (.xlsx)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <div className="sm:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patient name, doctor name, or medicine..."
              className="w-full min-h-[44px] pl-10 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="sm:col-span-3 relative">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              placeholder="Filter date DD/MM/YYYY"
              className="w-full min-h-[44px] pl-10 pr-8 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                aria-label="Clear date filter"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="sm:col-span-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleSort('serialNo')}
              className={`flex-1 min-h-[44px] px-3 py-2 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${
                sortField === 'serialNo'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Serial {sortField === 'serialNo' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
            <button
              type="button"
              onClick={() => toggleSort('date')}
              className={`flex-1 min-h-[44px] px-3 py-2 rounded-xl border text-xs font-medium inline-flex items-center justify-center gap-1.5 whitespace-nowrap ${
                sortField === 'date'
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Date {sortField === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {filteredRecords.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
          <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900">
            {records.length === 0 ? 'No prescriptions saved yet' : 'No matching records found'}
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {records.length === 0
              ? 'Scan a prescription photo or click Add Row to start your pharmacy ledger.'
              : 'Try clearing the date filter or adjusting your search terms.'}
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* Excel-Style Spreadsheet Grid */
        <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto excel-scroll">
            <table className="w-full border-collapse text-left text-xs sm:text-sm min-w-[1280px]">
              <thead>
                <tr className="bg-emerald-800 text-white font-semibold">
                  <th className="sticky left-0 z-20 bg-emerald-800 border border-emerald-700 px-3 py-2.5 w-24 text-center whitespace-nowrap">
                    1. Serial No.
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-32 whitespace-nowrap">
                    2. Date
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-44 whitespace-nowrap">
                    3. Prescriber Name
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-44 whitespace-nowrap">
                    4. Patient Name
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-20 text-center whitespace-nowrap">
                    5. Age
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-24 text-center whitespace-nowrap">
                    6. Sex
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 min-w-[300px] whitespace-nowrap">
                    7. Prescribed Medicine
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-40 whitespace-nowrap">
                    8. Duration
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-44 whitespace-nowrap">
                    9. Pharmacist Signature
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-48 whitespace-nowrap">
                    10. Remarks
                  </th>
                  <th className="border border-emerald-700 px-3 py-2.5 w-36 text-center whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((rec, rowIdx) => {
                  const isEditingThis = (field: EditableField) =>
                    editingCell?.id === rec.id && editingCell?.field === field;

                  return (
                    <tr
                      key={rec.id}
                      className={`${
                        rowIdx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAF9]'
                      } hover:bg-emerald-50/40 transition-colors align-top`}
                    >
                      {/* 1. Serial No. (Immutable) */}
                      <td className="sticky left-0 z-10 bg-inherit border border-slate-200 px-3 py-2.5 text-center font-mono tabular-nums font-semibold text-slate-900">
                        {formatSerialNo(rec.serialNo)}
                        {savingRowId === rec.id && (
                          <span className="block text-[10px] text-emerald-700 font-sans font-normal">
                            Saving...
                          </span>
                        )}
                      </td>

                      {/* 2. Date */}
                      <td
                        onClick={() => !isEditingThis('date') && startCellEdit(rec, 'date')}
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer font-mono tabular-nums text-slate-800"
                      >
                        {isEditingThis('date') ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'date')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitCellEdit(rec, 'date');
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none"
                          />
                        ) : (
                          <div>
                            <span>{rec.date}</span>
                            {rec.dateIsRecordDate && (
                              <span className="block text-[10px] font-sans text-slate-500">
                                Record Date
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 3. Prescriber Name */}
                      <td
                        onClick={() =>
                          !isEditingThis('prescriberName') && startCellEdit(rec, 'prescriberName')
                        }
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer text-slate-900"
                      >
                        {isEditingThis('prescriberName') ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'prescriberName')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitCellEdit(rec, 'prescriberName');
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none"
                          />
                        ) : (
                          <span>{rec.prescriberName || '—'}</span>
                        )}
                      </td>

                      {/* 4. Patient Name */}
                      <td
                        onClick={() =>
                          !isEditingThis('patientName') && startCellEdit(rec, 'patientName')
                        }
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer font-medium text-slate-900"
                      >
                        {isEditingThis('patientName') ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'patientName')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitCellEdit(rec, 'patientName');
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none"
                          />
                        ) : (
                          <span>{rec.patientName || '—'}</span>
                        )}
                      </td>

                      {/* 5. Age */}
                      <td
                        onClick={() => !isEditingThis('age') && startCellEdit(rec, 'age')}
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer text-center font-mono tabular-nums text-slate-800"
                      >
                        {isEditingThis('age') ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'age')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitCellEdit(rec, 'age');
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none text-center"
                          />
                        ) : (
                          <span>{rec.age || '—'}</span>
                        )}
                      </td>

                      {/* 6. Sex */}
                      <td
                        onClick={() => !isEditingThis('sex') && startCellEdit(rec, 'sex')}
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer text-center text-slate-800"
                      >
                        {isEditingThis('sex') ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'sex')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitCellEdit(rec, 'sex');
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none text-center"
                          />
                        ) : (
                          <span>{rec.sex || '—'}</span>
                        )}
                      </td>

                      {/* 7. Prescribed Medicine */}
                      <td
                        onClick={() =>
                          !isEditingThis('prescribedMedicine') &&
                          startCellEdit(rec, 'prescribedMedicine')
                        }
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer text-slate-900"
                      >
                        {isEditingThis('prescribedMedicine') ? (
                          <textarea
                            autoFocus
                            rows={4}
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'prescribedMedicine')}
                            className="w-full px-2 py-1.5 text-xs bg-white border border-emerald-600 rounded focus:outline-none leading-relaxed"
                          />
                        ) : (
                          <div className="whitespace-pre-line leading-relaxed text-xs">
                            {rec.prescribedMedicine || '—'}
                          </div>
                        )}
                      </td>

                      {/* 8. Duration */}
                      <td
                        onClick={() => !isEditingThis('duration') && startCellEdit(rec, 'duration')}
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer text-slate-800"
                      >
                        {isEditingThis('duration') ? (
                          <input
                            autoFocus
                            type="text"
                            value={cellValue}
                            onChange={(e) => setCellValue(e.target.value)}
                            onBlur={() => void commitCellEdit(rec, 'duration')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitCellEdit(rec, 'duration');
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none"
                          />
                        ) : (
                          <span className="text-xs">{rec.duration || '—'}</span>
                        )}
                      </td>

                      {/* 9. Pharmacist Signature */}
                      <td className="border border-slate-200 px-2.5 py-2 text-slate-800">
                        <div className="flex items-start justify-between gap-1.5">
                          <div
                            onClick={() =>
                              !isEditingThis('pharmacistSignature') &&
                              startCellEdit(rec, 'pharmacistSignature')
                            }
                            className="flex-1 cursor-pointer min-h-[24px]"
                          >
                            {isEditingThis('pharmacistSignature') ? (
                              <input
                                autoFocus
                                type="text"
                                value={cellValue}
                                onChange={(e) => setCellValue(e.target.value)}
                                onBlur={() => void commitCellEdit(rec, 'pharmacistSignature')}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter')
                                    void commitCellEdit(rec, 'pharmacistSignature');
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none"
                              />
                            ) : (
                              <div>
                                <span className="text-xs">
                                  {rec.pharmacistSignature || (
                                    <span className="text-slate-400 italic">Tap to sign</span>
                                  )}
                                </span>
                                {rec.signatureDrawing && (
                                  <img
                                    src={rec.signatureDrawing}
                                    alt="Signature"
                                    className="mt-1 h-7 object-contain bg-white border border-slate-200 rounded px-1"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSignatureTarget(rec)}
                            className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 shrink-0"
                            title="Open signature pad"
                            aria-label="Open signature pad"
                          >
                            <PenTool className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* 10. Remarks */}
                      <td
                        onClick={() => !isEditingThis('remarks') && startCellEdit(rec, 'remarks')}
                        className="border border-slate-200 px-2.5 py-2 cursor-pointer text-slate-800"
                      >
                        {isEditingThis('remarks') ? (
                          <div className="space-y-1">
                            <input
                              autoFocus
                              type="text"
                              value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => void commitCellEdit(rec, 'remarks')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void commitCellEdit(rec, 'remarks');
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              className="w-full px-1.5 py-1 text-xs bg-white border border-emerald-600 rounded focus:outline-none"
                            />
                            <div className="flex flex-wrap gap-1">
                              {REMARK_PRESETS.slice(0, 4).map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    void commitCellEdit(rec, 'remarks', p);
                                  }}
                                  className="px-1.5 py-0.5 text-[10px] bg-slate-100 hover:bg-emerald-100 rounded text-slate-700"
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs">
                            {rec.remarks || <span className="text-slate-400 italic">Add remark</span>}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="border border-slate-200 px-2 py-2 text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleCopyRecord(rec)}
                            className="p-2 rounded-lg text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
                            title="Copy for WhatsApp"
                            aria-label="Copy record"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenWhatsApp(formatWhatsAppRecord(rec))}
                            className="p-2 rounded-lg text-emerald-700 hover:bg-emerald-50"
                            title="Share to WhatsApp"
                            aria-label="Share to WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleExportSingle(rec)}
                            className="p-2 rounded-lg text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
                            title="Export single Excel"
                            aria-label="Export single Excel"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRecord(rec)}
                            className="p-2 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50"
                            title="Delete record"
                            aria-label="Delete record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Responsive Mobile Card Ledger View */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRecords.map((rec) => (
            <div
              key={rec.id}
              className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono tabular-nums font-semibold text-emerald-700">
                      #{formatSerialNo(rec.serialNo)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{rec.date}</span>
                    {rec.dateIsRecordDate && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Record Date</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                    {rec.patientName || 'Patient Not Mentioned'}
                  </h3>
                  <p className="text-xs text-slate-600">
                    {rec.prescriberName || 'Prescriber Not Mentioned'} · Age: {rec.age || '—'} ·
                    Sex: {rec.sex || '—'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteRecord(rec)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-700 hover:bg-red-50"
                  aria-label="Delete record"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 whitespace-pre-line leading-relaxed">
                {rec.prescribedMedicine || 'No medicines listed'}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>
                  <span className="font-medium text-slate-700">Duration: </span>
                  {rec.duration || '—'}
                </div>
                <div>
                  <span className="font-medium text-slate-700">Remarks: </span>
                  {rec.remarks || '—'}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSignatureTarget(rec)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                >
                  <PenTool className="w-3.5 h-3.5 text-emerald-700" />
                  {rec.pharmacistSignature ? 'Edit Sign' : 'Sign'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyRecord(rec)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(formatWhatsAppRecord(rec))}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 hover:bg-emerald-100 inline-flex items-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportSingle(rec)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteRecord && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-slate-900">
              Delete Prescription #{formatSerialNo(confirmDeleteRecord.serialNo)}?
            </h2>
            <p className="text-sm text-slate-600">
              This will permanently remove the record for{' '}
              <strong>{confirmDeleteRecord.patientName || 'this patient'}</strong>. Existing
              serial numbers for other records will not change.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteRecord(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteConfirm()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700"
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Row Modal */}
      {showAddRowModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleAddRowSubmit}
            className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Add New Prescription Row</h2>
              <button
                type="button"
                onClick={() => setShowAddRowModal(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3.5 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Date (DD/MM/YYYY)
                  </label>
                  <input
                    type="text"
                    value={newRowDraft.date}
                    onChange={(e) => setNewRowDraft({ ...newRowDraft, date: e.target.value })}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Prescriber Name
                  </label>
                  <input
                    type="text"
                    value={newRowDraft.prescriberName}
                    onChange={(e) =>
                      setNewRowDraft({ ...newRowDraft, prescriberName: e.target.value })
                    }
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Patient Name
                  </label>
                  <input
                    type="text"
                    value={newRowDraft.patientName}
                    onChange={(e) =>
                      setNewRowDraft({ ...newRowDraft, patientName: e.target.value })
                    }
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Age</label>
                  <input
                    type="text"
                    value={newRowDraft.age}
                    onChange={(e) => setNewRowDraft({ ...newRowDraft, age: e.target.value })}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sex</label>
                  <input
                    type="text"
                    value={newRowDraft.sex}
                    onChange={(e) => setNewRowDraft({ ...newRowDraft, sex: e.target.value })}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Prescribed Medicine
                </label>
                <textarea
                  rows={4}
                  value={newRowDraft.prescribedMedicine}
                  onChange={(e) =>
                    setNewRowDraft({ ...newRowDraft, prescribedMedicine: e.target.value })
                  }
                  placeholder="1. Medicine 500 mg – 1 tablet twice daily"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Duration</label>
                  <input
                    type="text"
                    value={newRowDraft.duration}
                    onChange={(e) => setNewRowDraft({ ...newRowDraft, duration: e.target.value })}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
                  <input
                    type="text"
                    value={newRowDraft.remarks}
                    onChange={(e) => setNewRowDraft({ ...newRowDraft, remarks: e.target.value })}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
            </div>
            <div className="p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 pb-safe">
              <button
                type="button"
                onClick={() => setShowAddRowModal(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-700 text-white font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Save Row
              </button>
            </div>
          </form>
        </div>
      )}

      <SignaturePadModal
        isOpen={Boolean(signatureTarget)}
        initialName={signatureTarget?.pharmacistSignature || ''}
        onClose={() => setSignatureTarget(null)}
        onSave={(name, drawingDataUrl) => {
          if (!signatureTarget) return;
          void updatePrescriptionRecord(uid, signatureTarget.id, {
            pharmacistSignature: name,
            signatureDrawing: drawingDataUrl || signatureTarget.signatureDrawing || '',
          })
            .then(() =>
              onNotify(
                `Pharmacist signature saved on Serial #${formatSerialNo(signatureTarget.serialNo)}.`,
                'success'
              )
            )
            .catch((err) =>
              onNotify(err instanceof Error ? err.message : 'Signature save failed.', 'error')
            );
        }}
      />
    </div>
  );
};
