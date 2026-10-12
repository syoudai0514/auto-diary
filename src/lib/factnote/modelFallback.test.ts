import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import {
  factnoteFallbackModel,
  factnoteModel,
  FACTNOTE_DEFAULT_MODEL,
  FACTNOTE_FALLBACK_MODEL,
  isModelSwitchable,
  withModelFallback,
} from './modelFallback';

const KEYS = ['FACTNOTE_GEMINI_MODEL', 'GEMINI_MODEL', 'FACTNOTE_GEMINI_FALLBACK_MODEL'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function geminiWith(handler: (model: string) => unknown) {
  const generateContent = vi.fn(async (req: { model: string }) => handler(req.model));
  return { ai: { models: { generateContent } } as unknown as GoogleGenAI, generateContent };
}

const err = (status: number) => Object.assign(new Error(`status ${status}`), { status });

describe('モデルの選択', () => {
  it('既定は 3.5 flash-lite、予備は 3.1 flash-lite', () => {
    for (const k of KEYS) delete process.env[k];
    expect(factnoteModel()).toBe(FACTNOTE_DEFAULT_MODEL);
    expect(FACTNOTE_DEFAULT_MODEL).toBe('gemini-3.5-flash-lite');
    expect(factnoteFallbackModel()).toBe(FACTNOTE_FALLBACK_MODEL);
  });

  it('FACTNOTE_GEMINI_MODEL > GEMINI_MODEL > 既定の順で上書きできる', () => {
    process.env.GEMINI_MODEL = 'gemini-x';
    expect(factnoteModel()).toBe('gemini-x');
    process.env.FACTNOTE_GEMINI_MODEL = 'gemini-y';
    expect(factnoteModel()).toBe('gemini-y');
  });

  it('予備が主モデルと同じ、または none なら切り替えなし', () => {
    delete process.env.FACTNOTE_GEMINI_FALLBACK_MODEL;
    expect(factnoteFallbackModel(FACTNOTE_FALLBACK_MODEL)).toBeUndefined();
    process.env.FACTNOTE_GEMINI_FALLBACK_MODEL = 'none';
    expect(factnoteFallbackModel('gemini-3.5-flash-lite')).toBeUndefined();
  });

  it('モデルを替えれば通りうる失敗(404/429/500/503/504)だけが切り替え対象', () => {
    for (const s of [404, 429, 500, 503, 504]) expect(isModelSwitchable(err(s))).toBe(true);
    for (const s of [400, 401, 403]) expect(isModelSwitchable(err(s))).toBe(false);
    expect(isModelSwitchable(new Error('no status'))).toBe(false);
  });
});

describe('withModelFallback', () => {
  it('主モデルが成功すれば予備は呼ばない', async () => {
    const { ai, generateContent } = geminiWith(() => ({ text: 'ok' }));
    const g = withModelFallback(ai, 'primary', 'fallback');
    await g.ai.models.generateContent({ model: 'ignored', contents: [] });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0].model).toBe('primary');
    expect(g.modelUsed()).toBe('primary');
  });

  it('主モデルが高負荷(503)なら同じリクエストを予備モデルで1回試し、使ったモデルを返す', async () => {
    const { ai, generateContent } = geminiWith((model) => {
      if (model === 'primary') throw err(503);
      return { text: 'from fallback' };
    });
    const g = withModelFallback(ai, 'primary', 'fallback');
    const res = (await g.ai.models.generateContent({ model: 'x', contents: [] })) as { text: string };
    expect(res.text).toBe('from fallback');
    expect(generateContent.mock.calls.map((c) => c[0].model)).toEqual(['primary', 'fallback']);
    expect(g.modelUsed()).toBe('fallback');
  });

  it('主モデルがそのキーで使えない(404)場合も予備へ', async () => {
    const { ai } = geminiWith((model) => {
      if (model === 'primary') throw err(404);
      return { text: 'ok' };
    });
    const g = withModelFallback(ai, 'primary', 'fallback');
    await g.ai.models.generateContent({ model: 'x', contents: [] });
    expect(g.modelUsed()).toBe('fallback');
  });

  it('入力エラー(400)は予備に替えても同じなので、そのまま投げる', async () => {
    const { ai, generateContent } = geminiWith(() => {
      throw err(400);
    });
    const g = withModelFallback(ai, 'primary', 'fallback');
    await expect(g.ai.models.generateContent({ model: 'x', contents: [] })).rejects.toMatchObject({ status: 400 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('両方失敗したら予備側のエラーを投げる（呼び出し側の再試行に任せる）', async () => {
    const { ai, generateContent } = geminiWith(() => {
      throw err(503);
    });
    const g = withModelFallback(ai, 'primary', 'fallback');
    await expect(g.ai.models.generateContent({ model: 'x', contents: [] })).rejects.toMatchObject({ status: 503 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('予備なしなら切り替えない', async () => {
    const { ai, generateContent } = geminiWith(() => {
      throw err(503);
    });
    const g = withModelFallback(ai, 'primary', null);
    await expect(g.ai.models.generateContent({ model: 'x', contents: [] })).rejects.toMatchObject({ status: 503 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
