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

- **日記の柔軟化・後編集（フィードバック対応）**:
  - **原文のまま日記モード（`verbatim`）**: 入力文をAIで意訳せずそのまま日記本文にする（分析はAIで実施）。DiaryMode に追加、`AI_DIARY_MODES` でAPI対象と区別。作成フロー・詳細の作り直しの両方でモード選択に表示
  - **保存後の日記編集・作り直し**: 記録詳細の日記タブで既存日記をインライン編集・削除でき、モードを選んで作り直し／追加生成（`factnoteDiaryApi` 直呼び。verbatim含む）
  - **分析のやり直し**: 分析タブに「分析をやり直す」（再判断。既存の analyze ジョブを再実行）
  - **記録の後編集画面（`/factnote/records/[id]/edit`）**: タイトル・日時・場所・関係者・子ども同席・感情・本文（文章 or 修正済み文字起こし）を保存後に修正可能。内容変更時は「分析をやり直す」を案内。詳細ヘッダーに「編集」導線
  - E2E factnote フローに verbatim・日記編集・記録編集の検証を追加

- **画像添付（フィードバック対応）**: 記録詳細の原本タブから写真・スクショを添付できる（`image.ts` で長辺~1600px縮小+JPEG圧縮、複数直列、MIME拡張子フォールバック）。attachments ストアにBlob保存、サムネイルグリッド表示・タップで拡大・削除。一覧に「画像あり」バッジ。文字起こし対象からは画像を除外。E2Eに画像添付検証を追加

- **Markdownエクスポート（フィードバック対応）**: `markdown.ts` で記録を人間・LLMが読みやすいMDに変換（記録情報・原本・分析の全セクション・論点別責任表・日記を見出しで分離）。設定から全件を、記録詳細から1件を書き出し（共有シート対応端末は共有、なければダウンロード）。バックアップ日時は更新しない（復元用はJSON）。テスト+E2E追加

- **画面ロック（PIN + 生体認証／フィードバック「最重要」対応）**: `src/lib/factnote/lock.ts` にロジックを集約。
  - **PIN**: PBKDF2-SHA256（150k回・16byteソルト）でハッシュ化し localStorage（`factnote-lock-pin`）に保存。平文は保存しない。照合は定数時間比較。
  - **生体認証**: WebAuthn プラットフォーム認証器（Face ID / Touch ID）。`isUserVerifyingPlatformAuthenticatorAvailable` で対応判定、`navigator.credentials.create/get`（`userVerification:'required'`）。rawId を base64 で保存（`factnote-lock-cred`）。**PINを常にフォールバックに残す**（締め出し＝データ喪失を防ぐため、生体のみのロックは不可）。
  - **ゲート**: `LockGate`（`app/factnote/layout.tsx` で全 `/factnote/*` を包む）。設定済みかつ未解除ならロック画面（テンキー＋生体ボタン）を表示し中身を隠す。解除状態はメモリのみ（`subscribeLock` pub/sub）＝**リロードで必ず再ロック**。`visibilitychange` でバックグラウンド滞在が `getAutoLockMs()`（既定60秒、設定で「すぐ/1分/5分」）を超えたら再ロック。
  - **設定UI**: `LockSettings`（設定画面の先頭）でPIN設定・変更（現PIN確認付き）、生体認証の登録/解除、自動ロック時間、ロック解除（現PIN確認付き）。「これは目隠しでデータ自体は暗号化されない／PINを忘れると解除不可」の注記あり。
  - `lock.test.ts`（PIN照合・非平文保存・ソルト差分・remove・オートロック値）+ E2E `factnote-lock.mjs`（PIN登録→リロードでロック→誤PIN拒否→正PIN解除）追加。

- **判定ロジック v3 と「全体の見解」（フィードバック「バランスだけ取っている」対応）**:
  - **診断（v2 までの問題）**:
    1. Gemini は `propertyOrdering` を指定しないとプロパティを**アルファベット順**に生成するため、`balancedConclusion`・`conciseView` が改善点・問題点より先に書かれ、結論が分析に先行して両論併記に寄っていた
    2. スキーマが自分側/相手側の改善点・問題点・返信案（境界線を含む3種）を常に要求し、「両側に何か書く」構造になっていた。重さの区別がなく、苛立ちの一言と発端のミスが同じ1件として並んでいた
    3. 判定（どちらが重いか）を出すフィールドがなく、「中立的」「バランスの取れた結論」という語が真ん中への収束を誘導していた
    4. 記録の形式（録音か本人の文章か）をAIに伝えておらず、根拠の強さを判定に反映できなかった
    5. ローカル集計が detectedPatterns を**種類だけで**側に振り分けており、記録者自身の一般化表現も「相手側」に数えていた
    6. フラットチェックのプロンプトが「極端な結論を防ぐ」＝真ん中へ寄せる設計だった
  - **対応**: `prompts/incidentAnalysis.ts` v3（公正≠真ん中 / 件数でなく重さ / 共通の重さの物差し / 発端と反応の分離 / 記録者バイアスと basis / 立場入れ替えチェック / 判定の逃げ道禁止 / firm は moderate 以上の時だけ）。`analyzeIncident.ts` に `verdict`（leaning 8種・headline・reasoning・robustness・whatWouldChange・roleReversalCheck）、改善点・問題点・論点の `severity`/`basis`、パターンの `actor`、`INCIDENT_PROPERTY_ORDER`（事実→論点→各側→判定→見解・結論→対応）、温度0.2。`describeSourceType` で記録の形式を送信。`applyAnalysisResult` が直前の分析を `previousAnalysis` に1世代保持。aggregate は `patternActor`（actor 優先・旧データは種類で推定）。フラットチェック v2・カルテ講評 v2（重さ・判定の内訳を送る）。旧基準のフラットチェック結果はキャッシュ再利用しない
  - **UI**: `Verdict.tsx`（判定カード: 5段階スケール・確かさ・立場入れ替え/変わりうる条件の折りたたみ。色は自分側=テラコッタ `--c-side-user` / 相手側=青灰 `--c-side-other`）。`AnalysisView` を判定→見解→各側（重さ・根拠バッジ、問題なしは明示）→論点カード→論点ごとの結論→対応→事実4層→返信案（空は非表示）の順に。旧基準の分析には説明と「最新の基準で分析し直す」。再分析時は判定の変化を表示
  - **一括再分析**（`jobs.ts` `startBulkReanalysis`）: 古い順に直列、1件ごとに保存、429は最大6回待って再試行、1件の失敗は継続・APIキー未設定/認証切れ/3連続失敗で中断、途中停止、Screen Wake Lock。対象選びは `overview.ts` `reanalysisTargets`（旧基準+未分析 / 全件）。再実行すれば残りから再開
  - **全体の見解**（`/factnote/overview`、分析ハブの先頭カード）: ①判定基準の状態と一括再分析 ②記録全体のかたち（ローカル: 判定の内訳バー・重さの内訳・月ごとの推移・繰り返しパターン・偏り警告）③AI総評（`/api/factnote/overall-review`、プロンプト `overallReview.ts` v1。送るのは各記録の分析要約+集計のみで本文は送らない。最大120件。#番号→記録リンク。meta に最新+1つ前を保存、記録が変わると「更新する」）
  - テスト: `overview.test.ts` / `bulkReanalysis.test.ts` 追加、`analyzeIncident.test.ts`（生成順・判定・重さ・プロンプト内容）拡充。E2E `factnote-overview.mjs` 追加、`factnote.mjs` を v3 に更新

- **直し方の提示（判定 v4 / 全体の見解 v2 — フィードバック「相手の直した方がいいことも」）**:
  - 一件の分析: 改善点・問題点の各項目に `suggestion`（代わりにどうするとよいか。具体的な行動・言い方）。相手側にも行動レベルで付ける（人格への注文は禁止）。UI は「次からは」「相手が直すとよいこと」。v4 に上げたので v3 の記録も「全体の見解」で再分析対象になる
  - 全体の見解: 繰り返しの課題ごとに直し方、二人の間の悪循環（`interactionCycle`）と断ち切るポイント、「相手が直した方がいいこと（伝えてよいこと）」。旧形式の保存済み総評も表示できる（欠けたフィールドは非表示）

- **一括再分析の失敗対策（本番で「めっちゃ失敗」の報告 → Vercelログで原因特定）**:
  - 原因: Gemini の **503 UNAVAILABLE（"This model is currently experiencing high demand"）**。429（回数制限）ではなく一時的な高負荷だったが、クライアントの再試行は 429 のみで 503 は即失敗していた
  - 対応: `retry.ts` に `withRetryOnBusy`（429 は Retry-After、503/504 は 10→20→40→60秒の指数バックオフで再試行。待機中は `onWait` で画面に通知、中断ボタンで待たずに止まる）。文字起こし・分析・日記・フラットチェック・全体の見解に適用。**502 は対象外**（分析ルートが「ブロック」「出力途切れ」も 502 で返すため、再試行すると同じ内容を無駄に送り続ける）
  - 一括再分析: 1件あたり最大6回再試行。失敗理由を `failures` に保存して画面に表示（生のJSONエラーでなく「Geminiが混み合っています」等）。3連続失敗で中断。失敗した記録は旧基準のまま残るので、もう一度押せば失敗分だけやり直せる
  - モデルは `GEMINI_MODEL`（未設定なら `gemini-3.1-flash-lite`）。503 が続く時間帯は Vercel の環境変数で別モデルへ切り替え可能

- **モデルを 3.5 flash-lite へ + 混雑時の自動切り替え**: 事実ノートの text 系ルート（analyze / diary / flat-check / overall-review / memo-draft / profile-summary）は `modelFallback.ts` の `factnoteModel()`（`FACTNOTE_GEMINI_MODEL` > `GEMINI_MODEL` > 既定 `gemini-3.5-flash-lite`）を使い、主モデルが 404/429/500/503/504 で失敗したら同じリクエストを予備（`FACTNOTE_GEMINI_FALLBACK_MODEL`、既定 `gemini-3.1-flash-lite`）で1回だけ試す（`withModelFallback`。無料枠の制限・高負荷はモデルごとに別枠のため）。記録の `aiModel` には実際に応答したモデルを残す。**既存の音声日記アプリは `GEMINI_MODEL`（既定 3.1）のまま**。未検証: 3.5 の出力品質・無料枠の実際の回数（公式ドキュメントに到達できず検索情報のみ）。出力がおかしければ Vercel の環境変数 `FACTNOTE_GEMINI_MODEL=gemini-3.1-flash-lite` で戻せる

- **AI側の制限で分析できない記録の扱い**（本番で62/63件成功、残り1件が `PROHIBITED_CONTENT` で毎回ブロック）: `PROHIBITED_CONTENT` は Google 側で常時有効な制限で、safetySettings では解除できない。**回避（別モデルで試す等）はしない**。代わりに `IncidentRecord.analysisBlocked`（理由 + 本文ハッシュ）を付け、本文が同じ間は再分析の対象から外す（本文を直すとハッシュが変わり自動で対象に戻る）。一括再分析ではブロックを失敗・連続失敗に数えず次へ進み、「AI側の制限で分析できない記録」として別枠に一覧表示。記録詳細にも説明と「編集で本文を直す」案内。分析ルートは `reason` を返し、PROHIBITED_CONTENT 専用の文言を出す

- **分析用の本文（`IncidentRecord.analysisText`）**: 原本（rawText / transcript）は書き換えず、AIにはこちらだけを送る任意の本文。`newRecord.ts` の `analysisTextOf()`（分析用の本文 > 原本）を、外部AIへ送る処理（分析ジョブ・一括再分析・日記のAI生成・フラットチェック）で使う。「原文のまま」日記・ローカル集計・書き出しの原本表示は従来どおり `sourceTextOf()`。ブロック判定のハッシュも `analysisTextOf` で取るので、分析用の本文を書けばブロックされた記録も自動で再分析の対象に戻る。分析用の本文がある時は、記録の形式を「記録者がAI分析用に書き直した文章」としてAIに伝える。UI: 編集画面に「分析用の本文（任意）」（原本をコピーして書き始めるボタン・`#analysis-text` で直接スクロール）、記録詳細の分析タブに「分析用の本文で分析しています」表示、ブロック案内から「分析用の本文を書く」へ直行。Markdown書き出しにも別見出しで出力
- テスト補助の修正: `bulkReanalysis.test.ts` の `waitForFinish` が、購読直後に届く前回実行の最終状態で解決してしまい、実行中の一括再分析を待たずに次へ進んでいた（「再実行で送り直さない」の確認が空振りしていた）。購読時の同期コールバックを無視するよう修正

## 検証コマンドと最新の実行結果

```
npm run typecheck && npm run test && npm run lint && npm run build
E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # パス指定は実行環境依存（通常は不要）
```

- Phase 2 完了時点: typecheck ✅ / test 320件 ✅ / lint ✅ / build ✅ / test:e2e 全5フロー PASS
- 長期分析3機能の追加完了時点: typecheck ✅ / test **349件** ✅ / lint ✅ / build ✅ / **test:e2e 全6フロー PASS（既存4フロー + factnote + factnote-longterm）** ✅
- 画面ロック（PIN + 生体認証）追加完了時点: typecheck ✅ / test **372件** ✅ / lint ✅ / build ✅ / **test:e2e 全7フロー PASS（+ factnote-lock）** ✅
- 分析の安全フィルタ誤ブロック修正（BLOCK_NONEへ再緩和＋診断ログ強化）完了時点: typecheck ✅ / test **377件** ✅ / lint ✅ / build ✅ / test:e2e 全7フロー PASS ✅
- 判定ロジック v3 + 全体の見解 完了時点: typecheck ✅ / test **401件** ✅ / lint ✅ / build ✅ / **test:e2e 全8フロー PASS（+ factnote-overview）** ✅
- 直し方の提示（v4 / 総評 v2）完了時点: typecheck ✅ / test **403件** ✅ / lint ✅ / build ✅ / test:e2e 全8フロー PASS ✅
- 一括再分析の503対策 完了時点: typecheck ✅ / test **410件** ✅ / lint ✅ / build ✅ / test:e2e 全8フロー PASS ✅
- モデル切り替え 完了時点: typecheck ✅ / test **420件** ✅ / lint ✅ / build ✅ / test:e2e 全8フロー PASS ✅
- ブロック記録の扱い 完了時点: typecheck ✅ / test **424件** ✅ / lint ✅ / build ✅ / test:e2e 全8フロー PASS ✅
- 分析用の本文 完了時点: typecheck ✅ / test **429件** ✅ / lint ✅ / build ✅ / test:e2e 全8フロー PASS ✅

## バグ修正: 分析が「分析に失敗しました」で毎回失敗する（安全フィルタの誤ブロック）

- **症状**: 記録詳細の分析タブが常に「分析に失敗しました。しばらくしてから再試行してください。」になる（再試行も同じ結果）。Gemini呼び出し自体は例外を投げていない（例外なら理由が括弧書きで表示されるはずだが、それが出ない）ことから切り分けた。
- **原因**: `analyzeIncident`（および diary / flat-check / memo-draft / profile-summary / transcribe）が Gemini の `safetySettings` を明示していなかったため、既定（やや厳しめ）の閾値が適用されていた。このアプリの用途は「自分自身の言い合い・衝突を客観的に記録・分析する」ことで、内容には強い言葉や子どもが関係する場面の描写が含まれうる。既定閾値だとこうした自己内省目的の記述が誤って安全フィルタに引っかかり、`candidates[0].finishReason === 'SAFETY'`（またはプロンプト自体がブロックされ `promptFeedback.blockReason` が付く）で本文が空になる。空文字は当然JSONとして解釈できないため、`IncidentAnalysisError(kind:'parse')` → 汎用エラーメッセージになっていた（再試行しても同じ内容を送るので何度やっても失敗する）。
- **修正（1回目）**:
  - `src/lib/gemini.ts` に `REFLECTIVE_SAFETY_SETTINGS`（HARASSMENT / HATE_SPEECH / DANGEROUS_CONTENT を `BLOCK_ONLY_HIGH` に緩和）を追加し、事実ノートの全Gemini呼び出し（analyze / diary / flat-check / memo-draft / profile-summary / transcribe）に適用。
  - `analyzeIncident.ts`: `finishReason`（SAFETY/PROHIBITED_CONTENT/BLOCKLIST/RECITATION/SPII/OTHER）または `promptFeedback.blockReason` を検出したら `IncidentAnalysisError(kind:'blocked')` として区別。再試行しても結果が変わらないため即座に打ち切り、理由（種別のみ・本文はログに出さない）をサーバーログに記録し、ユーザーには再試行を促さない具体的な文言を返す。
  - `analyzeIncident.test.ts` に `analyzeIncident()` 本体の単体テストを追加（blocked/truncated/parse/成功の4パターン + 再試行回数の検証）。
- **修正（2回目 — 本番で BLOCK_ONLY_HIGH でもなお誤ブロックが再現したため）**:
  - `REFLECTIVE_SAFETY_SETTINGS` の HARASSMENT / HATE_SPEECH / DANGEROUS_CONTENT を `BLOCK_NONE` まで緩和。このアプリは第三者への攻撃文の生成は行わず、むしろ危険性の兆候（暴力・自傷・子どもの安全等）自体をモデルに `safetyFlags` として検出・提示させてユーザー自身の安全につなげる設計のため、ブロックによって分析自体が止まる方が実害が大きいと判断（`BLOCK_NONE` は閾値でのブロックを止めるだけで `safetyRatings` 自体は返り続けるため診断には使える）。
  - `analyzeIncident.ts` にブロック理由の診断ログ（`blockedDiagnostics`）を追加。`promptFeedback.safetyRatings` / `candidates[0].safetyRatings` から HIGH/MEDIUM 相当・`blocked:true` のカテゴリのみを `カテゴリ=確率` の形でログに出す（本文は一切含めない）。ブロックが起きた場合はサーバーログの `[factnote-analyze] blocked: <reason> (<category>=<probability>, ...)` でどのカテゴリが原因かを特定できる。
- **既知の限界**: CSAM等のGoogle側で常時有効な非設定可能カテゴリはこの調整では変えられない（そもそも変えるべきでもない）。`BLOCK_NONE` でもなお誤ブロックが起きる場合は上記ログのカテゴリを見て個別に判断する。

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

- 判定 v3 は実モデル（gemini-3.1-flash-lite）での出力品質を本番データで要確認。判定が片寄りすぎ/寄らなすぎる場合は `prompts/incidentAnalysis.ts` の重さの物差しを調整し、`INCIDENT_ANALYSIS_PROMPT_VERSION` を上げる（上げると「全体の見解」で旧基準として再分析対象になる）
- 一括再分析はタブが生きている間だけ動く（画面ロック・アプリ切替で中断しうる。完了分は保存済みで、再実行で残りから再開）

- 記録詳細の添付音声は再生UI未実装（Blobは attachments ストアに保存済み。`URL.createObjectURL` で再生ボタンを付けるだけ）
- 週次・月次・パターン横断ビューは未着手（P1/P2）
- PINロック（+生体認証）は実装済み。匿名化・PDF出力は P2（PLAN.md §5）
- ロックは「画面の目隠し」で IndexedDB のデータ自体は暗号化していない（P2でPIN由来鍵での暗号化を検討）
- E2E実行時に playwright のバージョンによっては `E2E_CHROMIUM_PATH` の指定が必要
