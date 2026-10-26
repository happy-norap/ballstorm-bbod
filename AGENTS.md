# AGENTS.md

Endless breakout game (HTML5 Canvas + vanilla JavaScript, no external libraries). Development is shared between Codex and Claude Code. ドキュメントは日本語で書くこと。

## 作業開始時
1. `docs/HANDOFF.md`（現状と次の作業）を読む
2. `docs/SPEC.md`（仕様・決定事項・未決定事項）を読む
3. 必要に応じて `docs/WORKLOG.md` の最新記録を読む

## 作業ルール
- 決定済みの仕様を勝手に変更しない。変更が必要なら理由を説明して確認する。
- 調整値は `js/config.js` に定数として置く。
- ES Modules は使わず通常の `<script>` 読み込みを維持する（`index.html` を直接開いても動かすため）。
- ローカル確認：`powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8765` → http://localhost:8765/

## 作業終了時
- `docs/WORKLOG.md` の先頭に記録を追加（日時・担当AI・変更ファイル・変更理由・確認結果・未解決問題）
- `docs/HANDOFF.md` を現状に合わせて更新
- 仕様が変わった場合は `docs/SPEC.md` を更新
