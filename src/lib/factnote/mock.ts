import { buildMockAnalysis, buildMockDiary, MOCK_TRANSCRIPT } from './fixtures';
import type { DiaryMode, IncidentAnalysis } from './types';

/**
 * AIモックモード（依頼書 §22.2）。環境変数 AI_MOCK=1 のとき、
 * 事実ノートのAIルートは Gemini を呼ばず固定JSONを返す。
 * APIキー未設定でも全画面フローを確認でき、E2Eでも利用する。
 */

export function isAiMock(): boolean {
  return process.env.AI_MOCK === '1';
}

export function mockTranscript(): string {
  return MOCK_TRANSCRIPT;
}

export function mockAnalysis(): IncidentAnalysis {
  return buildMockAnalysis();
}

export function mockDiary(mode: DiaryMode): { title: string; body: string } {
  return buildMockDiary(mode);
}
