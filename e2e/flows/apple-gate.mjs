/**
 * Appleジャーナル連携ゲートのフロー:
 * 既定でオフ → 保存先一覧に出ない → 手順の開閉 → オンにすると出る →
 * リロードで永続 → オフに戻すと結果画面のチップ・保存先シートからも消える。
 */
export async function run({ base, invite, newPage, audioFile }) {
  const page = await newPage();

  // --- サインアップ ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'hanako456');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  // --- 設定画面: スイッチは既定オフ、保存先一覧にも出ない ---
  await page.goto(`${base}/settings`);
  const toggle = page.locator('button[aria-label="Appleジャーナル連携を有効にする"]');
  await toggle.waitFor({ timeout: 5000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'false') {
    throw new Error('FAIL: Apple journal toggle should default to OFF');
  }
  const hiddenCount = await page
    .locator('text=標準の保存先')
    .locator('..')
    .locator('text=Appleジャーナル')
    .count();
  if (hiddenCount !== 0) throw new Error('FAIL: Appleジャーナル should be hidden while disabled');
  console.log('  OK: defaults to OFF and hidden from save targets');

  // --- 手順の開閉 → 有効化 → 一覧に出る → リロードで永続 ---
  await page.click('text=準備の手順を見る');
  await page.waitForSelector('text=ショートカット」アプリを開く', { timeout: 3000 });
  await toggle.click();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    throw new Error('FAIL: toggle did not turn on');
  }
  const visibleCount = await page
    .locator('text=標準の保存先')
    .locator('..')
    .locator('text=Appleジャーナル')
    .count();
  if (visibleCount === 0) throw new Error('FAIL: Appleジャーナル should appear once enabled');
  await page.reload();
  if (
    (await page
      .locator('button[aria-label="Appleジャーナル連携を有効にする"]')
      .getAttribute('aria-checked')) !== 'true'
  ) {
    throw new Error('FAIL: toggle state not persisted');
  }
  console.log('  OK: enable flow + persistence works');

  // --- オフに戻して、結果画面のチップ・保存先シートから消えることを確認 ---
  await page.locator('button[aria-label="Appleジャーナル連携を有効にする"]').click();

  const sampleDiary = {
    title: 'テストの日記',
    body: 'これはテストです。',
    facts: [],
    feelings: [],
    interpretations: [],
    nextActions: [],
    tags: [],
    rawTranscript: 'これはテストです。',
  };
  await page.route('**/api/transcribe', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'これはテストです。' }),
    }),
  );
  await page.route('**/api/generate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ diary: sampleDiary }),
    }),
  );

  await page.goto(`${base}/`);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=音声ファイルをアップロード'),
  ]);
  await chooser.setFiles([audioFile]);
  await page.waitForSelector('text=音声ファイルから作る', { timeout: 5000 });
  await page.click('text=文字起こしして日記にする');
  await page.waitForFunction(
    () => (document.querySelector('input[aria-label="日記タイトル"]')?.value ?? '') === 'テストの日記',
    { timeout: 15000 },
  );

  if ((await page.locator('text=Appleジャーナル').count()) !== 0) {
    throw new Error('FAIL: Appleジャーナル chip should be hidden while disabled');
  }
  await page.click('text=保存する');
  await page.waitForSelector('text=保存先を選ぶ', { timeout: 5000 });
  if ((await page.locator('text=Appleジャーナルに保存').count()) !== 0) {
    throw new Error('FAIL: SaveSheet should not offer Appleジャーナル while disabled');
  }
  console.log('  OK: chip and SaveSheet respect the gate');

  await page.context().close();
}
