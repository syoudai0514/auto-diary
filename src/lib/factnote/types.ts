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
export type DiaryMode = 'factual' | 'emotional' | 'family' | 'short' | 'detailed';
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
  diaryVersions: DiaryVersion[];

  status: RecordStatus;

  aiModel?: string;
  promptVersion?: string;

  isPositiveEvent?: boolean;
  isConflict?: boolean;
  isRepairAction?: boolean;

  lastBackupAt?: string;
}

export interface IncidentAnalysis {
  /** 最初に表示する 2〜4文の率直かつ中立的な見解（依頼書 §12.1）。 */
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
}

export interface DetectedPattern {
  id: string;
  /** 集計用の機械的な種別（例: 'generalization' / 'no_correction' / 'conflict_in_car'）。 */
  type: string;
  label: string;
  description: string;
  evidenceIds: string[];
  confidence: ConfidenceLevel;
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
  factual: '事実記録',
  emotional: '感情整理',
  family: '家族日記',
  short: '短い日記',
  detailed: '詳細な日記',
};

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

/** 確信度の表示名。 */
export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: '確度高',
  medium: '確度中',
  low: '確度低',
};
