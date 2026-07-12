import { describe, it, expect } from 'vitest';
import { formatTimer, formatDuration, formatDate, formatBytes, combineTranscripts, sourceLabel } from './format';

describe('formatTimer', () => {
  it('ミリ秒を mm:ss に変換する', () => {
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(8000)).toBe('00:08');
    expect(formatTimer(65000)).toBe('01:05');
  });
});

describe('formatDuration', () => {
  it('60秒未満は秒のみ', () => {
    expect(formatDuration(45)).toBe('45秒');
  });
  it('60秒以上は分秒', () => {
    expect(formatDuration(125)).toBe('2分5秒');
  });
});

describe('formatDate', () => {
  it('ISO日時をM月D日形式にする', () => {
    expect(formatDate('2026-07-11T09:30:00.000Z')).toMatch(/^\d{1,2}月\d{1,2}日$/);
  });
  it('不正な日時は空文字', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('formatBytes', () => {
  it('1024未満はB', () => {
    expect(formatBytes(500)).toBe('500B');
  });
  it('KB単位', () => {
    expect(formatBytes(2048)).toBe('2KB');
  });
  it('MB単位（小数第1位まで）', () => {
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB');
  });
});

describe('combineTranscripts（複数音声の文字起こし結合）', () => {
  it('空行で連結する', () => {
    expect(combineTranscripts(['朝の散歩をした。', '午後は仕事をした。'])).toBe(
      '朝の散歩をした。\n\n午後は仕事をした。',
    );
  });
  it('空・空白のみの結果は除外する（無音ファイル対策）', () => {
    expect(combineTranscripts(['本文A', '  ', '', '本文B'])).toBe('本文A\n\n本文B');
  });
  it('前後の空白をトリムする', () => {
    expect(combineTranscripts(['  先頭と末尾に空白  '])).toBe('先頭と末尾に空白');
  });
  it('全て空なら空文字を返す', () => {
    expect(combineTranscripts(['', '   '])).toBe('');
  });
});

describe('sourceLabel', () => {
  it('ファイル入力なら件数を表示する', () => {
    expect(sourceLabel('files', 0, 3)).toBe('音声ファイル3件から作成');
  });
  it('録音なら録音時間を表示する', () => {
    expect(sourceLabel('record', 90, 0)).toBe('録音時間 1分30秒');
  });
  it('録音時間が無ければ手入力', () => {
    expect(sourceLabel('quick', 0, 0)).toBe('手入力');
  });
});
