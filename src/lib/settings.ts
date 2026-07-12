'use client';

import { DEFAULT_STYLE, isDiaryStyleId, type DiaryStyleId } from './diary';

/**
 * ユーザー設定（文体・保存先・Day One ジャーナル名・登場人物の補足情報）。
 * パスワードや API キーは保存しない。
 */

export type SaveTarget = 'apple' | 'dayone' | 'clipboard' | 'ask';

/** peopleContext の最大長（サーバー側の上限と合わせる）。 */
export const MAX_PEOPLE_CONTEXT_CHARS = 1000;

export interface Settings {
  style: DiaryStyleId;
  saveTarget: SaveTarget;
  dayoneJournal: string;
  /** 「私は父です。妻はママと呼びます」など、話者・登場人物を判断するための補足情報。 */
  peopleContext: string;
}

const KEY = 'voice-diary-settings';

export const DEFAULT_SETTINGS: Settings = {
  style: DEFAULT_STYLE,
  saveTarget: 'ask',
  dayoneJournal: '',
  peopleContext: '',
};

export function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      style: isDiaryStyleId(parsed.style) ? parsed.style : DEFAULT_SETTINGS.style,
      saveTarget: isSaveTarget(parsed.saveTarget) ? parsed.saveTarget : DEFAULT_SETTINGS.saveTarget,
      dayoneJournal:
        typeof parsed.dayoneJournal === 'string' ? parsed.dayoneJournal : DEFAULT_SETTINGS.dayoneJournal,
      peopleContext:
        typeof parsed.peopleContext === 'string'
          ? parsed.peopleContext.slice(0, MAX_PEOPLE_CONTEXT_CHARS)
          : DEFAULT_SETTINGS.peopleContext,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 容量不足などは無視
  }
}

function isSaveTarget(v: unknown): v is SaveTarget {
  return v === 'apple' || v === 'dayone' || v === 'clipboard' || v === 'ask';
}
