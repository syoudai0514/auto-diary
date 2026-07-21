'use client';

/**
 * 事実ノートの画面ロック（PIN + 生体認証/Face ID）。
 *
 * 方針:
 * - PIN を土台にする。PBKDF2-SHA256 でハッシュ化して localStorage に保存し、
 *   平文の PIN は保存しない。照合は定数時間比較。
 * - 生体認証は WebAuthn（プラットフォーム認証器＝Face ID / Touch ID）。
 *   端末ローカルの本人確認として使い、サーバーには依存しない。
 *   失敗しうるため PIN を常にフォールバックに残す（締め出し＝データ喪失を防ぐ）。
 * - ロックが設定されている間は、アプリ起動時とバックグラウンド復帰後（一定時間経過）に
 *   必ずロックし、解除するまで中身を表示しない。
 *
 * 正直な制約: これは「画面ロック（目隠し）」で、IndexedDB のデータ自体は
 * 暗号化されない。端末のファイルへ直接アクセスできる相手には防げない。
 */

const KEY_PIN = 'factnote-lock-pin';
const KEY_CRED = 'factnote-lock-cred';
const KEY_AUTOLOCK = 'factnote-lock-autolock-ms';

const PBKDF2_ITERATIONS = 150_000;

/** 既定のオートロック時間（バックグラウンド滞在がこれを超えたら再ロック）。 */
export const DEFAULT_AUTOLOCK_MS = 60_000;
export const AUTOLOCK_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 0, label: 'すぐ' },
  { ms: 60_000, label: '1分後' },
  { ms: 5 * 60_000, label: '5分後' },
];

// ---------------------------------------------------------------------------
// base64 / 乱数

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 定数時間比較（タイミング攻撃対策）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// PIN（PBKDF2）

interface PinRecord {
  salt: string; // base64
  hash: string; // base64
  iterations: number;
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

function readPin(): PinRecord | null {
  try {
    const raw = localStorage.getItem(KEY_PIN);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PinRecord>;
    if (typeof parsed.salt === 'string' && typeof parsed.hash === 'string' && parsed.iterations) {
      return { salt: parsed.salt, hash: parsed.hash, iterations: parsed.iterations };
    }
  } catch {
    /* noop */
  }
  return null;
}

/** ロック（PIN）が設定されているか。 */
export function isLockConfigured(): boolean {
  return readPin() !== null;
}

/** PIN を設定・変更する（4桁以上）。 */
export async function setPin(pin: string): Promise<void> {
  const salt = randomBytes(16);
  const hash = await derivePinHash(pin, salt, PBKDF2_ITERATIONS);
  const record: PinRecord = {
    salt: toBase64(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
  };
  localStorage.setItem(KEY_PIN, JSON.stringify(record));
}

/** PIN を照合する。 */
export async function verifyPin(pin: string): Promise<boolean> {
  const record = readPin();
  if (!record) return false;
  const hash = await derivePinHash(pin, fromBase64(record.salt), record.iterations);
  return timingSafeEqual(hash, record.hash);
}

/** ロックを完全に解除（PIN・生体認証の登録をすべて削除）。 */
export function removeLock(): void {
  localStorage.removeItem(KEY_PIN);
  localStorage.removeItem(KEY_CRED);
  localStorage.removeItem(KEY_AUTOLOCK);
  markUnlocked();
}

// ---------------------------------------------------------------------------
// 生体認証（WebAuthn / Face ID・Touch ID）

/** この端末で生体認証（プラットフォーム認証器）が使えるか。 */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    if (
      typeof window === 'undefined' ||
      typeof PublicKeyCredential === 'undefined' ||
      !navigator.credentials
    ) {
      return false;
    }
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** 生体認証が登録済みか。 */
export function hasBiometric(): boolean {
  try {
    return !!localStorage.getItem(KEY_CRED);
  } catch {
    return false;
  }
}

/** 生体認証を登録する（Face ID / Touch ID）。失敗時は例外を投げる。 */
export async function registerBiometric(): Promise<void> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: '事実ノート', id: location.hostname },
      user: {
        id: randomBytes(16) as BufferSource,
        name: 'factnote-user',
        displayName: '事実ノート',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('登録がキャンセルされました。');
  localStorage.setItem(KEY_CRED, toBase64(new Uint8Array(cred.rawId)));
}

/** 生体認証で解除する。成功で true。 */
export async function unlockWithBiometric(): Promise<boolean> {
  const stored = localStorage.getItem(KEY_CRED);
  if (!stored) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        rpId: location.hostname,
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: fromBase64(stored) as BufferSource }],
      },
    });
    if (assertion) {
      markUnlocked();
      return true;
    }
  } catch {
    /* 失敗・キャンセル */
  }
  return false;
}

/** 生体認証の登録を解除する（PINは残す）。 */
export function removeBiometric(): void {
  localStorage.removeItem(KEY_CRED);
}

// ---------------------------------------------------------------------------
// オートロック設定

export function getAutoLockMs(): number {
  try {
    const raw = localStorage.getItem(KEY_AUTOLOCK);
    if (raw === null) return DEFAULT_AUTOLOCK_MS;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_AUTOLOCK_MS;
  } catch {
    return DEFAULT_AUTOLOCK_MS;
  }
}

export function setAutoLockMs(ms: number): void {
  localStorage.setItem(KEY_AUTOLOCK, String(ms));
}

// ---------------------------------------------------------------------------
// セッションのロック状態（メモリ上。リロードで必ずロックに戻る）

let unlocked = false;
const listeners = new Set<() => void>();

export function isUnlocked(): boolean {
  return unlocked;
}

export function markUnlocked(): void {
  unlocked = true;
  notify();
}

export function lockNow(): void {
  unlocked = false;
  notify();
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

export function subscribeLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
