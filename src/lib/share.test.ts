import { describe, it, expect } from 'vitest';
import {
  buildDayOneUrl,
  buildRunShortcutUrl,
  buildShortcutUrl,
  fullText,
  isShortcutUrlTooLong,
  shareData,
  shortcutJson,
  OPEN_APP_SHORTCUT_NAME,
  SHORTCUT_NAME,
} from './share';

const payload = {
  title: '午後の散歩と気づいたこと',
  body: '今日は少し早めに仕事を切り上げて、近所を歩いた。\n夕方の光がやわらかかった。',
  tags: ['家族', '散歩'],
  createdAt: '2026-07-11T09:30:00.000Z',
};

describe('Appleジャーナル用URL生成', () => {
  it('shortcuts:// スキームと正しいクエリを生成する', () => {
    const url = buildShortcutUrl(payload);
    expect(url.startsWith('shortcuts://run-shortcut?')).toBe(true);
    expect(url).toContain(`name=${encodeURIComponent(SHORTCUT_NAME)}`);
    expect(url).toContain('input=text');
  });

  it('渡すJSONに title/body/tags/createdAt が含まれる', () => {
    const url = buildShortcutUrl(payload);
    const params = new URLSearchParams(url.split('?')[1]);
    const json = JSON.parse(params.get('text')!);
    expect(json).toEqual(shortcutJson(payload));
    expect(json.title).toBe(payload.title);
    expect(json.body).toBe(payload.body);
    expect(json.tags).toEqual(payload.tags);
    expect(json.createdAt).toBe(payload.createdAt);
  });

  it('日本語と改行が正しくURLエンコードされ、デコードで元に戻る', () => {
    const url = buildShortcutUrl(payload);
    const params = new URLSearchParams(url.split('?')[1]);
    const json = JSON.parse(params.get('text')!);
    // 改行が保持される
    expect(json.body).toContain('\n');
    // 生 URL には生の日本語や生の改行が含まれない（エンコードされている）
    const rawQuery = url.split('?')[1];
    expect(rawQuery).not.toContain('午後');
    expect(rawQuery).not.toContain('\n');
  });

  it('長すぎるURLを検知できる', () => {
    const huge = { ...payload, body: 'あ'.repeat(20000) };
    expect(isShortcutUrlTooLong(huge)).toBe(true);
    expect(isShortcutUrlTooLong(payload)).toBe(false);
  });

  it('数分の発話から生成される程度の長さの日記でも、長すぎる判定になる（iOS側の実際の起動失敗を防ぐため保守的に判定する）', () => {
    // 2分ほど話した内容から生成される日記を想定した、数百文字程度の本文
    const moderate = { ...payload, body: 'きょうは天気が良かったので散歩に出かけた。'.repeat(15) };
    expect(isShortcutUrlTooLong(moderate)).toBe(true);
  });
});

describe('Day One用URL生成', () => {
  it('dayone://post スキームで entry/journal/tags を生成する', () => {
    const url = buildDayOneUrl({
      title: payload.title,
      body: payload.body,
      tags: payload.tags,
      journal: '日記',
    });
    expect(url.startsWith('dayone://post?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('journal')).toBe('日記');
    expect(params.get('tags')).toBe('家族,散歩');
    // entry はタイトル + 本文
    expect(params.get('entry')).toBe(`${payload.title}\n\n${payload.body}`);
  });

  it('journal 未指定・タグ空でも壊れない', () => {
    const url = buildDayOneUrl({ title: 't', body: 'b', tags: [] });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('journal')).toBeNull();
    expect(params.get('tags')).toBeNull();
    expect(params.get('entry')).toBe('t\n\nb');
  });

  it('日本語・改行・記号がエンコードされる', () => {
    const url = buildDayOneUrl({
      title: '#タグ & 記号',
      body: '1行目\n2行目',
      tags: ['仕事'],
    });
    const rawQuery = url.split('?')[1];
    expect(rawQuery).not.toContain('\n');
    expect(rawQuery).not.toContain('記号');
    // デコードして復元できる
    const params = new URLSearchParams(rawQuery);
    expect(params.get('entry')).toContain('1行目\n2行目');
  });
});

describe('buildRunShortcutUrl（URLスキーム非対応アプリ向けフォールバック）', () => {
  it('名前だけを渡す shortcuts:// URL を生成する（inputなし）', () => {
    const url = buildRunShortcutUrl(OPEN_APP_SHORTCUT_NAME);
    expect(url.startsWith('shortcuts://run-shortcut?')).toBe(true);
    expect(url).toContain(`name=${encodeURIComponent(OPEN_APP_SHORTCUT_NAME)}`);
    expect(url).not.toContain('input=');
    expect(url).not.toContain('text=');
  });

  it('日本語のショートカット名も正しくエンコードされる', () => {
    const url = buildRunShortcutUrl('テスト用ショートカット');
    const rawQuery = url.split('?')[1];
    expect(rawQuery).not.toContain('テスト');
    const params = new URLSearchParams(rawQuery);
    expect(params.get('name')).toBe('テスト用ショートカット');
  });
});

describe('コピー/共有テキスト', () => {
  it('fullText はタイトルと本文を結合する', () => {
    expect(fullText('T', 'B')).toBe('T\n\nB');
    expect(fullText('', 'B')).toBe('B');
  });
  it('shareData は共有シート用データを返す', () => {
    expect(shareData('T', 'B')).toEqual({ title: 'T', text: 'T\n\nB' });
    expect(shareData('', 'B').title).toBe('音声日記');
  });
});
