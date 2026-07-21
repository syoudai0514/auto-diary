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

- **UX改善（ユーザーフィードバック対応）**:
  - プロフィール（`src/lib/factnote/profile.ts`、metaストア保存・エクスポート対象・設定画面で編集）。文字起こし/分析/日記の全AIルートに `peopleContext` として送信（各プロンプト v2）。文字起こしの話者ラベルはプロフィールがあれば「私:/妻:」等の呼び名、なければ従来のA:/B:
  - 下部タブバー（`TabBar.tsx`: ホーム/記録/分析/設定）。長期分析は設定から `/factnote/insights`（分析タブ）へ移動。ホームの入口カードを整理
  - バックアップ: Web Share API による「共有して保存（iCloud Driveなど）」ボタン（`shareBackupJson`）+ ホームに7日超のバックアップ未実施警告。自動iCloud保存はPWAの制約で不可（README/設定画面に明記）

- **UX改善（フィードバック対応）**:
  - プロフィール（`profile.ts`、IndexedDB meta保存・JSONバックアップ対象）。文字起こし・分析・日記の全AIルートへ `peopleContext` として送信（プロンプト v2）。文字起こしの話者ラベルはプロフィールがあれば「私:/妻:」等の呼び名、なければ A:/B:
  - 下部タブバー（ホーム/記録/分析/設定）+ 分析ハブ `/factnote/insights` 新設。長期分析への導線を設定から移動
  - バックアップ: 共有シート経由の保存（`shareBackupJson` — iOSで「"ファイル"に保存」→iCloud Drive）+ ホームに7日超の未バックアップ警告。※ブラウザ制約により「自動でiCloudへ書き込み」は不可能（README/UIで正直に案内）
  - **バックグラウンド処理**（`jobs.ts`）: 文字起こし・分析をモジュールシングルトンのジョブとして実行。アプリ内の画面遷移では継続し、完了時に IndexedDB へ反映。処理中画面に「バックグラウンドで続ける」、記録バッジに「文字起こし中…/分析中…」、ホーム・一覧はジョブ完了で自動更新、詳細画面から未分析記録の「AIで分析する」（バックグラウンド実行）
  - 制約: タブ自体が停止する状況（画面ロック・他アプリへの切替）では中断されることがある。原本・完了済み文字起こしは保存済みのため、再試行で途中から再開（キャッシュにより再送コストなし）

- **データ保護の強化（消失報告への対応）**:
  - フロー/詳細画面の保存を「DBの最新を読み→変更を適用」方式へ変更（バックグラウンドジョブが書いた文字起こし・分析を古いメモリ上のコピーで上書きするレースを根絶）
  - `recoverStaleProcessingRecords`（jobs.ts）: タブ強制終了で「文字起こし中/分析中」のまま固まった記録をホーム・一覧の読込時に draft へ復旧
  - 記録詳細: 原本タブに**音声プレーヤー**、文字起こしタブに**「保存済みの音声を文字起こしする」**（保存済み添付Blobからジョブ再実行）— エラーや中断があっても録音から必ず復帰できる
  - **録音の途中自動保存**: `useRecorder` に onPartial オプションを追加し、録音中15秒ごとに音声Blobを保存（クラッシュしても直前までの録音が残る）。キャンセル時は空レコードを掃除
  - プロフィールを IndexedDB + localStorage の**二重保存**にし、片方が消えても読み込み時に自動復元（ヒール）
  - キャンセル操作が完了済みの状態を巻き戻さないようガード

- **フォルダ自動保存（`autoBackup.ts`）**: File System Access API でフォルダを一度指定すると、データ変更時・起動時・離脱時（visibilitychange hidden）に同名ファイルへ自動上書き保存。iCloud Drive 内のフォルダを選べば iCloud 同期される。**デスクトップ Chrome/Edge 等で有効**。iOS/iPadOS Safari は API 非対応のため設定画面で正直に案内し「共有して保存」へ誘導。権限が切れた場合は `resumeAutoBackup`（ユーザー操作）で再開

- **ワンタップ・バックアップ導線（`BackupPrompt.tsx`）**: iOSは共有にユーザー操作が必須なため、保存が終わった自然なタイミングでワンタップ保存を提示。記録作成フローに `saved` 完了ステップを新設し「保存しました → iCloud Driveにバックアップ（1タップ）→ 記録を見る」。ホームの古いバックアップ警告も設定へ飛ばさずその場でワンタップ保存に変更。フォルダ自動保存が設定済みの端末では「自動保存しました」と静かに表示、バックアップが新しい時は出さない（`isBackupStale` 3日既定で毎回のnagを回避）

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

## 次にやること（追加分）

1. **auto-diary（音声日記）側のバックグラウンド処理**: 事実ノートと同じジョブランナー方式を `src/app/page.tsx` の状態機械へ適用する。既存アプリの中核フロー（1,500行規模）の改修になるため、E2E 4フローの回帰確認とセットで別コミットとして実施すること
2. 未来メモの「返信文コピー前の表示」（§18.3）

## 既知の問題・保留事項

- 記録詳細の添付音声は再生UI未実装（Blobは attachments ストアに保存済み。`URL.createObjectURL` で再生ボタンを付けるだけ）
- 週次・月次・パターン横断ビューは未着手（P1/P2）
- PINロック・匿名化・PDF出力は P2（PLAN.md §5）
- E2E実行時に playwright のバージョンによっては `E2E_CHROMIUM_PATH` の指定が必要
