import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS, MAX_PEOPLE_CONTEXT_CHARS, loadSettings, saveSettings } from './settings';

describe('settings（peopleContext含む）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未保存時はデフォルト設定を返す（peopleContextは空文字）', () => {
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.peopleContext).toBe('');
  });

  it('保存した peopleContext を復元できる', () => {
    saveSettings({
      style: 'natural',
      saveTarget: 'ask',
      dayoneJournal: '',
      peopleContext: '私は4人家族の父です。妻はママと呼びます。',
    });
    const s = loadSettings();
    expect(s.peopleContext).toBe('私は4人家族の父です。妻はママと呼びます。');
  });

  it('異常に長い peopleContext は上限で切り詰めて復元する', () => {
    const long = 'あ'.repeat(MAX_PEOPLE_CONTEXT_CHARS + 500);
    localStorage.setItem(
      'voice-diary-settings',
      JSON.stringify({ style: 'natural', saveTarget: 'ask', dayoneJournal: '', peopleContext: long }),
    );
    const s = loadSettings();
    expect(s.peopleContext.length).toBe(MAX_PEOPLE_CONTEXT_CHARS);
  });

  it('壊れたJSONが保存されていてもデフォルトにフォールバックする', () => {
    localStorage.setItem('voice-diary-settings', '{ 壊れた');
    const s = loadSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('peopleContext が文字列でない場合はデフォルトにフォールバックする', () => {
    localStorage.setItem(
      'voice-diary-settings',
      JSON.stringify({ style: 'natural', saveTarget: 'ask', dayoneJournal: '', peopleContext: 123 }),
    );
    const s = loadSettings();
    expect(s.peopleContext).toBe('');
  });
});
