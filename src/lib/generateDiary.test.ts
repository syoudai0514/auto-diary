import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { generateDiary, DiaryGenerationError } from './generateDiary';

function mockOpenAI(responses: string[]): OpenAI {
  let i = 0;
  const create = vi.fn(async () => {
    const content = responses[Math.min(i, responses.length - 1)];
    i++;
    return { choices: [{ message: { content } }] };
  });
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

const validJson = JSON.stringify({
  title: 'テスト',
  body: '本文',
  facts: [],
  feelings: [],
  interpretations: [],
  nextActions: [],
  tags: ['x'],
  rawTranscript: 'ignored',
});

describe('generateDiary', () => {
  it('有効なJSONを返すと日記を生成する', async () => {
    const openai = mockOpenAI([validJson]);
    const diary = await generateDiary(openai, {
      transcript: '元の文字起こし',
      style: 'natural',
      model: 'gpt-4o-mini',
    });
    expect(diary.title).toBe('テスト');
    // rawTranscript は必ず渡した文字起こしで上書きされる
    expect(diary.rawTranscript).toBe('元の文字起こし');
  });

  it('JSONパース失敗時に再試行し、成功すれば返す', async () => {
    const openai = mockOpenAI(['これはJSONではない', validJson]);
    const diary = await generateDiary(openai, {
      transcript: 't',
      style: 'natural',
      model: 'gpt-4o-mini',
      maxRetries: 2,
    });
    expect(diary.title).toBe('テスト');
    expect((openai.chat.completions.create as any).mock.calls.length).toBe(2);
  });

  it('全試行で失敗すると DiaryGenerationError を投げる', async () => {
    const openai = mockOpenAI(['壊れ', '壊れ', '壊れ']);
    await expect(
      generateDiary(openai, {
        transcript: 't',
        style: 'natural',
        model: 'gpt-4o-mini',
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(DiaryGenerationError);
    // 初回 + 2回リトライ = 3回
    expect((openai.chat.completions.create as any).mock.calls.length).toBe(3);
  });
});
