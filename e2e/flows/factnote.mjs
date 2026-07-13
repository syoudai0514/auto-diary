/**
 * 事実ノートのP0コアループ:
 * 文章入力 → 補足情報 → AI分析（モック）→ 分析結果の全セクション表示
 * → 日記生成（モック）→ 編集・保存 → 詳細タブ → JSONエクスポート → 削除 → 一覧が空。
 */
const sampleAnalysis = {
  conciseView:
    '荷物の受け取りを忘れた点は、あなたのミスです。ただし「いつも」という一般化は今回の事実からは確認できません。',
  verifiedFacts: [{ id: 'vf1', text: '受け取りを忘れ、その場で謝罪した', confidence: 'high', evidenceIds: [] }],
  userClaims: [{ id: 'uc1', text: '仕事の電話が原因だと認識している', confidence: 'medium', evidenceIds: [] }],
  aiInferences: [{ id: 'ai1', text: '不満が今回の一件に重なった可能性', confidence: 'low', evidenceIds: [] }],
  unknowns: [{ id: 'uk1', text: '過去の忘れ事の実際の回数', confidence: 'low', evidenceIds: [] }],
  userImprovementPoints: [
    { id: 'ui1', text: '受け取りを了承した時点でリマインダーを設定する', confidence: 'high', evidenceIds: [] },
  ],
  otherPartyProblemPoints: [
    { id: 'op1', text: '一件のミスを「いつも」と一般化した', confidence: 'high', evidenceIds: [] },
  ],
  balancedConclusion: 'ミスの訂正と表現の適切さは別の論点として扱うのが妥当です。',
  nextActions: ['依頼を受けた瞬間にリマインダーを登録する'],
  replySuggestions: {
    gentle: '荷物の件、忘れてしまってごめん。',
    standard: '次からはリマインダーを設定します。',
    firm: '「いつも」とまとめられるのは受け入れられません。',
  },
  responsibilityBreakdown: [
    { id: 'rb1', topic: '荷物の受け取りを忘れた', userSide: '改善が必要', judgment: 'user_improvement' },
  ],
  detectedPatterns: [
    {
      id: 'dp1',
      type: 'generalization',
      label: '一般化表現',
      description: '「いつも」という一般化表現が使われた',
      evidenceIds: [],
      confidence: 'high',
    },
  ],
  positiveActions: [],
  repairActions: [],
  safetyFlags: [],
  aiModel: 'e2e-mock',
  promptVersion: 'v1',
  generatedAt: '2026-07-13T00:00:00.000Z',
};

const sampleResult = {
  analysis: sampleAnalysis,
  title: '荷物の受け取りを忘れた',
  isPositiveEvent: false,
  isConflict: true,
  isRepairAction: false,
};

export async function run({ base, invite, newPage }) {
  const page = await newPage();

  let analyzeBody = null;
  await page.route('**/api/factnote/analyze', (route) => {
    analyzeBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: sampleResult }),
    });
  });
  let diaryBody = null;
  await page.route('**/api/factnote/diary', (route) => {
    diaryBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        diary: { title: '荷物の受け取りを忘れた日', body: '夕方、荷物の受け取りを忘れていたことが分かった。' },
      }),
    });
  });

  // --- サインアップして事実ノートのホームへ ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'factnote99');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  await page.goto(`${base}/factnote`);
  await page.waitForSelector('text=まだ記録がありません', { timeout: 10000 });
  console.log('  OK: factnote home shown (empty)');

  // --- 文章入力 → 補足情報 ---
  await page.click('text=文章で入力');
  await page.waitForSelector('textarea[aria-label="出来事の内容"]', { timeout: 10000 });
  await page.fill(
    'textarea[aria-label="出来事の内容"]',
    '頼まれていた荷物の受け取りを忘れた。「いつもそう」と言われて苦しかった。',
  );
  await page.click('button:has-text("次へ（補足情報）")');

  await page.waitForSelector('text=分かる項目だけで大丈夫です', { timeout: 5000 });
  await page.click('button:text-is("自宅")');
  await page.click('button:text-is("配偶者")');
  await page.click('button:text-is("いなかった")');
  await page.click('button:text-is("落胆")');
  console.log('  OK: supplement chips selected');

  // --- 分析 → 結果画面の全セクション ---
  await page.click('button:has-text("AIで分析する")');
  await page.waitForSelector('text=次回の具体的対応', { timeout: 15000 });
  for (const text of [
    'あなたのミスです',
    '確認できる事実',
    'ユーザー本人の認識',
    'AIによる推測',
    '不明・確認できない点',
    '自分側の改善点',
    '相手側の問題点',
    '論点別の責任整理',
    'バランスの取れた結論',
    '相手へ伝える短文',
    'やわらかい',
    '境界線を明確にする',
    '一般化表現',
  ]) {
    if ((await page.locator(`text=${text}`).count()) === 0) {
      throw new Error(`FAIL: analysis result missing: ${text}`);
    }
  }
  console.log('  OK: all analysis sections rendered');

  if (!analyzeBody) throw new Error('FAIL: /api/factnote/analyze was never called');
  if (!analyzeBody.sourceText.includes('荷物の受け取りを忘れた')) {
    throw new Error('FAIL: sourceText not sent correctly');
  }
  if (analyzeBody.context?.location !== '自宅' || analyzeBody.context?.childrenPresent !== 'いなかった') {
    throw new Error(`FAIL: context not sent correctly: ${JSON.stringify(analyzeBody.context)}`);
  }
  console.log('  OK: analyze payload shape verified');

  // --- 日記生成 → 編集 → 保存 → 詳細 ---
  await page.click('button:has-text("日記を作成")');
  await page.waitForSelector('text=日記のモードを選ぶ', { timeout: 5000 });
  await page.click('button:has-text("事実記録")');
  await page.waitForSelector('input[aria-label="日記のタイトル"]', { timeout: 15000 });
  if (!diaryBody || diaryBody.mode !== 'factual') {
    throw new Error(`FAIL: diary payload wrong: ${JSON.stringify(diaryBody)}`);
  }
  await page.fill('input[aria-label="日記のタイトル"]', '荷物の受け取りを忘れた日（編集済み）');
  await page.click('button:has-text("保存する")');
  await page.waitForURL('**/factnote/records/*', { timeout: 10000 });
  console.log('  OK: diary generated, edited and saved');

  // --- 詳細タブ（分析・日記・原本の分離表示） ---
  await page.waitForSelector('text=あなたのミスです', { timeout: 10000 });
  await page.click('[role="tab"]:has-text("日記")');
  await page.waitForSelector('text=荷物の受け取りを忘れた日（編集済み）', { timeout: 5000 });
  await page.waitForSelector('text=ユーザー編集済み', { timeout: 5000 });
  await page.click('[role="tab"]:has-text("原本")');
  await page.waitForSelector('text=「いつもそう」と言われて苦しかった', { timeout: 5000 });
  console.log('  OK: record detail tabs show analysis / diary / source separately');

  const detailUrl = page.url();

  // --- 一覧に反映 ---
  await page.goto(`${base}/factnote/records`);
  await page.waitForSelector('text=荷物の受け取りを忘れた', { timeout: 10000 });
  await page.waitForSelector('text=分析済み', { timeout: 5000 });
  console.log('  OK: record appears in list with analyzed badge');

  // --- JSONエクスポート ---
  await page.goto(`${base}/factnote/settings`);
  await page.click('text=すべての記録をJSONでエクスポート');
  await page.waitForSelector('text=1件の記録をエクスポートしました', { timeout: 10000 });
  console.log('  OK: JSON export works');

  // --- 削除（ゴミ箱へ移動）→ 一覧が空 ---
  await page.goto(detailUrl);
  await page.waitForSelector('text=この記録を削除', { timeout: 10000 });
  await page.click('text=この記録を削除');
  await page.waitForSelector('text=30日以内なら復元できます', { timeout: 5000 });
  await page.click('button:has-text("ゴミ箱へ移動")');
  await page.waitForURL('**/factnote/records', { timeout: 10000 });
  await page.waitForSelector('text=まだ記録がありません', { timeout: 5000 });
  console.log('  OK: delete moves record to trash and list is empty');

  await page.context().close();
}
