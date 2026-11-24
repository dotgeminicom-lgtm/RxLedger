/**
 * Security Rules Verification Suite (Dirty Dozen Adversarial Payloads)
 * Maps each attack vector in security_spec.md to expected PERMISSION_DENIED behavior.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  expected: 'PERMISSION_DENIED' | 'ALLOW';
  payload?: Record<string, unknown>;
}

const VALID_BASE_RECORD = {
  ownerId: 'userA',
  serialNo: 1,
  date: '23/11/2026',
  dateIsRecordDate: false,
  prescriberName: 'Dr. A. Sharma',
  patientName: 'John Doe',
  age: '45',
  sex: 'Male',
  prescribedMedicine: '1. Amoxicillin 500 mg - 1 cap TDS',
  duration: '5 days',
  pharmacistSignature: '',
  remarks: '',
  createdAt: 'REQUEST_TIME',
  updatedAt: 'REQUEST_TIME',
};

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read rejected',
    operation: 'get',
    path: '/users/userA/prescriptions/rx1',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email rejected on write',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: false },
    payload: VALID_BASE_RECORD,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-tenant get rejected',
    operation: 'get',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-tenant list rejected',
    operation: 'list',
    path: '/users/userA/prescriptions',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity spoofing ownerId rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, ownerId: 'userB' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow field injection on create rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Shadow field injection on update rejected',
    operation: 'update',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, verifiedBySystem: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable serialNo tampering rejected',
    operation: 'update',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, serialNo: 999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client timestamp forgery rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Path variable poisoning rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/invalid$id..',
    auth: { uid: 'userA', email_verified: true },
    payload: VALID_BASE_RECORD,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value poisoning oversized string rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, patientName: 'A'.repeat(250) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Invalid date format rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, date: '2026-11-23' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Cross-tenant update rejected',
    operation: 'update',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userB', email_verified: true },
    payload: { ...VALID_BASE_RECORD, remarks: 'Tampered' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Cross-tenant delete rejected',
    operation: 'delete',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 15,
    name: 'Non-image signatureDrawing data URL rejected',
    operation: 'create',
    path: '/users/userA/prescriptions/rx1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ...VALID_BASE_RECORD, signatureDrawing: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
    expected: 'PERMISSION_DENIED',
  },
];
