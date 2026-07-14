import { Type, type GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { extractText } from '../gemini';
import { safeParseJson } from './jsonExtract';
import {
  buildFactnoteDiarySystemPrompt,
  buildFactnoteDiaryUserPrompt,
} from './prompts/diary';
import type { DiaryMode, IncidentAnalysis } from './types';

/** 日記生成（依頼書 §12.10 / §25。`generateDiary.ts` と同じ構造化出力パターン）。 */

export const FactnoteDiarySchema = z.object({
  title: z.string(),
  body: z.string(),
});

export type FactnoteDiary = z.infer<typeof FactnoteDiarySchema>;

const DIARY_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: '日記のタイトル（短い名詞句）' },
    body: { type: Type.STRING, description: '日記の本文。読みやすい段落に分ける' },
  },
  required: ['title', 'body'],
} as const;

/** 日記の出力上限（暴走対策。依頼書 §2-3）。 */
export const FACTNOTE_DIARY_MAX_OUTPUT_TOKENS = 4096;

export class FactnoteDiaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactnoteDiaryError';
  }
}

/**
 * 分析結果から、日記プロンプトに渡す要点テキストを作る（純粋関数）。
 * 分析JSON全体を渡すとトークンを浪費するため、日記に必要な部分だけに絞る。
 */
export function analysisSummaryForDiary(analysis: IncidentAnalysis): string {
  const lines: string[] = [];
  lines.push(`見解: ${analysis.conciseView}`);
  if (analysis.verifiedFacts.length > 0) {
    lines.push(`確認できる事実: ${analysis.verifiedFacts.map((i) => i.text).join(' / ')}`);
  }
  if (analysis.userImprovementPoints.length > 0) {
    lines.push(`自分側の改善点: ${analysis.userImprovementPoints.map((i) => i.text).join(' / ')}`);
  }
  if (analysis.otherPartyProblemPoints.length > 0) {
    lines.push(`相手側の問題点: ${analysis.otherPartyProblemPoints.map((i) => i.text).join(' / ')}`);
  }
  if (analysis.nextActions.length > 0) {
    lines.push(`次回の対応: ${analysis.nextActions.join(' / ')}`);
  }
  if (analysis.positiveActions.length > 0) {
    lines.push(`良い出来事: ${analysis.positiveActions.map((i) => i.text).join(' / ')}`);
  }
  if (analysis.repairActions.length > 0) {
    lines.push(`修復行動: ${analysis.repairActions.map((i) => i.text).join(' / ')}`);
  }
  return lines.join('\n');
}

export interface GenerateFactnoteDiaryOptions {
  mode: DiaryMode;
  sourceText: string;
  analysisSummary?: string;
  /** プロフィール（登場人物の呼び方の判断材料）。 */
  peopleContext?: string;
  model: string;
  maxRetries?: number;
}

export async function generateFactnoteDiary(
  ai: GoogleGenAI,
  { mode, sourceText, analysisSummary, peopleContext, model, maxRetries = 2 }: GenerateFactnoteDiaryOptions,
): Promise<FactnoteDiary> {
  const system = buildFactnoteDiarySystemPrompt(mode, peopleContext);
  const user = buildFactnoteDiaryUserPrompt(sourceText, analysisSummary);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const contents = [
      { role: 'user' as const, parts: [{ text: user }] },
      ...(attempt > 0
        ? [
            {
              role: 'user' as const,
              parts: [
                { text: '前回の出力は指定 JSON スキーマとして解釈できませんでした。必ず有効な JSON のみを返してください。' },
              ],
            },
          ]
        : []),
    ];

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: system,
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: DIARY_RESPONSE_SCHEMA,
        maxOutputTokens: FACTNOTE_DIARY_MAX_OUTPUT_TOKENS,
      },
    });

    const diary = safeParseJson(FactnoteDiarySchema, extractText(response));
    if (diary && diary.title.trim() && diary.body.trim()) return diary;
  }

  throw new FactnoteDiaryError('日記の生成に失敗しました');
}
