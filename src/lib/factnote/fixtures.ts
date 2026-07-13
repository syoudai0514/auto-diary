import {
  FACTNOTE_SCHEMA_VERSION,
  type AnalysisItem,
  type ConfidenceLevel,
  type DiaryMode,
  type IncidentAnalysis,
  type IncidentRecord,
} from './types';

/**
 * モックAI応答とサンプルデータの共通ビルダー（実在の人物を含まない架空データ）。
 * サーバー（AI_MOCK=1 のAPIルート）とクライアント（サンプルデータ投入）の
 * 両方から使うため 'use client' を付けない。
 */

export const MOCK_AI_MODEL = 'mock';

function item(
  id: string,
  text: string,
  confidence: ConfidenceLevel = 'medium',
  evidenceIds: string[] = [],
): AnalysisItem {
  return { id, text, confidence, evidenceIds };
}

/** モック・サンプル共用の文字起こし。 */
export const MOCK_TRANSCRIPT = [
  'A: 今日、荷物の受け取りお願いしてたよね。なんで忘れるの。',
  'B: ごめん、仕事の電話が長引いて、そのまま忘れてた。',
  'A: いつもそう。全部わたしがやることになる。',
  'B: いつもではないと思うけど……ごめん、今回は自分のミス。',
  '[聞き取れず]',
  'A: もういい。',
].join('\n');

/**
 * 「荷物の受け取りを忘れた」出来事のフル分析（依頼書 §12 の全セクションを網羅）。
 * AI_MOCK=1 の分析ルートとサンプルデータの両方で使う。
 */
export function buildMockAnalysis(overrides?: Partial<IncidentAnalysis>): IncidentAnalysis {
  return {
    conciseView:
      '荷物の受け取りを忘れた点は、あなたのミスです。ただし「いつも」「全部」という一般化は今回の事実からは確認できず、一件のミスと日頃の分担への評価は分けて考える必要があります。',

    verifiedFacts: [
      item('vf1', 'ユーザーが荷物の受け取りを依頼されていた', 'high', ['ev1']),
      item('vf2', 'ユーザーは受け取りを忘れ、その場で謝罪した', 'high', ['ev1']),
      item('vf3', '相手が「いつもそう」「全部わたしがやることになる」と発言した', 'high', ['ev1']),
    ],
    userClaims: [item('uc1', '仕事の電話が長引いたことが忘れた原因だとユーザーは認識している', 'medium', [])],
    aiInferences: [
      item('ai1', '相手は繰り返しへの不満を今回の一件に重ねて表現した可能性がある', 'low', []),
    ],
    unknowns: [
      item('uk1', '過去に同様の忘れ事が実際に何回あったか', 'low', []),
      item('uk2', '依頼時にリマインドの合意があったか', 'low', []),
    ],

    userImprovementPoints: [
      item('ui1', '受け取りを了承した時点でリマインダーを設定する', 'high', []),
    ],
    otherPartyProblemPoints: [
      item('op1', '一件のミスを「いつも」「全部」と一般化して表現した', 'high', ['ev1']),
    ],

    balancedConclusion:
      '受け取り忘れはユーザー側に明確な改善点があります。一方で、一件のミスを全体化する表現は事実に基づく指摘とは言えません。ミスの訂正と、表現の適切さは別の論点として扱うのが妥当です。',

    nextActions: [
      '依頼を受けた瞬間にリマインダーを登録する',
      '「いつも」と言われたら、今回の一件に限定して話すことを提案する',
    ],

    replySuggestions: {
      gentle:
        '荷物の件、忘れてしまってごめん。頼んでくれていたのに嫌な思いをさせたと思う。次からは頼まれたその場でリマインダーを入れるようにする。',
      standard:
        '受け取りを忘れたのは自分のミスなので、次からは頼まれた時点でリマインダーを設定します。ただ「いつも全部」と言われると話が広がってしまうので、今回の件として話せると助かります。',
      firm: '忘れたことは謝ります。ただ、一件のミスを「いつも」とまとめられるのは受け入れられません。',
    },

    responsibilityBreakdown: [
      {
        id: 'rb1',
        topic: '荷物の受け取りを忘れた',
        userSide: '改善が必要',
        otherSide: undefined,
        judgment: 'user_improvement',
      },
      {
        id: 'rb2',
        topic: '「いつも」「全部」という一般化表現',
        userSide: undefined,
        otherSide: '改善が必要',
        judgment: 'other_improvement',
      },
      {
        id: 'rb3',
        topic: '再発防止の仕組み',
        userSide: '通知設定',
        otherSide: '受け取り可能な時間を共有',
        judgment: 'shared_improvement',
      },
    ],

    detectedPatterns: [
      {
        id: 'dp1',
        type: 'generalization',
        label: '一般化表現',
        description: '「いつも」「全部」という一般化表現が使われた',
        evidenceIds: ['ev1'],
        confidence: 'high',
      },
      {
        id: 'dp2',
        type: 'forgotten_promise',
        label: '約束忘れ',
        description: '口頭依頼のみで管理し、受け取りを忘れた',
        evidenceIds: ['ev1'],
        confidence: 'high',
      },
    ],
    positiveActions: [],
    repairActions: [item('rp1', 'ユーザーはその場で自分のミスを認めて謝罪した', 'high', ['ev1'])],

    safetyFlags: [],

    aiModel: MOCK_AI_MODEL,
    promptVersion: 'mock-v1',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** AI_MOCK=1 の分析ルートが返す結果（分析 + タイトル + 分類フラグ）。 */
export function buildMockAnalyzeResult() {
  return {
    analysis: buildMockAnalysis(),
    title: '荷物の受け取りを忘れた',
    isPositiveEvent: false,
    isConflict: true,
    isRepairAction: false,
  };
}

/** モック日記（モード別の固定文面）。 */
export function buildMockDiary(mode: DiaryMode): { title: string; body: string } {
  const bodies: Record<DiaryMode, { title: string; body: string }> = {
    factual: {
      title: '荷物の受け取りを忘れた日',
      body: '夕方、頼まれていた荷物の受け取りを忘れていたことが分かった。原因は仕事の電話が長引いたこと。その場で謝罪した。相手からは「いつもそう」という言葉があった。次からは依頼を受けた時点でリマインダーを設定する。',
    },
    emotional: {
      title: '責められて苦しかったけれど',
      body: '忘れた自分が悪いのは分かっている。それでも「いつも」「全部」と言われた時は、これまでやってきたことまで否定された気がして苦しかった。ミスはミスとして直す。ただ、全部を否定される言葉は受け止めすぎないでおきたい。',
    },
    family: {
      title: '荷物の受け取りの行き違い',
      body: '今日は荷物の受け取りのことで行き違いがあった。忘れてしまったのは私のミスで、すぐに謝った。お互い疲れている時間帯だったのも大きいと思う。次からはリマインダーで仕組みにして、同じことで揉めないようにしたい。',
    },
    short: {
      title: '受け取り忘れ',
      body: '荷物の受け取りを忘れて指摘された。ミスは認めて謝罪。次回からリマインダーを設定する。',
    },
    detailed: {
      title: '荷物の受け取りを忘れた件の記録',
      body: '18時頃、帰宅した相手から荷物の受け取りを忘れていたことを指摘された。依頼は今朝の口頭のみで、メモは取っていなかった。仕事の電話が長引き、そのまま失念した。指摘に対してその場で謝罪したが、相手からは「いつもそう」「全部わたしがやることになる」という言葉があった。忘れたこと自体は自分の改善点。一方で、一件のミスが全体への評価に広がった点は、今回の事実とは分けて考えたい。再発防止として、依頼を受けた瞬間にリマインダーを登録することにする。',
    },
  };
  return bodies[mode];
}

// ---------------------------------------------------------------------------
// サンプルデータ（依頼書 §33 の10件。実在人物なし）

export const SAMPLE_ID_PREFIX = 'sample-';

interface SampleSeed {
  key: string;
  daysAgo: number;
  title: string;
  sourceType: IncidentRecord['sourceType'];
  rawText: string;
  emotions: string[];
  childrenPresent?: IncidentRecord['childrenPresent'];
  isPositiveEvent?: boolean;
  isConflict?: boolean;
  isRepairAction?: boolean;
  location?: string;
  withFullAnalysis?: boolean;
}

const SAMPLE_SEEDS: SampleSeed[] = [
  {
    key: '1',
    daysAgo: 1,
    title: '荷物の受け取りを忘れた',
    sourceType: 'text',
    rawText:
      '頼まれていた荷物の受け取りを忘れた。仕事の電話が長引いてそのまま忘れてしまった。「いつもそう」「全部わたしがやることになる」と言われた。忘れたのは自分だけど、いつもと言われるのは苦しかった。',
    emotions: ['落胆', '混乱'],
    childrenPresent: 'no',
    isConflict: true,
    location: '自宅',
    withFullAnalysis: true,
  },
  {
    key: '2',
    daysAgo: 3,
    title: '冗談に対して強い言葉を言われた',
    sourceType: 'voice_recording',
    rawText: '',
    emotions: ['悲しい'],
    childrenPresent: 'unknown',
    isConflict: true,
    location: '自宅',
  },
  {
    key: '3',
    daysAgo: 5,
    title: '家事の担当について衝突した',
    sourceType: 'text',
    rawText:
      '洗濯物の取り込みがどちらの担当か曖昧で言い合いになった。担当が決まっていないことが原因だと思う。一覧にしようと提案したが、その場では話が流れた。',
    emotions: ['疲労'],
    childrenPresent: 'yes',
    isConflict: true,
    location: '自宅',
  },
  {
    key: '4',
    daysAgo: 7,
    title: '相手が帰りの運転を代わってくれた',
    sourceType: 'quick_memo',
    rawText:
      '昨日の言い合いのあと、今日の外出では相手がお酒を買って、帰りの運転を代わってくれた。言葉での謝罪はなかったが、埋め合わせだった可能性があると感じた。',
    emotions: ['安心'],
    childrenPresent: 'yes',
    isPositiveEvent: true,
    isRepairAction: true,
    location: '車',
  },
  {
    key: '5',
    daysAgo: 9,
    title: '家族で公園へ出かけた',
    sourceType: 'text',
    rawText: '午前中に家族で公園へ。子どもが遊具を気に入って、穏やかに過ごせた。帰りにアイスを買った。',
    emotions: ['嬉しい'],
    childrenPresent: 'yes',
    isPositiveEvent: true,
    location: '公園',
  },
  {
    key: '6',
    daysAgo: 11,
    title: '子どもの病院へ行った',
    sourceType: 'quick_memo',
    rawText: '子どもの発熱で小児科へ。自分が半休を取って対応した。夜には熱が下がって一安心。',
    emotions: ['不安', '安心'],
    childrenPresent: 'yes',
    location: '外出先',
  },
  {
    key: '7',
    daysAgo: 14,
    title: '生活費の追加支払いについて揉めた',
    sourceType: 'text',
    rawText:
      '今月の生活費の追加精算を伝えたら「また？」と言われて揉めた。金額の根拠は伝えたつもりだが、毎回言い出すタイミングで気まずくなる。決まった日に確認する運用にしたい。',
    emotions: ['怒り', '疲労'],
    childrenPresent: 'no',
    isConflict: true,
    location: '自宅',
  },
  {
    key: '8',
    daysAgo: 17,
    title: '相手が自分の勘違いを認めなかった',
    sourceType: 'text',
    rawText:
      'ゴミ袋を出しっぱなしにしたのは自分だと責められたが、実際には自分は触っていない。その可能性を伝えても「絶対あなた」と言われ、訂正や謝罪はなかった。',
    emotions: ['混乱', '怒り'],
    childrenPresent: 'unknown',
    isConflict: true,
    location: '自宅',
  },
  {
    key: '9',
    daysAgo: 19,
    title: 'お互いに穏やかに話せた',
    sourceType: 'text',
    rawText: '週末の予定について、お互い落ち着いて希望を出し合えた。先に時間を決めて話したのが良かった気がする。',
    emotions: ['安心'],
    childrenPresent: 'no',
    isPositiveEvent: true,
    location: '自宅',
  },
  {
    key: '10',
    daysAgo: 21,
    title: '記念日にプレゼントと手紙を渡した',
    sourceType: 'text',
    rawText: '記念日にプレゼントと手紙を渡した。相手は喜んでくれて、夜は家族で外食した。',
    emotions: ['嬉しい', '感謝'],
    childrenPresent: 'yes',
    isPositiveEvent: true,
    location: '店舗',
  },
];

/** サンプルレコード10件を組み立てる（依頼書 §33）。 */
export function buildSampleRecords(now: Date = new Date()): IncidentRecord[] {
  return SAMPLE_SEEDS.map((seed) => {
    const at = new Date(now.getTime() - seed.daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const analyzed = seed.withFullAnalysis === true;
    const record: IncidentRecord = {
      id: `${SAMPLE_ID_PREFIX}${seed.key}`,
      schemaVersion: FACTNOTE_SCHEMA_VERSION,
      createdAt: at,
      occurredAt: at,
      updatedAt: at,
      title: seed.title,
      sourceType: seed.sourceType,
      rawText: seed.rawText || undefined,
      transcript: seed.sourceType === 'voice_recording' ? MOCK_TRANSCRIPT : undefined,
      location: seed.location,
      people: [{ id: 'p1', displayName: '配偶者', relationship: '配偶者' }],
      childrenPresent: seed.childrenPresent,
      childImpactTags: seed.childrenPresent === 'yes' ? ['同席していた'] : [],
      emotions: seed.emotions,
      tags: [],
      attachments: [],
      evidenceItems: analyzed
        ? [
            {
              id: 'ev1',
              type: 'text',
              text: seed.rawText,
              sourceLabel: 'ユーザー入力',
              confidence: 'high',
            },
          ]
        : [],
      analysis: analyzed ? buildMockAnalysis({ generatedAt: at }) : undefined,
      diaryVersions: analyzed
        ? [
            {
              id: 'dv1',
              mode: 'factual',
              ...buildMockDiary('factual'),
              createdAt: at,
              editedByUser: false,
              aiModel: MOCK_AI_MODEL,
              promptVersion: 'mock-v1',
            },
          ]
        : [],
      status: analyzed ? 'ready' : 'draft',
      aiModel: analyzed ? MOCK_AI_MODEL : undefined,
      promptVersion: analyzed ? 'mock-v1' : undefined,
      isPositiveEvent: seed.isPositiveEvent,
      isConflict: seed.isConflict,
      isRepairAction: seed.isRepairAction,
    };
    return record;
  });
}

// ---------------------------------------------------------------------------
// 長期分析（客観カルテ / フラットチェック / 未来メモ）のモック

/** AI_MOCK=1 の客観カルテ講評。 */
export const MOCK_PROFILE_SUMMARY =
  '直近の記録では、家事・お金に関する衝突が複数記録されています。利用者側には予定忘れと口頭依頼のみで管理する課題が、相手側には一件の出来事を「いつも」「全部」と一般化する表現が記録されています。一方で、運転を代わるなど修復の可能性がある行動や、穏やかに話せた記録も存在します。記録件数がまだ少ないため、長期傾向として断定するには十分ではありません。';

/** AI_MOCK=1 のフラットチェック応答（AI生成部分）。 */
export function buildMockFlatCheckAiPart() {
  const item = (id: string, text: string, confidence: 'high' | 'medium' | 'low' = 'medium') => ({
    id,
    text,
    confidence,
    evidenceIds: [] as string[],
  });
  return {
    conciseConclusion:
      '今回、約束を忘れた点はあなたのミスです。一方で、その一件を理由に家事や育児全体を否定する表現は適切ではありません。今回の反省点と、相手の一般化表現は分けて考える必要があります。',
    userImprovementPoints: [item('fcu1', '受け取りを了承した時点で予定登録しなかった', 'high')],
    otherPartyProblemPoints: [item('fco1', '一件のミスを「いつも」と一般化した', 'high')],
    unknowns: [item('fcn1', '相手がどこまで本気で言ったか', 'low')],
    avoidJudgingFromThisIncident: [
      item('fca1', '相手の人格全体', 'high'),
      item('fca2', '離婚すべきかどうか', 'high'),
    ],
    improvingPoints: [item('fci1', '記録を残して事実を確認できるようになった', 'medium')],
    aiMessage:
      '今回は、受け取りを忘れたことだけを反省すれば十分です。それを理由に、家事や育児全体を否定される必要はありません。',
    aiModel: MOCK_AI_MODEL,
    promptVersion: 'mock-v1',
  };
}

/** AI_MOCK=1 の未来メモ下書き。 */
export function buildMockMemoDraft(): { title: string; body: string } {
  return {
    title: '全部自分が悪いと思った時',
    body: 'また全部自分が悪いと思っているかもしれない。\nまず今回の事実だけを確認しよう。\n自分の改善点は受け止める。\nでも、相手の強い言葉まで自分の責任にしなくていい。',
  };
}
