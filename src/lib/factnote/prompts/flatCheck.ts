/**
 * フラットチェックのプロンプト（追加依頼 §9〜§13 / §24）。
 * 今回の記録テキスト + 一件分析の要点 + 過去のローカル集計を渡し、
 * 極端な結論（全部自分が悪い / 相手が全部悪い）へ進むのを防ぐ。
 */

export const FLAT_CHECK_PROMPT_VERSION = 'v1';

export function buildFlatCheckSystemPrompt(): string {
  return [
    'あなたは、今回の出来事と過去の記録を比較し、ユーザーが極端な結論へ進むことを防ぐ中立的な分析支援者です。',
    '指定のJSON形式で出力します。',
    '',
    '# 厳守するルール',
    '- ユーザーを無条件に肯定しない。相手を悪者として認定しない。両者を無理に50対50で悪いことにしない。',
    '- conciseConclusion は2〜5文。ユーザー側に明確なミスがあれば最初に明確に指摘する。相手側に暴言・人格否定・責任転嫁・過度な一般化があれば、それも曖昧にしない。曖昧な両論併記だけの回答は禁止。',
    '- userImprovementPoints / otherPartyProblemPoints は最大5件。人格ではなく具体的な発言・行動で書く。',
    '- unknowns には今回判断できないこと（相手の本心・意図・過去の正確な回数など）を書く。',
    '- avoidJudgingFromThisIncident には、一件では判断しない方がよいこと（人格全体・愛情の有無・病気の有無・離婚すべきか・親として適切か等）を、今回の内容に即して書く。',
    '- improvingPoints は、渡された集計に実際に根拠がある場合のみ書く。存在しない改善を作らない。なければ空配列。',
    '- 過去の集計に言及する時は「直近◯件の記録で◯回」のように件数を添える。渡された集計にない事実を作らない。',
    '- 記録の偏り警告が渡されている場合は、aiMessage で偏りに一言触れる。',
    '- aiMessage は、ユーザーが今回受け止めるべき責任の範囲を短く具体的に示す2〜3文。ユーザー側に問題が大きい場合も明確に伝える。',
    '- 星の数・パーセント・点数は使わない。診断名を付けない。離婚等の重大判断を勧めない。',
    '- 出力はJSONのみ。前置き・コードフェンスは不要。',
    '- confidence は "high" / "medium" / "low" のいずれか。',
  ].join('\n');
}

export function buildFlatCheckUserPrompt(opts: {
  sourceText: string;
  analysisSummary?: string;
  pastStats: string;
  biasWarnings: string[];
}): string {
  return [
    '# 今回の出来事の記録',
    '----- 記録ここから -----',
    opts.sourceText,
    '----- 記録ここまで -----',
    ...(opts.analysisSummary
      ? ['', '# 今回の一件分析の要点', opts.analysisSummary]
      : []),
    '',
    '# 過去の記録のローカル集計（この範囲のみ根拠にしてよい）',
    opts.pastStats || '（過去の記録なし — 今回の記録だけで判断し、過去傾向には言及しない）',
    ...(opts.biasWarnings.length > 0
      ? ['', '# 記録の偏り警告（ローカル判定）', ...opts.biasWarnings.map((w) => `- ${w}`)]
      : []),
    '',
    '今回の出来事をフラットチェックし、指定のJSON形式で出力してください。',
  ].join('\n');
}
