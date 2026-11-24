import ExcelJS from 'exceljs';
import type { PrescriptionRecord } from '../types/prescription.ts';
import { formatSerialNo } from './formatters.ts';

const HEADERS = [
  'Serial No',
  'Date',
  'Prescriber Name',
  'Patient Name',
  'Age',
  'Sex',
  'Prescribed Medicine',
  'Duration',
  'Pharmacist Signature',
  'Remarks',
];

const COLUMN_WIDTHS = [12, 16, 24, 24, 10, 10, 48, 22, 24, 26];

export async function exportPrescriptionsToExcel(
  records: PrescriptionRecord[],
  filenamePrefix = 'pharmacy-prescription-records'
): Promise<void> {
  if (records.length === 0) {
    throw new Error('No prescription records available to export.');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RxLedger Pharmacy Record System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Prescriptions', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = HEADERS.map((header, idx) => ({
    header,
    key: `col_${idx}`,
    width: COLUMN_WIDTHS[idx],
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF065F46' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF047857' } },
      left: { style: 'thin', color: { argb: 'FF047857' } },
      bottom: { style: 'medium', color: { argb: 'FF064E3B' } },
      right: { style: 'thin', color: { argb: 'FF047857' } },
    };
  });

  const sorted = [...records].sort((a, b) => a.serialNo - b.serialNo);

  sorted.forEach((rec, index) => {
    const signatureText = rec.pharmacistSignature?.trim()
      ? rec.pharmacistSignature.trim()
      : rec.signatureDrawing
        ? '[Digital Signature Captured]'
        : '';

    const rowValues = [
      formatSerialNo(rec.serialNo),
      rec.dateIsRecordDate ? `${rec.date} (Record Date)` : rec.date,
      rec.prescriberName || '',
      rec.patientName || '',
      rec.age || '',
      rec.sex || '',
      rec.prescribedMedicine || '',
      rec.duration || '',
      signatureText,
      rec.remarks || '',
    ];

    const row = sheet.addRow(rowValues);
    const medicineLines = (rec.prescribedMedicine || '').split(/\r?\n/).length;
    const wrappedEstimate = Math.ceil((rec.prescribedMedicine || '').length / 44);
    const lineCount = Math.max(1, medicineLines, wrappedEstimate);
    row.height = Math.max(22, lineCount * 16 + 8);

    const isEven = index % 2 === 1;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { size: 10.5, name: 'Calibri', color: { argb: 'FF0F172A' } };
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAF9' },
        };
      }
      cell.alignment = {
        vertical: 'top',
        horizontal: colNumber === 1 || colNumber === 2 || colNumber === 5 || colNumber === 6 ? 'center' : 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const todayStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${filenamePrefix}-${todayStamp}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
