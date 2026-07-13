import { sourceTextOf } from './newRecord';
import type {
  AggregatedItem,
  FlatCheckScope,
  IncidentRecord,
  ObjectiveProfileSummary,
  PersonProfile,
  ReviewPeriod,
} from './types';

/**
 * 客観カルテ・フラットチェックのローカル集計エンジン（追加依頼 §5〜§8 / §27）。
 * ここにある処理は**AIを一切呼ばない**。集計可能な項目はすべてローカルで行い、
 * AIは短い講評文の生成にだけ使う（無料枠の節約・オフライン動作）。
 *
 * 注意: テキストの語句一致による集計は「参考値」。人格の診断ではなく、
 * 記録上の発言・行動パターンの計数として扱う。
 */

// ---------------------------------------------------------------------------
// 辞書（テーマ・表現・状況）。集約して調整しやすくする。

/** よく出るテーマ（追加依頼 §5.4）。ラベル → 一致キーワード。 */
export const THEME_KEYWORDS: Record<string, string[]> = {
  家事: ['家事', '洗濯', '掃除', '料理', '皿', '片付け', 'ゴミ'],
  育児: ['育児', '子ども', '子供', '保育園', '幼稚園', '学校', 'おむつ', '寝かしつけ'],
  お金: ['生活費', 'お金', '精算', '家計', '支払い', 'ローン', '貯金', '給料'],
  実家・親族: ['実家', '義実家', '帰省', '義母', '義父', '親戚', '祖父母'],
  仕事: ['仕事', '残業', '出張', '会社', '職場'],
  約束・忘れ物: ['約束', '忘れ', '受け取り', 'リマインダー', '予定'],
  車・運転: ['車', '運転', '車内', 'ドライブ'],
  通院・健康: ['病院', '通院', '発熱', '体調', '健康'],
  記念日・贈り物: ['記念日', 'プレゼント', '誕生日', '手紙', 'お祝い'],
  会話の言い方: ['言い方', '冗談', '口調', 'きつい', '言葉'],
  'スマホ・LINE': ['スマホ', 'LINE', 'メッセージ', '既読', '返信'],
};

/** 一般化・特徴的な表現（追加依頼 §5.5）。 */
export const EXPRESSION_KEYWORDS: Record<string, string[]> = {
  '「いつも」': ['いつも'],
  '「全部」': ['全部', '全て', 'すべて'],
  '「何もしていない」': ['何もしていない', '何もしない', 'なにもしていない'],
  '「ずっと」': ['ずっと', '10年間'],
  '「また」': ['また'],
  '「どうせ」': ['どうせ'],
  '「普通は」': ['普通'],
  '「言わなきゃやらない」': ['言わなきゃ', '言わないと'],
};

/** 強い言葉・存在否定（安全とカウントに使用）。 */
export const STRONG_LANGUAGE_KEYWORDS = [
  '死ね',
  '死んでほしい',
  '死んで',
  '大嫌い',
  '消えて',
  'いらない',
  '出て行け',
  '出ていけ',
];

/** 離婚・重大判断の語句（未来メモの表示条件に使用）。 */
export const DIVORCE_KEYWORDS = ['離婚', '別居', '親権', '離縁'];

const APOLOGY_KEYWORDS = ['ごめん', 'すまん', 'すみません', '申し訳', '謝っ', '謝罪'];
const GRATITUDE_KEYWORDS = ['ありがとう', '感謝', '助かった', '助かる'];

/** 衝突が起きやすい状況（追加依頼 §5.6）。ラベル → 判定関数。 */
const CONFLICT_CONTEXT_CHECKS: Array<{ label: string; test: (r: IncidentRecord, text: string) => boolean }> = [
  { label: '車内', test: (r, t) => r.location === '車' || t.includes('車内') || t.includes('運転中') },
  {
    label: '夜・深夜',
    test: (r) => {
      const at = r.occurredAt ?? r.createdAt;
      const h = new Date(at).getHours();
      return h >= 22 || h < 5;
    },
  },
  { label: '子どもの前', test: (r) => r.childrenPresent === 'yes' },
  { label: '疲労時', test: (r, t) => r.emotions.includes('疲労') || t.includes('疲れ') },
  { label: '朝の準備中', test: (r, t) => t.includes('朝') && (t.includes('準備') || t.includes('出発')) },
  { label: '帰省・実家関連', test: (r, t) => t.includes('帰省') || t.includes('実家') },
  { label: 'お金の話', test: (r, t) => THEME_KEYWORDS['お金'].some((k) => t.includes(k)) },
  { label: '忘れ物・約束忘れ', test: (r, t) => t.includes('忘れ') },
];

/** detectedPatterns.type の分類: 自分側の繰り返しパターン（追加依頼 §6）。 */
const USER_PATTERN_TYPES = new Set(['forgotten_promise', 'verbal_only_management', 'user_over_apology']);
/** 相手側の発言・行動パターン。 */
const OTHER_PATTERN_TYPES = new Set([
  'generalization',
  'personalization',
  'blame_without_evidence',
  'no_correction',
  'one_sided_apology',
]);

// ---------------------------------------------------------------------------
// 期間・人物・対象記録のフィルタ

export const PERIOD_DAYS: Record<Exclude<ReviewPeriod, 'all'>, number> = {
  '7_days': 7,
  '30_days': 30,
  '3_months': 92,
  '6_months': 183,
  '1_year': 366,
};

function recordDate(r: IncidentRecord): number {
  return Date.parse(r.occurredAt ?? r.createdAt);
}

export function filterByPeriod(
  records: IncidentRecord[],
  period: ReviewPeriod,
  now: Date = new Date(),
): IncidentRecord[] {
  if (period === 'all') return records;
  const cutoff = now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
  return records.filter((r) => recordDate(r) >= cutoff);
}

/** 人物が記録に登場するか（displayName / aliases で照合）。 */
export function personMatchesRecord(person: PersonProfile, record: IncidentRecord): boolean {
  const names = new Set([person.displayName, ...person.aliases]);
  return record.people.some((p) => names.has(p.displayName));
}

/** カルテ集計の対象記録（除外フラグ付きを外す。追加依頼 §30）。 */
export function carteTargetRecords(
  records: IncidentRecord[],
  person: PersonProfile,
  period: ReviewPeriod,
  now: Date = new Date(),
): IncidentRecord[] {
  return filterByPeriod(records, period, now).filter(
    (r) => !r.excludeFromCarte && personMatchesRecord(person, r),
  );
}

// ---------------------------------------------------------------------------
// 集計ヘルパー

function countByKeywords(
  records: IncidentRecord[],
  dictionary: Record<string, string[]>,
): AggregatedItem[] {
  const items: AggregatedItem[] = [];
  for (const [label, keywords] of Object.entries(dictionary)) {
    const hit = records.filter((r) => {
      const text = `${r.title ?? ''}\n${sourceTextOf(r)}`;
      return keywords.some((k) => text.includes(k));
    });
    if (hit.length > 0) {
      items.push({
        id: `kw_${label}`,
        label,
        count: hit.length,
        recordIds: hit.map((r) => r.id),
        confidence: 'medium', // 語句一致による参考値
      });
    }
  }
  return items.sort((a, b) => b.count - a.count);
}

function textContainsAny(record: IncidentRecord, keywords: string[]): boolean {
  const text = `${record.title ?? ''}\n${sourceTextOf(record)}`;
  return keywords.some((k) => text.includes(k));
}

/** analysis.detectedPatterns を type ごとに集計する。 */
function aggregatePatterns(
  records: IncidentRecord[],
  filter: (type: string) => boolean,
): AggregatedItem[] {
  const map = new Map<string, { label: string; description: string; recordIds: string[] }>();
  for (const r of records) {
    for (const p of r.analysis?.detectedPatterns ?? []) {
      if (!filter(p.type)) continue;
      const entry = map.get(p.type) ?? { label: p.label, description: p.description, recordIds: [] };
      if (!entry.recordIds.includes(r.id)) entry.recordIds.push(r.id);
      map.set(p.type, entry);
    }
  }
  return Array.from(map.entries())
    .map(([type, e]) => ({
      id: `pat_${type}`,
      label: e.label,
      description: e.description,
      count: e.recordIds.length,
      recordIds: e.recordIds,
      confidence: 'high' as const, // 一件ごとのAI分析済み結果の集計
    }))
    .sort((a, b) => b.count - a.count);
}

/** analysis の positiveActions / repairActions を集計する（事実と解釈の分離は各項目の文面が担う）。 */
function aggregateAnalysisItems(
  records: IncidentRecord[],
  pick: (r: IncidentRecord) => Array<{ text: string }>,
): AggregatedItem[] {
  const items: AggregatedItem[] = [];
  for (const r of records) {
    for (const item of pick(r)) {
      items.push({
        id: `ai_${r.id}_${items.length}`,
        label: item.text,
        count: 1,
        recordIds: [r.id],
        confidence: 'high',
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 記録の偏り検出（追加依頼 §12.7。ローカル判定）

export function detectDataBias(records: IncidentRecord[]): string[] {
  const warnings: string[] = [];
  const total = records.length;
  if (total === 0) return warnings;

  if (total < 5) {
    warnings.push(
      `対象期間の記録は${total}件だけなので、長期傾向としての判断には十分ではありません。`,
    );
  }

  const conflicts = records.filter((r) => r.isConflict).length;
  const positives = records.filter((r) => r.isPositiveEvent).length;
  if (total >= 3 && conflicts / total >= 0.7 && positives === 0) {
    warnings.push(
      '現在の記録は衝突した出来事が中心です。関係全体を判断するためには、穏やかだった日や相手の良かった行動も記録すると、より正確に比較できます。',
    );
  }

  const negativeEmotions = new Set(['悲しい', '怒り', '混乱', '不安', '疲労', '落胆']);
  const emotional = records.filter((r) => r.emotions.some((e) => negativeEmotions.has(e))).length;
  if (total >= 4 && emotional / total >= 0.8) {
    warnings.push(
      '記録の多くが強い感情の直後に入力されています。落ち着いている時の出来事も記録すると、傾向がより正確になります。',
    );
  }

  const onlyUserMemory = records.filter(
    (r) => r.sourceType === 'text' || r.sourceType === 'quick_memo',
  ).length;
  if (total >= 5 && onlyUserMemory === total) {
    warnings.push(
      'すべての記録が本人の記憶ベースです。録音やスクリーンショットなど原本のある記録が混ざると、事実の確認がしやすくなります。',
    );
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// 客観カルテのサマリー生成（ローカル。aiSummary は空で返し、別途AIで埋める）

export function buildProfileSummary(
  allRecords: IncidentRecord[],
  person: PersonProfile,
  period: ReviewPeriod,
  now: Date = new Date(),
): ObjectiveProfileSummary {
  const records = carteTargetRecords(allRecords, person, period, now);
  const conflictRecords = records.filter((r) => r.isConflict);

  const conflictPatterns: AggregatedItem[] = CONFLICT_CONTEXT_CHECKS.map(({ label, test }) => {
    const hit = conflictRecords.filter((r) => test(r, sourceTextOf(r)));
    return {
      id: `ctx_${label}`,
      label,
      count: hit.length,
      recordIds: hit.map((r) => r.id),
      confidence: 'medium' as const,
    };
  })
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count);

  const countWhere = (pred: (r: IncidentRecord) => boolean) => records.filter(pred).length;

  return {
    personId: person.id,
    period,
    periodStart:
      period === 'all'
        ? undefined
        : new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000).toISOString(),
    periodEnd: now.toISOString(),

    totalRecords: records.length,
    conflictCount: countWhere((r) => r.isConflict === true),
    positiveEventCount: countWhere((r) => r.isPositiveEvent === true),
    repairActionCount: countWhere((r) => r.isRepairAction === true),
    apologyCount: countWhere((r) => textContainsAny(r, APOLOGY_KEYWORDS)),
    gratitudeCount: countWhere((r) => textContainsAny(r, GRATITUDE_KEYWORDS)),
    strongLanguageCount: countWhere((r) => textContainsAny(r, STRONG_LANGUAGE_KEYWORDS)),
    childPresentCount: countWhere((r) => r.childrenPresent === 'yes'),
    insufficientEvidenceCount: countWhere((r) =>
      (r.analysis?.responsibilityBreakdown ?? []).some((b) => b.judgment === 'insufficient_evidence'),
    ),

    commonThemes: countByKeywords(records, THEME_KEYWORDS),
    commonExpressions: countByKeywords(records, EXPRESSION_KEYWORDS),
    conflictPatterns,

    userPatterns: aggregatePatterns(records, (t) => USER_PATTERN_TYPES.has(t)),
    otherPartyPatterns: aggregatePatterns(records, (t) => OTHER_PATTERN_TYPES.has(t)),

    positiveActions: aggregateAnalysisItems(records, (r) => r.analysis?.positiveActions ?? []),
    repairActions: aggregateAnalysisItems(records, (r) => r.analysis?.repairActions ?? []),

    dataBiasWarnings: detectDataBias(records),
    aiSummary: '',

    generatedAt: now.toISOString(),
  };
}

/**
 * AI講評キャッシュの指紋。対象記録のIDと更新日時から作る —
 * 記録が増減・更新された時だけ再生成する（差分更新。追加依頼 §27）。
 */
export function summaryFingerprint(records: IncidentRecord[]): string {
  const parts = records
    .map((r) => `${r.id}@${r.updatedAt}`)
    .sort()
    .join('|');
  // 軽量な非暗号ハッシュ（FNV-1a）。キャッシュキー用途で十分
  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${records.length}_${hash.toString(16)}`;
}

// ---------------------------------------------------------------------------
// フラットチェック用: 過去記録の範囲選択と比較集計（追加依頼 §11 / §12.6）

export const SCOPE_TO_PERIOD: Record<FlatCheckScope, ReviewPeriod | 'none'> = {
  current_only: 'none',
  current_and_7_days: '7_days',
  current_and_30_days: '30_days',
  current_and_3_months: '3_months',
  current_and_all: 'all',
};

export function flatCheckPastRecords(
  allRecords: IncidentRecord[],
  currentRecordId: string,
  scope: FlatCheckScope,
  now: Date = new Date(),
): IncidentRecord[] {
  const period = SCOPE_TO_PERIOD[scope];
  if (period === 'none') return [];
  return filterByPeriod(allRecords, period, now).filter(
    (r) => r.id !== currentRecordId && !r.excludeFromCarte,
  );
}

/** 過去との比較項目（件数+根拠記録ID。断定ではなく記録上の傾向）。 */
export function buildPastComparison(pastRecords: IncidentRecord[]): AggregatedItem[] {
  const items: AggregatedItem[] = [];
  const push = (partial: AggregatedItem | null) => {
    if (partial && partial.count > 0) items.push(partial);
  };

  for (const item of countByKeywords(pastRecords, EXPRESSION_KEYWORDS).slice(0, 3)) {
    push({ ...item, label: `${item.label}の表現`, id: `pc_${item.id}` });
  }
  for (const item of aggregatePatterns(
    pastRecords,
    (t) => USER_PATTERN_TYPES.has(t) || OTHER_PATTERN_TYPES.has(t),
  ).slice(0, 4)) {
    push({ ...item, id: `pc_${item.id}` });
  }
  const repairs = pastRecords.filter((r) => r.isRepairAction);
  push({
    id: 'pc_repair',
    label: '修復の可能性がある行動',
    count: repairs.length,
    recordIds: repairs.map((r) => r.id),
    confidence: 'high',
  });
  const positives = pastRecords.filter((r) => r.isPositiveEvent);
  push({
    id: 'pc_positive',
    label: '良い出来事',
    count: positives.length,
    recordIds: positives.map((r) => r.id),
    confidence: 'high',
  });
  return items;
}

/** 同じ日の衝突記録数（未来メモの表示条件に使用）。 */
export function conflictsOnSameDay(records: IncidentRecord[], date: Date): number {
  const day = date.toISOString().slice(0, 10);
  return records.filter((r) => r.isConflict && (r.occurredAt ?? r.createdAt).slice(0, 10) === day)
    .length;
}
