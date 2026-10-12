/**
 * 事実ノートの「全体の見解」:
 * サンプル投入 → 分析ハブから全体の見解へ → 判定基準の状態（最新/旧基準/未分析）
 * → まとめて再分析（モックAI・直列・進捗 → 完了・判定の変化一覧）
 * → 記録全体のかたち（判定の内訳・重さ・月ごとの推移）
 * → AIによる全体の見解（モック。本文を送らないこと・#番号→記録リンク）→ 記録詳細の判定カード。
 */

function analyzeResult(n) {
  // 呼ばれるたびに判定の向きを変え、内訳の集計を確かめられるようにする
  const leaning = n % 2 === 0 ? 'other_mainly' : 'user_more';
  return {
    analysis: {
      verdict: {
        leaning,
        headline: leaning === 'other_mainly' ? '今回は相手側の発言が最も重い問題です。' : '今回は自分側の問題が主です。',
        reasoning: '重さの比較による理由。',
        robustness: 'tentative',
        whatWouldChange: '条件。',
        roleReversalCheck: '入れ替えても同じ。',
      },
      conciseView: '見解。',
      verifiedFacts: [],
      userClaims: [],
      aiInferences: [],
      unknowns: [],
      userImprovementPoints:
        leaning === 'user_more'
          ? [{ id: 'u', text: '約束を忘れた', confidence: 'high', evidenceIds: [], severity: 'moderate', basis: 'user_claim' }]
          : [],
      otherPartyProblemPoints:
        leaning === 'other_mainly'
          ? [{ id: 'o', text: '存在を否定する言葉を使った', confidence: 'high', evidenceIds: [], severity: 'serious', basis: 'user_claim' }]
          : [],
      balancedConclusion: '論点ごとの結論。',
      nextActions: [],
      replySuggestions: { gentle: '', standard: '', firm: '' },
      responsibilityBreakdown: [],
      detectedPatterns: [],
      positiveActions: [],
      repairActions: [],
      safetyFlags: [],
      aiModel: 'e2e-mock',
      promptVersion: 'v4',
      generatedAt: '2026-10-01T00:00:00.000Z',
    },
    title: 'サンプル',
    isPositiveEvent: false,
    isConflict: true,
    isRepairAction: false,
  };
}

const overallReview = {
  userRecurringIssues: [
    { text: '引き受けた依頼を忘れる', suggestion: 'その場でリマインダーに登録する', severity: 'moderate', count: 2, refs: [1] },
  ],
  otherRecurringIssues: [
    {
      text: '存在を否定する強い言葉を使う',
      suggestion: '怒りが強い時は「今は話せない、30分後に話したい」と言って一度離れる',
      severity: 'serious',
      count: 3,
      refs: [2],
    },
  ],
  strengths: ['家族で外食を楽しめた日がある'],
  conflictTriggers: ['疲れている夜'],
  interactionCycle: '依頼を忘れる → 強い言葉で責める → 黙り込む、の流れが繰り返されています。強い言葉が出た時点で話し合いを中断すると断ち切れます。',
  childImpact: '',
  safetyConcerns: '',
  responsibilityReason: '相手側の重大な言動が繰り返し記録されている。',
  responsibilityTendency: 'other_heavier',
  trendReason: '記録期間が短い。',
  relationshipTrend: 'insufficient_data',
  cannotJudge: ['穏やかな日の記録が少ない'],
  userFocus: ['依頼はその場でリマインダーに入れる'],
  requestsToOther: ['存在を否定する言葉は使わないでほしいと伝える'],
  overallView: '記録全体では、相手側の存在を否定する言葉が最も重い問題として繰り返し記録されています。',
  closingMessage: '自分の課題は小さく具体的に、相手の重い言動ははっきりと扱いましょう。',
};

export async function run({ base, invite, newPage }) {
  const page = await newPage();

  let analyzeCalls = 0;
  await page.route('**/api/factnote/analyze', async (route) => {
    analyzeCalls++;
    const n = analyzeCalls;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: analyzeResult(n) }),
    });
  });
  let overallBody = null;
  await page.route('**/api/factnote/overall-review', (route) => {
    overallBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ review: overallReview, aiModel: 'e2e-mock', promptVersion: 'v1' }),
    });
  });

  // --- サインアップ → サンプルデータ投入 ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'overview55');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  await page.goto(`${base}/factnote/settings`);
  await page.click('button:has-text("架空の10件を投入")');
  await page.waitForSelector('text=サンプルデータ10件を投入しました', { timeout: 10000 });

  // --- 分析ハブ → 全体の見解 ---
  await page.goto(`${base}/factnote/insights`);
  await page.click('a:has-text("全体の見解")');
  await page.waitForURL('**/factnote/overview', { timeout: 10000 });
  await page.waitForSelector('text=判定基準の状態', { timeout: 10000 });
  await page.waitForSelector('text=記録全体のかたち', { timeout: 5000 });
  console.log('  OK: overview page reachable from insights hub');

  // --- まとめて再分析（未分析のサンプルが対象）---
  const startButton = page.locator('button:has-text("件をまとめて再分析")');
  const label = await startButton.innerText();
  const targetCount = Number(label.match(/(\d+)件/)?.[1] ?? 0);
  if (targetCount < 2) throw new Error(`FAIL: expected reanalysis targets, got "${label}"`);
  await startButton.click();
  await page.waitForSelector('text=再分析が完了しました', { timeout: 60000 });
  if (analyzeCalls !== targetCount) {
    throw new Error(`FAIL: analyze called ${analyzeCalls} times, expected ${targetCount}`);
  }
  await page.waitForSelector('text=判定が付いた・変わった記録', { timeout: 5000 });
  await page.click('button:has-text("閉じる")');
  await page.waitForSelector('text=すべての記録が最新の基準で分析されています', { timeout: 5000 });
  console.log(`  OK: bulk reanalysis ran ${targetCount} records sequentially and reported changes`);

  // --- 記録全体のかたち ---
  for (const text of ['衝突ごとの判定', '主に相手側の問題', '指摘された問題の重さ', '月ごとの推移']) {
    if ((await page.locator(`text=${text}`).count()) === 0) throw new Error(`FAIL: shape section missing: ${text}`);
  }
  console.log('  OK: leaning distribution / severity / monthly trend rendered');

  // --- AIによる全体の見解 ---
  await page.click('button:has-text("全体の見解を作成する")');
  await page.waitForSelector('text=相手側の課題が重い傾向', { timeout: 15000 });
  for (const text of ['自分側の繰り返しの課題', '相手側の繰り返しの課題', 'うまくいっていること', 'あなたが取り組むと効果が大きいこと', '相手が直した方がいいこと', '記録からは判断できないこと', '二人の間で繰り返されている流れ', '相手がこう直すとよい', '30分後に話したい']) {
    if ((await page.locator(`text=${text}`).count()) === 0) throw new Error(`FAIL: review section missing: ${text}`);
  }
  if (!overallBody || typeof overallBody.digest !== 'string' || !overallBody.digest.includes('#1')) {
    throw new Error('FAIL: digest not sent');
  }
  // サンプルの本文（原文）そのものは送らない
  if (overallBody.digest.includes('記念日にプレゼントと手紙を渡した。相手は喜んでくれて')) {
    throw new Error('FAIL: raw record text leaked into the overall review digest');
  }
  console.log('  OK: overall review generated from analysis digest (no raw text)');

  // 根拠の記録へ移動でき、記録詳細に判定カードが出る
  await page.locator('section:has-text("相手側の繰り返しの課題") a[href*="/factnote/records/"]').first().click();
  await page.waitForURL('**/factnote/records/*', { timeout: 10000 });
  await page.waitForSelector('text=今回の判定', { timeout: 10000 });
  console.log('  OK: recurring issue links to its evidence record with verdict card');

  // 保存されていて、再訪時にも表示される
  await page.goto(`${base}/factnote/overview`);
  await page.waitForSelector('text=相手側の課題が重い傾向', { timeout: 10000 });
  console.log('  OK: overall review persisted');

  await page.context().close();
}
