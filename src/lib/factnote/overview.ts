import { aggregatePatterns, detectDataBias, patternActor, summaryFingerprint } from './aggregate';
import { isAnalysisBlocked, sourceTextOf } from './newRecord';
import { INCIDENT_ANALYSIS_PROMPT_VERSION } from './prompts/incidentAnalysis';
import {
  SEVERITY_LABELS,
  VERDICT_LEANING_LABELS,
  VERDICT_ROBUSTNESS_LABELS,
  type AggregatedItem,
  type AnalysisItem,
  type IncidentRecord,
  type OverallReview,
  type Severity,
  type VerdictLeaning,
} from './types';

/**
 * 「全体の見解」のローカル集計と、AI総評へ渡す要約（ダイジェスト）の組み立て。
 * ここはAIを呼ばない純粋関数のみ（テスト可能・オフライン動作）。
 */

// ---------------------------------------------------------------------------
// 判定基準のバージョン管理（一括再分析の対象選び）

export type AnalysisStatus = 'current' | 'outdated' | 'none';

/** 記録の分析が最新の判定基準によるものか。モック（mock-v3 等）は接頭辞を除いて比較する。 */
export function analysisStatus(record: IncidentRecord): AnalysisStatus {
  if (!record.analysis) return 'none';
  const version = record.analysis.promptVersion.replace(/^mock-/, '');
  return version === INCIDENT_ANALYSIS_PROMPT_VERSION ? 'current' : 'outdated';
}

export type ReanalysisMode = 'outdated' | 'all';

/** 再分析できる記録か（分析対象の本文があり、処理中でなく、AI側の制限で止まった本文のままではない）。 */
export function canAnalyze(record: IncidentRecord): boolean {
  return (
    sourceTextOf(record).length > 0 &&
    record.status !== 'transcribing' &&
    record.status !== 'analyzing' &&
    !isAnalysisBlocked(record)
  );
}

/** AI側の制限で分析できず、本文を直すまで再分析の対象外の記録。 */
export function blockedRecords(records: IncidentRecord[]): IncidentRecord[] {
  return records.filter((r) => !r.excludeFromCarte && isAnalysisBlocked(r));
}

/**
 * 一括再分析の対象（古い順 — 途中で止めても、長期の流れが古い側から揃っていく）。
 * 'outdated' = 旧基準の分析 + 未分析 / 'all' = 分析できる全記録。
 */
export function reanalysisTargets(records: IncidentRecord[], mode: ReanalysisMode): IncidentRecord[] {
  return records
    .filter(canAnalyze)
    .filter((r) => mode === 'all' || analysisStatus(r) !== 'current')
    .sort((a, b) => recordTime(a) - recordTime(b));
}

/** 1件あたりの目安（Gemini応答 + レート制限の待ち）。表示用の概算。 */
const SECONDS_PER_ANALYSIS = 20;

export function estimateReanalysisMinutes(count: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.ceil((count * SECONDS_PER_ANALYSIS) / 60));
}

// ---------------------------------------------------------------------------
// ローカル集計

function recordTime(r: IncidentRecord): number {
  return Date.parse(r.occurredAt ?? r.createdAt);
}

/** 判定スケール上の並び（自分側 → 相手側）。 */
export const LEANING_SCALE: VerdictLeaning[] = [
  'user_mainly',
  'user_more',
  'comparable',
  'other_more',
  'other_mainly',
];

export type SeverityCounts = Record<Severity, number>;

const emptySeverity = (): SeverityCounts => ({ minor: 0, moderate: 0, serious: 0 });

export interface MonthlyBucket {
  /** YYYY-MM */
  month: string;
  conflicts: number;
  positives: number;
  repairs: number;
  /** 判定が自分側寄り（主に/やや）の件数。 */
  userHeavier: number;
  /** 判定が相手側寄り（主に/やや）の件数。 */
  otherHeavier: number;
}

export interface OverviewStats {
  /** 集計対象（カルテ除外の記録は除く）。 */
  total: number;
  excluded: number;
  analyzedCurrent: number;
  analyzedOutdated: number;
  unanalyzed: number;

  conflicts: number;
  positives: number;
  repairs: number;
  childPresentConflicts: number;
  safetyRecords: number;

  /** 最新基準で判定済みの記録の判定内訳。 */
  leaningCounts: Record<VerdictLeaning, number>;
  /** 最新基準で判定済みの衝突件数（leaningCounts のスケール部分の合計）。 */
  judgedConflicts: number;

  /** 改善点・問題点の重さの内訳（重さが付いた項目のみ = 最新基準の分析）。 */
  severity: { user: SeverityCounts; other: SeverityCounts };

  userPatterns: AggregatedItem[];
  otherPatterns: AggregatedItem[];

  monthly: MonthlyBucket[];
  biasWarnings: string[];
  /** AI総評のキャッシュ判定用。 */
  fingerprint: string;
}

function monthKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 直近 n か月の YYYY-MM（古い順）。 */
export function recentMonths(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1).getTime()));
  }
  return out;
}

const isUserSide = (l?: VerdictLeaning) => l === 'user_mainly' || l === 'user_more';
const isOtherSide = (l?: VerdictLeaning) => l === 'other_mainly' || l === 'other_more';

/** 全体の見解のローカル集計。 */
export function buildOverviewStats(allRecords: IncidentRecord[], now: Date = new Date()): OverviewStats {
  const records = allRecords.filter((r) => !r.excludeFromCarte);

  const leaningCounts = Object.fromEntries(
    Object.keys(VERDICT_LEANING_LABELS).map((k) => [k, 0]),
  ) as Record<VerdictLeaning, number>;
  const severity = { user: emptySeverity(), other: emptySeverity() };

  let analyzedCurrent = 0;
  let analyzedOutdated = 0;
  let unanalyzed = 0;
  for (const r of records) {
    const status = analysisStatus(r);
    if (status === 'current') analyzedCurrent++;
    else if (status === 'outdated') analyzedOutdated++;
    else unanalyzed++;

    if (status === 'current' && r.analysis?.verdict) leaningCounts[r.analysis.verdict.leaning]++;
    for (const it of r.analysis?.userImprovementPoints ?? []) if (it.severity) severity.user[it.severity]++;
    for (const it of r.analysis?.otherPartyProblemPoints ?? []) if (it.severity) severity.other[it.severity]++;
  }

  const months = recentMonths(now, 6);
  const monthly: MonthlyBucket[] = months.map((month) => ({
    month,
    conflicts: 0,
    positives: 0,
    repairs: 0,
    userHeavier: 0,
    otherHeavier: 0,
  }));
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  for (const r of records) {
    const bucket = byMonth.get(monthKey(recordTime(r)));
    if (!bucket) continue;
    if (r.isConflict) bucket.conflicts++;
    if (r.isPositiveEvent) bucket.positives++;
    if (r.isRepairAction) bucket.repairs++;
    const leaning = analysisStatus(r) === 'current' ? r.analysis?.verdict?.leaning : undefined;
    if (isUserSide(leaning)) bucket.userHeavier++;
    if (isOtherSide(leaning)) bucket.otherHeavier++;
  }

  return {
    total: records.length,
    excluded: allRecords.length - records.length,
    analyzedCurrent,
    analyzedOutdated,
    unanalyzed,
    conflicts: records.filter((r) => r.isConflict).length,
    positives: records.filter((r) => r.isPositiveEvent).length,
    repairs: records.filter((r) => r.isRepairAction).length,
    childPresentConflicts: records.filter((r) => r.isConflict && r.childrenPresent === 'yes').length,
    safetyRecords: records.filter((r) => (r.analysis?.safetyFlags.length ?? 0) > 0).length,
    leaningCounts,
    judgedConflicts: LEANING_SCALE.reduce((acc, l) => acc + leaningCounts[l], 0),
    severity,
    userPatterns: aggregatePatterns(records, (p) => ['user', 'both'].includes(patternActor(p))).slice(0, 5),
    otherPatterns: aggregatePatterns(records, (p) => ['other', 'both'].includes(patternActor(p))).slice(0, 5),
    monthly,
    biasWarnings: detectDataBias(records),
    fingerprint: summaryFingerprint(records),
  };
}

// ---------------------------------------------------------------------------
// AI総評へ渡すダイジェスト（記録の本文は送らず、各記録の分析結果の要約だけを送る）

/** AIへ送る記録の上限（新しい順に採用）。それより古い記録は集計値にのみ反映される。 */
export const OVERVIEW_DIGEST_MAX_RECORDS = 120;
const ITEM_MAX_CHARS = 70;

const clip = (text: string, max = ITEM_MAX_CHARS) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function issueText(items: AnalysisItem[]): string {
  return items
    .slice(0, 3)
    .map((i) => `${clip(i.text)}${i.severity ? `(${SEVERITY_LABELS[i.severity]})` : ''}`)
    .join(' / ');
}

function dateLabel(r: IncidentRecord): string {
  const d = new Date(recordTime(r));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface OverviewDigest {
  text: string;
  /** ダイジェスト中の参照番号 → 記録ID（refs[n-1] が #n）。 */
  refs: string[];
  /** ダイジェストに含めた記録数。 */
  includedCount: number;
}

/** 記録ごとの要約行を古い順に並べたダイジェストを作る。 */
export function buildOverviewDigest(
  allRecords: IncidentRecord[],
  stats: OverviewStats,
  maxRecords = OVERVIEW_DIGEST_MAX_RECORDS,
): OverviewDigest {
  const analyzed = allRecords
    .filter((r) => !r.excludeFromCarte && r.analysis)
    .sort((a, b) => recordTime(a) - recordTime(b));
  const included = analyzed.slice(Math.max(0, analyzed.length - maxRecords));

  const header = [
    `# 全体の集計（ローカル集計。カルテ除外の記録を除く）`,
    `記録 ${stats.total}件（最新基準で分析済み ${stats.analyzedCurrent} / 旧基準の分析 ${stats.analyzedOutdated} / 未分析 ${stats.unanalyzed}）`,
    `衝突 ${stats.conflicts}件 / 良い出来事 ${stats.positives}件 / 修復行動 ${stats.repairs}件 / 子ども同席の衝突 ${stats.childPresentConflicts}件 / 安全上の懸念がある記録 ${stats.safetyRecords}件`,
    `最新基準での判定内訳（衝突 ${stats.judgedConflicts}件）: ${LEANING_SCALE.map((l) => `${VERDICT_LEANING_LABELS[l]} ${stats.leaningCounts[l]}`).join(' / ')} / どちらにも大きな問題なし ${stats.leaningCounts.no_fault} / 判断材料不足 ${stats.leaningCounts.undeterminable}`,
    `自分側の問題の重さ: 重大 ${stats.severity.user.serious} / 中程度 ${stats.severity.user.moderate} / 軽微 ${stats.severity.user.minor}`,
    `相手側の問題の重さ: 重大 ${stats.severity.other.serious} / 中程度 ${stats.severity.other.moderate} / 軽微 ${stats.severity.other.minor}`,
    ...(stats.biasWarnings.length > 0 ? [`記録の偏り: ${stats.biasWarnings.join(' / ')}`] : []),
    ...(analyzed.length > included.length
      ? [`※ 分析済み ${analyzed.length}件のうち、新しい ${included.length}件だけを下に列挙しています（古い記録は上の集計にのみ含まれます）。`]
      : []),
    '',
    '# 記録ごとの要約（古い順。#番号で参照できる）',
  ];

  const lines = included.map((r, i) => {
    const a = r.analysis!;
    const kinds = [r.isConflict && '衝突', r.isPositiveEvent && '良い出来事', r.isRepairAction && '修復']
      .filter(Boolean)
      .join('・');
    const parts = [`#${i + 1} ${dateLabel(r)} ${clip(r.title || '無題', 40)}${kinds ? `［${kinds}］` : ''}`];
    if (a.verdict) {
      parts.push(
        `  判定: ${VERDICT_LEANING_LABELS[a.verdict.leaning]}（${VERDICT_ROBUSTNESS_LABELS[a.verdict.robustness]}）${clip(a.verdict.headline, 90)}`,
      );
    } else {
      parts.push(`  （旧基準の分析・判定なし）見解: ${clip(a.conciseView, 90)}`);
    }
    if (a.userImprovementPoints.length > 0) parts.push(`  自分側: ${issueText(a.userImprovementPoints)}`);
    if (a.otherPartyProblemPoints.length > 0) parts.push(`  相手側: ${issueText(a.otherPartyProblemPoints)}`);
    const goods = [...a.positiveActions, ...a.repairActions].slice(0, 2).map((x) => clip(x.text));
    if (goods.length > 0) parts.push(`  良い点・修復: ${goods.join(' / ')}`);
    const extras = [
      r.childrenPresent === 'yes' && '子ども同席',
      a.safetyFlags.length > 0 && `安全上の懸念: ${a.safetyFlags.map((f) => clip(f.description, 50)).join(' / ')}`,
      r.sourceType === 'voice_recording' || r.sourceType === 'audio_file' ? '録音あり' : '本人の文章',
    ].filter(Boolean);
    parts.push(`  ${extras.join(' / ')}`);
    return parts.join('\n');
  });

  return {
    text: [...header, ...lines].join('\n'),
    refs: included.map((r) => r.id),
    includedCount: included.length,
  };
}

// ---------------------------------------------------------------------------
// AI総評の後処理（#番号 → 記録ID、件数上限の担保）

/** AI応答（overallReview.ts の OverallReviewPayload と同形。サーバー依存を持ち込まないよう構造で受ける）。 */
export interface OverallReviewPayloadLike {
  userRecurringIssues: Array<{ text: string; suggestion?: string; severity: Severity; count: number; refs: number[] }>;
  otherRecurringIssues: Array<{ text: string; suggestion?: string; severity: Severity; count: number; refs: number[] }>;
  strengths: string[];
  conflictTriggers: string[];
  interactionCycle?: string;
  childImpact: string;
  safetyConcerns: string;
  responsibilityReason: string;
  responsibilityTendency: OverallReview['responsibilityTendency'];
  trendReason: string;
  relationshipTrend: OverallReview['relationshipTrend'];
  cannotJudge: string[];
  userFocus: string[];
  requestsToOther: string[];
  overallView: string;
  closingMessage: string;
}

export function resolveOverallReview(
  payload: OverallReviewPayloadLike,
  opts: {
    refs: string[];
    aiModel: string;
    promptVersion: string;
    fingerprint: string;
    includedCount: number;
    outdatedCount: number;
    now?: Date;
  },
): OverallReview {
  const toIds = (nums: number[]) =>
    Array.from(new Set(nums.filter((n) => n >= 1 && n <= opts.refs.length).map((n) => opts.refs[n - 1])));
  const issues = (list: OverallReviewPayloadLike['userRecurringIssues']) =>
    list.slice(0, 5).map((it) => ({
      text: it.text,
      suggestion: it.suggestion?.trim() || undefined,
      severity: it.severity,
      count: it.count,
      recordIds: toIds(it.refs),
    }));
  const nonEmpty = (list: string[], max: number) => list.map((s) => s.trim()).filter(Boolean).slice(0, max);
  return {
    overallView: payload.overallView,
    relationshipTrend: payload.relationshipTrend,
    trendReason: payload.trendReason,
    responsibilityTendency: payload.responsibilityTendency,
    responsibilityReason: payload.responsibilityReason,
    userRecurringIssues: issues(payload.userRecurringIssues),
    otherRecurringIssues: issues(payload.otherRecurringIssues),
    strengths: nonEmpty(payload.strengths, 4),
    conflictTriggers: nonEmpty(payload.conflictTriggers, 4),
    interactionCycle: payload.interactionCycle?.trim() || undefined,
    childImpact: payload.childImpact.trim(),
    safetyConcerns: payload.safetyConcerns.trim(),
    userFocus: nonEmpty(payload.userFocus, 3),
    requestsToOther: nonEmpty(payload.requestsToOther, 3),
    cannotJudge: nonEmpty(payload.cannotJudge, 4),
    closingMessage: payload.closingMessage,
    aiModel: opts.aiModel,
    promptVersion: opts.promptVersion,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    fingerprint: opts.fingerprint,
    includedCount: opts.includedCount,
    outdatedCount: opts.outdatedCount,
  };
}
