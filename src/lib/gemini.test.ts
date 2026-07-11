import { describe, it, expect } from 'vitest';
import { guessAudioMimeType, extractText } from './gemini';

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
