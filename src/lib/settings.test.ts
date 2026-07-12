import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';

describe('settings（文体・保存先・Day Oneジャーナル名）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未保存時はデフォルト設定を返す', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('保存した設定を復元できる', () => {
    saveSettings({ style: 'emotion', saveTarget: 'dayone', dayoneJournal: '日記' });
    const s = loadSettings();
    expect(s.style).toBe('emotion');
    expect(s.saveTarget).toBe('dayone');
    expect(s.dayoneJournal).toBe('日記');
  });

  it('不正な style / saveTarget はデフォルトにフォールバックする', () => {
    localStorage.setItem(
      'voice-diary-settings',
      JSON.stringify({ style: 'invalid', saveTarget: 'invalid', dayoneJournal: 'x' }),
    );
    const s = loadSettings();
    expect(s.style).toBe(DEFAULT_SETTINGS.style);
    expect(s.saveTarget).toBe(DEFAULT_SETTINGS.saveTarget);
    expect(s.dayoneJournal).toBe('x');
  });

  it('壊れたJSONが保存されていてもデフォルトにフォールバックする', () => {
    localStorage.setItem('voice-diary-settings', '{ 壊れた');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
