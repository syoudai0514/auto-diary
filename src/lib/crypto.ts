import { randomBytes, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'crypto';
import { promisify } from 'util';

/**
 * パスワードのハッシュ化（scrypt + ランダムsalt）と、
 * Gemini APIキーなど秘密情報の保管時暗号化（AES-256-GCM）。
 * 追加の依存ライブラリを増やさないため、Node標準の crypto のみを使う。
 */

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;

/** パスワードをハッシュ化する。戻り値は `<saltHex>:<hashHex>`。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** ハッシュ化済みパスワードと入力パスワードを、タイミング安全に照合する。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** 2つの文字列をタイミング安全に比較する（招待コードの照合等に使う）。 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // 長さが違うと timingSafeEqual が例外を投げるため、長さ違いも定数時間で扱う。
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // ダミー比較でタイミングを揃える
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function getEncryptionKey(): Buffer {
  const raw = process.env.ACCOUNT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ACCOUNT_ENCRYPTION_KEY が設定されていません');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ACCOUNT_ENCRYPTION_KEY は base64 エンコードされた32バイトである必要があります');
  }
  return key;
}

/**
 * 秘密情報（Gemini APIキー等）を AES-256-GCM で暗号化する。
 * 戻り値は `v1:<ivBase64>:<authTagBase64>:<ciphertextBase64>`。
 * バージョン接頭辞は、将来の鍵ローテーション時に形式を判別できるようにするため。
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** encryptSecret() の逆変換。改ざん・形式不正の場合は例外を投げる。 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('不正な暗号化データの形式です');
  }
  const [, ivB64, authTagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
