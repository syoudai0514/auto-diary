/**
 * 事実ノートのデータモデル（依頼書 §21 を確定させたもの。docs/factnote/PLAN.md §2）。
 *
 * 設計原則:
 * - 原本（rawText / transcript / 添付Blob）とAI生成物（analysis / diaryVersions）を
 *   別フィールドで持ち、AIが原本を上書きしない（依頼書 §6.3 / §10）
 * - 添付Blobの本体はレコードに埋め込まず attachments ストアへ分離保存する
 * - 全レコードに schemaVersion を持たせ、将来のマイグレーションに備える
 */

/** 現行のスキーマバージョン。構造を変えるときは db.ts の migrateRecord も更新する。 */
export const FACTNOTE_SCHEMA_VERSION = 1;

export type RecordSource = 'voice_recording' | 'audio_file' | 'text' | 'screenshot' | 'quick_memo';
export type EvidenceType = 'audio' | 'image' | 'text' | 'user_statement';
export type DiaryMode = 'factual' | 'emotional' | 'family' | 'short' | 'detailed' | 'verbatim';
export type RecordStatus = 'draft' | 'transcribing' | 'analyzing' | 'ready' | 'error';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ChildrenPresent = 'yes' | 'no' | 'unknown';

export interface IncidentRecord {
  id: string;
  schemaVersion: number;
  createdAt: string; // ISO
  /** 出来事の発生日時（入力日時と別。不明なら undefined）。 */
  occurredAt?: string;
  updatedAt: string; // ISO

  title?: string;
  sourceType: RecordSource;

  /** ユーザーが入力した原文（文章入力・30秒メモ）。原本 — AIは変更しない。 */
  rawText?: string;
  /** AIによる文字起こし。原本扱い — ユーザー修正は correctedTranscript に分離。 */
  transcript?: string;
  /** ユーザーが修正した文字起こし。 */
  correctedTranscript?: string;

  location?: string;
  people: PersonRef[];

  childrenPresent?: ChildrenPresent;
  childImpactTags: string[];

  emotions: string[];
  tags: string[];
  /** 記録目的（依頼書 §9。P1で入力UIを拡充）。 */
  purposes?: string[];

  attachments: Attachment[];
  evidenceItems: EvidenceItem[];

  analysis?: IncidentAnalysis;
  /** 再分析で置き換えられた直前の分析（判定の変化を比較するため1世代だけ保持）。 */
  previousAnalysis?: IncidentAnalysis;
  diaryVersions: DiaryVersion[];

  status: RecordStatus;

  aiModel?: string;
  promptVersion?: string;

  isPositiveEvent?: boolean;
  isConflict?: boolean;
  isRepairAction?: boolean;

  /** true にすると客観カルテの集計から除外する（追加依頼 §30）。 */
  excludeFromCarte?: boolean;
  /** この記録に固定した未来メモのID（追加依頼 §19）。 */
  pinnedMemoIds?: string[];

  lastBackupAt?: string;
}

export interface IncidentAnalysis {
  /**
   * 今回の判定（v3〜）。論点の「重さ」から導いた、どちら側の問題が重いかの率直な判定。
   * 旧基準（v1/v2）の分析には存在しない。
   */
  verdict?: IncidentVerdict;

  /** 最初に表示する 2〜4文の率直な見解（依頼書 §12.1）。v3〜は verdict から導く。 */
  conciseView: string;

  verifiedFacts: AnalysisItem[];
  userClaims: AnalysisItem[];
  aiInferences: AnalysisItem[];
  unknowns: AnalysisItem[];

  userImprovementPoints: AnalysisItem[];
  otherPartyProblemPoints: AnalysisItem[];

  balancedConclusion: string;

  /** 次回の具体的対応。最大3件（依頼書 §6.2）。 */
  nextActions: string[];

  replySuggestions: {
    gentle: string;
    standard: string;
    firm: string;
  };

  responsibilityBreakdown: ResponsibilityItem[];

  detectedPatterns: DetectedPattern[];
  positiveActions: AnalysisItem[];
  repairActions: AnalysisItem[];

  /** 危険の兆候がない場合は空配列（過剰警告をしない。依頼書 §6.4）。 */
  safetyFlags: SafetyFlag[];

  /** 生成時のメタ情報（依頼書 §22.4）。 */
  aiModel: string;
  promptVersion: string;
  generatedAt: string; // ISO
}

export interface AnalysisItem {
  id: string;
  text: string;
  confidence: ConfidenceLevel;
  evidenceIds: string[];
  /** 問題の重さ（改善点・問題点のみ。v3〜）。 */
  severity?: Severity;
  /** 根拠の種類（改善点・問題点のみ。v3〜）。 */
  basis?: EvidenceBasis;
  /** 代わりにどうするとよいか（改善点・問題点のみ。v4〜）。具体的な行動・言い方。 */
  suggestion?: string;
}

/** 問題の重さ。自分側・相手側に同じ物差しで付ける。 */
export type Severity = 'minor' | 'moderate' | 'serious';

/** 根拠の種類: 記録で確認できる / 記録者の記憶・主張 / AIの推測。 */
export type EvidenceBasis = 'verified' | 'user_claim' | 'inference';

/** 発言・行動の主体。 */
export type IssueActor = 'user' | 'other' | 'both' | 'unclear';

/**
 * 一件の出来事の判定。「誰が何％悪い」という数値は出さず（依頼書 §13）、
 * 問題の重さから見た傾きをカテゴリで示す。
 */
export type VerdictLeaning =
  | 'user_mainly'
  | 'user_more'
  | 'comparable'
  | 'other_more'
  | 'other_mainly'
  | 'no_fault'
  | 'not_applicable'
  | 'undeterminable';

/** 判定の確かさ（未確認の主張にどれだけ依存しているか）。 */
export type VerdictRobustness = 'firm' | 'tentative' | 'fragile';

export interface IncidentVerdict {
  leaning: VerdictLeaning;
  /** 1文の率直な判定。 */
  headline: string;
  /** 件数ではなく重さに基づく理由。 */
  reasoning: string;
  robustness: VerdictRobustness;
  /** どんな事実が分かれば判定が変わりうるか。 */
  whatWouldChange: string;
  /** 立場を入れ替えても同じ判定になるかの確認結果。 */
  roleReversalCheck: string;
}

export type ResponsibilityJudgment =
  | 'user_improvement'
  | 'other_improvement'
  | 'shared_improvement'
  | 'no_problem'
  | 'insufficient_evidence'
  | 'contextual_factor';

export interface ResponsibilityItem {
  id: string;
  topic: string;
  userSide?: string;
  otherSide?: string;
  judgment: ResponsibilityJudgment;
  /** この論点の問題の重さ（v3〜。問題なし・判断材料不足の論点では省略）。 */
  severity?: Severity;
  /** この論点の根拠の種類（v3〜）。 */
  basis?: EvidenceBasis;
}

export interface DetectedPattern {
  id: string;
  /** 集計用の機械的な種別（例: 'generalization' / 'no_correction' / 'conflict_in_car'）。 */
  type: string;
  label: string;
  description: string;
  evidenceIds: string[];
  confidence: ConfidenceLevel;
  /** そのパターンを示したのは誰か（v3〜。旧データは type から推定する）。 */
  actor?: IssueActor;
}

export interface EvidenceItem {
  id: string;
  type: EvidenceType;

  text?: string;
  attachmentId?: string;

  /** 秒。チャンク分割の影響で不正確なことがあるため「参考値」（依頼書 §2-13）。 */
  timestampStart?: number;
  timestampEnd?: number;

  /** 表示用ラベル（例: 「音声（前半）」「ユーザー入力」「画像2枚目」）。 */
  sourceLabel: string;
  confidence?: ConfidenceLevel;
}

export interface DiaryVersion {
  id: string;
  mode: DiaryMode;

  title: string;
  body: string;

  createdAt: string; // ISO
  editedByUser: boolean;

  aiModel?: string;
  promptVersion?: string;
}

export interface Attachment {
  id: string;

  fileName: string;
  mimeType: string;
  size: number;

  durationSeconds?: number;

  createdAt: string; // ISO
}

export interface PersonRef {
  id: string;
  displayName: string;
  relationship?: string;
}

export interface SafetyFlag {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidenceIds: string[];
}

/** 日記モードの表示名。 */
export const DIARY_MODE_LABELS: Record<DiaryMode, string> = {
  verbatim: '原文のまま（変えない）',
  factual: '事実記録',
  emotional: '感情整理',
  family: '家族日記',
  short: '短い日記',
  detailed: '詳細な日記',
};

/** AIが文章を生成する日記モード（verbatim は AI を使わないので含めない）。 */
export const AI_DIARY_MODES: DiaryMode[] = ['factual', 'emotional', 'family', 'short', 'detailed'];

/** 入力形式の表示名。 */
export const RECORD_SOURCE_LABELS: Record<RecordSource, string> = {
  voice_recording: '録音',
  audio_file: '音声ファイル',
  text: '文章',
  screenshot: 'スクリーンショット',
  quick_memo: '30秒メモ',
};

/** 論点別責任の判定ラベル（依頼書 §13）。 */
export const RESPONSIBILITY_JUDGMENT_LABELS: Record<ResponsibilityJudgment, string> = {
  user_improvement: '自分側の改善点',
  other_improvement: '相手側の改善点',
  shared_improvement: '共同で仕組み化',
  no_problem: '問題なし',
  insufficient_evidence: '判断材料不足',
  contextual_factor: '考慮事情あり',
};

/** 判定の表示名。 */
export const VERDICT_LEANING_LABELS: Record<VerdictLeaning, string> = {
  user_mainly: '主に自分側の問題',
  user_more: '自分側がやや重い',
  comparable: '双方同程度',
  other_more: '相手側がやや重い',
  other_mainly: '主に相手側の問題',
  no_fault: 'どちらにも大きな問題なし',
  not_applicable: '判定の対象外（衝突ではない）',
  undeterminable: '判断材料が不足',
};

/** 判定の確かさの表示名。 */
export const VERDICT_ROBUSTNESS_LABELS: Record<VerdictRobustness, string> = {
  firm: '記録で裏付けあり',
  tentative: '暫定（一部が本人の記憶）',
  fragile: '揺らぎやすい（未確認の主張が中心）',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  minor: '軽微',
  moderate: '中程度',
  serious: '重大',
};

export const EVIDENCE_BASIS_LABELS: Record<EvidenceBasis, string> = {
  verified: '記録で確認',
  user_claim: '本人の記憶',
  inference: '推測',
};

export const ISSUE_ACTOR_LABELS: Record<IssueActor, string> = {
  user: '自分',
  other: '相手',
  both: '双方',
  unclear: '不明',
};

/** 確信度の表示名。 */
export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: '確度高',
  medium: '確度中',
  low: '確度低',
};

// ---------------------------------------------------------------------------
// 長期分析（客観カルテ / フラットチェック / 未来の自分からのメモ）
// docs/FACTNOTE_REQUEST.md に対する追加依頼（客観カルテ等）§21 のモデル

export type ReviewPeriod = '7_days' | '30_days' | '3_months' | '6_months' | '1_year' | 'all';

export type FlatCheckScope =
  | 'current_only'
  | 'current_and_7_days'
  | 'current_and_30_days'
  | 'current_and_3_months'
  | 'current_and_all';

/** 記録に登場する人物（別名統合に対応。依頼書 §4）。 */
export interface PersonProfile {
  id: string;
  displayName: string;
  relationship?: string;
  /** 同一人物の別名（例: 妻/ママ/配偶者）。記録との照合に使う。 */
  aliases: string[];

  createdAt: string;
  updatedAt: string;

  /** 統合により吸収した旧人物ID（分離時の手がかり）。 */
  mergedPersonIds: string[];
}

/** ローカル集計またはAIによる横断項目。 */
export interface AggregatedItem {
  id: string;
  label: string;
  description?: string;
  count: number;
  recordIds: string[];
  confidence: ConfidenceLevel;
}

/** 客観カルテのサマリー（集計はローカル、aiSummary のみAI）。 */
export interface ObjectiveProfileSummary {
  personId: string;
  period: ReviewPeriod;
  periodStart?: string;
  periodEnd?: string;

  totalRecords: number;
  conflictCount: number;
  positiveEventCount: number;
  repairActionCount: number;
  apologyCount: number;
  gratitudeCount: number;
  strongLanguageCount: number;
  childPresentCount: number;
  insufficientEvidenceCount: number;

  commonThemes: AggregatedItem[];
  commonExpressions: AggregatedItem[];
  conflictPatterns: AggregatedItem[];

  userPatterns: AggregatedItem[];
  otherPartyPatterns: AggregatedItem[];

  positiveActions: AggregatedItem[];
  repairActions: AggregatedItem[];

  dataBiasWarnings: string[];
  /** AI講評（未生成なら空文字）。 */
  aiSummary: string;

  generatedAt: string;
  aiModel?: string;
  promptVersion?: string;
}

/** フラットチェックの結果（履歴として保存・削除可能）。 */
export interface FlatCheckResult {
  id: string;
  currentRecordId: string;
  personId?: string;
  scope: FlatCheckScope;

  conciseConclusion: string;

  userImprovementPoints: AnalysisItem[];
  otherPartyProblemPoints: AnalysisItem[];
  unknowns: AnalysisItem[];
  /** 今回だけでは判断しない方がいいこと。 */
  avoidJudgingFromThisIncident: AnalysisItem[];

  /** 過去との比較（ローカル集計）。 */
  pastComparison: AggregatedItem[];
  dataBiasWarnings: string[];
  improvingPoints: AnalysisItem[];

  aiMessage: string;

  createdAt: string;
  aiModel?: string;
  promptVersion?: string;
}

export type FutureMemoTriggerType =
  | 'strong_language'
  | 'violence_related'
  | 'sadness'
  | 'anger'
  | 'anxiety'
  | 'confusion'
  | 'divorce_keyword'
  | 'late_night'
  | 'multiple_conflicts_same_day'
  | 'data_bias_warning'
  | 'many_user_issues'
  | 'many_other_party_issues'
  | 'manual';

export interface FutureMemoTrigger {
  type: FutureMemoTriggerType;
  keyword?: string;
  threshold?: number;
}

/** 冷静な時の自分が、動揺している未来の自分へ残すメモ。 */
export interface FutureSelfMemo {
  id: string;
  title: string;
  body: string;

  triggers: FutureMemoTrigger[];
  priority: number;
  isEnabled: boolean;

  /** 本人の言葉であることを明示するための由来（依頼書 §20）。 */
  source: 'user_written' | 'ai_draft_user_edited' | 'ai_draft_approved';

  createdAt: string;
  updatedAt: string;
  lastShownAt?: string;
  /** 「明日の朝に再表示」の予約時刻（ISO）。 */
  remindAt?: string;
}

export interface FutureMemoDisplayLog {
  id: string;
  memoId: string;
  recordId?: string;
  displayedAt: string;

  action: 'closed' | 'read_again' | 'remind_tomorrow' | 'pinned_to_record' | 'edited' | 'shown';
}

export const REVIEW_PERIOD_LABELS: Record<ReviewPeriod, string> = {
  '7_days': '直近7日',
  '30_days': '直近30日',
  '3_months': '直近3か月',
  '6_months': '直近6か月',
  '1_year': '直近1年',
  all: '全期間',
};

export const FLAT_CHECK_SCOPE_LABELS: Record<FlatCheckScope, string> = {
  current_only: '今回の記録だけ',
  current_and_7_days: '今回＋直近7日',
  current_and_30_days: '今回＋直近30日',
  current_and_3_months: '今回＋直近3か月',
  current_and_all: '今回＋全期間',
};

export const FUTURE_MEMO_TRIGGER_LABELS: Record<FutureMemoTriggerType, string> = {
  strong_language: '強い言葉を記録した時',
  violence_related: '暴力に関する内容の時',
  sadness: '「悲しい」を選んだ時',
  anger: '「怒り」を選んだ時',
  anxiety: '「不安」を選んだ時',
  confusion: '「混乱」を選んだ時',
  divorce_keyword: '離婚・別居の語句がある時',
  late_night: '夜22時以降',
  multiple_conflicts_same_day: '同じ日に衝突が複数ある時',
  data_bias_warning: '記録の偏りが検出された時',
  many_user_issues: '自分側の問題が多い時',
  many_other_party_issues: '相手側の問題が多い時',
  manual: '手動で表示',
};

// ---------------------------------------------------------------------------
// 全体の見解（全記録を通じたAI総評）

export type RelationshipTrend = 'improving' | 'stable' | 'worsening' | 'fluctuating' | 'insufficient_data';

export type ResponsibilityTendency =
  | 'user_heavier'
  | 'comparable'
  | 'other_heavier'
  | 'depends_on_topic'
  | 'insufficient_data';

/** 繰り返し見られる課題（refs は記録IDに変換済み）。 */
export interface RecurringIssue {
  text: string;
  /** 直し方（具体的な行動・言い方）。overallReview v2〜。 */
  suggestion?: string;
  severity: Severity;
  /** 該当した記録数（AIが要約から数えた値）。 */
  count: number;
  recordIds: string[];
}

export interface OverallReview {
  overallView: string;
  relationshipTrend: RelationshipTrend;
  trendReason: string;
  responsibilityTendency: ResponsibilityTendency;
  responsibilityReason: string;
  userRecurringIssues: RecurringIssue[];
  otherRecurringIssues: RecurringIssue[];
  strengths: string[];
  conflictTriggers: string[];
  /** 二人の間で繰り返される悪循環（overallReview v2〜）。 */
  interactionCycle?: string;
  childImpact: string;
  safetyConcerns: string;
  userFocus: string[];
  requestsToOther: string[];
  cannotJudge: string[];
  closingMessage: string;

  aiModel: string;
  promptVersion: string;
  generatedAt: string;
  /** 生成時点の記録の指紋（記録が変わったら「更新できます」を出す）。 */
  fingerprint: string;
  /** 生成時に要約へ含めた記録数 / 旧基準の分析だった記録数。 */
  includedCount: number;
  outdatedCount: number;
}

export const RELATIONSHIP_TREND_LABELS: Record<RelationshipTrend, string> = {
  improving: '改善の傾向',
  stable: '横ばい',
  worsening: '悪化の傾向',
  fluctuating: '波がある',
  insufficient_data: '判断材料が不足',
};

export const RESPONSIBILITY_TENDENCY_LABELS: Record<ResponsibilityTendency, string> = {
  user_heavier: '自分側の課題が重い傾向',
  comparable: '双方同程度',
  other_heavier: '相手側の課題が重い傾向',
  depends_on_topic: 'テーマによって異なる',
  insufficient_data: '判断材料が不足',
};
