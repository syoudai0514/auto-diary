import { describe, it, expect, vi } from 'vitest';
import { Type, type GoogleGenAI } from '@google/genai';
import type { Diary } from './diary';
import { generateDiary, reviseDiary, DiaryGenerationError, DIARY_RESPONSE_SCHEMA } from './generateDiary';

function mockGemini(responses: string[]): GoogleGenAI {
  let i = 0;
  const generateContent = vi.fn(async () => {
    const text = responses[Math.min(i, responses.length - 1)];
    i++;
    return { text };
  });
  return { models: { generateContent } } as unknown as GoogleGenAI;
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
    const ai = mockGemini([validJson]);
    const diary = await generateDiary(ai, {
      transcript: '元の文字起こし',
      style: 'natural',
      model: 'gemini-2.0-flash',
    });
    expect(diary.title).toBe('テスト');
    // rawTranscript は必ず渡した文字起こしで上書きされる
    expect(diary.rawTranscript).toBe('元の文字起こし');
  });

  it('JSONパース失敗時に再試行し、成功すれば返す', async () => {
    const ai = mockGemini(['これはJSONではない', validJson]);
    const diary = await generateDiary(ai, {
      transcript: 't',
      style: 'natural',
      model: 'gemini-2.0-flash',
      maxRetries: 2,
    });
    expect(diary.title).toBe('テスト');
    expect((ai.models.generateContent as any).mock.calls.length).toBe(2);
  });

  it('全試行で失敗すると DiaryGenerationError を投げる', async () => {
    const ai = mockGemini(['壊れ', '壊れ', '壊れ']);
    await expect(
      generateDiary(ai, {
        transcript: 't',
        style: 'natural',
        model: 'gemini-2.0-flash',
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(DiaryGenerationError);
    // 初回 + 2回リトライ = 3回
    expect((ai.models.generateContent as any).mock.calls.length).toBe(3);
  });

  it('text が undefined の応答でも例外を投げず再試行する', async () => {
    let i = 0;
    const generateContent = vi.fn(async () => {
      i++;
      if (i === 1) return { text: undefined };
      return { text: validJson };
    });
    const ai = { models: { generateContent } } as unknown as GoogleGenAI;
    const diary = await generateDiary(ai, {
      transcript: 't',
      style: 'natural',
      model: 'gemini-2.0-flash',
      maxRetries: 1,
    });
    expect(diary.title).toBe('テスト');
  });
});

const currentDiary: Diary = {
  title: '元のタイトル',
  body: '元の本文です。',
  facts: ['散歩した'],
  feelings: ['楽しかった'],
  interpretations: [],
  nextActions: [],
  tags: ['散歩'],
  rawTranscript: '元の文字起こし',
};

const revisedJson = JSON.stringify({
  title: '修正後のタイトル',
  body: '修正後の本文です。',
  facts: ['散歩した'],
  feelings: ['楽しかった'],
  interpretations: [],
  nextActions: [],
  tags: ['散歩', '追加タグ'],
  rawTranscript: 'ignored',
});

describe('reviseDiary', () => {
  it('修正依頼に従って更新された日記を返す', async () => {
    const ai = mockGemini([revisedJson]);
    const diary = await reviseDiary(ai, {
      transcript: '元の文字起こし',
      currentDiary,
      instruction: 'タイトルをもっと具体的にして',
      style: 'natural',
      model: 'gemini-3.1-flash-lite',
    });
    expect(diary.title).toBe('修正後のタイトル');
    expect(diary.tags).toContain('追加タグ');
    // rawTranscript は必ず元の文字起こしで上書きされる
    expect(diary.rawTranscript).toBe('元の文字起こし');
  });

  it('プロンプトに現在の日記・修正依頼・文字起こしが含まれる', async () => {
    const generateContent = vi.fn(async (_req: unknown) => ({ text: revisedJson }));
    const ai = { models: { generateContent } } as unknown as GoogleGenAI;
    await reviseDiary(ai, {
      transcript: '元の文字起こし',
      currentDiary,
      instruction: 'もっとカジュアルな文体にして',
      style: 'natural',
      model: 'gemini-3.1-flash-lite',
    });
    const call = generateContent.mock.calls[0][0] as any;
    const userText = call.contents[0].parts[0].text;
    expect(userText).toContain('元のタイトル');
    expect(userText).toContain('もっとカジュアルな文体にして');
    expect(userText).toContain('元の文字起こし');
    expect(call.config.systemInstruction).toContain('修正依頼');
  });

  it('JSONパース失敗時に再試行する', async () => {
    const ai = mockGemini(['壊れた出力', revisedJson]);
    const diary = await reviseDiary(ai, {
      transcript: 't',
      currentDiary,
      instruction: '直して',
      style: 'natural',
      model: 'gemini-3.1-flash-lite',
      maxRetries: 2,
    });
    expect(diary.title).toBe('修正後のタイトル');
    expect((ai.models.generateContent as any).mock.calls.length).toBe(2);
  });

  it('全試行で失敗すると DiaryGenerationError を投げる', async () => {
    const ai = mockGemini(['壊れ', '壊れ']);
    await expect(
      reviseDiary(ai, {
        transcript: 't',
        currentDiary,
        instruction: '直して',
        style: 'natural',
        model: 'gemini-3.1-flash-lite',
        maxRetries: 1,
      }),
    ).rejects.toBeInstanceOf(DiaryGenerationError);
  });
});

describe('DIARY_RESPONSE_SCHEMA（Gemini structured output）', () => {
  it('OBJECT型で全プロパティが required', () => {
    expect(DIARY_RESPONSE_SCHEMA.type).toBe(Type.OBJECT);
    expect(DIARY_RESPONSE_SCHEMA.required).toContain('title');
    expect(DIARY_RESPONSE_SCHEMA.required).toContain('rawTranscript');
    expect(DIARY_RESPONSE_SCHEMA.required).toHaveLength(8);
  });

  it('配列フィールドは STRING の ARRAY', () => {
    expect(DIARY_RESPONSE_SCHEMA.properties.tags.type).toBe(Type.ARRAY);
    expect(DIARY_RESPONSE_SCHEMA.properties.tags.items.type).toBe(Type.STRING);
  });
});
