import { describe, it, expect } from 'vitest';
import { classifyRecorderError, extForMime, hasRecorderSupport } from './useRecorder';

describe('録音権限/サポート判定', () => {
  it('NotAllowedError は permission に分類（権限拒否）', () => {
    const err = new DOMException('denied', 'NotAllowedError');
    expect(classifyRecorderError(err)).toBe('permission');
  });

  it('SecurityError も permission に分類', () => {
    const err = new DOMException('blocked', 'SecurityError');
    expect(classifyRecorderError(err)).toBe('permission');
  });

  it('その他の例外は unknown', () => {
    expect(classifyRecorderError(new Error('boom'))).toBe('unknown');
    expect(classifyRecorderError('str')).toBe('unknown');
  });

  it('jsdom には MediaRecorder が無いので非サポート判定', () => {
    expect(hasRecorderSupport()).toBe(false);
  });
});

describe('mime → 拡張子', () => {
  it('mp4 系は m4a', () => {
    expect(extForMime('audio/mp4')).toBe('m4a');
  });
  it('ogg は ogg', () => {
    expect(extForMime('audio/ogg')).toBe('ogg');
  });
  it('未指定は webm', () => {
    expect(extForMime(undefined)).toBe('webm');
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm');
  });
});
