import type {
  ExtractedMedicine,
  MedicinePatientAdvice,
  PrescriptionDraft,
  PrescriptionRecord,
} from '../types/prescription.ts';

export function formatSerialNo(serialNo: number): string {
  return String(Math.max(1, serialNo)).padStart(3, '0');
}

export function getTodayDDMMYYYY(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function normalizeDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    }
  }
  const yyyymmdd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    return `${yyyymmdd[3]}/${yyyymmdd[2]}/${yyyymmdd[1]}`;
  }
  return null;
}

export function parseDDMMYYYYToTime(dateStr: string): number {
  const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 0;
  const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return d.getTime();
}

export function toInputDateValue(ddmmyyyy: string): string {
  const match = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function buildMedicineBullets(
  prescribedMedicine: string,
  medicines?: ExtractedMedicine[],
  fallbackDuration?: string
): string[] {
  const lines = prescribedMedicine
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return lines.map((line) => {
      const cleaned = line.replace(/^\d+[\.\)]\s*/, '').replace(/^[•\-\*]\s*/, '').trim();
      return `• ${cleaned}`;
    });
  }

  if (medicines && medicines.length > 0) {
    return medicines.map((m) => {
      const parts = [m.name, m.dosage, m.duration || fallbackDuration]
        .map((p) => (p || '').trim())
        .filter(Boolean);
      return `• ${parts.join(' – ')}`;
    });
  }

  return ['• Not mentioned'];
}

export function formatWhatsAppRecord(
  record: (PrescriptionRecord | (PrescriptionDraft & { serialNo: number })),
): string {
  const serialFormatted = formatSerialNo(record.serialNo);
  const dateLabel = record.dateIsRecordDate ? `${record.date} (Record Date)` : record.date;
  const medicines = 'medicines' in record ? record.medicines : undefined;
  const bulletLines = buildMedicineBullets(record.prescribedMedicine, medicines, record.duration);

  const sigValue = record.pharmacistSignature?.trim()
    ? record.pharmacistSignature.trim()
    : record.signatureDrawing
      ? '[Digital Signature Captured]'
      : '';

  const remarksValue = record.remarks?.trim() || '';

  return [
    'PHARMACY PRESCRIPTION RECORD',
    '',
    `Serial No: ${serialFormatted}`,
    `Date: ${dateLabel}`,
    `Prescriber Name: ${record.prescriberName || 'Not mentioned'}`,
    `Patient Name: ${record.patientName || 'Not mentioned'}`,
    `Age: ${record.age || 'Not mentioned'}`,
    `Sex: ${record.sex || 'Not mentioned'}`,
    '',
    'Prescribed Medicine:',
    ...bulletLines,
    '',
    `Duration: ${record.duration || 'Not mentioned'}`,
    '',
    `Pharmacist Signature:${sigValue ? ` ${sigValue}` : ''}`,
    `Remarks:${remarksValue ? ` ${remarksValue}` : ''}`,
  ].join('\n');
}

function getPointNumberEmoji(indexZeroBased: number): string {
  const keycaps = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  return keycaps[indexZeroBased] ?? `${indexZeroBased + 1}.`;
}

export function formatSingleMedicineAdviceWhatsApp(
  item: MedicinePatientAdvice,
  indexNumber: number
): string {
  const lines: string[] = [
    `Medicine ${indexNumber}: ${item.medicineName.trim() || 'Medicine'}`,
  ];

  if (item.needsPharmacistReview) {
    lines.push(
      `⚠️ Pharmacist Review Required${item.reviewReason ? `: ${item.reviewReason}` : ''}`
    );
  }

  item.advicePoints.forEach((pt, idx) => {
    const emojiNum = getPointNumberEmoji(idx);
    lines.push('');
    lines.push(`${emojiNum} Sinhala: ${pt.sinhala.trim()}`);
    lines.push('');
    lines.push(`Tamil: ${pt.tamil.trim()}`);
  });

  return lines.join('\n');
}

export function formatPatientAdviceWhatsApp(items: MedicinePatientAdvice[]): string {
  if (items.length === 0) return '';

  const blocks = items.map((item, idx) => formatSingleMedicineAdviceWhatsApp(item, idx + 1));

  return [
    '💊 PATIENT MEDICATION ADVICE',
    'රෝගී උපදෙස් | நோயாளி அறிவுரை',
    '',
    '━━━━━━━━━━━━━━',
    '',
    blocks.join('\n\n━━━━━━━━━━━━━━\n\n'),
  ].join('\n');
}
