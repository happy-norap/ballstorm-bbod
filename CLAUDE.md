# CLAUDE.md

エンドレス型ブロック崩し（HTML5 Canvas + 素の JavaScript、外部ライブラリなし）。Claude Code と Codex の両方で開発を継続している。

## 作業開始時
1. `docs/HANDOFF.md`（現状と次の作業）を読む
2. `docs/SPEC.md`（仕様・決定事項・未決定事項）を読む
3. 必要に応じて `docs/WORKLOG.md` の最新記録を読む

## 作業ルール
- 決定済みの仕様を勝手に変更しない。変更が必要なら理由をユーザーに説明して確認する。
- 調整値は `js/config.js` に定数として置く。
- `<script>` 通常読み込み（ES Modules 不使用）を維持し、`index.html` の直接起動と GitHub Pages 公開を両立させる。
- 動作確認は `tools/serve.ps1` でローカルサーバーを立てて行う。

## 作業終了時
- `docs/WORKLOG.md` の先頭に記録を追加（日時・担当AI・変更ファイル・変更理由・確認結果・未解決問題）
- `docs/HANDOFF.md` を現状に合わせて更新
- 仕様が変わった場合は `docs/SPEC.md` を更新
