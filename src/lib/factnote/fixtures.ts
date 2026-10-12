import { INCIDENT_ANALYSIS_PROMPT_VERSION } from './prompts/incidentAnalysis';
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
 * 「荷物の受け取りを忘れた」出来事のフル分析（依頼書 §12 の全セクション + v3 の判定を網羅）。
 * AI_MOCK=1 の分析ルートとサンプルデータの両方で使う。
 *
 * 判定の考え方の見本でもある: 発端（受け取り忘れ）の重さと、相手の反応（苛立ちからの
 * 一般化）の重さを同じ物差しで比べ、釣り合いを取らずに「自分側がやや重い」と言い切る。
 */
export function buildMockAnalysis(overrides?: Partial<IncidentAnalysis>): IncidentAnalysis {
  return {
    verdict: {
      leaning: 'user_more',
      headline: '今回は、頼まれていた受け取りを忘れたあなたの側の問題が主です。',
      reasoning:
        '発端は受け取り忘れ（中程度: 了承した約束を果たさなかった）。相手の「いつも」「全部」は一般化だが、ミスの直後の苛立ちから出た一言で、人格否定や存在否定には至っていない（軽微）。重さで比べると自分側がやや重い。',
      robustness: 'firm',
      whatWouldChange:
        '同じ忘れ事が実際に繰り返されていたなら「いつも」は誇張ではなく、相手の不満はより正当になる。逆に、相手が日常的に一般化で責めているなら相手側の課題が重くなる。',
      roleReversalCheck:
        '立場を入れ替え、相手が受け取りを忘れて自分が「いつもそう」と言った場合も、主な原因は忘れた側にあり、一言の誇張は軽微と判断する。判定は変わらない。',
    },
    conciseView:
      '今回は、頼まれていた受け取りを忘れたあなたの側の問題が主です。相手の「いつも」「全部」は一般化ですが、ミスの直後の苛立ちとしては軽微で、あなたの責任を薄めるものではありません。一方で、この一件だけで日頃の分担全体まで否定されたと受け取る必要もありません。',

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
      {
        ...item('ui1', '受け取りを了承した時点でリマインダーを設定せず、約束を果たさなかった', 'high', []),
        severity: 'moderate',
        basis: 'verified',
        suggestion: '頼まれたその場でスマホのリマインダーに登録し、「登録したよ」と一言返す',
      },
    ],
    otherPartyProblemPoints: [
      {
        ...item('op1', '一件のミスを「いつも」「全部」と一般化して表現した', 'high', ['ev1']),
        severity: 'minor',
        basis: 'verified',
        suggestion: '「いつも」ではなく「今日の受け取りを忘れたのは困った。次は気をつけてほしい」と、今回の件に限定して伝える',
      },
    ],

    balancedConclusion:
      '受け取り忘れ（発端）はユーザー側の課題で、今回の中心です。相手の一般化表現は事実としては確認できない誇張ですが、苛立ちの一言の範囲にとどまっており、発端の責任と同じ重さではありません。全体としては自分側に片寄った出来事です。',

    nextActions: [
      '依頼を受けた瞬間にリマインダーを登録する',
      '忘れた時は言い訳より先に「忘れた、ごめん。次は〇〇する」と再発防止策まで伝える',
    ],

    replySuggestions: {
      gentle:
        '荷物の件、忘れてしまってごめん。頼んでくれていたのに嫌な思いをさせたと思う。次からは頼まれたその場でリマインダーを入れるようにする。',
      standard:
        '受け取りを忘れたのは自分のミスです。ごめんなさい。次からは頼まれた時点でリマインダーを設定します。',
      firm: '',
    },

    responsibilityBreakdown: [
      {
        id: 'rb1',
        topic: '荷物の受け取りを忘れた（発端）',
        userSide: '了承した約束を果たさなかった',
        otherSide: undefined,
        judgment: 'user_improvement',
        severity: 'moderate',
        basis: 'verified',
      },
      {
        id: 'rb2',
        topic: '「いつも」「全部」という反応',
        userSide: undefined,
        otherSide: '一件を全体に広げた表現（苛立ちの範囲）',
        judgment: 'other_improvement',
        severity: 'minor',
        basis: 'verified',
      },
      {
        id: 'rb3',
        topic: '再発防止の仕組み',
        userSide: '通知設定',
        otherSide: '受け取り可能な時間を共有',
        judgment: 'shared_improvement',
        severity: 'minor',
        basis: 'inference',
      },
    ],

    detectedPatterns: [
      {
        id: 'dp1',
        type: 'generalization',
        actor: 'other',
        label: '一般化表現',
        description: '「いつも」「全部」という一般化表現が使われた',
        evidenceIds: ['ev1'],
        confidence: 'high',
      },
      {
        id: 'dp2',
        type: 'forgotten_promise',
        actor: 'user',
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
    promptVersion: `mock-${INCIDENT_ANALYSIS_PROMPT_VERSION}`,
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

/** モック日記（AIモード別の固定文面。verbatim はAIを使わないので対象外）。 */
export function buildMockDiary(mode: DiaryMode): { title: string; body: string } {
  const bodies: Record<Exclude<DiaryMode, 'verbatim'>, { title: string; body: string }> = {
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
  return mode === 'verbatim' ? bodies.factual : bodies[mode];
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
      promptVersion: analyzed ? `mock-${INCIDENT_ANALYSIS_PROMPT_VERSION}` : undefined,
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

/** AI_MOCK=1 の全体の見解（参照番号はダイジェストの #番号）。 */
export function buildMockOverallReviewPayload() {
  return {
    userRecurringIssues: [
      {
        text: '口頭で引き受けた予定や依頼を、記録や通知に残さずに忘れる',
        suggestion: '頼まれたその場でスマホのリマインダーに入れ、「入れたよ」と一言返す',
        severity: 'moderate' as const,
        count: 2,
        refs: [1],
      },
    ],
    otherRecurringIssues: [
      {
        text: '一件のミスを「いつも」「全部」と広げて表現する',
        suggestion: '「いつも」ではなく「今日の受け取りを忘れたのは困った」と、その日の件に限定して伝える',
        severity: 'minor' as const,
        count: 2,
        refs: [1],
      },
    ],
    strengths: ['ミスをその場で認めて謝る場面が記録されている', '記念日や外食など、家族で楽しく過ごせた日がある'],
    conflictTriggers: ['約束・依頼の忘れ', '疲れている時間帯の会話'],
    interactionCycle:
      'あなたが依頼を忘れる → 相手が「いつも」と過去までまとめて責める → あなたが「いつもではない」と反論し、話が今回の件から離れていく。忘れた直後に、あなたが言い訳より先に謝って再発防止策まで伝えると、この流れを最初で止められます。',
    childImpact: '',
    safetyConcerns: '',
    responsibilityReason:
      '記録上の衝突の多くは、自分側の約束忘れ（中程度）が発端で、相手側の課題は反応としての一般化（軽微）にとどまっています。',
    responsibilityTendency: 'user_heavier' as const,
    trendReason: '記録期間がまだ短く、増減の傾向を言える件数ではありません。',
    relationshipTrend: 'insufficient_data' as const,
    cannotJudge: ['穏やかだった日の記録が少ないため、関係全体の良し悪しは判断できません'],
    userFocus: ['引き受けた依頼は、その場でリマインダーに登録する'],
    requestsToOther: ['不満を伝える時は「いつも」ではなく今回の件として話してもらう'],
    overallView:
      '記録全体では、衝突の発端はあなたの側の約束忘れであることが多く、まず取り組むべきはそこです。相手の「いつも」「全部」という表現は誇張ですが、苛立ちの範囲にとどまっています。良い出来事も記録されており、関係が悪い方向へ進んでいると言える材料はありません。',
    closingMessage: '忘れない仕組みを一つ作るだけで、衝突の多くは減らせそうです。',
  };
}
