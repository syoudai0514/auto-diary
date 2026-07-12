import { describe, it, expect, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { updateProfile, ProfileUpdateError } from './updateProfile';

function mockGemini(text: string | undefined): GoogleGenAI {
  const generateContent = vi.fn(async () => ({ text }));
  return { models: { generateContent } } as unknown as GoogleGenAI;
}

describe('updateProfile', () => {
  it('更新されたMarkdownを返す', async () => {
    const ai = mockGemini('## 家族構成\n- 妻(ママ)\n- 長男');
    const result = await updateProfile(ai, {
      currentMarkdown: '## 家族構成\n- 妻(ママ)',
      newInput: '長男が生まれました',
      model: 'gemini-3.1-flash-lite',
    });
    expect(result).toBe('## 家族構成\n- 妻(ママ)\n- 長男');
  });

  it('前後の空白はトリムされる', async () => {
    const ai = mockGemini('  \n## 内容\n  ');
    const result = await updateProfile(ai, {
      currentMarkdown: '',
      newInput: 'x',
      model: 'gemini-3.1-flash-lite',
    });
    expect(result).toBe('## 内容');
  });

  it('結果が空なら ProfileUpdateError を投げる', async () => {
    const ai = mockGemini('   ');
    await expect(
      updateProfile(ai, { currentMarkdown: '', newInput: 'x', model: 'gemini-3.1-flash-lite' }),
    ).rejects.toBeInstanceOf(ProfileUpdateError);
  });

  it('text が undefined でも ProfileUpdateError を投げる', async () => {
    const ai = mockGemini(undefined);
    await expect(
      updateProfile(ai, { currentMarkdown: '', newInput: 'x', model: 'gemini-3.1-flash-lite' }),
    ).rejects.toBeInstanceOf(ProfileUpdateError);
  });
});
