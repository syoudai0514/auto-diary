import { newFactnoteId } from './db';
import type { FactnoteAnalyzeResult } from './api';
import type { IncidentContext } from './prompts/incidentAnalysis';
import {
  FACTNOTE_SCHEMA_VERSION,
  type ChildrenPresent,
  type IncidentRecord,
  type RecordSource,
} from './types';

/**
 * 記録作成フローの純粋ロジック（画面から分離してテスト可能にする）。
 */

/** 補足情報の選択肢（依頼書 §9。P0 最小構成 + 場所）。 */
export const LOCATION_OPTIONS = ['自宅', '車', '外出先', '公園', '店舗', '電話', 'LINE', 'その他'] as const;
export const PEOPLE_OPTIONS = [
  '配偶者',
  '子ども',
  '自分の親',
  '配偶者の親',
  '親族',
  '友人',
  '職場',
  'その他',
] as const;
export const EMOTION_OPTIONS = [
  '悲しい',
  '怒り',
  '混乱',
  '不安',
  '疲労',
  '落胆',
  '安心',
  '嬉しい',
  '感謝',
] as const;
export const CHILDREN_OPTIONS = [
  '聞いていた',
  '同席していた',
  '同席していたが聞いていたか不明',
  'いなかった',
  '不明',
] as const;
export type ChildrenOption = (typeof CHILDREN_OPTIONS)[number];

/** 補足情報の画面上の状態。 */
export interface Supplement {
  /** datetime-local 形式（例: 2026-07-13T18:00）。時刻不明なら空。 */
  occurredAtLocal: string;
  occurredUnknown: boolean;
  location: string;
  people: string[];
  children: ChildrenOption | '';
  emotions: string[];
}

export function emptySupplement(now: Date = new Date()): Supplement {
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return {
    occurredAtLocal: local,
    occurredUnknown: false,
    location: '',
    people: [],
    children: '',
    emotions: [],
  };
}

/** 子どもの同席の選択肢を保存用の値に変換する。 */
export function childrenToStored(children: ChildrenOption | ''): {
  childrenPresent?: ChildrenPresent;
  childImpactTags: string[];
} {
  switch (children) {
    case '聞いていた':
      return { childrenPresent: 'yes', childImpactTags: ['聞いていた'] };
    case '同席していた':
      return { childrenPresent: 'yes', childImpactTags: ['同席していた'] };
    case '同席していたが聞いていたか不明':
      return { childrenPresent: 'yes', childImpactTags: ['聞いていたか不明'] };
    case 'いなかった':
      return { childrenPresent: 'no', childImpactTags: [] };
    case '不明':
      return { childrenPresent: 'unknown', childImpactTags: [] };
    default:
      return { childrenPresent: undefined, childImpactTags: [] };
  }
}

/** 補足情報をレコードへ反映する。 */
export function applySupplement(record: IncidentRecord, s: Supplement): IncidentRecord {
  const children = childrenToStored(s.children);
  const occurredAt =
    !s.occurredUnknown && s.occurredAtLocal ? new Date(s.occurredAtLocal).toISOString() : undefined;
  return {
    ...record,
    occurredAt,
    location: s.location || undefined,
    people: s.people.map((name, i) => ({ id: `p${i + 1}`, displayName: name, relationship: name })),
    childrenPresent: children.childrenPresent,
    childImpactTags: children.childImpactTags,
    emotions: s.emotions,
    updatedAt: new Date().toISOString(),
  };
}

/** 補足情報をAI分析へ渡すコンテキストに変換する。 */
export function supplementToContext(s: Supplement): IncidentContext {
  return {
    occurredAt: !s.occurredUnknown && s.occurredAtLocal ? s.occurredAtLocal.replace('T', ' ') : undefined,
    location: s.location || undefined,
    people: s.people.length > 0 ? s.people : undefined,
    childrenPresent: s.children || undefined,
    emotions: s.emotions.length > 0 ? s.emotions : undefined,
  };
}

/** 新しい空のレコードを作る。 */
export function createEmptyRecord(sourceType: RecordSource, now: Date = new Date()): IncidentRecord {
  const iso = now.toISOString();
  return {
    id: newFactnoteId(),
    schemaVersion: FACTNOTE_SCHEMA_VERSION,
    createdAt: iso,
    updatedAt: iso,
    sourceType,
    people: [],
    childImpactTags: [],
    emotions: [],
    tags: [],
    attachments: [],
    evidenceItems: [],
    diaryVersions: [],
    status: 'draft',
  };
}

/** 分析対象のテキスト（修正済み文字起こし > 文字起こし > 原文の優先順）。 */
export function sourceTextOf(record: IncidentRecord): string {
  return (record.correctedTranscript ?? record.transcript ?? record.rawText ?? '').trim();
}

/**
 * 分析結果をレコードへ反映する。verifiedFacts は原本の EvidenceItem に紐づける。
 * 原本（rawText / transcript / 添付）は変更しない（依頼書 §6.3）。
 */
export function applyAnalysisResult(
  record: IncidentRecord,
  result: FactnoteAnalyzeResult,
  now: Date = new Date(),
): IncidentRecord {
  const sourceEvidence = record.evidenceItems[0];
  const analysis = sourceEvidence
    ? {
        ...result.analysis,
        verifiedFacts: result.analysis.verifiedFacts.map((it) => ({
          ...it,
          evidenceIds: [sourceEvidence.id],
        })),
      }
    : result.analysis;
  return {
    ...record,
    title: record.title || result.title,
    analysis,
    status: 'ready',
    aiModel: result.analysis.aiModel,
    promptVersion: result.analysis.promptVersion,
    isPositiveEvent: result.isPositiveEvent,
    isConflict: result.isConflict,
    isRepairAction: result.isRepairAction,
    updatedAt: now.toISOString(),
  };
}

/** 保存済みレコードの補足情報をAI分析用コンテキストへ変換する（詳細画面からの分析用）。 */
export function recordToContext(record: IncidentRecord): IncidentContext {
  return {
    occurredAt: record.occurredAt
      ? new Date(record.occurredAt).toLocaleString('ja-JP')
      : undefined,
    location: record.location,
    people: record.people.length > 0 ? record.people.map((p) => p.displayName) : undefined,
    childrenPresent:
      record.childrenPresent === 'yes'
        ? record.childImpactTags[0] || '同席していた'
        : record.childrenPresent === 'no'
          ? 'いなかった'
          : record.childrenPresent === 'unknown'
            ? '不明'
            : undefined,
    emotions: record.emotions.length > 0 ? record.emotions : undefined,
  };
}
