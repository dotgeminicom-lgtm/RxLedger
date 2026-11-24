# Security Specification & Threat Model

## 1. Data Invariants

1. **Strict Ownership Isolation**: Every user profile (`/users/{userId}`), serial counter (`/users/{userId}/meta/{counterId}`), and prescription record (`/users/{userId}/prescriptions/{prescriptionId}`) is strictly accessible only when `request.auth != null`, `request.auth.token.email_verified == true`, `request.auth.uid == userId`, and the stored `ownerId` (or `uid`) equals `request.auth.uid`.
2. **No Public Reads or List Scraping**: No collection or collection group permits unauthenticated reads, blanket `isSignedIn()` reads, cross-tenant reads, or client-delegated list queries. Every `allow list` on prescriptions verifies `isOwner(userId)` and `resource.data.ownerId == request.auth.uid`.
3. **Immutable Serial Numbers & Creation Metadata**: Once a prescription record is created, `ownerId`, `serialNo`, and `createdAt` cannot be modified. Serial numbers must be integers `>= 1` and atomically bound to `/users/{userId}/meta/counters`.
4. **Strict Temporal Integrity**: `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on both creation and update.
5. **Strict Schema & Size Boundaries**: All string fields enforce explicit `.size()` bounds matching `firebase-blueprint.json`. Optional `signatureDrawing` must be empty or a valid PNG/JPEG/WebP base64 data URL (`<= 32000` chars). Unknown/shadow fields are rejected via `keys().hasAll(...)`, `keys().hasOnly(...)`, and `affectedKeys().hasOnly(...)`.
6. **Zero Public Image Storage**: Uploaded prescription images are never stored in Firestore or exposed publicly.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated Read/Write**: `request.auth == null` reading `/users/userA/prescriptions/rx1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `request.auth.token.email_verified == false` writing `/users/userA/prescriptions/rx1` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Read/Get**: `userB` calling `get` on `/users/userA/prescriptions/rx1` -> `PERMISSION_DENIED`.
4. **Cross-Tenant List Scraping**: `userB` querying `/users/userA/prescriptions` -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Create**: `userA` creating `/users/userA/prescriptions/rx1` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
6. **Shadow Field Injection on Create**: `userA` creating prescription with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **Shadow Field Injection on Update**: `userA` updating prescription with extra field `verifiedBySystem: true` -> `PERMISSION_DENIED`.
8. **Immutable Field Tampering**: `userA` updating `serialNo` from `1` to `999` or modifying `createdAt` -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: `userA` creating prescription with `createdAt` set to a past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **Path Variable Poisoning**: `userA` creating doc at `/users/userA/prescriptions/invalid$id..` -> `PERMISSION_DENIED`.
11. **Value Poisoning (Oversized String or Non-Image Signature)**: `userA` writing 50KB into `patientName` or `data:text/html,<script>` into `signatureDrawing` -> `PERMISSION_DENIED`.
12. **Invalid Date Format / Counter Bypass**: `userA` writing `date: "2026-11-23"` or creating a prescription without updating `/users/userA/meta/counters` -> `PERMISSION_DENIED`.
