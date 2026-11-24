import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { PrescriptionDraft, PrescriptionRecord } from '../types/prescription.ts';
import { db, handleFirestoreError, OperationType } from './firebase.ts';
import { getTodayDDMMYYYY, normalizeDateInput } from './formatters.ts';

function sanitizeString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function generateRecordId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `rx_${Date.now()}_${randomPart}`;
}

export async function ensureUserProfile(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(userRef);
    const email = sanitizeString(user.email || `${user.uid}@local`, 254);
    const displayName = sanitizeString(user.displayName || 'Pharmacist', 120);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        email,
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export function subscribeToNextSerial(
  uid: string,
  onSerial: (nextSerial: number) => void,
  onError: (err: Error) => void
): () => void {
  const counterPath = `users/${uid}/meta/counters`;
  const counterRef = doc(db, 'users', uid, 'meta', 'counters');

  return onSnapshot(
    counterRef,
    (snap) => {
      if (!snap.exists()) {
        onSerial(1);
      } else {
        const data = snap.data();
        const nextNum = typeof data.nextSerialNumber === 'number' ? data.nextSerialNumber : 1;
        onSerial(nextNum);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, counterPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeToPrescriptions(
  uid: string,
  onData: (records: PrescriptionRecord[]) => void,
  onError: (err: Error) => void
): () => void {
  const rxPath = `users/${uid}/prescriptions`;
  const q = query(collection(db, 'users', uid, 'prescriptions'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: PrescriptionRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const createdAt = d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now();
        const updatedAt = d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : createdAt;

        return {
          id: docSnap.id,
          ownerId: String(d.ownerId || uid),
          serialNo: typeof d.serialNo === 'number' ? d.serialNo : 1,
          date: String(d.date || getTodayDDMMYYYY()),
          dateIsRecordDate: Boolean(d.dateIsRecordDate),
          prescriberName: String(d.prescriberName || ''),
          patientName: String(d.patientName || ''),
          age: String(d.age || ''),
          sex: String(d.sex || ''),
          prescribedMedicine: String(d.prescribedMedicine || ''),
          duration: String(d.duration || ''),
          pharmacistSignature: String(d.pharmacistSignature || ''),
          signatureDrawing: typeof d.signatureDrawing === 'string' ? d.signatureDrawing : undefined,
          remarks: String(d.remarks || ''),
          createdAtMs: createdAt,
          updatedAtMs: updatedAt,
        };
      });

      records.sort((a, b) => b.serialNo - a.serialNo);
      onData(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, rxPath);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export async function createPrescriptionWithSerial(
  uid: string,
  draft: PrescriptionDraft
): Promise<{ id: string; serialNo: number }> {
  const newId = generateRecordId();
  const counterRef = doc(db, 'users', uid, 'meta', 'counters');
  const rxRef = doc(db, 'users', uid, 'prescriptions', newId);
  const rxPath = `users/${uid}/prescriptions/${newId}`;

  const normalizedDate = normalizeDateInput(draft.date) || getTodayDDMMYYYY();

  const payload: Record<string, unknown> = {
    ownerId: uid,
    date: normalizedDate,
    dateIsRecordDate: Boolean(draft.dateIsRecordDate),
    prescriberName: sanitizeString(draft.prescriberName, 200),
    patientName: sanitizeString(draft.patientName, 200),
    age: sanitizeString(draft.age, 50),
    sex: sanitizeString(draft.sex, 30),
    prescribedMedicine: sanitizeString(draft.prescribedMedicine, 4000),
    duration: sanitizeString(draft.duration, 1000),
    pharmacistSignature: sanitizeString(draft.pharmacistSignature, 200),
    remarks: sanitizeString(draft.remarks, 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (draft.signatureDrawing && draft.signatureDrawing.length <= 32000) {
    payload.signatureDrawing = draft.signatureDrawing;
  }

  try {
    const assignedSerial = await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      let serialNo = 1;

      if (!counterSnap.exists()) {
        serialNo = 1;
        tx.set(counterRef, {
          ownerId: uid,
          nextSerialNumber: 2,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const currentNext = counterSnap.data().nextSerialNumber;
        serialNo = typeof currentNext === 'number' && currentNext >= 1 ? currentNext : 1;
        tx.update(counterRef, {
          nextSerialNumber: serialNo + 1,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(rxRef, {
        ...payload,
        serialNo,
      });

      return serialNo;
    });

    return { id: newId, serialNo: assignedSerial };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, rxPath);
  }
}

export async function updatePrescriptionRecord(
  uid: string,
  id: string,
  updates: Partial<PrescriptionDraft>
): Promise<void> {
  const rxPath = `users/${uid}/prescriptions/${id}`;
  const rxRef = doc(db, 'users', uid, 'prescriptions', id);

  const sanitizedUpdates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.date !== undefined) {
    const normalized = normalizeDateInput(updates.date);
    if (!normalized) {
      throw new Error('Date must follow DD/MM/YYYY format.');
    }
    sanitizedUpdates.date = normalized;
  }
  if (updates.dateIsRecordDate !== undefined) {
    sanitizedUpdates.dateIsRecordDate = Boolean(updates.dateIsRecordDate);
  }
  if (updates.prescriberName !== undefined) {
    sanitizedUpdates.prescriberName = sanitizeString(updates.prescriberName, 200);
  }
  if (updates.patientName !== undefined) {
    sanitizedUpdates.patientName = sanitizeString(updates.patientName, 200);
  }
  if (updates.age !== undefined) {
    sanitizedUpdates.age = sanitizeString(updates.age, 50);
  }
  if (updates.sex !== undefined) {
    sanitizedUpdates.sex = sanitizeString(updates.sex, 30);
  }
  if (updates.prescribedMedicine !== undefined) {
    sanitizedUpdates.prescribedMedicine = sanitizeString(updates.prescribedMedicine, 4000);
  }
  if (updates.duration !== undefined) {
    sanitizedUpdates.duration = sanitizeString(updates.duration, 1000);
  }
  if (updates.pharmacistSignature !== undefined) {
    sanitizedUpdates.pharmacistSignature = sanitizeString(updates.pharmacistSignature, 200);
  }
  if (updates.signatureDrawing !== undefined && updates.signatureDrawing.length <= 32000) {
    sanitizedUpdates.signatureDrawing = updates.signatureDrawing;
  }
  if (updates.remarks !== undefined) {
    sanitizedUpdates.remarks = sanitizeString(updates.remarks, 1000);
  }

  try {
    await updateDoc(rxRef, sanitizedUpdates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, rxPath);
  }
}

export async function deletePrescriptionRecord(uid: string, id: string): Promise<void> {
  const rxPath = `users/${uid}/prescriptions/${id}`;
  const rxRef = doc(db, 'users', uid, 'prescriptions', id);
  try {
    await deleteDoc(rxRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, rxPath);
  }
}
