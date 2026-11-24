import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseConfig {
  projectId: string;
}

const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
const firebaseConfig: FirebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MAX_BASE64_BYTES = 14 * 1024 * 1024; // ~10.5MB decoded image limit

let cachedCerts: Record<string, string> = {};
let certsExpireAt = 0;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpireAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase token certificates (${res.status})`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpireAt = Date.now() + maxAgeSec * 1000;
  return cachedCerts;
}

function decodeBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid authentication token format.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(decodeBase64Url(headerB64).toString('utf-8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf-8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported token algorithm.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== firebaseConfig.projectId) {
    throw new Error('Token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${firebaseConfig.projectId}`) {
    throw new Error('Token issuer mismatch.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token subject missing.');
  }
  if (payload.email_verified !== true) {
    throw new Error('Verified email account is required.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Session expired. Please sign in again.');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Invalid token issued-at timestamp.');
  }

  const certs = await getGooglePublicCerts();
  let pem = certs[header.kid];
  if (!pem) {
    certsExpireAt = 0;
    const refreshed = await getGooglePublicCerts();
    pem = refreshed[header.kid];
  }
  if (!pem) {
    throw new Error('Signing certificate not found for token.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = decodeBase64Url(sigB64);

  if (!verifier.verify(pem, signature)) {
    throw new Error('Token signature verification failed.');
  }

  const email = (payload.email || '').trim().toLowerCase();
  const allowedEmailsRaw = (process.env.ALLOWED_PHARMACIST_EMAILS || '').trim();
  if (allowedEmailsRaw) {
    const allowedSet = new Set(
      allowedEmailsRaw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    );
    if (!email || !allowedSet.has(email)) {
      throw Object.assign(
        new Error('Access restricted: your Google account is not on the authorized pharmacist list.'),
        { status: 403, isAccessDenied: true }
      );
    }
  }

  return {
    uid: payload.sub,
    email,
  };
}

const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_USER_WINDOW = 20;
const MAX_REQUESTS_PER_IP_WINDOW = 40;
const MAX_CONCURRENT_PER_USER = 2;

const userRequestTimestamps = new Map<string, number[]>();
const ipRequestTimestamps = new Map<string, number[]>();
const activeUserScans = new Map<string, number>();

function checkSlidingWindowLimit(store: Map<string, number[]>, key: string, limit: number): boolean {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const recent = (store.get(key) || []).filter((ts) => ts > windowStart);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  if (store.size > 5000) {
    for (const [k, list] of store.entries()) {
      if (list.every((ts) => ts <= windowStart)) {
        store.delete(k);
      }
    }
  }
  return true;
}

function acquireUserConcurrencySlot(uid: string): boolean {
  const current = activeUserScans.get(uid) || 0;
  if (current >= MAX_CONCURRENT_PER_USER) {
    return false;
  }
  activeUserScans.set(uid, current + 1);
  return true;
}

function releaseUserConcurrencySlot(uid: string): void {
  const current = activeUserScans.get(uid) || 0;
  if (current <= 1) {
    activeUserScans.delete(uid);
  } else {
    activeUserScans.set(uid, current - 1);
  }
}

function hasValidImageMagicBytes(base64Data: string, mimeType: string): boolean {
  try {
    const sample = Buffer.from(base64Data.slice(0, 64), 'base64');
    if (sample.length < 8) return false;
    const lowerMime = mimeType.toLowerCase();

    if (lowerMime === 'image/jpeg' || lowerMime === 'image/jpg') {
      return sample[0] === 0xff && sample[1] === 0xd8 && sample[2] === 0xff;
    }
    if (lowerMime === 'image/png') {
      return (
        sample[0] === 0x89 &&
        sample[1] === 0x50 &&
        sample[2] === 0x4e &&
        sample[3] === 0x47
      );
    }
    if (lowerMime === 'image/webp') {
      return (
        sample.subarray(0, 4).toString('ascii') === 'RIFF' &&
        sample.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    }
    if (lowerMime === 'image/heic' || lowerMime === 'image/heif') {
      return sample.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    return false;
  } catch {
    return false;
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const PRESCRIPTION_SYSTEM_INSTRUCTION = `You are an expert clinical pharmacist and medical OCR specialist.
Your task is to carefully read an uploaded doctor's prescription image (both printed clinic text and handwritten Rx notes) and extract structured pharmacy record fields with 100% factual fidelity.

STRICT ACCURACY & ANTI-HALLUCINATION RULES:
1. NEVER guess or invent patient details, doctor names, medicine names, strengths, dosages, or durations.
2. If handwriting or text is present for a field but illegible or ambiguous, write "Unclear – Please Verify" (or attach "[Unclear – Please Verify]" specifically to the uncertain medicine/word).
3. If a field (like Age, Sex, Prescriber Name, Patient Name, Duration) is completely absent from the prescription, output "Not mentioned".
4. Date extraction:
   - Identify the prescription date if written or printed anywhere on the slip.
   - Normalize and return it strictly in DD/MM/YYYY format (e.g., "05/11/2026").
   - If NO date appears on the prescription, return an empty string "" for extractedDate.
   - If a date is present but unreadable, return "Unclear – Please Verify".
5. Prescribed Medicine extraction:
   - Extract ALL prescribed medicines in order.
   - Include medicine name, dosage, strength, frequency, route, and quantity when visible.
   - Format prescribedMedicineText as a clean numbered multi-line list separated by newline characters, e.g.:
     1. Amoxicillin 500 mg – 1 capsule 3 times daily
     2. Paracetamol 500 mg – 2 tablets when needed
     3. Cetirizine 10 mg – 1 tablet at night
   - Also return each medicine as a structured entry in the medicines array with name, dosage, and duration.
   - If individual medicines have different durations, include each duration both in its medicine line/item and summarize clearly in the duration field (e.g., "Amoxicillin: 7 days; Cetirizine: 5 days").
6. Keep confidenceNotes concise (1-2 short sentences) highlighting any unclear handwriting areas for pharmacist verification.`;

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const BACKUP_MODEL = 'gemini-3.1-flash-lite';
const RETRY_DELAYS_MS = [2000, 4000, 8000];

interface ClassifiedError {
  kind: 'transient' | 'permanent_auth' | 'permanent_image' | 'permanent_model' | 'permanent_unknown';
  httpStatus: number;
  code: string;
  userMessage: string;
}

function extractErrorDetails(err: unknown): { status?: number; message: string; code?: string } {
  if (!err || typeof err !== 'object') {
    return { message: String(err ?? '') };
  }
  const obj = err as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  const status =
    typeof obj.status === 'number'
      ? obj.status
      : typeof obj.statusCode === 'number'
        ? obj.statusCode
        : undefined;
  const code = typeof obj.code === 'string' ? obj.code : undefined;
  let message = typeof obj.message === 'string' ? obj.message : String(err);

  if (!code && obj.cause && typeof obj.cause === 'object') {
    const causeObj = obj.cause as { code?: unknown; message?: unknown };
    if (typeof causeObj.message === 'string') {
      message = `${message} ${causeObj.message}`;
    }
  }
  return { status, message, code };
}

function classifyGeminiError(err: unknown): ClassifiedError {
  const { status, message, code } = extractErrorDetails(err);
  const upper = message.toUpperCase();

  if (
    upper.includes('GEMINI_API_KEY') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('PERMISSION_DENIED') ||
    status === 401 ||
    status === 403
  ) {
    return {
      kind: 'permanent_auth',
      httpStatus: 403,
      code: 'CONFIG_ERROR',
      userMessage: 'AI service configuration error. Please check GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  if (
    status === 400 ||
    upper.includes('INVALID_ARGUMENT') ||
    upper.includes('UNABLE TO PROCESS INPUT IMAGE') ||
    upper.includes('UNSUPPORTED')
  ) {
    return {
      kind: 'permanent_image',
      httpStatus: 400,
      code: 'INVALID_IMAGE',
      userMessage:
        'The prescription image could not be read. Please upload a clear JPEG, PNG, or WebP photo.',
    };
  }

  if (status === 404 || upper.includes('NOT_FOUND')) {
    return {
      kind: 'permanent_model',
      httpStatus: 503,
      code: 'MODEL_UNAVAILABLE',
      userMessage: 'The AI service is temporarily busy. Please try scanning again.',
    };
  }

  const isRateLimit =
    status === 429 || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('429');

  const isTransientStatus =
    isRateLimit ||
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    status === 408;

  const isTransientMessage =
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('500') ||
    upper.includes('INTERNAL') ||
    upper.includes('502') ||
    upper.includes('BAD GATEWAY') ||
    upper.includes('504') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('TIMEOUT') ||
    upper.includes('TIMED OUT') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('ECONNREFUSED') ||
    upper.includes('ENOTFOUND') ||
    upper.includes('EAI_AGAIN') ||
    upper.includes('FETCH FAILED') ||
    upper.includes('NETWORK') ||
    upper.includes('SOCKET') ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_CONNECT_TIMEOUT';

  if (isTransientStatus || isTransientMessage) {
    return {
      kind: 'transient',
      httpStatus: isRateLimit ? 429 : 503,
      code: isRateLimit ? 'RATE_LIMIT' : 'SERVICE_BUSY',
      userMessage: 'The AI service is temporarily busy. Your prescription image is retained. Please try scanning again.',
    };
  }

  return {
    kind: 'permanent_unknown',
    httpStatus: 500,
    code: 'SCAN_FAILED',
    userMessage: 'Unable to analyze the prescription image right now. Please try again.',
  };
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function callModelForPrescriptionOcr(
  ai: GoogleGenAI,
  model: string,
  imageBase64: string,
  normalizedMime: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const config: Record<string, unknown> = {
    systemInstruction: PRESCRIPTION_SYSTEM_INSTRUCTION,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        extractedDate: {
          type: Type.STRING,
          description:
            'Date found on prescription in DD/MM/YYYY format, empty string if no date present, or "Unclear – Please Verify" if illegible.',
        },
        prescriberName: {
          type: Type.STRING,
          description:
            'Doctor/prescriber full name and credentials if visible, "Not mentioned", or "Unclear – Please Verify".',
        },
        patientName: {
          type: Type.STRING,
          description:
            'Patient full name if visible, "Not mentioned", or "Unclear – Please Verify".',
        },
        age: {
          type: Type.STRING,
          description:
            'Patient age as written on prescription, "Not mentioned", or "Unclear – Please Verify".',
        },
        sex: {
          type: Type.STRING,
          description:
            'Patient sex/gender as written on prescription, "Not mentioned", or "Unclear – Please Verify".',
        },
        medicines: {
          type: Type.ARRAY,
          description: 'List of individual prescribed medicines.',
          items: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'Medicine name and strength (e.g. Amoxicillin 500 mg).',
              },
              dosage: {
                type: Type.STRING,
                description: 'Dosage, frequency, and quantity (e.g. 1 capsule 3 times daily).',
              },
              duration: {
                type: Type.STRING,
                description: 'Duration for this medicine if specified, else empty string.',
              },
            },
            required: ['name', 'dosage', 'duration'],
          },
        },
        prescribedMedicineText: {
          type: Type.STRING,
          description: 'Numbered multi-line list of all medicines separated by newlines.',
        },
        duration: {
          type: Type.STRING,
          description:
            'Overall treatment duration or per-medicine associated durations, "Not mentioned", or "Unclear – Please Verify".',
        },
        confidenceNotes: {
          type: Type.STRING,
          description: 'Short note flagging any unclear handwriting spots for pharmacist verification.',
        },
      },
      required: [
        'extractedDate',
        'prescriberName',
        'patientName',
        'age',
        'sex',
        'medicines',
        'prescribedMedicineText',
        'duration',
        'confidenceNotes',
      ],
    },
  };

  if (model === PRIMARY_MODEL) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MEDIUM };
  }

  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: normalizedMime,
            data: imageBase64,
          },
        },
        {
          text: 'Read this prescription image completely. Extract the prescription date (DD/MM/YYYY or empty string if absent), prescriber/doctor name, patient name, age, sex, all prescribed medicines with dosage/strength/frequency/quantity, treatment duration, and any handwriting verification notes. Follow all anti-hallucination rules strictly.',
        },
      ],
    },
    config,
  });

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const rawText = (response.text ?? '').trim();
  const cleanedJson = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleanedJson) {
    throw Object.assign(new Error('502 BAD GATEWAY: Empty AI OCR response'), { status: 502 });
  }
  try {
    return JSON.parse(cleanedJson);
  } catch {
    throw Object.assign(new Error('502 BAD GATEWAY: Incomplete AI OCR JSON response'), {
      status: 502,
    });
  }
}

async function callGeminiWithRetryAndFallback(
  imageBase64: string,
  mimeType: string,
  options?: {
    signal?: AbortSignal;
    onRetryStatus?: (info: { attempt: number; maxAttempts: number; waitMs: number; fallback?: boolean }) => void;
  }
) {
  const ai = getAiClient();
  const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  let lastError: unknown = null;

  // Primary model: initial attempt + up to 3 automatic retries (2s, 4s, 8s + jitter)
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await callModelForPrescriptionOcr(
        ai,
        PRIMARY_MODEL,
        imageBase64,
        normalizedMime,
        options?.signal
      );
      return { result, modelUsed: PRIMARY_MODEL };
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || options?.signal?.aborted) {
        throw err;
      }
      lastError = err;
      const classified = classifyGeminiError(err);

      // Do not retry permanent auth/image/config errors
      if (classified.kind === 'permanent_auth' || classified.kind === 'permanent_image' || classified.kind === 'permanent_unknown') {
        throw err;
      }

      // If primary model returned 404 (not found), skip retries on primary and try backup immediately
      if (classified.kind === 'permanent_model') {
        break;
      }

      if (attempt < RETRY_DELAYS_MS.length) {
        const baseWait = RETRY_DELAYS_MS[attempt];
        const jitter = Math.floor(Math.random() * 450);
        const waitMs = baseWait + jitter;
        options?.onRetryStatus?.({
          attempt: attempt + 1,
          maxAttempts: RETRY_DELAYS_MS.length,
          waitMs,
          fallback: false,
        });
        await abortableSleep(waitMs, options?.signal);
      }
    }
  }

  // Fallback to compatible backup vision/OCR model
  for (let fbAttempt = 0; fbAttempt < 2; fbAttempt++) {
    try {
      options?.onRetryStatus?.({
        attempt: RETRY_DELAYS_MS.length,
        maxAttempts: RETRY_DELAYS_MS.length,
        waitMs: fbAttempt === 0 ? 0 : 2000,
        fallback: true,
      });
      if (fbAttempt > 0) {
        await abortableSleep(2000 + Math.floor(Math.random() * 350), options?.signal);
      }
      const result = await callModelForPrescriptionOcr(
        ai,
        BACKUP_MODEL,
        imageBase64,
        normalizedMime,
        options?.signal
      );
      return { result, modelUsed: BACKUP_MODEL };
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || options?.signal?.aborted) {
        throw err;
      }
      lastError = err;
      const classified = classifyGeminiError(err);
      if (classified.kind !== 'transient') {
        break;
      }
    }
  }

  throw lastError;
}

const PATIENT_COUNSELING_SYSTEM_INSTRUCTION = `You are a licensed clinical pharmacist in Sri Lanka providing clear, accurate, medicine-wise patient counseling in BOTH Sinhala and Tamil.

STRICT CLINICAL & LANGUAGE RULES:
1. Generate a separate counseling entry for EACH medicine in the prescription list.
2. Provide a MINIMUM of 3 distinct, concise, easy-to-understand patient advice points for EACH medicine (never fewer than 3 points per medicine).
3. Every single advice point MUST contain both natural, simple Sinhala AND natural, simple Tamil conveying the exact same accurate clinical guidance.
4. Advice MUST be specific to that exact medicine—never generic copy-paste advice across different medicines unless clinically required. Tailor advice to:
   - Dosage form & route of administration (e.g., oral tablet/capsule, pediatric syrup/suspension shake well & measuring cup/spoon, inhaler technique & mouth rinsing, eye/ear drops hygiene, topical cream thin layer).
   - Timing & food interactions (e.g., before meals vs after meals, morning vs bedtime, spacing doses evenly, avoiding alcohol or dairy/antacids if relevant).
   - Key clinical precautions & patient age context (e.g., completing full antibiotic course, avoiding duplicate Paracetamol products, drowsiness/driving caution for sedating antihistamines, hydration, pediatric weight-based measuring).
   - Storage & relevant warning signs (e.g., seek medical help for rash/breathing difficulty, refrigerate reconstituted suspension if applicable, do not exceed maximum daily dose).
5. Avoid unsupported, excessive, or frightening warnings. Keep sentences short, practical, and friendly for ordinary patients.
6. UNCERTAIN MEDICINE IDENTITY RULE: If any medicine name is marked "Unclear", "Please Verify", contains "?", or cannot be reliably identified, DO NOT invent drug-specific advice. Instead:
   - Set needsPharmacistReview = true
   - State the reason briefly in reviewReason
   - Provide 3 safe pharmacist-verification points in Sinhala and Tamil advising the patient/staff to confirm the exact medicine and dose with the pharmacist or prescriber before taking it.`;

async function callModelForAdvice(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const config: Record<string, unknown> = {
    systemInstruction: PATIENT_COUNSELING_SYSTEM_INSTRUCTION,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: 'Separate counseling advice entries for each prescribed medicine.',
          items: {
            type: Type.OBJECT,
            properties: {
              medicineName: {
                type: Type.STRING,
                description: 'Clean medicine name and strength (e.g. Amoxicillin 500 mg).',
              },
              needsPharmacistReview: {
                type: Type.BOOLEAN,
                description:
                  'True if medicine identity is unclear or uncertain and requires pharmacist verification.',
              },
              reviewReason: {
                type: Type.STRING,
                description:
                  'Short reason if needsPharmacistReview is true, otherwise empty string.',
              },
              advicePoints: {
                type: Type.ARRAY,
                description: 'Minimum 3 specific patient counseling points in Sinhala and Tamil.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sinhala: {
                      type: Type.STRING,
                      description: 'Simple, accurate counseling point in Sinhala script.',
                    },
                    tamil: {
                      type: Type.STRING,
                      description: 'Equivalent simple, accurate counseling point in Tamil script.',
                    },
                  },
                  required: ['sinhala', 'tamil'],
                },
              },
            },
            required: [
              'medicineName',
              'needsPharmacistReview',
              'reviewReason',
              'advicePoints',
            ],
          },
        },
      },
      required: ['items'],
    },
  };

  if (model === PRIMARY_MODEL) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.MEDIUM };
  }

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config,
  });

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const rawText = (response.text ?? '').trim();
  const cleanedJson = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  if (!cleanedJson) {
    throw Object.assign(new Error('502 BAD GATEWAY: Empty AI counseling response'), { status: 502 });
  }
  try {
    return JSON.parse(cleanedJson);
  } catch {
    throw Object.assign(new Error('502 BAD GATEWAY: Incomplete AI counseling JSON response'), {
      status: 502,
    });
  }
}

async function generatePatientAdviceWithRetry(
  input: {
    prescribedMedicineText: string;
    age?: string;
    sex?: string;
    duration?: string;
  },
  signal?: AbortSignal
) {
  const ai = getAiClient();
  let lastError: unknown = null;

  const prompt = [
    'Generate medicine-wise patient counseling advice in Sinhala and Tamil for the following prescription.',
    `Patient Age: ${input.age || 'Not mentioned'}`,
    `Patient Sex: ${input.sex || 'Not mentioned'}`,
    `Overall Duration: ${input.duration || 'Not mentioned'}`,
    '',
    'Prescribed Medicines:',
    input.prescribedMedicineText,
  ].join('\n');

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await callModelForAdvice(ai, PRIMARY_MODEL, prompt, signal);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      lastError = err;
      const classified = classifyGeminiError(err);
      if (
        classified.kind === 'permanent_auth' ||
        classified.kind === 'permanent_image' ||
        classified.kind === 'permanent_unknown'
      ) {
        throw err;
      }
      if (classified.kind === 'permanent_model') {
        break;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        const waitMs = RETRY_DELAYS_MS[attempt] + Math.floor(Math.random() * 450);
        await abortableSleep(waitMs, signal);
      }
    }
  }

  // Backup model fallback
  for (let fbAttempt = 0; fbAttempt < 2; fbAttempt++) {
    try {
      if (fbAttempt > 0) {
        await abortableSleep(2000 + Math.floor(Math.random() * 350), signal);
      }
      return await callModelForAdvice(ai, BACKUP_MODEL, prompt, signal);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      lastError = err;
      const classified = classifyGeminiError(err);
      if (classified.kind !== 'transient') {
        break;
      }
    }
  }

  throw lastError;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  });
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/scan-prescription', async (req: Request, res: Response) => {
    const wantsStream = (req.headers.accept || '').includes('application/x-ndjson');
    const abortController = new AbortController();
    let activeSlotUid: string | null = null;
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const writeStreamLine = (payload: Record<string, unknown>) => {
      if (wantsStream && !res.writableEnded) {
        res.write(`${JSON.stringify(payload)}\n`);
      }
    };

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required to scan prescriptions.' });
        return;
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const verifiedUser = await verifyFirebaseIdToken(token);

      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (
        !checkSlidingWindowLimit(userRequestTimestamps, verifiedUser.uid, MAX_REQUESTS_PER_USER_WINDOW) ||
        !checkSlidingWindowLimit(ipRequestTimestamps, clientIp, MAX_REQUESTS_PER_IP_WINDOW)
      ) {
        res.status(429).json({
          code: 'RATE_LIMIT',
          retryExhausted: true,
          error: 'Too many scan requests in a short period. Please wait a few minutes and try again.',
        });
        return;
      }

      const { imageBase64, mimeType } = req.body as {
        imageBase64?: unknown;
        mimeType?: unknown;
      };

      if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
        res.status(400).json({ error: 'Valid prescription image data is required.' });
        return;
      }
      if (imageBase64.length > MAX_BASE64_BYTES) {
        res.status(400).json({ error: 'Image size exceeds maximum allowed limit (10 MB).' });
        return;
      }
      if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
        res.status(400).json({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.' });
        return;
      }

      const cleanedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      if (!hasValidImageMagicBytes(cleanedBase64, mimeType)) {
        res.status(400).json({
          code: 'INVALID_IMAGE',
          retryExhausted: true,
          error: 'The uploaded file does not appear to be a valid prescription image.',
        });
        return;
      }

      if (!acquireUserConcurrencySlot(verifiedUser.uid)) {
        res.status(429).json({
          code: 'RATE_LIMIT',
          retryExhausted: true,
          error: 'Another prescription scan is already in progress. Please wait for it to finish.',
        });
        return;
      }
      activeSlotUid = verifiedUser.uid;

      if (wantsStream) {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        writeStreamLine({ type: 'status', state: 'analyzing' });
      }

      const { result: extracted, modelUsed } = await callGeminiWithRetryAndFallback(
        cleanedBase64,
        mimeType.toLowerCase(),
        {
          signal: abortController.signal,
          onRetryStatus: (info) => {
            writeStreamLine({ type: 'status', state: 'retrying', ...info });
          },
        }
      );

      if (wantsStream) {
        writeStreamLine({ type: 'result', result: extracted, modelUsed });
        res.end();
      } else {
        res.json({ result: extracted, modelUsed });
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || abortController.signal.aborted) {
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      const rawMsg = err instanceof Error ? err.message : '';
      if ((err as { isAccessDenied?: boolean })?.isAccessDenied) {
        res.status(403).json({
          code: 'ACCESS_DENIED',
          retryExhausted: true,
          error: rawMsg,
        });
        return;
      }
      if (
        rawMsg.includes('Authentication') ||
        rawMsg.includes('Token') ||
        rawMsg.includes('Session expired') ||
        rawMsg.includes('Verified email')
      ) {
        if (wantsStream && res.headersSent) {
          writeStreamLine({
            type: 'error',
            code: 'AUTH_ERROR',
            retryExhausted: true,
            message: 'Session expired. Please sign in again.',
          });
          res.end();
        } else {
          res.status(401).json({ error: 'Session expired. Please sign in again.' });
        }
        return;
      }

      const classified = classifyGeminiError(err);
      if (wantsStream && res.headersSent) {
        writeStreamLine({
          type: 'error',
          code: classified.code,
          retryExhausted: true,
          message: classified.userMessage,
        });
        res.end();
      } else {
        res.status(classified.httpStatus).json({
          code: classified.code,
          retryExhausted: true,
          error: classified.userMessage,
        });
      }
    } finally {
      if (activeSlotUid) {
        releaseUserConcurrencySlot(activeSlotUid);
      }
    }
  });

  app.post('/api/patient-advice', async (req: Request, res: Response) => {
    const abortController = new AbortController();
    let activeAdviceUid: string | null = null;
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required to generate patient advice.' });
        return;
      }

      const token = authHeader.slice('Bearer '.length).trim();
      const verifiedUser = await verifyFirebaseIdToken(token);

      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (
        !checkSlidingWindowLimit(userRequestTimestamps, verifiedUser.uid, MAX_REQUESTS_PER_USER_WINDOW) ||
        !checkSlidingWindowLimit(ipRequestTimestamps, clientIp, MAX_REQUESTS_PER_IP_WINDOW)
      ) {
        res.status(429).json({
          code: 'RATE_LIMIT',
          error: 'Too many requests in a short period. Please wait a few minutes and try again.',
        });
        return;
      }

      const { prescribedMedicineText, age, sex, duration } = req.body as {
        prescribedMedicineText?: unknown;
        age?: unknown;
        sex?: unknown;
        duration?: unknown;
      };

      if (typeof prescribedMedicineText !== 'string' || prescribedMedicineText.trim().length === 0) {
        res.status(400).json({ error: 'Prescribed medicine text is required.' });
        return;
      }
      if (prescribedMedicineText.length > 5000) {
        res.status(400).json({ error: 'Prescribed medicine text exceeds maximum length.' });
        return;
      }

      if (!acquireUserConcurrencySlot(verifiedUser.uid)) {
        res.status(429).json({
          code: 'RATE_LIMIT',
          error: 'Another AI request is currently running. Please wait a moment and try again.',
        });
        return;
      }
      activeAdviceUid = verifiedUser.uid;

      const advice = await generatePatientAdviceWithRetry(
        {
          prescribedMedicineText: prescribedMedicineText.trim(),
          age: typeof age === 'string' ? age.slice(0, 60) : undefined,
          sex: typeof sex === 'string' ? sex.slice(0, 40) : undefined,
          duration: typeof duration === 'string' ? duration.slice(0, 1000) : undefined,
        },
        abortController.signal
      );

      res.json({ advice });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || abortController.signal.aborted) {
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      const rawMsg = err instanceof Error ? err.message : '';
      if ((err as { isAccessDenied?: boolean })?.isAccessDenied) {
        res.status(403).json({
          code: 'ACCESS_DENIED',
          error: rawMsg,
        });
        return;
      }
      if (
        rawMsg.includes('Authentication') ||
        rawMsg.includes('Token') ||
        rawMsg.includes('Session expired') ||
        rawMsg.includes('Verified email')
      ) {
        res.status(401).json({ error: 'Session expired. Please sign in again.' });
        return;
      }

      const classified = classifyGeminiError(err);
      res.status(classified.httpStatus).json({
        code: classified.code,
        error:
          classified.kind === 'transient'
            ? 'The AI service is temporarily busy. Please tap Regenerate Advice to try again.'
            : classified.userMessage,
      });
    } finally {
      if (activeAdviceUid) {
        releaseUserConcurrencySlot(activeAdviceUid);
      }
    }
  });

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`RxLedger server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
