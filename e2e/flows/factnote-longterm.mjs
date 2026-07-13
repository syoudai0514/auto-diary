/**
 * 事実ノートの長期分析3機能:
 * サンプル投入 → 客観カルテ（人物自動抽出・期間切替・テーマ展開・AI講評モック）
 * → フラットチェック（範囲選択 → モックAI → 全セクション + 過去比較 + 偏り警告）
 * → 未来メモ（テンプレート作成 → 条件合致で記録保存直後に表示 → 記録へ固定）。
 */
const mockAnalyzeResult = {
  analysis: {
    conciseView: '荷物の受け取りを忘れた点は、あなたのミスです。',
    verifiedFacts: [{ id: 'vf1', text: '受け取りを忘れた', confidence: 'high', evidenceIds: [] }],
    userClaims: [],
    aiInferences: [],
    unknowns: [{ id: 'uk1', text: '過去の回数', confidence: 'low', evidenceIds: [] }],
    userImprovementPoints: [
      { id: 'ui1', text: 'リマインダーを設定する', confidence: 'high', evidenceIds: [] },
    ],
    otherPartyProblemPoints: [
      { id: 'op1', text: '「いつも」と一般化した', confidence: 'high', evidenceIds: [] },
    ],
    balancedConclusion: 'ミスと表現は別の論点です。',
    nextActions: ['リマインダーを登録する'],
    replySuggestions: { gentle: 'g', standard: 's', firm: 'f' },
    responsibilityBreakdown: [],
    detectedPatterns: [],
    positiveActions: [],
    repairActions: [],
    safetyFlags: [],
    aiModel: 'e2e-mock',
    promptVersion: 'v1',
    generatedAt: '2026-07-13T00:00:00.000Z',
  },
  title: '週末の言い合い',
  isPositiveEvent: false,
  isConflict: true,
  isRepairAction: false,
};

const mockFlatCheck = {
  conciseConclusion: '今回、約束を忘れた点はあなたのミスです。一方で一般化表現は適切ではありません。',
  userImprovementPoints: [
    { id: 'u1', text: '受け取りを了承した時点で予定登録しなかった', confidence: 'high', evidenceIds: [] },
  ],
  otherPartyProblemPoints: [
    { id: 'o1', text: '一件のミスを「いつも」と一般化した', confidence: 'high', evidenceIds: [] },
  ],
  unknowns: [{ id: 'n1', text: '相手がどこまで本気だったか', confidence: 'low', evidenceIds: [] }],
  avoidJudgingFromThisIncident: [
    { id: 'a1', text: '相手の人格全体', confidence: 'high', evidenceIds: [] },
  ],
  improvingPoints: [{ id: 'i1', text: '記録を残せるようになった', confidence: 'medium', evidenceIds: [] }],
  aiMessage: '今回は、受け取りを忘れたことだけを反省すれば十分です。',
  aiModel: 'e2e-mock',
  promptVersion: 'v1',
};

export async function run({ base, invite, newPage }) {
  const page = await newPage();

  await page.route('**/api/factnote/profile-summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: '直近の記録では家事とお金に関する衝突が中心ですが、良い外出や修復行動も記録されています。',
        aiModel: 'e2e-mock',
        promptVersion: 'v1',
      }),
    }),
  );
  let flatCheckBody = null;
  await page.route('**/api/factnote/flat-check', (route) => {
    flatCheckBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ check: mockFlatCheck }),
    });
  });
  await page.route('**/api/factnote/analyze', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: mockAnalyzeResult }),
    }),
  );

  // --- サインアップ → サンプルデータ投入 ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'longterm77');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  await page.goto(`${base}/factnote/settings`);
  await page.click('button:has-text("架空の10件を投入")');
  await page.waitForSelector('text=サンプルデータ10件を投入しました', { timeout: 10000 });
  console.log('  OK: sample data loaded');

  // --- 客観カルテ: 人物の自動抽出 → 人物カルテ ---
  await page.goto(`${base}/factnote/carte`);
  await page.waitForSelector('text=配偶者', { timeout: 10000 });
  console.log('  OK: person auto-extracted from records');

  await page.click('text=配偶者');
  await page.waitForURL('**/factnote/carte/*', { timeout: 5000 });
  await page.waitForSelector('text=サマリー', { timeout: 10000 });
  await page.waitForSelector('text=衝突した出来事', { timeout: 5000 });
  await page.waitForSelector('text=良い出来事', { timeout: 5000 });
  console.log('  OK: person carte shows local aggregation');

  // 期間切替（全期間）
  await page.click('button:has-text("全期間")');
  await page.waitForSelector('text=全期間・全', { timeout: 5000 });
  console.log('  OK: period switch works');

  // テーマ展開 → 記録リンク
  await page.click('button:has-text("約束・忘れ物")');
  await page.waitForSelector('a:has-text("荷物の受け取りを忘れた")', { timeout: 5000 });
  console.log('  OK: theme expands to matching records');

  // AI講評（モック）— 集計値のみ送信の注記
  await page.waitForSelector('text=記録の本文や名前は送信されません', { timeout: 5000 });
  await page.click('button:has-text("講評を生成する")');
  await page.waitForSelector('text=良い外出や修復行動も記録されています', { timeout: 10000 });
  console.log('  OK: AI summary generated (mock, stats only)');

  // --- フラットチェック ---
  await page.goto(`${base}/factnote/records`);
  await page.click('text=荷物の受け取りを忘れた');
  await page.waitForSelector('text=この出来事をフラットチェック', { timeout: 10000 });
  await page.click('text=この出来事をフラットチェック');
  await page.waitForSelector('text=比較する範囲を選んでください', { timeout: 10000 });
  await page.waitForSelector('text=過去の記録の本文は送信されません', { timeout: 5000 });
  await page.click('button:has-text("今回＋直近30日")');

  await page.waitForSelector('text=今回の自分側の改善点', { timeout: 15000 });
  for (const text of [
    '今回の相手側の問題点',
    '今回判断できないこと',
    '今回だけでは判断しない方がいいこと',
    '過去との比較',
    '良くなっている点',
    'AIからの一言',
    '受け取りを忘れたことだけを反省すれば十分',
  ]) {
    if ((await page.locator(`text=${text}`).count()) === 0) {
      throw new Error(`FAIL: flat check result missing: ${text}`);
    }
  }
  if (!flatCheckBody || typeof flatCheckBody.pastStats !== 'string') {
    throw new Error('FAIL: flat-check payload missing local pastStats');
  }
  console.log('  OK: flat check result with past comparison rendered');

  // --- 未来メモ: テンプレートから作成 ---
  await page.goto(`${base}/factnote/memos`);
  await page.click('text=新しいメモを作る');
  await page.waitForSelector('text=テンプレートから始める', { timeout: 10000 });
  await page.click('button:has-text("論破したくなった時")');
  await page.waitForSelector('input[aria-label="メモのタイトル"]', { timeout: 5000 });
  await page.click('button:has-text("保存する")');
  await page.waitForURL('**/factnote/memos', { timeout: 10000 });
  await page.waitForSelector('text=論破したくなった時', { timeout: 5000 });
  console.log('  OK: memo created from template');

  // --- 条件に合う記録を作成（怒り）→ 保存直後にメモが表示される ---
  await page.goto(`${base}/factnote/new?mode=text`);
  await page.fill(
    'textarea[aria-label="出来事の内容"]',
    '週末の予定について言い合いになった。言い返したくてたまらない。',
  );
  await page.click('button:has-text("次へ（補足情報）")');
  await page.waitForSelector('text=分かる項目だけで大丈夫です', { timeout: 5000 });
  await page.click('button:text-is("怒り")');
  await page.click('button:has-text("AIで分析する")');

  await page.waitForSelector('text=未来の自分から', { timeout: 15000 });
  await page.waitForSelector('text=これはAIの文章ではなく', { timeout: 5000 });
  console.log('  OK: future memo auto-displayed after emotional record (distinct from AI)');

  // --- 記録へ固定 → 詳細に表示 ---
  await page.click('button:has-text("この出来事に固定")');
  await page.click('button:has-text("保存して終了")');
  await page.waitForURL('**/factnote/records/*', { timeout: 10000 });
  await page.waitForSelector('text=未来の自分から（固定）', { timeout: 10000 });
  console.log('  OK: memo pinned to record and shown on detail');

  await page.context().close();
}
