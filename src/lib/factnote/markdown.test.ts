import { describe, it, expect } from 'vitest';
import { recordToMarkdown, recordsToMarkdown } from './markdown';
import { createEmptyRecord } from './newRecord';
import { buildMockAnalysis, buildMockDiary } from './fixtures';
import type { IncidentRecord } from './types';

function fullRecord(): IncidentRecord {
  const r = createEmptyRecord('text', new Date('2026-07-13T18:00:00Z'));
  return {
    ...r,
    id: 'rec1',
    title: '荷物の受け取りを忘れた',
    occurredAt: '2026-07-13T18:00:00Z',
    rawText: '頼まれていた荷物の受け取りを忘れた。「いつもそう」と言われた。',
    location: '自宅',
    people: [{ id: 'p1', displayName: '配偶者' }],
    emotions: ['落胆'],
    isConflict: true,
    analysis: buildMockAnalysis(),
    diaryVersions: [
      {
        id: 'dv1',
        mode: 'factual',
        ...buildMockDiary('factual'),
        createdAt: '2026-07-13T18:30:00Z',
        editedByUser: false,
      },
    ],
    status: 'ready',
  };
}

describe('Markdown 書き出し', () => {
  it('1件の記録に原本・分析・日記の見出しが含まれる', () => {
    const md = recordToMarkdown(fullRecord());
    expect(md).toContain('# 荷物の受け取りを忘れた');
    expect(md).toContain('## 記録情報');
    expect(md).toContain('## 原本');
    expect(md).toContain('ユーザーが入力した原文');
    expect(md).toContain('頼まれていた荷物の受け取りを忘れた');
    expect(md).toContain('## 分析');
    expect(md).toContain('確認できる事実');
    expect(md).toContain('論点別の責任整理');
    expect(md).toContain('相手へ伝える短文');
    expect(md).toContain('## 日記');
    expect(md).toContain('事実記録');
  });

  it('分析・日記がない記録でも壊れない', () => {
    const r = { ...createEmptyRecord('text'), title: 'メモ', rawText: '短いメモ' };
    const md = recordToMarkdown(r);
    expect(md).toContain('# メモ');
    expect(md).toContain('短いメモ');
    expect(md).not.toContain('## 分析');
    expect(md).not.toContain('## 日記');
  });

  it('複数記録は区切り線でまとめられ、件数が入る', () => {
    const md = recordsToMarkdown([fullRecord(), fullRecord()], new Date('2026-07-13T20:00:00Z'));
    expect(md).toContain('# 事実ノート エクスポート');
    expect(md).toContain('記録件数: 2件');
    expect(md.split('\n---\n').length).toBeGreaterThanOrEqual(2);
  });

  it('画像添付は本文に含めず件数だけ記す', () => {
    const r = fullRecord();
    r.attachments = [
      { id: 'a1', fileName: 'x.jpg', mimeType: 'image/jpeg', size: 1000, createdAt: r.createdAt },
    ];
    const md = recordToMarkdown(r);
    expect(md).toContain('画像1枚');
    expect(md).toContain('本文には含まれません');
  });
});
