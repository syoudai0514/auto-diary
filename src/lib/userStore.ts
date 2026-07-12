import { Redis } from '@upstash/redis';

/**
 * アカウント情報の永続化（Upstash Redis）。
 * 保存するのはアカウント情報のみ（ユーザー名・パスワードのハッシュ・暗号化したGemini APIキー）。
 * 日記本文・下書き・プロフィールは今まで通りサーバーには一切保存しない。
 * Node実行のみを前提とする（middleware.ts のような Edge Runtime からは import しないこと）。
 */

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  geminiKeyEncrypted: string | null;
  createdAt: string; // ISO
}

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN が設定されていません');
    }
    // 呼び出しはほぼ常に逐次実行（並行実行を活かす場面がない）ため、
    // 自動パイプライン化は無効にしてリクエストの挙動を単純にしておく。
    client = new Redis({ url, token, enableAutoPipelining: false });
  }
  return client;
}

function userKey(id: string): string {
  return `user:${id}`;
}

function usernameKey(username: string): string {
  return `username:${normalizeUsername(username)}`;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function newUserId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `u_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function getUserById(id: string): Promise<StoredUser | null> {
  const user = await getClient().get<StoredUser>(userKey(id));
  return user ?? null;
}

export async function getUserByUsername(username: string): Promise<StoredUser | null> {
  const id = await getClient().get<string>(usernameKey(username));
  if (!id) return null;
  return getUserById(id);
}

/** 新規ユーザーを作成する。ユーザー名が既に使われている場合は null を返す。 */
export async function createUser(username: string, passwordHash: string): Promise<StoredUser | null> {
  const id = newUserId();
  const redis = getClient();
  // SET NX でユーザー名の重複を原子的に検知・予約する
  const reserved = await redis.set(usernameKey(username), id, { nx: true });
  if (reserved !== 'OK') return null;

  const user: StoredUser = {
    id,
    username: normalizeUsername(username),
    passwordHash,
    geminiKeyEncrypted: null,
    createdAt: new Date().toISOString(),
  };
  await redis.set(userKey(id), user);
  return user;
}

export async function setUserGeminiKey(userId: string, encrypted: string | null): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new Error('ユーザーが見つかりません');
  const updated: StoredUser = { ...user, geminiKeyEncrypted: encrypted };
  await getClient().set(userKey(userId), updated);
}
