import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Copy,
  Download,
  Edit3,
  FileSpreadsheet,
  Loader2,
  MessageCircle,
  PenTool,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  MedicinePatientAdvice,
  PrescriptionDraft,
  PrescriptionRecord,
  ScanExtractionResult,
} from '../types/prescription.ts';
import { REMARK_PRESETS } from '../types/prescription.ts';
import { auth } from '../lib/firebase.ts';
import { exportPrescriptionsToExcel } from '../lib/excelExport.ts';
import {
  formatSerialNo,
  formatWhatsAppRecord,
  getTodayDDMMYYYY,
  normalizeDateInput,
} from '../lib/formatters.ts';
import { preparePrescriptionImage } from '../lib/imageUtils.ts';
import { createPrescriptionWithSerial, updatePrescriptionRecord } from '../lib/prescriptionService.ts';
import { CameraModal } from './CameraModal.tsx';
import { PatientAdviceSection } from './PatientAdviceSection.tsx';
import { SignaturePadModal } from './SignaturePadModal.tsx';

interface ScanReviewViewProps {
  uid: string;
  nextSerialNo: number;
  initialFile?: File | null;
  onClearInitialFile?: () => void;
  onRecordSaved: (recordId: string, serialNo: number) => void;
  onOpenWhatsApp: (formattedText: string) => void;
  onNotify: (message: string, tone?: 'success' | 'error') => void;
}

export const ScanReviewView: React.FC<ScanReviewViewProps> = ({
  uid,
  nextSerialNo,
  initialFile = null,
  onClearInitialFile,
  onRecordSaved,
  onOpenWhatsApp,
  onNotify,
}) => {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSignatureOpen, setIsSignatureOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState<'analyzing' | 'retrying'>('analyzing');
  const [scanError, setScanError] = useState<{
    sinhala: string;
    english: string;
    isBusy: boolean;
  } | null>(null);

  const [retainedImage, setRetainedImage] = useState<{
    base64: string;
    mimeType: string;
    previewUrl: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isImageExpanded, setIsImageExpanded] = useState(false);
  const [imgGuideError, setImgGuideError] = useState(false);

  const [draft, setDraft] = useState<PrescriptionDraft | null>(null);
  const [isEditing, setIsEditing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMeta, setSavedMeta] = useState<{ id: string; serialNo: number } | null>(null);
  const [copiedRecently, setCopiedRecently] = useState(false);

  const [adviceList, setAdviceList] = useState<MedicinePatientAdvice[]>([]);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const scanInFlightRef = useRef(false);
  const saveInFlightRef = useRef(false);

  const activeSerial = savedMeta ? savedMeta.serialNo : nextSerialNo;

  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    if (initialFile) {
      const fileToScan = initialFile;
      onClearInitialFile?.();
      void processFile(fileToScan);
    }
  }, [initialFile]);

  const fetchPatientAdvice = async (params: {
    prescribedMedicineText: string;
    age?: string;
    sex?: string;
    duration?: string;
  }) => {
    const cleanedMeds = params.prescribedMedicineText.trim();
    if (!cleanedMeds) {
      setAdviceList([]);
      setAdviceError('Enter at least one medicine above before generating counseling advice.');
      return;
    }

    setAdviceLoading(true);
    setAdviceError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Please sign in to generate patient advice.');
      }
      const token = await user.getIdToken();

      const res = await fetch('/api/patient-advice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prescribedMedicineText: cleanedMeds,
          age: params.age,
          sex: params.sex,
          duration: params.duration,
        }),
      });

      const data = (await res.json()) as {
        advice?: { items?: MedicinePatientAdvice[] };
        error?: string;
      };

      if (!res.ok || !data.advice?.items) {
        throw new Error(data.error || 'Could not generate medicine-wise patient advice.');
      }

      setAdviceList(data.advice.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate patient advice.';
      setAdviceError(msg);
    } finally {
      setAdviceLoading(false);
    }
  };

  const sleepWithAbort = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

  const sanitizeUiError = (
    rawMessage: string,
    code?: string
  ): { sinhala: string; english: string; isBusy: boolean } => {
    const busySinhala =
      'දැනට AI සේවාව කාර්යබහුලයි. ඔබගේ Prescription photo එක ආරක්ෂිතව තබා ඇත. නැවත Scan කිරීමට උත්සාහ කරන්න.';
    const busyEnglish =
      'The AI service is temporarily busy. Your prescription image is retained. Please try scanning again.';

    if (
      code === 'SERVICE_BUSY' ||
      code === 'RATE_LIMIT' ||
      code === 'MODEL_UNAVAILABLE' ||
      !rawMessage ||
      rawMessage.trim().startsWith('{') ||
      rawMessage.includes('503') ||
      rawMessage.includes('429') ||
      rawMessage.includes('502') ||
      rawMessage.includes('504') ||
      rawMessage.includes('UNAVAILABLE') ||
      rawMessage.toLowerCase().includes('fetch') ||
      rawMessage.toLowerCase().includes('network')
    ) {
      return { sinhala: busySinhala, english: busyEnglish, isBusy: true };
    }

    return {
      sinhala:
        'දැනට AI සේවාව කාර්යබහුලයි. ඔබගේ Prescription photo එක ආරක්ෂිතව තබා ඇත. නැවත Scan කිරීමට උත්සාහ කරන්න.',
      english: rawMessage,
      isBusy: false,
    };
  };

  const executeScanWithPreparedImage = async (prepared: {
    base64: string;
    mimeType: string;
    previewUrl: string;
  }) => {
    if (scanInFlightRef.current) return;

    scanInFlightRef.current = true;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setScanError(null);
    setScanPhase('analyzing');
    setIsScanning(true);
    setSavedMeta(null);
    setAdviceList([]);
    setAdviceError(null);
    setRetainedImage(prepared);
    setPreviewUrl(prepared.previewUrl);

    const transportBackoffMs = [2000, 4000, 8000];

    try {
      const user = auth.currentUser;
      if (!user) {
        throw { code: 'AUTH_ERROR', retryExhausted: true, message: 'Please sign in to scan prescriptions.' };
      }

      let extractedResult: ScanExtractionResult | null = null;

      for (let transportAttempt = 0; transportAttempt <= transportBackoffMs.length; transportAttempt++) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        try {
          const token = await user.getIdToken();
          const response = await fetch('/api/scan-prescription', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/x-ndjson',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              imageBase64: prepared.base64,
              mimeType: prepared.mimeType,
            }),
            signal: controller.signal,
          });

          const contentType = response.headers.get('content-type') || '';

          if (contentType.includes('application/x-ndjson') && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let evt: {
                  type?: string;
                  state?: 'analyzing' | 'retrying';
                  result?: ScanExtractionResult;
                  code?: string;
                  retryExhausted?: boolean;
                  message?: string;
                };
                try {
                  evt = JSON.parse(trimmed);
                } catch {
                  throw { code: 'SERVICE_BUSY', retryExhausted: false, message: '' };
                }

                if (evt.type === 'status') {
                  if (evt.state === 'retrying') {
                    setScanPhase('retrying');
                  } else if (evt.state === 'analyzing') {
                    setScanPhase('analyzing');
                  }
                } else if (evt.type === 'result' && evt.result) {
                  extractedResult = evt.result;
                } else if (evt.type === 'error') {
                  throw {
                    code: evt.code || 'SERVICE_BUSY',
                    retryExhausted: Boolean(evt.retryExhausted),
                    message: evt.message || '',
                  };
                }
              }
            }

            if (buffer.trim()) {
              let evt: {
                type?: string;
                result?: ScanExtractionResult;
                code?: string;
                retryExhausted?: boolean;
                message?: string;
              };
              try {
                evt = JSON.parse(buffer.trim());
              } catch {
                throw { code: 'SERVICE_BUSY', retryExhausted: false, message: '' };
              }
              if (evt.type === 'result' && evt.result) {
                extractedResult = evt.result;
              } else if (evt.type === 'error') {
                throw {
                  code: evt.code || 'SERVICE_BUSY',
                  retryExhausted: Boolean(evt.retryExhausted),
                  message: evt.message || '',
                };
              }
            }

            if (!extractedResult) {
              throw { code: 'SERVICE_BUSY', retryExhausted: true, message: '' };
            }
            break;
          } else {
            const payload = (await response.json().catch(() => ({}))) as {
              result?: ScanExtractionResult;
              error?: string;
              code?: string;
              retryExhausted?: boolean;
            };

            if (!response.ok || !payload.result) {
              const isGatewayTransient =
                response.status === 502 ||
                response.status === 503 ||
                response.status === 504 ||
                response.status === 429 ||
                response.status === 500;
              throw {
                code: payload.code || (isGatewayTransient ? 'SERVICE_BUSY' : 'SCAN_FAILED'),
                retryExhausted: Boolean(payload.retryExhausted) || !isGatewayTransient,
                message: payload.error || '',
              };
            }

            extractedResult = payload.result;
            break;
          }
        } catch (attemptErr) {
          if ((attemptErr as { name?: string })?.name === 'AbortError' || controller.signal.aborted) {
            throw attemptErr;
          }
          const structured = attemptErr as { code?: string; retryExhausted?: boolean; message?: string };
          if (structured?.retryExhausted) {
            throw attemptErr;
          }
          if (transportAttempt < transportBackoffMs.length) {
            setScanPhase('retrying');
            const waitMs = transportBackoffMs[transportAttempt] + Math.floor(Math.random() * 450);
            await sleepWithAbort(waitMs, controller.signal);
            continue;
          }
          throw attemptErr;
        }
      }

      if (!extractedResult) {
        throw { code: 'SERVICE_BUSY', retryExhausted: true, message: '' };
      }

      const ext = extractedResult;
      const parsedDate = ext.extractedDate ? normalizeDateInput(ext.extractedDate) : null;
      const hasDate = Boolean(parsedDate);
      const finalDate = parsedDate || getTodayDDMMYYYY();

      const formattedMeds =
        ext.prescribedMedicineText?.trim() ||
        (ext.medicines && ext.medicines.length > 0
          ? ext.medicines
              .map((m, idx) => {
                const lineParts = [m.name, m.dosage, m.duration].filter(Boolean);
                return `${idx + 1}. ${lineParts.join(' – ')}`;
              })
              .join('\n')
          : 'Unclear – Please Verify');

      const nextDraft: PrescriptionDraft = {
        date: finalDate,
        dateIsRecordDate: !hasDate,
        prescriberName: ext.prescriberName?.trim() || 'Not mentioned',
        patientName: ext.patientName?.trim() || 'Not mentioned',
        age: ext.age?.trim() || 'Not mentioned',
        sex: ext.sex?.trim() || 'Not mentioned',
        prescribedMedicine: formattedMeds,
        duration: ext.duration?.trim() || 'Not mentioned',
        // Sections 7 & 8: Pharmacist Signature & Remarks MUST remain empty after AI scan
        pharmacistSignature: '',
        signatureDrawing: '',
        remarks: '',
        confidenceNotes: ext.confidenceNotes || '',
        medicines: ext.medicines || [],
      };

      setDraft(nextDraft);
      setIsEditing(true);
      // Clear heavy base64 buffer once extracted while keeping lightweight previewUrl until confirm
      setRetainedImage((prev) => (prev ? { ...prev, base64: '' } : null));

      // Automatically generate separate Sinhala + Tamil counseling advice for each extracted medicine
      void fetchPatientAdvice({
        prescribedMedicineText: nextDraft.prescribedMedicine,
        age: nextDraft.age,
        sex: nextDraft.sex,
        duration: nextDraft.duration,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || controller.signal.aborted) {
        // User cancelled mid-scan: keep retained image so they can retry or discard without re-uploading
        setScanError({
          sinhala:
            'Scan කිරීම නවතා ඇත. ඔබගේ Prescription photo එක ආරක්ෂිතව තබා ඇත. නැවත Scan කිරීමට උත්සාහ කරන්න.',
          english:
            'Scan cancelled. Your prescription image is retained. Tap Retry Scan to continue or Cancel to clear.',
          isBusy: false,
        });
        return;
      }

      const structured = err as { code?: string; message?: string };
      const rawMsg =
        err instanceof Error ? err.message : typeof structured?.message === 'string' ? structured.message : '';
      const friendly = sanitizeUiError(rawMsg, structured?.code);
      setScanError(friendly);
      onNotify(friendly.english, 'error');
    } finally {
      scanInFlightRef.current = false;
      setIsScanning(false);
    }
  };

  const processFile = async (file: File | Blob) => {
    if (scanInFlightRef.current) return;
    try {
      const prepared = await preparePrescriptionImage(file);
      await executeScanWithPreparedImage(prepared);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : '';
      const friendly = sanitizeUiError(rawMsg, 'INVALID_IMAGE');
      setScanError(friendly);
      onNotify(friendly.english, 'error');
    }
  };

  const handleRetryScan = () => {
    if (!retainedImage || !retainedImage.base64 || scanInFlightRef.current) return;
    void executeScanWithPreparedImage(retainedImage);
  };

  const handleCancelActiveScan = () => {
    abortControllerRef.current?.abort();
  };

  const handleDiscardRetainedError = () => {
    abortControllerRef.current?.abort();
    setScanError(null);
    setRetainedImage(null);
    setPreviewUrl(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void processFile(file);
    }
  };

  const handleStartManualEntry = () => {
    abortControllerRef.current?.abort();
    setScanError(null);
    setRetainedImage(null);
    setPreviewUrl(null);
    setSavedMeta(null);
    setAdviceList([]);
    setAdviceError(null);
    setDraft({
      date: getTodayDDMMYYYY(),
      dateIsRecordDate: true,
      prescriberName: '',
      patientName: '',
      age: '',
      sex: '',
      prescribedMedicine: '',
      duration: '',
      pharmacistSignature: '',
      signatureDrawing: '',
      remarks: '',
      confidenceNotes: '',
    });
    setIsEditing(true);
  };

  const handleConfirmRecord = async () => {
    if (!draft || saveInFlightRef.current) return;

    const normalizedDate = normalizeDateInput(draft.date);
    if (!normalizedDate) {
      onNotify('Please enter a valid date in DD/MM/YYYY format.', 'error');
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    try {
      const cleanDraft: PrescriptionDraft = {
        ...draft,
        date: normalizedDate,
      };

      if (savedMeta) {
        await updatePrescriptionRecord(uid, savedMeta.id, cleanDraft);
        onNotify(`Record #${formatSerialNo(savedMeta.serialNo)} updated.`, 'success');
      } else {
        const res = await createPrescriptionWithSerial(uid, cleanDraft);
        setSavedMeta(res);
        // Clear transient image from memory on confirm for patient privacy (Section 15 & Req 7)
        setRetainedImage(null);
        setPreviewUrl(null);
        setIsEditing(false);
        onRecordSaved(res.id, res.serialNo);
        onNotify(`Record #${formatSerialNo(res.serialNo)} confirmed and saved.`, 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save prescription record.';
      onNotify(msg, 'error');
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const getWhatsAppText = () => {
    if (!draft) return '';
    return formatWhatsAppRecord({
      ...draft,
      serialNo: activeSerial,
    });
  };

  const handleCopyWhatsApp = async () => {
    const text = getWhatsAppText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRecently(true);
      onNotify('Formatted prescription record copied to clipboard.', 'success');
      setTimeout(() => setCopiedRecently(false), 2200);
    } catch {
      onNotify('Clipboard access denied. Use Share to WhatsApp to copy manually.', 'error');
    }
  };

  const handleExportSingleExcel = async () => {
    if (!draft) return;
    const normalized = normalizeDateInput(draft.date) || getTodayDDMMYYYY();
    const recordForExport: PrescriptionRecord = {
      id: savedMeta?.id || 'draft',
      ownerId: uid,
      serialNo: activeSerial,
      date: normalized,
      dateIsRecordDate: draft.dateIsRecordDate,
      prescriberName: draft.prescriberName,
      patientName: draft.patientName,
      age: draft.age,
      sex: draft.sex,
      prescribedMedicine: draft.prescribedMedicine,
      duration: draft.duration,
      pharmacistSignature: draft.pharmacistSignature,
      signatureDrawing: draft.signatureDrawing,
      remarks: draft.remarks,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    };
    try {
      await exportPrescriptionsToExcel(
        [recordForExport],
        `prescription-${formatSerialNo(activeSerial)}`
      );
      onNotify(`Excel file exported for Serial #${formatSerialNo(activeSerial)}.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Excel export failed.', 'error');
    }
  };

  const handleScanNext = () => {
    abortControllerRef.current?.abort();
    setDraft(null);
    setRetainedImage(null);
    setPreviewUrl(null);
    setSavedMeta(null);
    setScanError(null);
    setAdviceList([]);
    setAdviceError(null);
    setAdviceLoading(false);
    setIsImageExpanded(false);
    setIsEditing(true);
  };

  const handleDownloadLocalPhoto = () => {
    if (!previewUrl) return;
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = `rx-${formatSerialNo(activeSerial)}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Hidden native inputs for Android camera & gallery */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {!draft && !isScanning && !scanError && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                <span>AI OCR Scanner</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-emerald-700 font-medium">
                  Next Serial #{formatSerialNo(nextSerialNo)}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight [text-wrap:balance]">
                Scan or Upload a Doctor&apos;s Prescription
              </h1>
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
                Capture a clear photo using your phone camera or select an image from your gallery.
                Handwritten and printed medicines, dosages, and dates are extracted into an
                editable Excel-ready pharmacy record.
              </p>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => setIsCameraOpen(true)}
                  className="min-h-[52px] px-5 py-3 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2.5 whitespace-nowrap"
                >
                  <Camera className="w-5 h-5" />
                  SCAN NEW PRESCRIPTION
                </button>

                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => galleryInputRef.current?.click()}
                  className="min-h-[52px] px-5 py-3 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2.5 whitespace-nowrap"
                >
                  <Upload className="w-5 h-5 text-emerald-700" />
                  UPLOAD IMAGE
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="min-h-[40px] inline-flex items-center gap-1.5 text-emerald-700 font-medium hover:underline disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  Open Device Camera App Directly
                </button>
                <span aria-hidden="true" className="text-slate-300">
                  |
                </span>
                <button
                  type="button"
                  onClick={handleStartManualEntry}
                  className="min-h-[40px] inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-slate-900 hover:underline"
                >
                  <Plus className="w-4 h-4" />
                  Enter Prescription Manually
                </button>
              </div>
            </div>

            <div className="mt-8 pt-5 border-t border-slate-100 flex items-start gap-3 text-xs text-slate-600">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Confidentiality Safeguard:</strong> Prescription photos are processed
                transiently in memory for OCR extraction and are never stored publicly or saved in
                the cloud database.
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
            <div className="relative h-56 sm:h-64 lg:h-full min-h-[220px] bg-slate-100">
              {!imgGuideError ? (
                <img
                  src="/src/assets/images/pharmacy_scan_guide_1795472817113.jpg"
                  alt="Doctor prescription placed flat on a clean pharmacy counter"
                  referrerPolicy="no-referrer"
                  onError={() => setImgGuideError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-emerald-50 to-slate-100 text-emerald-800">
                  <Camera className="w-10 h-10 mb-2" />
                  <span className="text-sm font-medium">Flat Lighting Prescription Guide</span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/40 to-transparent p-5 text-white">
                <p className="text-sm font-semibold">Best Capture Practices</p>
                <p className="text-xs text-slate-200 mt-1">
                  Lay the prescription flat under bright counter light and keep all edges visible
                  for sharpest handwriting recognition.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {scanError && !isScanning && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {retainedImage?.previewUrl && (
              <div className="w-full sm:w-32 h-32 rounded-xl overflow-hidden border border-amber-300 bg-white shrink-0">
                <img
                  src={retainedImage.previewUrl}
                  alt="Retained prescription photo"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-start gap-2.5 text-amber-950">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700" />
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-amber-950 leading-relaxed">
                    {scanError.sinhala}
                  </p>
                  <p className="text-sm text-amber-900 leading-relaxed">{scanError.english}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {retainedImage?.base64 && (
              <button
                type="button"
                disabled={isScanning}
                onClick={handleRetryScan}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-2 whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                RETRY SCAN
              </button>
            )}
            <button
              type="button"
              onClick={handleDiscardRetainedError}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-800 text-sm font-semibold hover:bg-slate-50 whitespace-nowrap"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {isScanning && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {scanPhase === 'retrying'
                ? 'AI service is busy. Automatically retrying...'
                : 'Prescription is being analyzed. Please wait...'}
            </h2>
            <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
              {scanPhase === 'retrying'
                ? 'Your prescription photo is safely retained in memory while we reconnect or switch to our backup AI model.'
                : 'Reading prescriber details, patient information, and handwritten medicines.'}
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={handleCancelActiveScan}
              className="min-h-[44px] px-5 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 whitespace-nowrap"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {draft && !isScanning && (
        <div className="space-y-5">
          {/* Header Banner */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-emerald-700 uppercase tracking-wide">
                  PRESCRIPTION SCAN RESULTS
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-medium text-slate-800">
                  Serial No: {formatSerialNo(activeSerial)}
                </span>
                {savedMeta && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <Check className="w-3.5 h-3.5" />
                      Confirmed &amp; Saved
                    </span>
                  </>
                )}
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">
                Review &amp; Verify Extracted Details
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  firstFieldRef.current?.focus();
                }}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Edit3 className="w-4 h-4 text-emerald-700" />
                EDIT DETAILS
              </button>

              <button
                type="button"
                onClick={handleScanNext}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs sm:text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                SCAN NEXT PRESCRIPTION
              </button>
            </div>
          </div>

          {draft.confidenceNotes && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-xs sm:text-sm text-amber-900">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <span className="font-semibold">OCR Verification Note: </span>
                <span>{draft.confidenceNotes}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Optional Transient Prescription Image Preview */}
            {previewUrl && (
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    Reference Image (Temporary)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setIsImageExpanded((v) => !v)}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                      aria-label={isImageExpanded ? 'Shrink preview' : 'Zoom preview'}
                    >
                      {isImageExpanded ? (
                        <ZoomOut className="w-4 h-4" />
                      ) : (
                        <ZoomIn className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadLocalPhoto}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                      title="Save local copy to device"
                      aria-label="Download local copy to device"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className={`bg-slate-100 overflow-auto ${isImageExpanded ? 'max-h-[70vh]' : 'max-h-72'}`}>
                  <img
                    src={previewUrl}
                    alt="Uploaded prescription reference"
                    className={`w-full object-contain ${isImageExpanded ? 'scale-125 origin-top-left' : ''}`}
                  />
                </div>
                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
                  Cleared automatically once you confirm or scan next.
                </div>
              </div>
            )}

            {/* Editable Prescription Fields */}
            <div className={`${previewUrl ? 'lg:col-span-8' : 'lg:col-span-12'} bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5`}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    1. Serial No.
                  </label>
                  <div className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono tabular-nums text-sm font-semibold text-slate-900 flex items-center">
                    {formatSerialNo(activeSerial)}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="rx-date" className="text-xs font-medium text-slate-600">
                      2. Date (DD/MM/YYYY)
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.dateIsRecordDate}
                        onChange={(e) =>
                          setDraft({ ...draft, dateIsRecordDate: e.target.checked })
                        }
                        className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                      />
                      Record Date (not on Rx)
                    </label>
                  </div>
                  <input
                    id="rx-date"
                    ref={firstFieldRef}
                    type="text"
                    value={draft.date}
                    readOnly={!isEditing}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    placeholder="DD/MM/YYYY"
                    maxLength={10}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rx-prescriber" className="block text-xs font-medium text-slate-600 mb-1">
                    3. Prescriber Name
                  </label>
                  <input
                    id="rx-prescriber"
                    type="text"
                    value={draft.prescriberName}
                    readOnly={!isEditing}
                    onChange={(e) => setDraft({ ...draft, prescriberName: e.target.value })}
                    placeholder="Dr. Name"
                    maxLength={200}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="rx-patient" className="block text-xs font-medium text-slate-600 mb-1">
                    4. Patient Name
                  </label>
                  <input
                    id="rx-patient"
                    type="text"
                    value={draft.patientName}
                    readOnly={!isEditing}
                    onChange={(e) => setDraft({ ...draft, patientName: e.target.value })}
                    placeholder="Patient full name"
                    maxLength={200}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="rx-age" className="block text-xs font-medium text-slate-600 mb-1">
                    5. Age
                  </label>
                  <input
                    id="rx-age"
                    type="text"
                    value={draft.age}
                    readOnly={!isEditing}
                    onChange={(e) => setDraft({ ...draft, age: e.target.value })}
                    placeholder="e.g. 45"
                    maxLength={50}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="rx-sex" className="block text-xs font-medium text-slate-600 mb-1">
                    6. Sex
                  </label>
                  <input
                    id="rx-sex"
                    type="text"
                    value={draft.sex}
                    readOnly={!isEditing}
                    onChange={(e) => setDraft({ ...draft, sex: e.target.value })}
                    placeholder="Male / Female"
                    maxLength={30}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div className="col-span-2">
                  <label htmlFor="rx-duration" className="block text-xs font-medium text-slate-600 mb-1">
                    8. Duration
                  </label>
                  <input
                    id="rx-duration"
                    type="text"
                    value={draft.duration}
                    readOnly={!isEditing}
                    onChange={(e) => setDraft({ ...draft, duration: e.target.value })}
                    placeholder="e.g. 5 days / As prescribed"
                    maxLength={1000}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="rx-medicines" className="block text-xs font-medium text-slate-600 mb-1">
                  7. Prescribed Medicine (one item per line with dosage, strength, frequency &amp; duration)
                </label>
                <textarea
                  id="rx-medicines"
                  rows={5}
                  value={draft.prescribedMedicine}
                  readOnly={!isEditing}
                  onChange={(e) => setDraft({ ...draft, prescribedMedicine: e.target.value })}
                  placeholder="1. Amoxicillin 500 mg – 1 capsule 3 times daily"
                  maxLength={4000}
                  className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {/* 9. Pharmacist Signature (Empty by default) */}
              <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="rx-sig" className="text-xs font-medium text-slate-600">
                      9. Pharmacist Signature (Manual / Optional)
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsSignatureOpen(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Open Signature Pad
                    </button>
                  </div>
                  <input
                    id="rx-sig"
                    type="text"
                    value={draft.pharmacistSignature}
                    onChange={(e) => setDraft({ ...draft, pharmacistSignature: e.target.value })}
                    placeholder="Leave blank or enter pharmacist name/initials"
                    maxLength={200}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  {draft.signatureDrawing && (
                    <div className="mt-2 flex items-center gap-3 p-2 border border-slate-200 rounded-xl bg-slate-50">
                      <img
                        src={draft.signatureDrawing}
                        alt="Captured pharmacist signature"
                        className="h-10 object-contain bg-white rounded border border-slate-200 px-2"
                      />
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, signatureDrawing: '' })}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove Pad Signature
                      </button>
                    </div>
                  )}
                </div>

                {/* 10. Remarks (Blank by default) */}
                <div>
                  <label htmlFor="rx-remarks" className="block text-xs font-medium text-slate-600 mb-1">
                    10. Remarks
                  </label>
                  <input
                    id="rx-remarks"
                    type="text"
                    value={draft.remarks}
                    onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
                    placeholder="Blank by default or select below"
                    maxLength={1000}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {REMARK_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDraft({ ...draft, remarks: preset })}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                          draft.remarks === preset
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Buttons (Sections 9 & 14) */}
              <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleConfirmRecord}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-60 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {savedMeta ? 'UPDATE RECORD' : 'CONFIRM RECORD'}
                </button>

                <button
                  type="button"
                  onClick={handleCopyWhatsApp}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {copiedRecently ? (
                    <Check className="w-4 h-4 text-emerald-700" />
                  ) : (
                    <Copy className="w-4 h-4 text-emerald-700" />
                  )}
                  {copiedRecently ? 'COPIED RECORD' : 'COPY TO WHATSAPP'}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(getWhatsAppText())}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold hover:bg-emerald-100 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <MessageCircle className="w-4 h-4" />
                  SHARE TO WHATSAPP
                </button>

                <button
                  type="button"
                  onClick={handleExportSingleExcel}
                  className="min-h-[48px] px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  EXPORT EXCEL
                </button>
              </div>
            </div>
          </div>

          {/* Separate Medicine-Wise Patient Counseling Advice (Sinhala + Tamil) */}
          <PatientAdviceSection
            adviceList={adviceList}
            isLoading={adviceLoading}
            error={adviceError}
            onChange={setAdviceList}
            onRegenerate={() =>
              void fetchPatientAdvice({
                prescribedMedicineText: draft.prescribedMedicine,
                age: draft.age,
                sex: draft.sex,
                duration: draft.duration,
              })
            }
            onOpenWhatsApp={onOpenWhatsApp}
            onNotify={onNotify}
          />
        </div>
      )}

      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCaptureBlob={(blob) => void processFile(blob)}
        onFallbackFilePick={() => nativeCameraInputRef.current?.click()}
      />

      <SignaturePadModal
        isOpen={isSignatureOpen}
        initialName={draft?.pharmacistSignature || ''}
        onClose={() => setIsSignatureOpen(false)}
        onSave={(name, drawingDataUrl) => {
          if (!draft) return;
          setDraft({
            ...draft,
            pharmacistSignature: name,
            signatureDrawing: drawingDataUrl || draft.signatureDrawing,
          });
        }}
      />
    </div>
  );
};
