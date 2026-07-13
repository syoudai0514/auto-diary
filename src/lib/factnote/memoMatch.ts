import { DIVORCE_KEYWORDS, STRONG_LANGUAGE_KEYWORDS } from './aggregate';
import type {
  FutureMemoTrigger,
  FutureMemoTriggerType,
  FutureSelfMemo,
  IncidentRecord,
} from './types';

/**
 * 未来の自分からのメモ: 表示条件の判定とテンプレート（追加依頼 §14〜§18）。
 * 判定はすべてローカルで行う。
 *
 * 安全上の注意（追加依頼 §25）: 記録に safetyFlags がある場合、呼び出し側は
 * 未来メモより安全確認カードを優先して表示すること。
 */

/** メモ表示判定に使う状況。 */
export interface MemoContext {
  /** 直近の記録（保存直後・フラットチェック対象など）。 */
  record?: IncidentRecord;
  /** 記録・入力のテキスト（語句判定用）。 */
  text?: string;
  /** 選択された感情。 */
  emotions?: string[];
  /** 同じ日の衝突記録数。 */
  conflictsToday?: number;
  /** 記録の偏り警告が出ているか。 */
  hasBiasWarning?: boolean;
  /** 自分側/相手側の問題点の件数（分析・フラットチェック結果から）。 */
  userIssueCount?: number;
  otherIssueCount?: number;
  now?: Date;
}

const VIOLENCE_KEYWORDS = ['暴力', '殴', '叩か', '投げ', '威嚇', '脅', '怖い'];

function triggerMatches(trigger: FutureMemoTrigger, ctx: MemoContext): boolean {
  const text = `${ctx.text ?? ''}`;
  const emotions = ctx.emotions ?? ctx.record?.emotions ?? [];
  const now = ctx.now ?? new Date();
  switch (trigger.type) {
    case 'strong_language':
      return STRONG_LANGUAGE_KEYWORDS.some((k) => text.includes(k));
    case 'violence_related':
      return (
        (ctx.record?.analysis?.safetyFlags.length ?? 0) > 0 ||
        VIOLENCE_KEYWORDS.some((k) => text.includes(k))
      );
    case 'sadness':
      return emotions.includes('悲しい');
    case 'anger':
      return emotions.includes('怒り');
    case 'anxiety':
      return emotions.includes('不安');
    case 'confusion':
      return emotions.includes('混乱');
    case 'divorce_keyword':
      return [...DIVORCE_KEYWORDS, ...(trigger.keyword ? [trigger.keyword] : [])].some((k) =>
        text.includes(k),
      );
    case 'late_night': {
      const h = now.getHours();
      return h >= 22 || h < 5;
    }
    case 'multiple_conflicts_same_day':
      return (ctx.conflictsToday ?? 0) >= (trigger.threshold ?? 2);
    case 'data_bias_warning':
      return ctx.hasBiasWarning === true;
    case 'many_user_issues':
      return (ctx.userIssueCount ?? 0) >= (trigger.threshold ?? 5);
    case 'many_other_party_issues':
      return (ctx.otherIssueCount ?? 0) >= (trigger.threshold ?? 5);
    case 'manual':
      return false; // 手動表示は一覧から
    default:
      return false;
  }
}

/**
 * 状況に合致する有効なメモを優先度順で返す。
 * 同じメモを短時間に繰り返し出さないよう、直近表示から6時間は抑制する。
 */
export function matchMemos(
  memos: FutureSelfMemo[],
  ctx: MemoContext,
  suppressHours = 6,
): FutureSelfMemo[] {
  const now = ctx.now ?? new Date();
  return memos
    .filter((m) => m.isEnabled)
    .filter((m) => {
      if (m.lastShownAt) {
        const elapsed = now.getTime() - Date.parse(m.lastShownAt);
        if (elapsed < suppressHours * 60 * 60 * 1000) return false;
      }
      return m.triggers.some((t) => triggerMatches(t, ctx));
    })
    .sort((a, b) => b.priority - a.priority);
}

/** 「明日の朝に再表示」の時刻（翌日 7:00）。 */
export function nextMorning(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(7, 0, 0, 0);
  return d.toISOString();
}

/** 再表示予約が来ているメモ（ホームで表示）。 */
export function dueReminders(memos: FutureSelfMemo[], now: Date = new Date()): FutureSelfMemo[] {
  return memos.filter((m) => m.isEnabled && m.remindAt && Date.parse(m.remindAt) <= now.getTime());
}

// ---------------------------------------------------------------------------
// 初期テンプレート（追加依頼 §16。ユーザーが編集して自分の言葉にする前提）

export interface MemoTemplate {
  key: string;
  title: string;
  body: string;
  triggers: FutureMemoTrigger[];
}

export const MEMO_TEMPLATES: MemoTemplate[] = [
  {
    key: 'self_blame',
    title: '全部自分が悪いと思った時',
    body: 'また全部自分が悪いと思っているかもしれない。\nまず今回の事実だけを確認しよう。\n自分の改善点は受け止める。\nでも、相手の強い言葉や人格否定まで、自分の責任にしなくていい。',
    triggers: [{ type: 'sadness' }, { type: 'confusion' }, { type: 'strong_language' }],
  },
  {
    key: 'other_blame',
    title: '相手を全部悪いと思った時',
    body: '今は相手を全部悪い人だと思っているかもしれない。\n一件の出来事と、相手の人格全体は分けよう。\n良かった出来事や修復行動も確認しよう。\nただし、問題のある行動を無理に正当化する必要もない。',
    triggers: [{ type: 'anger' }, { type: 'data_bias_warning' }, { type: 'many_other_party_issues' }],
  },
  {
    key: 'win_argument',
    title: '論破したくなった時',
    body: '論破しても、相手が気づくとは限らない。\n自分が本当に欲しいのは、勝つことではなく、事実を共有し、同じことを繰り返さないこと。\n今は送らず、明日もう一度読もう。',
    triggers: [{ type: 'anger' }, { type: 'late_night' }],
  },
  {
    key: 'divorce_decision',
    title: '離婚をすぐ決めたくなった時',
    body: '感情が最も強い時に、人生の大きな結論を出さない。\n緊急の危険がないなら、まず寝て、記録を見返し、信頼できる人へ相談しよう。\n一件ではなく、長期的なパターンで考えよう。',
    triggers: [{ type: 'divorce_keyword' }, { type: 'late_night' }],
  },
  {
    key: 'child_fear',
    title: '子どものことが怖くなった時',
    body: '子どもと一緒にいたいという気持ちは、自分にとってとても大事。\nだからこそ、恐怖だけで判断せず、子どもの前で何が起きているか、日々どんな関わりをしているかを記録しよう。\n今できる子どもとの時間を大切にしよう。',
    triggers: [{ type: 'anxiety' }, { type: 'divorce_keyword' }],
  },
];
