# 事実ノート HANDOFF

> 引き継ぎ用の現在地メモ。`docs/factnote/PLAN.md` → 本書 → 直近コミットログの順に読むこと（依頼書 §0.4）。

## 完了したこと

- **Phase 0**: `docs/factnote/PLAN.md`（実装計画）と本書を作成
- **Phase 1（P0基盤）**: データモデル（`src/lib/factnote/types.ts`）/ IndexedDB 4ストア（`db.ts`: records/attachments/trash/meta、ゴミ箱30日、文字起こしキャッシュ、`storage.persist()`）/ サンプル10件・モックAI（`fixtures.ts` / `sampleData.ts` / `mock.ts`）/ JSONエクスポート（`exportData.ts`）/ ホーム・一覧・詳細・設定画面 / `AnalysisView.tsx` / `NEXT_PUBLIC_APP_VARIANT=factnote` リダイレクト
- **Phase 2（P0コアループ）**:
  - プロンプト3ファイル（`src/lib/factnote/prompts/` — transcribe / incidentAnalysis / diary、各 `PROMPT_VERSION='v1'`）
  - サーバーロジック: `analyzeIncident.ts`（responseSchema + zod + フェンス抽出 + 1回再生成 + MAX_TOKENS切り詰め検知、`maxOutputTokens=16384`）/ `generateFactnoteDiary.ts`（5モード、4096トークン上限）/ `jsonExtract.ts`
  - APIルート3本: `/api/factnote/transcribe`・`analyze`・`diary`（`requireAuth` → `rateLimitDistributed` → `resolveGeminiApiKey` → `aiErrorResponse` の既存パターン、`AI_MOCK=1` 分岐込み）
  - クライアント: `src/lib/factnote/api.ts`（280秒タイムアウト、SHA-256ヘルパー）。既存 `src/lib/api.ts` のヘルパー4つ（`parseError`/`fetchWithTimeout`/`postJson`/`AI_REQUEST_TIMEOUT_MS`）を export 化
  - フロー: `NewFlow.tsx`（文章/録音/ファイル → 補足情報(`SupplementStep.tsx`) → 文字起こし(チャンク直列+キャッシュ+進捗) → 確認・修正(原音声を残すか選択) → 分析 → 結果 → 日記5モード生成・編集 → 保存）。**原本Blobは文字起こし前に保存、文字起こしは分析前に保存**（§11）
  - フロー純ロジック: `newRecord.ts`（補足情報の変換・分析結果の反映・原本非破壊）+ テスト
  - E2E: `e2e/flows/factnote.mjs`（文章入力→分析全セクション→日記→詳細タブ→一覧→JSONエクスポート→削除）を `run.mjs` に登録
  - README に「事実ノート」節を追記

## 検証コマンドと最新の実行結果

```
npm run typecheck && npm run test && npm run lint && npm run build
E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # パス指定は実行環境依存（通常は不要）
```

- Phase 2 完了時点: typecheck ✅ / test 320件 ✅ / lint ✅ / build ✅ / **test:e2e 全5フロー PASS（既存4フロー含む）** ✅

## 次にやること（順番付き — Phase 3 / P1）

1. スクリーンショット取り込み（§8.4）: クライアントで長辺~1600px縮小+JPEG/WebP圧縮 → 新ルート `/api/factnote/extract-image`（`maxOutputTokens` 必須・直列送信・MIME拡張子フォールバック）
2. 30秒メモ（§8.5）: カテゴリ選択 + 一言入力 → quick_memo レコード
3. オンボーディング / プライバシー説明（初回のみ。録音同意の注意を含める）
4. 補足情報の全項目化（記録目的・タグ）/ 週次振り返り（ローカル集計、`detectedPatterns.type` ベース）
5. Markdownエクスポート / ZIPバックアップ・復元（`fflate` 追加可）/ ゴミ箱画面（db.ts の trash API は実装済み）
6. factnoteブランドのログイン画面（現状は既存 `/login` 流用）

## 既知の問題・保留事項

- 記録詳細の添付音声は再生UI未実装（Blobは attachments ストアに保存済み。`URL.createObjectURL` で再生ボタンを付けるだけ）
- 週次・月次・パターン横断ビューは未着手（P1/P2）
- PINロック・匿名化・PDF出力は P2（PLAN.md §5）
- E2E実行時に playwright のバージョンによっては `E2E_CHROMIUM_PATH` の指定が必要
