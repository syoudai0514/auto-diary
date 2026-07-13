# 事実ノート HANDOFF

> 引き継ぎ用の現在地メモ。`docs/factnote/PLAN.md` → 本書 → 直近コミットログの順に読むこと（依頼書 §0.4）。

## 完了したこと

- Phase 0: `docs/factnote/PLAN.md`（実装計画）と本書を作成
- Phase 1（P0基盤）:
  - `src/lib/factnote/appConfig.ts` / `types.ts`（§21確定版データモデル）
  - `src/lib/factnote/db.ts` + `db.test.ts`（IndexedDB 4ストア: records/attachments/trash/meta、ゴミ箱30日、文字起こしキャッシュ、`navigator.storage.persist()`）
  - `src/lib/factnote/fixtures.ts` + `fixtures.test.ts`（モック分析・モック日記・サンプル10件のビルダー）
  - `src/lib/factnote/sampleData.ts`（設定画面から投入/削除）/ `mock.ts`（AI_MOCK=1 判定）
  - `src/lib/factnote/exportData.ts`（JSON一括エクスポート + 最終バックアップ日時更新）
  - `next.config.mjs`: `NEXT_PUBLIC_APP_VARIANT=factnote` で `/` → `/factnote` リダイレクト（既定OFF）
  - 画面: ホーム / 記録一覧（検索+種別フィルタ）/ 記録詳細（タブ: 日記・分析・文字起こし・原本 + ゴミ箱削除）/ 設定（APIキー・JSONエクスポート・永続化・サンプルデータ）
  - `AnalysisView.tsx`（§12全セクション + §13責任表 + 安全確認カード + 返信案3種コピー。詳細と分析結果画面で共用）
  - `src/components/icons.tsx` に FileText/Download/Scale/Image/Zap/Heart/Shield を追加

## 作業中のもの

- `/factnote/new` はプレースホルダのみ（Phase 2 で入力フロー状態機械を実装）

## 次にやること（順番付き）

1. Phase 2-1: `src/lib/factnote/prompts/`（transcribe/incidentAnalysis/diary、PROMPT_VERSION付き）+ `analyzeIncident.ts` / `generateFactnoteDiary.ts`（zod検証。`analyzeTalk.ts` パターン）+ テスト
2. Phase 2-2: APIルート `/api/factnote/transcribe`・`analyze`・`diary`（AI_MOCK分岐込み）+ ルートテスト
3. Phase 2-3: `src/lib/factnote/api.ts`（クライアントラッパ + SHA-256文字起こしキャッシュ）
4. Phase 2-4〜5: `/factnote/new` の状態機械（文章/録音/ファイル → 補足情報 → 文字起こし確認 → 分析 → 日記生成・編集 → 保存）。文字起こし完了時点で必ずIndexedDB保存
5. Phase 2-8: E2E `e2e/flows/factnote.mjs` を `run.mjs` に登録
6. README追記 → 検証 → コミット

## 検証コマンドと最新の実行結果

```
npm run typecheck && npm run test && npm run lint && npm run build
npm run test:e2e
```

- Phase 1 時点: typecheck ✅ / test 304件 ✅ / lint ✅ / build ✅（test:e2e は Phase 2 で factnote フロー追加後に実行）

## 既知の問題・保留事項

- factnote専用のログイン画面はP1送り（既存 `/login` を流用中）
- 記録詳細の添付ファイルはメタ情報表示のみ（音声再生はPhase 2で attachments ストアの Blob から）
