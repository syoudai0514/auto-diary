'use client';

import { DEFAULT_STYLE, isDiaryStyleId, type DiaryStyleId } from './diary';

/**
 * ユーザー設定（文体・保存先・Day One ジャーナル名）。
 * パスワードや API キーは保存しない。
 * 「自分について・登場人物」は src/lib/profile.ts（プロフィール Markdown）で別管理する。
 */

export type SaveTarget = 'apple' | 'dayone' | 'clipboard' | 'openApp' | 'ask';

export interface Settings {
  style: DiaryStyleId;
  saveTarget: SaveTarget;
  dayoneJournal: string;
  /**
   * Appleジャーナル保存には、端末側で一度だけiOSショートカット「音声日記を保存」を
   * 作っておく必要がある（Apple側にJournalの公開APIが無いため）。未設定のまま
   * 保存を試みると分かりにくいiOSのエラーになるため、既定では無効にしておき、
   * 設定画面で手順を確認したうえで明示的に有効化してもらう。
   */
  appleJournalEnabled: boolean;
}

const KEY = 'voice-diary-settings';

export const DEFAULT_SETTINGS: Settings = {
  style: DEFAULT_STYLE,
  saveTarget: 'ask',
  dayoneJournal: '',
  appleJournalEnabled: false,
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
      appleJournalEnabled:
        typeof parsed.appleJournalEnabled === 'boolean'
          ? parsed.appleJournalEnabled
          : DEFAULT_SETTINGS.appleJournalEnabled,
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
  return v === 'apple' || v === 'dayone' || v === 'clipboard' || v === 'openApp' || v === 'ask';
}
