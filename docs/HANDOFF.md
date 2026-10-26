# 引き継ぎ（最終更新：2026-10-27 00:08 / Claude Code）

## 現在の状況
**正式公開版「BALLSTORM -BBOD-」Ver.1.0**。中身は Ver.0.1.6 と同じで、開発用キーを無効化（`DEV_KEYS_ENABLED: false`）し、タブのタイトルを変更した。
- 開発・テストで開発用キー（D / 1〜4 / B / Ctrl+Shift+F8・F9）やデバッグ表示を使う時は、`js/config.js` の `DEV_KEYS_ENABLED` を一時的に true に戻し、公開前に必ず false に戻すこと。
- JS からのテスト（`window.game` / `window.input`）は開発用キーの設定に関係なく使える。
- 公開URL：https://happy-norap.github.io/ballstorm-bbod/ 。SNS共有用の OGP / Twitter カードを `index.html` に設定済み（画像 `assets/images/ogp.png` 1200×630）。URLを変える時は `index.html` の絶対URL 4か所も変更する。SNS側の表示はまだ未確認（公開後に X / Facebook のカード確認ツールで確認する）。

これまでの変更：
- 難易度・得点バランス調整（Ver.0.1.6）：分裂はボール10個以下の時だけ、ボール上限119（`addBall` が上限で null を返す）、P/G の出現比率をボール数で下げる、装甲ブロック（耐久5・1,000点・`BLOCK.ARMOR`）、時間倍率（60秒ごと×1.1、上限10倍、`scoreMult`）。調整値は `BALL_LIMIT` / `SPLIT_MAX_BALLS` / `ITEM_PG_RATE_BANDS` / `ARMOR_*` / `SCORE_ARMOR` / `SCORE_MULT_*`。自動操作の推定で100万点まで約3〜8分。
- 100万点イベント「MILLIONAIRE」を追加（花火→炸裂で32球を放射、1プレイ1回）。`js/game.js` の `startMillionaire` 周辺、調整値は `MILLIONAIRE_*`。
- 開発用キーを `DEV_KEYS_ENABLED` でまとめて無効化できるようにした（公開時は false）。テスト用に Ctrl+Shift+F8（999,900点）/ Ctrl+Shift+F9（直接発動）。
- 新アイテム「グラビティ・リバウンド（G）」を追加。パドル周囲164pxの力場で下向きのボールを引き寄せ、パドル直前で1.3倍速の急反発（`js/game.js` の `updateBalls` 内と `gravityRebound`、調整値は `GRAVITY_*`）。アイテム比率は 40:20:20:20 に変更。
- 緊急増援「ブロック・ラッシュ（仮称）」を追加。残り21個以下で3列、0個で5列を上から降らせる（`js/game.js` の `updateRush` 周辺、調整値は `RUSH_*`）。「少ない時は補充3倍速」は廃止。
- マウス操作に Pointer Lock モード（既定）を追加。従来のカーソル追従は設定（⚙ / O キー）で切替可能。入力処理は `js/input.js`。
- アイテムを「落下してパドルで拾う」方式から「アイテム付きブロックを壊した瞬間に自動取得」方式へ変更済み。
ユーザーによる実プレイでの手触り確認待ち。

## 実装済み
- 基本ゲーム（マウス操作パドル、反射、ブロック破壊、上からの列補充と押し下げ、スコア、時間、ゲームオーバー、リスタート、一時停止）
- 時間経過による速度上昇（60秒ごと+10%）
- 特殊ブロック：増殖 / 捕獲 / 吸収
- アイテム（通常ブロックの約7%が内蔵、破壊で自動取得）：分裂（ストック3、Spaceで4/8/12倍）、回転パドル（3枚羽、物理反射）、貫通ボール、グラビティ・リバウンド。時間制アイテムは再取得で残り時間リセット
- 侵入限界ラインと減点、侵入圧力による吸収ブロック出現率上昇
- 緊急増援（INCOMING! 通知、空き段優先、侵入ラインに3列の安全余白、1回最大10列、1秒のクールダウン）
- 100万点イベント「MILLIONAIRE」（花火・祝福メッセージ・32球の放射）
- デバッグ表示（Dキー）と負荷測定用のボール大量追加（B / Shift+B）。開発用キーは `DEV_KEYS_ENABLED` で一括無効化
- 効果音（WebAudio）と BGM（Mキーで切替）

## 次に取り組む候補
0. 実ブラウザ（Chrome/Edge）でのポインターロック動作確認（Claude Code の確認用ブラウザはロック非対応のため、ロック状態は擬似的にしか検証できていない）
1. 実プレイ後のバランス調整（`js/config.js`）：100万点までの時間（装甲の点数・出現率で調整）、グラビティの回収距離と反発の強さ、緊急増援の頻度（ボールが多いと数秒おきに発動）、列補充間隔、アイテム内蔵率（`ITEM_BLOCK_CHANCE`、自動取得化で実質的に取得数が増えた）、回転パドルの回転速度・持続時間
2. 速度上限を設けるかの判断（SPEC 未決定事項）
2.5 ~~公開前に `js/config.js` の `DEV_KEYS_ENABLED` を false にする~~ → Ver.1.0 で対応済み
2.6 GitHub Pages に置いた状態での動作確認（BGM の読み込み、ポインターロック）
3. スマホ対応（タッチ操作の本実装、分裂ボタンのUI）
4. 演出強化（コンボ表示、画面フラッシュなど）

## 注意点
- 仕様は `docs/SPEC.md`。「3. 実装時に決めたこと」はユーザー未承認の暫定判断なので、変更要望があれば従う。
- `tools/serve.ps1` は ASCII のみで書くこと（Windows PowerShell 5.1 が BOM なし UTF-8 を誤読するため）。
- テスト用に `window.game` / `window.input` から状態を操作できる。ロック状態の再現は `input.onLockChange(true)`、移動は `document.dispatchEvent(new MouseEvent('mousemove', {movementX}))`。タブ非表示中は自動一時停止するので、JSでテストする時は `state` に注意。
- ボールの追加は必ず `addBall`（上限あり）を使う。上限を無視する `pushBall` は開発用 B キー専用。テストで `balls.length` を大きい値に書き換えると配列に穴が空いてエラーになるので、ボールは `pushBall` で実際に追加すること。
- 自動操作の検証は `new Game(new AudioManager())` で画面と別のインスタンスを作ると、描画ループやタブ非表示の一時停止に邪魔されない。ただしゲームオーバー時にベストスコアが localStorage に保存されるので、終わったら `endlessBreakout.best` を消す。
- 盤面を直接いじるテストでは `rows` と `blockCount` を必ず一致させること（増援の発動判定は `blockCount` を見る）。落下中の増援列は `flights` にあり、まだ `rows` / `blockCount` には入っていない。
