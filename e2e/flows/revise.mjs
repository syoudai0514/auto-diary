/**
 * 日記生成〜修正依頼フロー:
 * 音声アップロード → 文字起こし → 生成（AI応答はモック）→ 結果画面 →
 * 「修正を依頼」でテキスト指示 → 日記が置き換わる → 成功トースト。
 * Gemini API自体はpage.routeでモックし、UI配線とペイロード形状を検証する。
 */
export async function run({ base, invite, newPage, audioFile }) {
  const page = await newPage();

  const sampleDiary = {
    title: '元のタイトル',
    body: '元の本文です。散歩に行った。',
    facts: ['散歩した'],
    feelings: ['楽しかった'],
    interpretations: [],
    nextActions: [],
    tags: ['散歩'],
    rawTranscript: '今日は散歩に行きました。',
  };
  const revisedDiary = {
    ...sampleDiary,
    title: '修正後のタイトル',
    body: 'もっとカジュアルにした本文です。',
    tags: ['散歩', '追加タグ'],
  };

  await page.route('**/api/transcribe', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: '今日は散歩に行きました。' }),
    }),
  );
  await page.route('**/api/generate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ diary: sampleDiary }),
    }),
  );
  let reviseRequestBody = null;
  await page.route('**/api/diary/revise', (route) => {
    reviseRequestBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ diary: revisedDiary }),
    });
  });

  // --- サインアップして入る ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'revise789');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  // --- 音声ファイルから結果画面へ ---
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=音声ファイルをアップロード'),
  ]);
  await chooser.setFiles([audioFile]);
  await page.waitForSelector('text=音声ファイルから作る', { timeout: 5000 });
  await page.click('text=文字起こしして日記にする');
  await page.waitForFunction(
    () => (document.querySelector('input[aria-label="日記タイトル"]')?.value ?? '') === '元のタイトル',
    { timeout: 15000 },
  );
  console.log('  OK: reached result screen with generated diary');

  // --- 修正を依頼（テキスト） ---
  await page.click('text=修正を依頼');
  await page.waitForSelector('text=どう直したいか教えてください', { timeout: 5000 });
  await page.fill(
    'textarea[placeholder="修正内容を入力するか、マイクで話してください"]',
    'もっとカジュアルな文体にして',
  );
  await page.click('button:has-text("この内容で修正する")');
  await page.waitForFunction(
    () => (document.querySelector('input[aria-label="日記タイトル"]')?.value ?? '') === '修正後のタイトル',
    { timeout: 10000 },
  );
  await page.waitForSelector('text=修正しました', { timeout: 3000 });
  console.log('  OK: diary revised in place with success toast');

  // --- ペイロード形状の検証 ---
  if (!reviseRequestBody) throw new Error('FAIL: /api/diary/revise was never called');
  if (reviseRequestBody.instruction !== 'もっとカジュアルな文体にして') {
    throw new Error(`FAIL: instruction mismatch: ${reviseRequestBody.instruction}`);
  }
  if (reviseRequestBody.currentDiary?.title !== '元のタイトル') {
    throw new Error('FAIL: currentDiary not sent correctly');
  }
  if (reviseRequestBody.transcript !== '今日は散歩に行きました。') {
    throw new Error(`FAIL: transcript mismatch: ${reviseRequestBody.transcript}`);
  }
  console.log('  OK: revise payload shape verified');

  // パネルは成功後に閉じる / 空指示では送信ボタン無効
  const panelStillOpen = await page
    .locator('text=どう直したいか教えてください')
    .isVisible()
    .catch(() => false);
  if (panelStillOpen) throw new Error('FAIL: revise panel should close after success');
  await page.click('text=修正を依頼');
  await page.waitForSelector('text=どう直したいか教えてください', { timeout: 5000 });
  if (await page.locator('button:has-text("この内容で修正する")').isEnabled()) {
    throw new Error('FAIL: submit should be disabled with empty instruction');
  }
  console.log('  OK: panel close/disable behaviors correct');

  await page.context().close();
}
