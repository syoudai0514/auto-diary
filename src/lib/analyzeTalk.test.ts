import { describe, it, expect, vi } from 'vitest';
import { Type, type GoogleGenAI } from '@google/genai';
import { analyzeTalk, TalkAnalysisError, TALK_RESPONSE_SCHEMA } from './analyzeTalk';
import { sampleAnalysis } from '@/test/fixtures/talkAnalysis';

function mockGemini(responses: string[]): GoogleGenAI {
  let i = 0;
  const generateContent = vi.fn(async (_req: unknown) => {
    const text = responses[Math.min(i, responses.length - 1)];
    i++;
    return { text };
  });
  return { models: { generateContent } } as unknown as GoogleGenAI;
}

const validJson = JSON.stringify(sampleAnalysis);

describe('analyzeTalk', () => {
  it('有効なJSONを返すと分析結果を返す', async () => {
    const ai = mockGemini([validJson]);
    const result = await analyzeTalk(ai, {
      transcript: 'A: 片付けしてよ\nB: 後でやるって',
      speakerA: '妻',
      speakerB: '私',
      model: 'gemini-3.1-flash-lite',
    });
    expect(result.verdict.leansToward).toBe('B');
    expect(result.reconciliationScript.length).toBeGreaterThan(0);
  });

  it('プロンプトに話者名・文字起こし・判定指示が渡る', async () => {
    const generateContent = vi.fn(async (_req: unknown) => ({ text: validJson }));
    const ai = { models: { generateContent } } as unknown as GoogleGenAI;
    await analyzeTalk(ai, {
      transcript: 'A: こんにちは\nB: やあ',
      speakerA: '私',
      speakerB: '夫',
      model: 'gemini-3.1-flash-lite',
      peopleContext: '私は4人家族の母です。',
    });
    const call = generateContent.mock.calls[0][0] as {
      contents: { parts: { text: string }[] }[];
      config: { systemInstruction: string; responseSchema: unknown };
    };
    const userText = call.contents[0].parts[0].text;
    expect(userText).toContain('話者Aは「私」');
    expect(userText).toContain('話者Bは「夫」');
    expect(userText).toContain('A: こんにちは');
    expect(call.config.systemInstruction).toContain('率直');
    expect(call.config.systemInstruction).toContain('私は4人家族の母です。');
    expect(call.config.responseSchema).toBe(TALK_RESPONSE_SCHEMA);
  });

  it('JSONパース失敗時に再試行する', async () => {
    const ai = mockGemini(['壊れた出力', validJson]);
    const result = await analyzeTalk(ai, {
      transcript: 't',
      speakerA: 'A',
      speakerB: 'B',
      model: 'm',
      maxRetries: 2,
    });
    expect(result.title).toBe(sampleAnalysis.title);
    expect(
      (ai.models.generateContent as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(2);
  });

  it('全試行で失敗すると TalkAnalysisError を投げる', async () => {
    const ai = mockGemini(['壊れ', '壊れ']);
    await expect(
      analyzeTalk(ai, { transcript: 't', speakerA: 'A', speakerB: 'B', model: 'm', maxRetries: 1 }),
    ).rejects.toBeInstanceOf(TalkAnalysisError);
  });
});

describe('TALK_RESPONSE_SCHEMA', () => {
  it('OBJECT型で全プロパティが required', () => {
    expect(TALK_RESPONSE_SCHEMA.type).toBe(Type.OBJECT);
    expect(TALK_RESPONSE_SCHEMA.required).toContain('verdict');
    expect(TALK_RESPONSE_SCHEMA.required).toContain('safetyNote');
    expect(TALK_RESPONSE_SCHEMA.required).toHaveLength(12);
  });
});
