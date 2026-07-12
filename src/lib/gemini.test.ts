import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { guessAudioMimeType, extractText, chatModel, transcribeModel, getGemini } from './gemini';

describe('getGemini', () => {
  it('APIキーを渡せばクライアントを生成できる', () => {
    expect(() => getGemini('fake-api-key')).not.toThrow();
  });

  it('空のAPIキーは例外を投げる', () => {
    expect(() => getGemini('')).toThrow();
  });
});

describe('guessAudioMimeType', () => {
  it('ブラウザが正しい type を報告していればそれを使う', () => {
    expect(guessAudioMimeType('a.webm', 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
  });

  it('type が空文字なら拡張子から推定する（iOSファイルアプリ対策）', () => {
    expect(guessAudioMimeType('voice.m4a', '')).toBe('audio/mp4');
    expect(guessAudioMimeType('voice.mp3', '')).toBe('audio/mpeg');
    expect(guessAudioMimeType('voice.wav', '')).toBe('audio/wav');
    expect(guessAudioMimeType('voice.aac', '')).toBe('audio/aac');
    expect(guessAudioMimeType('voice.flac', undefined)).toBe('audio/flac');
  });

  it('type が application/octet-stream のような汎用値でも拡張子を優先する', () => {
    expect(guessAudioMimeType('voice.m4a', 'application/octet-stream')).toBe('audio/mp4');
  });

  it('日本語ファイル名・複数ドットでも拡張子を正しく取り出す', () => {
    expect(guessAudioMimeType('2026-07-11_15-51_家庭記録.m4a', '')).toBe('audio/mp4');
  });

  it('拡張子が不明なら audio/webm にフォールバックする', () => {
    expect(guessAudioMimeType('unknownfile', '')).toBe('audio/webm');
    expect(guessAudioMimeType('voice.xyz', '')).toBe('audio/webm');
  });
});

describe('extractText', () => {
  it('text が文字列ならそのまま返す', () => {
    expect(extractText({ text: 'こんにちは' })).toBe('こんにちは');
  });
  it('text が undefined なら空文字を返す', () => {
    expect(extractText({})).toBe('');
    expect(extractText({ text: undefined })).toBe('');
  });
});

describe('既定モデル（環境変数未設定時のフォールバック）', () => {
  const savedModel = process.env.GEMINI_MODEL;
  const savedTranscribeModel = process.env.GEMINI_TRANSCRIBE_MODEL;

  beforeEach(() => {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_TRANSCRIBE_MODEL;
  });
  afterEach(() => {
    process.env.GEMINI_MODEL = savedModel;
    process.env.GEMINI_TRANSCRIBE_MODEL = savedTranscribeModel;
  });

  it('廃止済みの gemini-2.0-flash 系を既定値に使わない', () => {
    expect(chatModel()).not.toContain('gemini-2.0-flash');
    expect(transcribeModel()).not.toContain('gemini-2.0-flash');
  });

  it('未設定時は gemini-3.1-flash-lite を使う', () => {
    expect(chatModel()).toBe('gemini-3.1-flash-lite');
    expect(transcribeModel()).toBe('gemini-3.1-flash-lite');
  });
});
