import { describe, it, expect } from 'vitest';
import { safeParseDiary, isDiaryStyleId, DIARY_JSON_SCHEMA } from './diary';

const valid = {
  title: 'テスト',
  body: '本文です。',
  facts: ['歩いた'],
  feelings: ['落ち着いた'],
  interpretations: ['よかった'],
  nextActions: ['また歩く'],
  tags: ['散歩'],
  rawTranscript: '元テキスト',
};

describe('safeParseDiary（JSONパース）', () => {
  it('正しいJSON文字列をパースできる', () => {
    const d = safeParseDiary(JSON.stringify(valid));
    expect(d).not.toBeNull();
    expect(d?.title).toBe('テスト');
  });

  it('```json フェンス付きでも抽出できる', () => {
    const raw = '```json\n' + JSON.stringify(valid) + '\n```';
    const d = safeParseDiary(raw);
    expect(d?.body).toBe('本文です。');
  });

  it('前後に余計な文字があっても { } を抜き出す', () => {
    const raw = 'これが結果です: ' + JSON.stringify(valid) + ' 以上です。';
    const d = safeParseDiary(raw);
    expect(d?.tags).toEqual(['散歩']);
  });

  it('配列フィールド欠落は空配列で補完される', () => {
    const partial = { title: 'x', body: 'y', rawTranscript: 'z' };
    const d = safeParseDiary(JSON.stringify(partial));
    expect(d).not.toBeNull();
    expect(d?.facts).toEqual([]);
    expect(d?.tags).toEqual([]);
  });

  it('title欠落時はデフォルトタイトルを与える', () => {
    const partial = { body: 'y' };
    const d = safeParseDiary(JSON.stringify(partial));
    expect(d?.title).toBe('無題の日記');
  });

  it('完全に壊れた文字列では null を返す（再試行の起点）', () => {
    expect(safeParseDiary('これはJSONではありません')).toBeNull();
    expect(safeParseDiary('')).toBeNull();
    expect(safeParseDiary('{ 壊れた')).toBeNull();
  });
});

describe('スタイル判定とスキーマ定義', () => {
  it('isDiaryStyleId', () => {
    expect(isDiaryStyleId('natural')).toBe(true);
    expect(isDiaryStyleId('emotion')).toBe(true);
    expect(isDiaryStyleId('unknown')).toBe(false);
    expect(isDiaryStyleId(123)).toBe(false);
  });

  it('JSON Schema は strict で全プロパティ required', () => {
    expect(DIARY_JSON_SCHEMA.strict).toBe(true);
    expect(DIARY_JSON_SCHEMA.schema.required).toContain('title');
    expect(DIARY_JSON_SCHEMA.schema.additionalProperties).toBe(false);
  });
});
