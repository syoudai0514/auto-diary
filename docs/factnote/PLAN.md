# 事実ノート 実装計画（PLAN.md）

> 本書は `docs/FACTNOTE_REQUEST.md`（以下「依頼書」）§0.1 に基づく Phase 0 成果物。
> **会話履歴を読んでいないAIが、本書 + 依頼書だけで実装を完遂できること**を目的とする。
> 進捗の現在地は `docs/factnote/HANDOFF.md` を参照。

## 0. 全体方針（依頼書 §3 の確定事項）

- 同一リポジトリ内で開発。事実ノート固有コードは以下に隔離し、**既存アプリのページ・APIルートは一切変更しない**:
  - `src/app/factnote/` — ページ
  - `src/app/api/factnote/` — APIルート
  - `src/lib/factnote/` — ロジック（プロンプトは `src/lib/factnote/prompts/`。依頼書 §22.4 の `src/lib/prompts/` から変更 — §3 の隔離方針と整合させ、将来の切り出しを容易にするため）
  - `src/components/screens/factnote/` — 画面コンポーネント
- 共通利用してよい既存層: `gemini.ts` / `aiRoute.ts` / `apiAuth.ts` / `rateLimit.ts` / `retry.ts` / `crypto.ts` / `userStore.ts` / `audioChunk.ts` / `api.ts`（`AI_REQUEST_TIMEOUT_MS` 等）/ `hooks/useRecorder.ts` / `components/icons.tsx` / `components/screens/common.tsx` / Tailwindデザイントークン
- デプロイは別Vercelプロジェクト + 別Upstash（環境変数を別値にするだけ。コード変更不要）。
  環境変数 `NEXT_PUBLIC_APP_VARIANT=factnote` を設定したデプロイでは `/` → `/factnote` へリダイレクト（next.config で実装。既定OFFで既存アプリに影響なし）。
- 認証画面はMVPでは既存 `/login`・`/signup` を流用（別デプロイのため実質専用になる）。factnoteブランドの認証画面はP1以降。

## 1. 画面一覧と遷移

依頼書 §32 の優先度付き30画面。ルーティングは App Router のページ + ページ内状態機械の併用。

```
/factnote                       ホーム [P0]
  ├→ 入力方法選択（ホーム内シート or セクション）[P0]
  │   ├→ /factnote/new/text     文章入力 [P0]
  │   ├→ /factnote/new/record   録音（録音中/一時停止/波形）[P0]
  │   ├→ /factnote/new/file     音声ファイル選択 [P0]
  │   ├→ /factnote/new/photo    スクリーンショット [P1]
  │   └→ /factnote/new/memo     30秒メモ [P1]
  │        ↓ （各入力から共通フローへ）
  │   補足情報入力（日時・関係者・子ども同席・感情）[P0 最小]
  │        ↓
  │   文字起こし中 → 文字起こし確認・修正 [P0]
  │        ↓
  │   分析中 → 分析結果（§12全セクション + 返信案3種）[P0]
  │        ↓
  │   日記生成（5モード）→ 日記編集 [P0]
  │        ↓ 保存
  ├→ /factnote/records          記録一覧 [P0]
  │   └→ /factnote/records/[id] 記録詳細（タブ: 日記/原本/文字起こし/分析/返信案）[P0]
  ├→ /factnote/settings         設定（最小: APIキー状態・バックアップ・サンプルデータ）[P0]
  │   ├→ バックアップ・復元（P0: JSONエクスポートのみ）
  │   ├→ ゴミ箱 [P1]
  │   └→ プライバシー設定 [P1]
  ├→ /factnote/weekly           週次振り返り [P1]
  ├→ /factnote/monthly          月次振り返り [P2]
  └→ オンボーディング/プライバシー説明（初回のみ）[P1]
```

- 入力→分析→日記の一連フローは `/analyze` ページ方式（1ページ内の状態機械）で実装:
  `input → supplement → transcribing → reviewTranscript → analyzing → result → diary → saved / error`
- **文字起こし完了時点で必ず IndexedDB へ保存してから分析へ進む**（依頼書 §11。途中失敗でも原本と文字起こしは残る）
- エラー画面は既存パターン（「文字起こしは保持されています」+ 再試行 + 戻る）を踏襲

## 2. データモデル最終版

依頼書 §21 の型をベースに以下を確定（`src/lib/factnote/types.ts`）:

- 全レコードに `schemaVersion: number`（現行 `FACTNOTE_SCHEMA_VERSION = 1`）
- `Attachment.localUrl` は持たない。Blob本体は attachments ストアに分離保存し、表示時に `URL.createObjectURL` を都度生成・解放
- `aiModel` / `promptVersion` / 生成日時は分析・日記の生成時に必ず記録
- §21 の `IncidentRecord` / `IncidentAnalysis` / `AnalysisItem` / `ResponsibilityItem` / `DetectedPattern` / `EvidenceItem` / `DiaryVersion` / `Attachment` / `PersonRef` / `SafetyFlag` をそのまま採用。追加フィールド:
  - `IncidentRecord.supplement`: 補足情報（§9。`occurredAtChoice` / `location` / `people` / `childrenPresent` / `purpose` / `emotions`）は既存フィールドへ格納し、専用型は作らない
  - `DiaryVersion.aiModel?` / `DiaryVersion.promptVersion?`（日記単位で記録）
  - `IncidentAnalysis.aiModel` / `promptVersion` / `generatedAt`（分析単位で記録）

### IndexedDB 設計（`src/lib/factnote/db.ts`）

DB名 `factnote` / version 1。`drafts.ts` の openDB/tx パターンを踏襲しつつ、複数ストア対応に拡張。

| ストア | keyPath | 内容 |
|---|---|---|
| `records` | `id` | `IncidentRecord`（Blob以外の全データ。一覧はここだけ読む） |
| `attachments` | `id` | `{ id, blob: Blob }`（音声・画像の本体。詳細表示時のみ読む） |
| `trash` | `id` | 削除された `IncidentRecord + deletedAt`（30日で自動消去）[P1] |
| `meta` | `key` | 文字起こしキャッシュ（key=`transcript:<sha256>`）、最終バックアップ日時、AI利用回数、サンプルデータ投入済みフラグ等 |

- `onupgradeneeded` の version 分岐でマイグレーション枠を用意
- レコード読み出し時に `schemaVersion` を見て前方マイグレーション（現状は v1 のみ）
- 初回に `navigator.storage.persist()` を要求し、結果（granted/denied）をホームのバックアップ状況に表示
- テストは fake-indexeddb（既存 `src/test/setup.ts` 参照）

## 3. APIルート一覧

すべて `runtime='nodejs'` / `maxDuration=300`、`requireAuth` → `rateLimitDistributed` → `resolveGeminiApiKey` → Gemini呼び出し（`withRetryOn429`）→ 失敗時 `aiErrorResponse` の既存パターン。

| ルート | 新規/既存 | 内容 |
|---|---|---|
| `POST /api/factnote/transcribe` | 新規 | 音声チャンク1本を文字起こし。`buildFactnoteTranscribePrompt`（話者仮分離 A:/B:、`[聞き取れず]`、美化禁止）。`TRANSCRIBE_MAX_OUTPUT_TOKENS` + `collapseRepeatedLines` 適用 |
| `POST /api/factnote/analyze` | 新規 | 文字起こし/文章 + 補足情報 → `IncidentAnalysis`（§12 の 4〜12 を1呼び出し）。responseSchema + zod + フェンス/波括弧抽出 + 1回だけ再生成 |
| `POST /api/factnote/diary` | 新規 | 分析結果 + モード（5種）→ タイトル + 本文 |
| `POST /api/factnote/extract-image` | 新規 [P1] | 画像1枚 → 会話抽出（発言者・日時付き。`maxOutputTokens` 必須） |
| `/api/login` `/api/logout` `/api/signup` `/api/account/*` | 既存流用 | 認証・APIキー登録。変更しない |

- **モックモード**: 環境変数 `AI_MOCK=1` のとき、factnote系AIルートはGeminiを呼ばず固定のモックJSONを返す（`src/lib/factnote/mock.ts`）。APIキー未設定でも全フロー確認可能。E2Eでは既存の `page.route` モックも併用可
- クライアント側APIラッパは `src/lib/factnote/api.ts`（既存 `api.ts` の `AI_REQUEST_TIMEOUT_MS=280秒` を再利用）

## 4. プロンプトファイル一覧（`src/lib/factnote/prompts/`）

各ファイルは `*_PROMPT_VERSION` 定数（'v1' 開始）を export。バージョンは生成物に保存。

| ファイル | 要件 |
|---|---|
| `transcribe.ts` | `buildTalkTranscribePrompt` を土台に: 原文を美化しない・暴言を削除しない・聞き取れない部分は `[聞き取れず]`・話者は A:/B:（子どもは C:）・発言者不明は断定しない・タイムスタンプは出さない（チャンクオフセット問題のため） |
| `incidentAnalysis.ts` | 依頼書 §23 のシステムプロンプトと `buildTalkAnalysisSystemPrompt` の中立性文言を統合。§6.1 の禁止事項、§6.2 の具体性（次回対応は最大3件）、§12 の全セクション、§13 の論点別責任、§14 の `detectedPatterns`、§15 の positive/repair、safetyFlags（兆候がない場合は空配列 — `safetyNote` 方式）を1回の構造化出力で生成 |
| `diary.ts` | 5モード（factual/emotional/family/short/detailed）別の日記生成。§25 の方針（事実と感情を分ける・重要な発言を曖昧にしない）。タイトル自動生成 |

## 5. 実装順序と完了条件

### Phase 0（本書）
- [x] PLAN.md / HANDOFF.md 作成・コミット

### Phase 1（P0基盤）— 完了条件: typecheck/test/lint/build 通過 + `/factnote` が骨格表示できる
1. `src/lib/factnote/appConfig.ts`（アプリ名「事実ノート」・サブタイトル集約）
2. `src/lib/factnote/types.ts`（§2 のデータモデル + zodスキーマ）
3. `src/lib/factnote/db.ts` + テスト（fake-indexeddb）
4. `src/lib/factnote/sampleData.ts`（依頼書 §33 の架空データ10件。設定画面から投入/削除、または `NEXT_PUBLIC_FACTNOTE_SAMPLE=1`）
5. `src/lib/factnote/mock.ts`（AI_MOCK 用の固定分析・日記JSON）
6. `next.config.mjs` に APP_VARIANT リダイレクト追加（既定OFF）
7. `/factnote`（ホーム）・`/factnote/records`・`/factnote/settings` の骨格 + レイアウト（既存トークン・common.tsx 部品）

### Phase 2（P0コアループ）— 完了条件: §37 P0完了条件 + E2E通過
1. プロンプト3ファイル + `analyzeIncident.ts` / `generateFactnoteDiary.ts`（サーバー側ロジック + zod検証。`analyzeTalk.ts` パターン）+ テスト
2. APIルート3本（AI_MOCK 分岐込み）
3. クライアント: `src/lib/factnote/api.ts` + 文字起こしキャッシュ（SHA-256 → meta ストア）
4. 入力フロー（1ページ状態機械）: 文章入力（自動保存）/ 録音（`useRecorder` + 24本バー波形、`docs/design/README.md` §4）/ 音声ファイル（`expandToChunks` 直列 + チャンク進捗）
5. 補足情報入力（最小4項目）→ 文字起こし確認・修正 → 分析結果画面（§12全セクション + §13責任表 + 返信案3種 + 安全確認カード）→ 日記生成・編集
6. 記録一覧 / 記録詳細（タブ切替、原本とAI生成物の分離表示）
7. JSONエクスポート / 削除（確認付き）/ `navigator.storage.persist()`
8. E2E `e2e/flows/factnote.mjs`（文章入力 → モックAI → 分析全セクション → 日記 → 保存 → 一覧 → 詳細 → JSONエクスポート → 削除）を `run.mjs` に登録
9. README に事実ノートの起動・環境変数・モックモードを追記

### Phase 3（P1）
スクショ取り込み（縮小+圧縮 → `/api/factnote/extract-image`）/ 30秒メモ / 補足情報全項目 / オンボーディング・プライバシー説明 / 週次振り返り（ローカル集計 + AI講評はP1後半）/ Markdownエクスポート / ZIPバックアップ・復元（`fflate` 追加）/ ゴミ箱 / PWA強化 / 追加E2E

### Phase 4（P2）
月次振り返り / パターン横断ビュー / PDF（印刷CSS + `window.print()`。ライブラリ追加禁止）/ PINロック（※目隠しであり暗号化ではない旨をUIに明記）/ 匿名化設定 / ストレージ管理 / AI利用状況

## 6. 再利用対応表（新規実装禁止 — 必ずこれを使う）

| 用途 | 既存コード |
|---|---|
| Geminiクライアント・モデル名（env: `GEMINI_MODEL`/`GEMINI_TRANSCRIBE_MODEL`）・音声MIME推定・`collapseRepeatedLines`・`TRANSCRIBE_MAX_OUTPUT_TOKENS` | `src/lib/gemini.ts` |
| APIキー解決（`resolveGeminiApiKey`）・AIエラー応答（`aiErrorResponse`） | `src/lib/aiRoute.ts` |
| 認証（`requireAuth`） | `src/lib/apiAuth.ts` |
| レート制限（`rateLimitDistributed` + `clientKey`） | `src/lib/rateLimit.ts` |
| 429リトライ（`withRetryOn429`） | `src/lib/retry.ts` |
| 音声チャンク分割（`expandToChunks`・`decodeAudioBuffer`・16kHzリサンプル・`MAX_CLIENT_AUDIO_BYTES`） | `src/lib/audioChunk.ts` |
| 録音（`useRecorder`・`hasRecorderSupport`・`classifyRecorderError`） | `src/hooks/useRecorder.ts` |
| 構造化出力パターン（responseSchema + zod + フェンス/波括弧抽出 + 1回だけ再生成） | `src/lib/analyzeTalk.ts` / `src/lib/generateDiary.ts` の実装を参考に factnote 用を作る |
| 中立性プロンプト土台（率直な判定・行動単位評価・safetyNote方式） | `src/lib/prompt.ts` の `buildTalkAnalysisSystemPrompt` |
| クライアントAIタイムアウト（`AI_REQUEST_TIMEOUT_MS = 280_000`）・`ApiError` | `src/lib/api.ts` |
| IndexedDBパターン | `src/lib/drafts.ts`（openDB/tx パターンを複数ストアに拡張） |
| アイコン | `src/components/icons.tsx`（不足分は同スタイルで追加） |
| 画面部品・トークン | `src/components/screens/common.tsx` / `tailwind.config.ts` / `globals.css` |
| E2E基盤 | `e2e/run.mjs` + `e2e/mock-upstash.mjs` + `page.route` |

## 7. 技術的な注意（依頼書 §2 の落とし穴を全適用）

1. Vercel 4.5MB上限 → 音声は `expandToChunks`、画像は長辺~1600px縮小 + JPEG/WebP圧縮
2. デコード・AI呼び出しは**必ず直列ループ**（`Promise.all` 禁止 — iPhone Safari メモリ枯渇）
3. 全Gemini呼び出しに `maxOutputTokens`。分析は項目が多いため大きめ（16K目安）にし、**finishReason=MAX_TOKENS と zod失敗を区別**してエラー文言を変える
4. クライアントタイムアウトは280秒統一
5. チャンク進捗表示必須
6. MIME欠落 → 拡張子フォールバック（音声・画像とも）
7. モデル名ハードコード禁止（環境変数）
8. タイムスタンプ根拠は「参考値」+ confidence。MVPでは「音声(前半/後半)」粒度も許容
9. ログに音声・本文・画像・APIキーを出さない（タグ+ステータスのみ）
10. 新規Redisクライアントを作る場合は `enableAutoPipelining: false`

## 8. 拡張課題（MVPでは実装しない。構造だけ壊さない）

- **PIN由来鍵によるIndexedDB暗号化**（WebCrypto + PBKDF2/HKDF）: P2のPINロックは目隠しに留まる。本格暗号化は鍵忘れ=データ全損のUX設計が必要なため保留
- クラウド同期（iCloud/Google Drive/独自バックエンド）: 保存層は `db.ts` のインターフェース越しに抽象化しておく
- 運営側キー + 課金への切替: `resolveGeminiApiKey` の1点差し替えで移行できる構造を維持
- 多言語対応 / Gemini以外のAIモデル

## 9. 取り返しのつかない問題の確認（依頼書 §0.1）

現時点で**該当なし**と判断:
- 既存アプリのコード・データに一切触れない（新規ディレクトリのみ）
- 事実ノートのデータは端末内IndexedDBのみで、サーバーに本文を保存しない
- 破壊的マイグレーションなし（DB新設のみ)

ただし iOS の IndexedDB 退避リスクがあるため、`navigator.storage.persist()` とバックアップ導線をP0から入れる（依頼書 §21/§26）。
