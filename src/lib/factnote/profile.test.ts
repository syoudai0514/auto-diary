import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  FACTNOTE_PROFILE_MAX_CHARS,
  loadFactnoteProfile,
  profileToPeopleContext,
  saveFactnoteProfile,
} from './profile';
import { buildFactnoteTranscribePrompt } from './prompts/transcribe';
import { buildIncidentAnalysisSystemPrompt } from './prompts/incidentAnalysis';
import { buildFactnoteDiarySystemPrompt } from './prompts/diary';

describe('事実ノートのプロフィール', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    localStorage.clear();
  });

  it('保存して読み出せる（未保存時は空）', async () => {
    expect((await loadFactnoteProfile()).markdown).toBe('');
    await saveFactnoteProfile('私は夫。妻はママと呼ぶ。');
    const loaded = await loadFactnoteProfile();
    expect(loaded.markdown).toBe('私は夫。妻はママと呼ぶ。');
    expect(loaded.updatedAt).toBeTruthy();
  });

  it('上限を超える本文は切り詰められる', async () => {
    await saveFactnoteProfile('あ'.repeat(FACTNOTE_PROFILE_MAX_CHARS + 100));
    expect((await loadFactnoteProfile()).markdown).toHaveLength(FACTNOTE_PROFILE_MAX_CHARS);
  });

  it('profileToPeopleContext は空なら undefined を返す', () => {
    expect(profileToPeopleContext({ markdown: '  ', updatedAt: '' })).toBeUndefined();
    expect(profileToPeopleContext({ markdown: '私は夫', updatedAt: '' })).toBe('私は夫');
  });

  it('IndexedDB側が消えても localStorage バックアップから自動復元される', async () => {
    await saveFactnoteProfile('私は夫。妻はママと呼ぶ。');
    // ブラウザによるIndexedDB退避を再現（localStorageは残る）
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    const restored = await loadFactnoteProfile();
    expect(restored.markdown).toBe('私は夫。妻はママと呼ぶ。');
    // ヒール後はIndexedDB側にも書き戻されている
    const again = await loadFactnoteProfile();
    expect(again.markdown).toBe('私は夫。妻はママと呼ぶ。');
  });
});

describe('プロンプトへのプロフィール反映', () => {
  const ctx = '私は夫。妻(ママ)、長男(5歳)。';

  it('文字起こし: プロフィールありなら呼び名ラベル、なしなら A/B ラベルを指示する', () => {
    const withCtx = buildFactnoteTranscribePrompt(ctx);
    expect(withCtx).toContain('「私: 」「妻: 」');
    expect(withCtx).toContain(ctx);
    const without = buildFactnoteTranscribePrompt();
    expect(without).toContain('「A: 」「B: 」');
    expect(without).not.toContain('補足情報ここから');
  });

  it('分析: プロフィールから自分側/相手側を判断する指示が入る', () => {
    const prompt = buildIncidentAnalysisSystemPrompt(ctx);
    expect(prompt).toContain('誰が「自分（記録者）」で');
    expect(prompt).toContain(ctx);
    expect(buildIncidentAnalysisSystemPrompt()).not.toContain('補足情報ここから');
  });

  it('日記: 登場人物の呼び方の指示が入る', () => {
    const prompt = buildFactnoteDiarySystemPrompt('factual', ctx);
    expect(prompt).toContain(ctx);
    expect(buildFactnoteDiarySystemPrompt('factual')).not.toContain('補足情報ここから');
  });
});
