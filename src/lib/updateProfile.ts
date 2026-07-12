import type { GoogleGenAI } from '@google/genai';
import { buildProfileUpdateSystemPrompt, buildProfileUpdateUserPrompt } from './prompt';
import { extractText } from './gemini';

export interface UpdateProfileOptions {
  currentMarkdown: string;
  newInput: string;
  model: string;
}

export class ProfileUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileUpdateError';
  }
}

/**
 * 現在のプロフィール(Markdown)と新しい入力（テキスト or 音声の文字起こし）を統合し、
 * 更新後のプロフィール全文を Markdown で返す。
 */
export async function updateProfile(
  ai: GoogleGenAI,
  { currentMarkdown, newInput, model }: UpdateProfileOptions,
): Promise<string> {
  const system = buildProfileUpdateSystemPrompt();
  const user = buildProfileUpdateUserPrompt(currentMarkdown, newInput);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: {
      systemInstruction: system,
      temperature: 0.3,
    },
  });

  const markdown = extractText(response).trim();
  if (!markdown) {
    throw new ProfileUpdateError('プロフィールの更新結果が空でした');
  }
  return markdown;
}
