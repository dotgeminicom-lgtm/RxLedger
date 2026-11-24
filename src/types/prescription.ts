export interface ExtractedMedicine {
  name: string;
  dosage: string;
  duration: string;
}

export interface ScanExtractionResult {
  extractedDate: string;
  prescriberName: string;
  patientName: string;
  age: string;
  sex: string;
  medicines: ExtractedMedicine[];
  prescribedMedicineText: string;
  duration: string;
  confidenceNotes: string;
}

export interface PatientAdvicePoint {
  sinhala: string;
  tamil: string;
}

export interface MedicinePatientAdvice {
  medicineName: string;
  needsPharmacistReview: boolean;
  reviewReason?: string;
  advicePoints: PatientAdvicePoint[];
}

export interface PrescriptionDraft {
  date: string;
  dateIsRecordDate: boolean;
  prescriberName: string;
  patientName: string;
  age: string;
  sex: string;
  prescribedMedicine: string;
  duration: string;
  pharmacistSignature: string;
  signatureDrawing?: string;
  remarks: string;
  confidenceNotes?: string;
  medicines?: ExtractedMedicine[];
}

export interface PrescriptionRecord {
  id: string;
  ownerId: string;
  serialNo: number;
  date: string;
  dateIsRecordDate: boolean;
  prescriberName: string;
  patientName: string;
  age: string;
  sex: string;
  prescribedMedicine: string;
  duration: string;
  pharmacistSignature: string;
  signatureDrawing?: string;
  remarks: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export type AppTab = 'dashboard' | 'scan' | 'records' | 'history';

export type SortField = 'serialNo' | 'date';
export type SortDirection = 'asc' | 'desc';

export const REMARK_PRESETS = [
  'Dispensed',
  'Partially dispensed',
  'Out of stock',
  'Follow-up required',
  'Prescription verified',
  'Pending',
] as const;
