# 事実ノート HANDOFF

> 引き継ぎ用の現在地メモ。`docs/factnote/PLAN.md` → 本書 → 直近コミットログの順に読むこと（依頼書 §0.4）。

## 完了したこと

- Phase 0: `docs/factnote/PLAN.md`（実装計画）と本書を作成

## 作業中のもの

- なし（Phase 1 着手前）

## 次にやること（順番付き）

1. Phase 1: `appConfig.ts` → `types.ts` → `db.ts`(+テスト) → `sampleData.ts` → `mock.ts` → next.config リダイレクト → `/factnote` 骨格
2. Phase 1 末: 検証 → コミット → 本書更新
3. Phase 2: PLAN.md §5 Phase 2 の 1〜9

## 検証コマンドと最新の実行結果

```
npm run typecheck && npm run test && npm run lint && npm run build
npm run test:e2e
```

- 未実行（Phase 0 は文書のみ）

## 既知の問題・保留事項

- なし
