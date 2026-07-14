'use client';

import { getMeta, setMeta } from './db';

/**
 * 事実ノートのプロフィール（自分の立場・家族構成・呼び方など）。
 * 音声日記の profile.ts と同じ思想だが、事実ノートは記録をIndexedDBに保存する
 * アプリなので、プロフィールも meta ストアに保存し、JSONバックアップに含める。
 *
 * 用途: 文字起こしの話者ラベル（A:/B: ではなく「私:」「妻:」）、
 * 分析での自分側/相手側の割り当て、日記の呼び方の判断材料としてAIへ渡す。
 * AI処理のリクエスト時にだけ送信され、サーバーには保存されない。
 */

export interface FactnoteProfile {
  markdown: string;
  updatedAt: string; // ISO
}

export const META_FACTNOTE_PROFILE = 'factnoteProfile';

/** AIへ渡すプロフィールの最大文字数（サーバー側の検証と揃える）。 */
export const FACTNOTE_PROFILE_MAX_CHARS = 2000;

export const DEFAULT_FACTNOTE_PROFILE: FactnoteProfile = { markdown: '', updatedAt: '' };

/** プロフィール入力欄のプレースホルダー（書き方の例）。 */
export const FACTNOTE_PROFILE_PLACEHOLDER = [
  '例:',
  '- 私は夫（30代）。記録を書いているのは私。',
  '- 妻: 「ママ」と呼ぶこともある',
  '- 長男（5歳）・長女（2歳）',
  '- 録音では妻の声が高め、私の声が低め',
].join('\n');

export async function loadFactnoteProfile(): Promise<FactnoteProfile> {
  try {
    const raw = await getMeta<FactnoteProfile>(META_FACTNOTE_PROFILE);
    if (raw && typeof raw.markdown === 'string') {
      return { markdown: raw.markdown, updatedAt: raw.updatedAt ?? '' };
    }
  } catch {
    /* 読み込み失敗時は空で返す */
  }
  return { ...DEFAULT_FACTNOTE_PROFILE };
}

export async function saveFactnoteProfile(markdown: string): Promise<FactnoteProfile> {
  const profile: FactnoteProfile = {
    markdown: markdown.slice(0, FACTNOTE_PROFILE_MAX_CHARS),
    updatedAt: new Date().toISOString(),
  };
  await setMeta(META_FACTNOTE_PROFILE, profile);
  return profile;
}

/** AIへ渡す形（空なら undefined）。 */
export function profileToPeopleContext(profile: FactnoteProfile): string | undefined {
  const trimmed = profile.markdown.trim();
  return trimmed ? trimmed.slice(0, FACTNOTE_PROFILE_MAX_CHARS) : undefined;
}
