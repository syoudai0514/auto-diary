/**
 * 事実ノートの画面ロック（PIN）:
 * 設定でPINを登録 → リロードでロック画面 → 誤PINでエラー → 正しいPINで解除。
 * 生体認証（WebAuthn）はヘッドレス環境では検証できないためPINのみを対象にする。
 */
export async function run({ base, invite, newPage }) {
  const page = await newPage();

  // --- サインアップ ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'locker88');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });

  // --- 設定でPINを登録 ---
  await page.goto(`${base}/factnote/settings`);
  await page.waitForSelector('text=画面ロック（PIN・生体認証）', { timeout: 10000 });
  await page.fill('input[aria-label="新しいPIN"]', '1234');
  await page.fill('input[aria-label="新しいPIN（確認）"]', '1234');
  await page.click('button:has-text("PINを設定")');
  await page.waitForSelector('text=PINを設定しました', { timeout: 10000 });
  console.log('  OK: PIN registered');

  // --- リロードでロック画面が出る（中身は隠れる） ---
  await page.reload();
  await page.waitForSelector('text=PINを入力して解除してください', { timeout: 10000 });
  if ((await page.locator('text=画面ロック（PIN・生体認証）').count()) !== 0) {
    throw new Error('FAIL: settings content visible while locked');
  }
  console.log('  OK: lock screen shown after reload');

  // --- 誤ったPIN → エラー ---
  for (const d of ['9', '9', '9', '9']) await page.click(`button:text-is("${d}")`);
  await page.click('button:has-text("解除")');
  await page.waitForSelector('text=PINが違います', { timeout: 5000 });
  console.log('  OK: wrong PIN rejected');

  // --- 正しいPIN → 解除 ---
  for (const d of ['1', '2', '3', '4']) await page.click(`button:text-is("${d}")`);
  await page.click('button:has-text("解除")');
  await page.waitForSelector('text=画面ロック（PIN・生体認証）', { timeout: 10000 });
  console.log('  OK: correct PIN unlocks');

  await page.context().close();
}
