import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * @upstash/redis の Redis クラスを、メモリ上の簡易ストアでモックする。
 * SET ... NX の原子性（既存キーがあれば null を返す）だけは実際の挙動に合わせて再現する。
 */
const store = new Map<string, unknown>();

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    async get<T>(key: string): Promise<T | null> {
      return (store.has(key) ? (store.get(key) as T) : null);
    }
    async set(key: string, value: unknown, opts?: { nx?: boolean }): Promise<'OK' | null> {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }
  }
  return { Redis: FakeRedis };
});

process.env.KV_REST_API_URL = 'https://example.upstash.io';
process.env.KV_REST_API_TOKEN = 'fake-token';

import { getUserById, getUserByUsername, createUser, setUserGeminiKey } from './userStore';

beforeEach(() => {
  store.clear();
});

describe('userStore（アカウント情報の永続化）', () => {
  it('ユーザーを作成して id/username で取得できる', async () => {
    const user = await createUser('Taro', 'saltHex:hashHex');
    expect(user).not.toBeNull();
    expect(user?.username).toBe('taro'); // 小文字に正規化される
    expect(user?.geminiKeyEncrypted).toBeNull();

    const byId = await getUserById(user!.id);
    expect(byId?.username).toBe('taro');

    const byUsername = await getUserByUsername('TARO'); // 大文字小文字を無視
    expect(byUsername?.id).toBe(user!.id);
  });

  it('同じユーザー名では作成できない（null を返す）', async () => {
    await createUser('taro', 'hash1');
    const second = await createUser('taro', 'hash2');
    expect(second).toBeNull();
  });

  it('存在しないユーザーは null', async () => {
    expect(await getUserById('nope')).toBeNull();
    expect(await getUserByUsername('nope')).toBeNull();
  });

  it('Gemini APIキーを設定・更新できる', async () => {
    const user = await createUser('hanako', 'hash');
    await setUserGeminiKey(user!.id, 'v1:encrypted-value');
    const updated = await getUserById(user!.id);
    expect(updated?.geminiKeyEncrypted).toBe('v1:encrypted-value');
    // 他のフィールドは維持される
    expect(updated?.username).toBe('hanako');
    expect(updated?.passwordHash).toBe('hash');
  });

  it('存在しないユーザーにキーを設定しようとすると例外', async () => {
    await expect(setUserGeminiKey('nope', 'v1:x')).rejects.toThrow();
  });
});
