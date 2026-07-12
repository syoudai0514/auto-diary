/**
 * ふたりの話し合い分析フロー:
 * ホームの導線 → 同意付き導入画面 → 音声ファイル選択 → 話者付き文字起こし（モック）
 * → 話者指定 → 分析（モック）→ 結果画面の全セクション表示 → 全文コピー。
 */
const sampleAnalysis = {
  title: '家事分担についての話し合い',
  summary: '夕食後の片付けを巡って意見がぶつかった。',
  topics: ['家事分担'],
  sideA: {
    label: '私',
    claims: ['仕事で疲れていて余裕がない'],
    feelings: ['疲労'],
    needs: ['休息を認めてほしい'],
  },
  sideB: {
    label: '妻',
    claims: ['自分ばかり片付けている'],
    feelings: ['不公平感'],
    needs: ['負担を分かち合いたい'],
  },
  misunderstandings: [
    {
      point: '「後でやる」の解釈',
      aView: '今日中にやるつもりだった',
      bView: 'やる気がないように聞こえた',
      explanation: '期限を言わなかったことで放置に受け取られた。',
    },
  ],
  verdict: {
    overall: '片付けの負担が偏っている点で妻の主張がより妥当。',
    leansToward: 'B',
    behaviorsA: [{ behavior: '後でやると言って時期を示さなかった', assessment: '不信感を強めた' }],
    behaviorsB: [{ behavior: '不満を一度にぶつけた', assessment: '本題が伝わりにくくなった' }],
  },
  adviceA: ['時刻で約束する'],
  adviceB: ['不満はその日のうちに1件ずつ'],
  commonGround: ['家庭を居心地よくしたい'],
  reconciliationScript: [{ speaker: '私', line: '任せきりにしてごめん。' }],
  safetyNote: '',
};

export async function run({ base, invite, newPage, audioFile }) {
  const page = await newPage();

  await page.route('**/api/talk/transcribe', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'A: 片付けしてよ\nB: 後でやるって言ったじゃん' }),
    }),
  );
  let analyzeBody = null;
  await page.route('**/api/talk/analyze', (route) => {
    analyzeBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ analysis: sampleAnalysis }),
    });
  });

  // --- サインアップしてホームへ ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'talker999');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  // --- ホームの導線から /analyze へ ---
  await page.click('text=ふたりの話し合いを分析');
  await page.waitForURL(`${base}/analyze`, { timeout: 5000 });
  await page.waitForSelector('text=相手の同意を得てから', { timeout: 5000 });
  console.log('  OK: intro screen with consent notice shown');

  // --- 音声ファイルを選ぶ → 文字起こし → 話者指定画面 ---
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=録音済みの音声ファイルを選ぶ'),
  ]);
  await chooser.setFiles([audioFile]);
  await page.waitForSelector('text=話した人を教えてください', { timeout: 15000 });
  await page.waitForSelector('text=A: 片付けしてよ', { timeout: 5000 });
  console.log('  OK: diarized transcript preview shown');

  // --- 話者を指定して分析 ---
  await page.fill('input[aria-label="話者Aの名前"]', '私');
  await page.fill('input[aria-label="話者Bの名前"]', '妻');
  await page.click('button:has-text("分析する")');

  // --- 結果画面の全セクション検証 ---
  await page.waitForSelector('text=率直な判定', { timeout: 10000 });
  for (const text of [
    '妻の主張がより妥当',
    '片付けの負担が偏っている点で妻の主張がより妥当。',
    'それぞれの言い分',
    'すれ違いポイント',
    'ふたりに共通する願い',
    '仲直りの会話例',
    '任せきりにしてごめん。',
    'この分析はどこにも保存されません',
  ]) {
    if ((await page.locator(`text=${text}`).count()) === 0) {
      throw new Error(`FAIL: result screen missing: ${text}`);
    }
  }
  console.log('  OK: all result sections rendered (verdict/sides/misunderstandings/repair)');

  // --- ペイロード検証 ---
  if (!analyzeBody) throw new Error('FAIL: /api/talk/analyze was never called');
  if (analyzeBody.speakerA !== '私' || analyzeBody.speakerB !== '妻') {
    throw new Error(`FAIL: speakers not sent correctly: ${JSON.stringify(analyzeBody)}`);
  }
  if (!analyzeBody.transcript.includes('A: 片付けしてよ')) {
    throw new Error('FAIL: transcript not sent correctly');
  }
  console.log('  OK: analyze payload shape verified');

  // --- 全文コピー ---
  await page.click('text=全文コピー');
  await page.waitForSelector('text=全文をコピーしました', { timeout: 5000 });
  console.log('  OK: copy-all works');

  await page.context().close();
}
