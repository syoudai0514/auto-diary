import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_PROFILE, loadProfile, saveProfile } from './profile';

describe('profile（プロフィールMarkdownの保存・復元）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未保存時はデフォルト（空）を返す', () => {
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it('保存した内容を復元できる', () => {
    saveProfile({ markdown: '## 家族構成\n- 妻(ママ)', updatedAt: '2026-07-12T00:00:00.000Z' });
    const p = loadProfile();
    expect(p.markdown).toBe('## 家族構成\n- 妻(ママ)');
    expect(p.updatedAt).toBe('2026-07-12T00:00:00.000Z');
  });

  it('壊れたJSONが保存されていてもデフォルトにフォールバックする', () => {
    localStorage.setItem('voice-diary-profile', '{ 壊れた');
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it('旧設定の peopleContext があれば初回読み込み時に引き継ぐ', () => {
    localStorage.setItem(
      'voice-diary-settings',
      JSON.stringify({
        style: 'natural',
        saveTarget: 'ask',
        dayoneJournal: '',
        peopleContext: '私は4人家族の父です。妻はママと呼びます。',
      }),
    );
    const p = loadProfile();
    expect(p.markdown).toBe('私は4人家族の父です。妻はママと呼びます。');
    expect(p.updatedAt).not.toBe('');
    // 一度読み込んだら永続化され、以後は独立して管理される
    expect(JSON.parse(localStorage.getItem('voice-diary-profile')!).markdown).toBe(
      '私は4人家族の父です。妻はママと呼びます。',
    );
  });

  it('旧設定の peopleContext が空なら移行しない', () => {
    localStorage.setItem(
      'voice-diary-settings',
      JSON.stringify({ style: 'natural', saveTarget: 'ask', dayoneJournal: '', peopleContext: '' }),
    );
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it('プロフィールが既に保存されていれば旧設定より優先する', () => {
    localStorage.setItem(
      'voice-diary-settings',
      JSON.stringify({ style: 'natural', saveTarget: 'ask', dayoneJournal: '', peopleContext: '旧データ' }),
    );
    saveProfile({ markdown: '新データ', updatedAt: '2026-07-12T00:00:00.000Z' });
    expect(loadProfile().markdown).toBe('新データ');
  });
});
