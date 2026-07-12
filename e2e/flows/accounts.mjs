/**
 * アカウント一連フロー:
 * 招待コード検証 → サインアップ → Gemini APIキー登録（暗号化保存・平文非表示）
 * → ログアウト → 再ログイン → 誤パスワード拒否 → 未認証リダイレクト。
 */
export async function run({ base, invite, newPage }) {
  const page = await newPage();

  // --- 1. 間違った招待コードでは登録できない ---
  await page.goto(`${base}/signup`);
  await page.fill('input[aria-label="ユーザー名"]', 'taro123');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.fill('input[aria-label="招待コード"]', 'wrong-code');
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForSelector('text=招待コードが違います', { timeout: 5000 });
  console.log('  OK: wrong invite code rejected');

  // --- 2. 正しい招待コードで新規登録 → ログイン状態でホームへ ---
  await page.fill('input[aria-label="招待コード"]', invite);
  await page.click('button:has-text("アカウントを作成")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });
  console.log('  OK: signup succeeded and landed on home');

  // --- 3. 設定画面: Gemini APIキーが未設定と表示される ---
  await page.goto(`${base}/settings`);
  await page.waitForSelector('text=未設定', { timeout: 5000 });
  console.log('  OK: settings shows Gemini key as unset');

  // --- 4. Gemini APIキーを保存する ---
  const plainKey = 'AIzaSyExampleKeyForE2eTestOnly123456';
  await page.fill('input[aria-label="Gemini APIキー"]', plainKey);
  await page.click('button:has-text("キーを保存")');
  await page.waitForSelector('text=保存しました', { timeout: 5000 });
  console.log('  OK: gemini key save succeeded');

  // リロード後も「設定済み」（サーバー側に永続化されている）
  await page.reload();
  await page.waitForSelector('text=設定済み', { timeout: 5000 });
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes(plainKey)) {
    throw new Error('FAIL: plaintext API key leaked into page content');
  }
  console.log('  OK: key persisted; plaintext never shown');

  // --- 5. ログアウト → 再ログイン（キーはアカウントに紐づく） ---
  await page.click('button:has-text("ログアウト")');
  await page.waitForURL(`${base}/login`, { timeout: 5000 });
  await page.fill('input[aria-label="ユーザー名"]', 'taro123');
  await page.fill('input[aria-label="パスワード"]', 'a-long-enough-password');
  await page.click('button:has-text("ログイン")');
  await page.waitForURL(`${base}/`, { timeout: 10000 });
  await page.goto(`${base}/settings`);
  await page.waitForSelector('text=設定済み', { timeout: 5000 });
  console.log('  OK: re-login works; key still set per-account');

  // --- 6. 間違ったパスワードは一律メッセージで拒否 ---
  await page.click('button:has-text("ログアウト")');
  await page.waitForURL(`${base}/login`, { timeout: 5000 });
  await page.fill('input[aria-label="ユーザー名"]', 'taro123');
  await page.fill('input[aria-label="パスワード"]', 'totally-wrong-password');
  await page.click('button:has-text("ログイン")');
  await page.waitForSelector('text=ユーザー名またはパスワードが違います', { timeout: 5000 });
  console.log('  OK: wrong password rejected');

  // --- 7. 未認証アクセスはログインへリダイレクト（middleware） ---
  await page.context().clearCookies();
  await page.goto(`${base}/settings`);
  await page.waitForURL(/\/login/, { timeout: 5000 });
  console.log('  OK: unauthenticated access redirects to /login');

  await page.context().close();
}
