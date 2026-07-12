import { z } from 'zod';

/**
 * 「ふたりの話し合い分析」の構造化データ。
 * Gemini の structured output とクライアント側バリデーションの両方で使う。
 * 判定（verdict）は率直に行うが、評価対象は常に発言・行動であり人格ではない。
 */

const TalkSideSchema = z.object({
  /** 表示名（ユーザーが指定した「私」「妻」など）。 */
  label: z.string(),
  /** 主な言い分。 */
  claims: z.array(z.string()),
  /** 表明された・読み取れる気持ち。 */
  feelings: z.array(z.string()),
  /** 言葉の奥にある本当の望み。 */
  needs: z.array(z.string()),
});

export const TalkAnalysisSchema = z.object({
  /** 例:「家事分担についての話し合い」 */
  title: z.string(),
  /** 何が起きたかの中立な要約。 */
  summary: z.string(),
  /** 争点。 */
  topics: z.array(z.string()),
  sideA: TalkSideSchema,
  sideB: TalkSideSchema,
  /** すれ違いポイント。 */
  misunderstandings: z.array(
    z.object({
      point: z.string(),
      aView: z.string(),
      bView: z.string(),
      explanation: z.string(),
    }),
  ),
  /** 率直な判定。 */
  verdict: z.object({
    /** どちらの主張がより妥当か、五分五分かの総合判定と理由。 */
    overall: z.string(),
    leansToward: z.enum(['A', 'B', 'even']),
    /** Aの発言・行動ごとの評価（人格評価はしない）。 */
    behaviorsA: z.array(z.object({ behavior: z.string(), assessment: z.string() })),
    behaviorsB: z.array(z.object({ behavior: z.string(), assessment: z.string() })),
  }),
  /** それぞれへの具体的な改善提案。 */
  adviceA: z.array(z.string()),
  adviceB: z.array(z.string()),
  /** ふたりに共通する願い。 */
  commonGround: z.array(z.string()),
  /** 仲直りの会話例。 */
  reconciliationScript: z.array(z.object({ speaker: z.string(), line: z.string() })),
  /**
   * 安全上の注意。暴力・脅迫などの兆候を検知した場合のみ、判定を控えて
   * 専門的な相談先を促す文言が入る。問題がなければ空文字。
   */
  safetyNote: z.string(),
});

export type TalkAnalysis = z.infer<typeof TalkAnalysisSchema>;
export type TalkSide = z.infer<typeof TalkSideSchema>;

/**
 * モデル出力の文字列から JSON を頑健に抽出してパースする。
 * ```json フェンスや前後の余分な文字が付いても取り出せるようにする。
 * 失敗時は null を返し、呼び出し側で再試行を判断する。
 */
export function safeParseTalkAnalysis(raw: string): TalkAnalysis | null {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }

  for (const c of candidates) {
    try {
      const result = TalkAnalysisSchema.safeParse(JSON.parse(c));
      if (result.success) return result.data;
    } catch {
      // 次の候補へ
    }
  }
  return null;
}

/**
 * 分析結果を、相手と共有しやすいプレーンテキストに整形する（コピー/共有シート用）。
 */
export function talkAnalysisToText(a: TalkAnalysis): string {
  const lines: string[] = [];
  lines.push(`【${a.title}】`);
  lines.push('');
  lines.push('■ なにが起きたか');
  lines.push(a.summary);
  if (a.safetyNote) {
    lines.push('');
    lines.push('■ たいせつなお知らせ');
    lines.push(a.safetyNote);
  }
  lines.push('');
  lines.push('■ 率直な判定');
  lines.push(a.verdict.overall);
  const side = (label: string, s: TalkSide, advice: string[]) => {
    lines.push('');
    lines.push(`■ ${label}（${s.label}）`);
    if (s.claims.length) lines.push(`言い分: ${s.claims.join(' / ')}`);
    if (s.feelings.length) lines.push(`気持ち: ${s.feelings.join(' / ')}`);
    if (s.needs.length) lines.push(`本当の望み: ${s.needs.join(' / ')}`);
    if (advice.length) lines.push(`改善のヒント: ${advice.join(' / ')}`);
  };
  side('ひとりめ', a.sideA, a.adviceA);
  side('ふたりめ', a.sideB, a.adviceB);
  if (a.misunderstandings.length) {
    lines.push('');
    lines.push('■ すれ違いポイント');
    for (const m of a.misunderstandings) {
      lines.push(`・${m.point}: ${m.explanation}`);
    }
  }
  if (a.commonGround.length) {
    lines.push('');
    lines.push('■ ふたりに共通する願い');
    lines.push(a.commonGround.map((c) => `・${c}`).join('\n'));
  }
  if (a.reconciliationScript.length) {
    lines.push('');
    lines.push('■ 仲直りの会話例');
    for (const s of a.reconciliationScript) {
      lines.push(`${s.speaker}「${s.line}」`);
    }
  }
  return lines.join('\n');
}
