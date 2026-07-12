'use client';

/**
 * 「プロフィール」（家族構成・自分について・特性など）を Markdown で保持する。
 * 設定と同様、端末内（localStorage）にのみ保存し、サーバーには保存しない。
 * 生成・更新のリクエスト時にだけ Gemini へ一時的に送られる。
 */

export interface Profile {
  markdown: string;
  updatedAt: string; // ISO
}

const KEY = 'voice-diary-profile';
/** 旧・設定画面の簡易テキスト欄（1行の「自分について・登場人物」）。移行専用。 */
const LEGACY_SETTINGS_KEY = 'voice-diary-settings';

export const DEFAULT_PROFILE: Profile = { markdown: '', updatedAt: '' };

export function loadProfile(): Profile {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PROFILE };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Profile>;
      return {
        markdown: typeof parsed.markdown === 'string' ? parsed.markdown : '',
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      };
    }
  } catch {
    return { ...DEFAULT_PROFILE };
  }

  // 初回のみ: 旧「自分について・登場人物」欄の内容があれば引き継ぐ
  const migrated = migrateFromLegacySettings();
  if (migrated) {
    saveProfile(migrated);
    return migrated;
  }
  return { ...DEFAULT_PROFILE };
}

function migrateFromLegacySettings(): Profile | null {
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { peopleContext?: unknown };
    if (typeof parsed.peopleContext === 'string' && parsed.peopleContext.trim().length > 0) {
      return { markdown: parsed.peopleContext.trim(), updatedAt: new Date().toISOString() };
    }
  } catch {
    /* noop */
  }
  return null;
}

export function saveProfile(p: Profile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 容量不足などは無視
  }
}
