import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { MedicinePatientAdvice } from '../types/prescription.ts';
import {
  formatPatientAdviceWhatsApp,
  formatSingleMedicineAdviceWhatsApp,
} from '../lib/formatters.ts';

interface PatientAdviceSectionProps {
  adviceList: MedicinePatientAdvice[];
  isLoading: boolean;
  error: string | null;
  onChange: (nextList: MedicinePatientAdvice[]) => void;
  onRegenerate: () => void;
  onOpenWhatsApp: (formattedText: string) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export const PatientAdviceSection: React.FC<PatientAdviceSectionProps> = ({
  adviceList,
  isLoading,
  error,
  onChange,
  onRegenerate,
  onOpenWhatsApp,
  onNotify,
}) => {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedMedicineIdx, setCopiedMedicineIdx] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const formattedAll = formatPatientAdviceWhatsApp(adviceList);

  const handleCopyAll = async () => {
    if (!formattedAll) return;
    try {
      await navigator.clipboard.writeText(formattedAll);
      setCopiedAll(true);
      onNotify('Patient Advice copied successfully!', 'success');
      setTimeout(() => setCopiedAll(false), 2400);
    } catch {
      onNotify('Clipboard access denied. Open the preview or Share to WhatsApp.', 'error');
    }
  };

  const handleCopySingle = async (item: MedicinePatientAdvice, idx: number) => {
    const singleText = [
      '💊 PATIENT MEDICATION ADVICE',
      'රෝගී උපදෙස් | நோயாளி அறிவுரை',
      '',
      '━━━━━━━━━━━━━━',
      '',
      formatSingleMedicineAdviceWhatsApp(item, idx + 1),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(singleText);
      setCopiedMedicineIdx(idx);
      onNotify(`Copied counseling advice for ${item.medicineName}.`, 'success');
      setTimeout(() => setCopiedMedicineIdx(null), 2000);
    } catch {
      onNotify('Clipboard access denied.', 'error');
    }
  };

  const updateMedicineName = (medIdx: number, value: string) => {
    const next = adviceList.map((item, i) =>
      i === medIdx ? { ...item, medicineName: value } : item
    );
    onChange(next);
  };

  const togglePharmacistReviewed = (medIdx: number) => {
    const next = adviceList.map((item, i) =>
      i === medIdx
        ? { ...item, needsPharmacistReview: !item.needsPharmacistReview }
        : item
    );
    onChange(next);
  };

  const updateAdvicePoint = (
    medIdx: number,
    pointIdx: number,
    lang: 'sinhala' | 'tamil',
    value: string
  ) => {
    const next = adviceList.map((item, i) => {
      if (i !== medIdx) return item;
      const updatedPoints = item.advicePoints.map((pt, j) =>
        j === pointIdx ? { ...pt, [lang]: value } : pt
      );
      return { ...item, advicePoints: updatedPoints };
    });
    onChange(next);
  };

  const addAdvicePoint = (medIdx: number) => {
    const next = adviceList.map((item, i) => {
      if (i !== medIdx) return item;
      return {
        ...item,
        advicePoints: [...item.advicePoints, { sinhala: '', tamil: '' }],
      };
    });
    onChange(next);
  };

  const removeAdvicePoint = (medIdx: number, pointIdx: number) => {
    const target = adviceList[medIdx];
    if (!target || target.advicePoints.length <= 3) {
      onNotify('Each medicine must keep at least 3 patient advice points.', 'error');
      return;
    }
    const next = adviceList.map((item, i) => {
      if (i !== medIdx) return item;
      return {
        ...item,
        advicePoints: item.advicePoints.filter((_, j) => j !== pointIdx),
      };
    });
    onChange(next);
  };

  return (
    <section
      aria-label="Medicine-Wise Patient Counseling Advice"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-[#F8FAF9]">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-emerald-700 uppercase tracking-wide">
              PATIENT COUNSELLING
            </span>
            <span aria-hidden="true">·</span>
            <span>Sinhala &amp; Tamil</span>
            <span aria-hidden="true">·</span>
            <span>Separate from Excel Ledger</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 mt-1">
            💊 PATIENT ADVICE
          </h3>
          <p className="text-sm font-semibold text-emerald-800 mt-0.5">
            රෝගී උපදෙස් | நோயாளி அறிவுரை
          </p>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Review or edit any Sinhala/Tamil advice point below before sharing to WhatsApp. Not
            stored inside the Excel table.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isLoading}
            onClick={onRegenerate}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-medium hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 text-emerald-700 ${isLoading ? 'animate-spin' : ''}`} />
            Regenerate Advice
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 sm:p-6 space-y-5">
        {isLoading && (
          <div className="py-10 text-center space-y-3">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-700 mx-auto" />
            <p className="text-sm font-medium text-slate-800">
              Generating medicine-specific Sinhala &amp; Tamil counseling advice...
            </p>
            <p className="text-xs text-slate-500">
              Checking dosage forms, timing, food interactions, and age precautions for each
              medicine.
            </p>
          </div>
        )}

        {error && !isLoading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-red-800">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-700" />
              <div>
                <p className="font-semibold">Unable to generate patient advice</p>
                <p className="text-xs text-red-700 mt-0.5">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRegenerate}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white border border-red-300 text-red-800 text-xs font-semibold hover:bg-red-100 whitespace-nowrap self-start sm:self-auto"
            >
              Try Again
            </button>
          </div>
        )}

        {!isLoading && !error && adviceList.length === 0 && (
          <div className="py-8 text-center space-y-3">
            <p className="text-sm text-slate-600">
              Enter or extract medicines above, then tap <strong>Regenerate Advice</strong> to
              create Sinhala &amp; Tamil counseling points.
            </p>
          </div>
        )}

        {!isLoading && adviceList.length > 0 && (
          <>
            <div className="space-y-5">
              {adviceList.map((med, medIdx) => (
                <div
                  key={`${medIdx}-${med.medicineName}`}
                  className="border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 bg-white"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span className="px-2.5 h-8 rounded-lg bg-emerald-50 text-emerald-800 font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0">
                        Medicine {medIdx + 1}
                      </span>
                      <input
                        type="text"
                        value={med.medicineName}
                        onChange={(e) => updateMedicineName(medIdx, e.target.value)}
                        aria-label={`Medicine ${medIdx + 1} name`}
                        className="flex-1 min-w-0 min-h-[40px] px-3 py-1.5 text-sm sm:text-base font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopySingle(med, medIdx)}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                      >
                        {copiedMedicineIdx === medIdx ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedMedicineIdx === medIdx ? 'Copied' : 'Copy Medicine'}
                      </button>
                    </div>
                  </div>

                  {med.needsPharmacistReview && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-950">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">
                            Pharmacist Review Flagged: Medicine identity uncertain.
                          </span>
                          {med.reviewReason && (
                            <span className="block text-amber-900 mt-0.5">{med.reviewReason}</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePharmacistReviewed(medIdx)}
                        className="min-h-[36px] px-3 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 font-medium hover:bg-amber-100 whitespace-nowrap self-start sm:self-auto"
                      >
                        Clear Flag
                      </button>
                    </div>
                  )}

                  <div className="space-y-3">
                    {med.advicePoints.map((pt, ptIdx) => {
                      const numLabel = String(ptIdx + 1).padStart(2, '0');
                      return (
                        <div
                          key={ptIdx}
                          className="bg-[#F8FAF9] border border-slate-200 rounded-xl p-3.5 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono tabular-nums font-semibold text-emerald-800">
                              Advice Point {numLabel}
                            </span>
                            {med.advicePoints.length > 3 && (
                              <button
                                type="button"
                                onClick={() => removeAdvicePoint(medIdx, ptIdx)}
                                className="text-xs text-slate-400 hover:text-red-600 p-1 rounded-lg"
                                aria-label={`Remove advice point ${numLabel}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                Sinhala (උපදෙස් {numLabel})
                              </label>
                              <textarea
                                rows={2}
                                value={pt.sinhala}
                                onChange={(e) =>
                                  updateAdvicePoint(medIdx, ptIdx, 'sinhala', e.target.value)
                                }
                                className="w-full px-3 py-2 text-xs sm:text-sm text-slate-900 bg-white border border-slate-200 rounded-xl leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                Tamil (அறிவுரை {numLabel})
                              </label>
                              <textarea
                                rows={2}
                                value={pt.tamil}
                                onChange={(e) =>
                                  updateAdvicePoint(medIdx, ptIdx, 'tamil', e.target.value)
                                }
                                className="w-full px-3 py-2 text-xs sm:text-sm text-slate-900 bg-white border border-slate-200 rounded-xl leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => addAdvicePoint(medIdx)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5 text-emerald-700" />
                      Add Advice Point
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Collapsible WhatsApp Copy-Ready Preview */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 hover:text-emerald-700 min-h-[36px]"
                >
                  {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showPreview
                    ? 'Hide WhatsApp Message Preview'
                    : 'Preview WhatsApp Message Format'}
                </button>
              </div>

              {showPreview && (
                <pre className="p-4 bg-white border-t border-slate-200 whitespace-pre-wrap font-sans text-xs sm:text-sm text-slate-800 leading-relaxed select-all">
                  {formattedAll}
                </pre>
              )}
            </div>

            {/* Dedicated WhatsApp Share & Copy All Action Bar Below Patient Advice */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onOpenWhatsApp(formattedAll)}
                className="min-h-[52px] px-4 py-3 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] active:scale-[0.99] text-slate-950 border border-[#1da851] text-xs sm:text-sm font-bold transition-all inline-flex items-center justify-center gap-2 text-center sm:whitespace-nowrap shadow-xs"
              >
                <MessageCircle className="w-5 h-5 shrink-0" />
                <span>SHARE PATIENT ADVICE TO WHATSAPP</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopyAll()}
                className="min-h-[52px] px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-[0.99] text-slate-900 border border-slate-300 text-xs sm:text-sm font-semibold transition-all inline-flex items-center justify-center gap-2 text-center sm:whitespace-nowrap"
              >
                {copiedAll ? (
                  <Check className="w-5 h-5 shrink-0 text-emerald-700" />
                ) : (
                  <Copy className="w-5 h-5 shrink-0 text-slate-700" />
                )}
                <span>{copiedAll ? 'COPIED PATIENT ADVICE' : 'COPY ALL PATIENT ADVICE'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
