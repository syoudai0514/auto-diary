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

- **機能追加（客観カルテ / フラットチェック / 未来の自分からのメモ — 追加依頼書対応）**:
  - データモデル: `types.ts` に PersonProfile / ObjectiveProfileSummary / AggregatedItem / FlatCheckResult / FutureSelfMemo / FutureMemoDisplayLog 等を追加。IncidentRecord に `excludeFromCarte` / `pinnedMemoIds`
  - DB v2: `db.ts` に persons / flatChecks / futureMemos / memoLogs の4ストアを追加（v1からの自動マイグレーション）
  - ローカル集計: `aggregate.ts`（期間/人物フィルタ・件数集計・テーマ/表現辞書・衝突状況・自分側/相手側パターン・偏り検出・過去比較・講評キャッシュ指紋）— **AIを呼ばない**
  - 人物管理: `persons.ts`（記録からの自動抽出・統合・別名分離・同義語辞書による統合候補の提示）
  - メモ判定: `memoMatch.ts`（トリガー判定・6時間抑制・翌朝再表示・テンプレート5種）
  - AI: `flatCheck.ts` + プロンプト3種（objectiveProfile / flatCheck / memoDraft、各v1）+ ルート3本（`/api/factnote/profile-summary`・`flat-check`・`memo-draft`。AI_MOCK対応）。カルテ講評は**集計値のみ送信**（本文・実名は送らない）
  - 画面: `/factnote/carte`（一覧+統合候補+別名分離）/ `/factnote/carte/[personId]`（期間切替・週次傾向・テーマ展開・AI講評キャッシュ）/ `/factnote/flatcheck`（範囲選択→結果、同一条件は再実行しない）/ `/factnote/memos`（一覧+表示履歴）/ `/factnote/memos/edit`（テンプレート・トリガー・AI下書き）
  - 統合: ホーム（カルテ/フラットチェック入口 + 翌朝再表示メモ）、記録詳細（フラットチェック導線・分類修正・カルテ除外・固定メモ表示）、NewFlow（保存直後のメモ自動表示。safetyFlags がある場合は安全確認を優先）
  - エクスポート: persons / futureMemos / flatChecks を JSON バックアップに追加
  - E2E: `e2e/flows/factnote-longterm.mjs`（カルテ→フラットチェック→メモ作成→自動表示→固定）

## 検証コマンドと最新の実行結果

```
npm run typecheck && npm run test && npm run lint && npm run build
E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # パス指定は実行環境依存（通常は不要）
```

- Phase 2 完了時点: typecheck ✅ / test 320件 ✅ / lint ✅ / build ✅ / test:e2e 全5フロー PASS
- 長期分析3機能の追加完了時点: typecheck ✅ / test **349件** ✅ / lint ✅ / build ✅ / **test:e2e 全6フロー PASS（既存4フロー + factnote + factnote-longterm）** ✅

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
