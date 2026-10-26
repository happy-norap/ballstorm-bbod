// ゲーム全体の調整用定数。数値の調整はここだけで行えるようにしている。
'use strict';

const CONFIG = {
  // ---- 画面（論理サイズ。実際の表示はウィンドウに合わせて拡大縮小） ----
  WIDTH: 600,
  HEIGHT: 820,
  HUD_HEIGHT: 44,            // 上部HUDの高さ（ここが天井になる）

  // ---- パドル ----
  PADDLE_WIDTH: 96,
  PADDLE_HEIGHT: 14,
  PADDLE_Y_FROM_BOTTOM: 56,  // 画面下端からパドル中心までの距離
  PADDLE_MAX_BOUNCE_DEG: 62, // パドル端に当たった時の最大反射角（垂直から）

  // ---- ボール ----
  BALL_RADIUS: 6,
  BALL_SPEED_INITIAL: 400,    // px/秒
  SPEED_UP_INTERVAL: 60,      // 秒ごとに
  SPEED_UP_RATE: 0.10,        // 10% 上昇（複利）
  BALL_MIN_VERTICAL_DEG: 14,  // 水平に近すぎる角度を防ぐ（水平からの最小角）
  BALL_SPEED_RELAX: 1.6,      // 回転パドルで加速したボールが基準速度へ戻る速さ（1/秒）
  BALL_MAX_BOOST: 1.8,        // 回転パドルによる加速の上限（基準速度比）
  BALL_LIMIT: 119,            // ボール数の上限。分裂・増殖・捕獲・MILLIONAIRE はこれを超えて生成しない（既存ボールは消さない）
  SUBSTEP_MAX_DIST: 4,        // 1サブステップで進む最大距離（すり抜け防止。半径より小さく）
  BALL_RECT_RENDER_THRESHOLD: 1500, // これ以上のボール数では四角形で高速描画

  // ---- ブロック ----
  BLOCK_COLS: 12,
  BLOCK_ROW_HEIGHT: 22,
  BLOCK_GAP: 2,
  BLOCK_SIDE_MARGIN: 6,
  BLOCK_TOP: 52,              // 最上段のY
  INITIAL_ROWS: 7,
  ROW_INTERVAL_INITIAL: 7.0,  // 新しい列が補充される間隔（秒）
  ROW_INTERVAL_MIN: 3.0,
  ROW_INTERVAL_DECAY: 0.02,   // 1列補充するごとに間隔を何秒短くするか
  ROW_SCROLL_TIME: 0.25,      // 押し下げアニメーション時間（秒）
  ROW_EMPTY_CHANCE: 0.12,     // 列内でマスが空になる確率

  // ---- 緊急増援（ブロック・ラッシュ） ----
  RUSH_BASELINE_BLOCKS: 0,    // 基準量（0 なら 初期列数×列のマス数 = 84）
  RUSH_THRESHOLD_RATIO: 0.25, // 残数が基準量のこの割合以下で発動
  RUSH_ROWS_LOW: 3,           // 閾値以下の時の補充列数
  RUSH_ROWS_EMPTY: 5,         // 0個の時の補充列数
  RUSH_NOTICE_TIME: 0.35,     // 「INCOMING!」表示から1列目が出発するまでの時間（秒）
  RUSH_ROW_INTERVAL: 0.15,    // 列の到着間隔（秒）
  RUSH_DROP_TIME: 0.2,        // 1列が上から定位置まで降りる時間（秒）
  RUSH_COOLDOWN: 1.0,         // 増援終了から次の増援までの最短間隔（秒）
  RUSH_MAX_ROWS: 10,          // 1回の増援で補充する最大列数（補充不足時の追加分を含む）
  RUSH_SAFE_ROWS: 3,          // 増援で押し下げる場合、最下段と侵入ラインの間に最低限残す列数

  // ブロック種別の出現率（空でないマスに対する重み）
  WEIGHT_NORMAL: 100,
  WEIGHT_SPLIT: 7,            // ボール増殖ブロック
  WEIGHT_CAPTURE: 5,          // ボール捕獲ブロック
  WEIGHT_ABSORB_BASE: 0,      // ボール吸収ブロック（侵入が無い時）
  WEIGHT_ABSORB_PER_PRESSURE: 3,  // 侵入圧力1あたりの吸収ブロック重み加算
  WEIGHT_ABSORB_MAX: 40,
  ABSORB_CAPACITY: 1,         // 吸収ブロックが何個ボールを吸うと消えるか

  // ---- 装甲ブロック ----
  ARMOR_HP: 5,                // 耐久値（ボール1回の接触で1減る。貫通ボールも1回の通過で1）
  // 出現率：列を生成した時点のボール数で決まる（空でないマスのうち装甲になる割合）。
  // [ボール数がこれ以上, 出現率] を小さい順に並べる。生成済みのブロックは後から変わらない
  ARMOR_RATE_BANDS: [[0, 0.03], [10, 0.05], [30, 0.10], [50, 0.20], [80, 0.30]],

  // ---- 侵入ペナルティ ----
  LIMIT_LINE_FROM_BOTTOM: 150, // 侵入限界ライン（画面下端からの距離）
  PENALTY_NORMAL: 20,
  PENALTY_SPECIAL: 40,
  PRESSURE_PER_BLOCK: 1,       // 侵入ブロック1個あたりの侵入圧力
  PRESSURE_DECAY: 0.15,        // 侵入圧力の自然減少（1/秒）

  // ---- スコア ----
  SCORE_NORMAL: 10,
  SCORE_SPLIT: 30,
  SCORE_CAPTURE: 30,
  SCORE_ITEM: 50,
  SCORE_ARMOR: 1000,           // 装甲ブロック破壊時の基本点
  // 時間倍率：SCORE_MULT_INTERVAL 秒ごとに ×(1+SCORE_MULT_RATE) の複利、上限 SCORE_MULT_MAX。
  // 通常ブロックと装甲ブロックの破壊点にだけ掛かる（一時停止中は進まない）
  SCORE_MULT_INTERVAL: 60,
  SCORE_MULT_RATE: 0.10,
  SCORE_MULT_MAX: 10,

  // ---- 増殖・捕獲 ----
  SPLIT_BLOCK_SPAWN_DEG: 35,   // 増殖ボールが反射方向からずれる角度

  // ---- アイテム（ブロック内蔵。破壊した瞬間に自動取得） ----
  ITEM_BLOCK_CHANCE: 0.07,     // 通常ブロックがアイテムを持つ確率（G 追加後も全体の頻度は据え置き）
  ITEM_WEIGHT_SPLIT: 40,       // 種類の比率（合計100）。G 追加時に 50:25:25 → 40:20:20:20 に配分し直した
  ITEM_WEIGHT_ROTOR: 20,
  ITEM_WEIGHT_PIERCE: 20,
  ITEM_WEIGHT_GRAVITY: 20,
  // P と G の重みに掛ける倍率（アイテムブロック生成時点のボール数で決まる）。
  // [ボール数がこれ以上, 倍率]。下がった分は S と R の比率が相対的に上がる（アイテム全体の頻度は変えない）
  ITEM_PG_RATE_BANDS: [[0, 1.0], [10, 0.5], [30, 0.25], [60, 0.1]],

  // ---- 分裂 ----
  SPLIT_STOCK_MAX: 3,
  SPLIT_COUNTS: [1, 4, 8, 12], // 使用数 → 1球あたりの分裂後の個数
  SPLIT_SPREAD_DEG: 150,       // 分裂ボールが広がる扇の角度（360で全方位）
  SPLIT_MAX_BALLS: 10,         // ボールがこの数以下の時だけ Space で分裂できる（超えている時はストックを消費しない）

  // ---- 回転パドル ----
  ROTOR_DURATION: 15,          // 秒
  ROTOR_BLADES: 3,
  ROTOR_ANGULAR_SPEED: 3.2,    // rad/秒（正で時計回り）
  ROTOR_HUB_OFFSET: 8,         // 中心から羽の根元までの距離

  // ---- 貫通ボール ----
  PIERCE_DURATION: 8,          // 秒

  // ---- グラビティ・リバウンド（G） ----
  GRAVITY_DURATION: 15,          // 秒
  GRAVITY_RANGE_RATIO: 0.20,     // 吸引開始距離（画面高さに対する割合。820px × 0.2 = 164px）
  // 引力 = GRAVITY_ACCEL × (1 - 距離/範囲)^GRAVITY_FALLOFF × (基準速度/初速)²（px/秒²）。範囲の端で0、近いほど強い。
  // 7000 / 0.7 で、真上から落ちるボールをパドル中心から約110px（パドル端の外側約60px）まで回収できる
  GRAVITY_ACCEL: 7000,
  GRAVITY_FALLOFF: 0.7,
  GRAVITY_REBOUND_SPEED: 1.3,    // 急反発の速度倍率（基準速度比）
  GRAVITY_REBOUND_DEPTH: 26,     // 反発領域の高さ：ボール下端がパドル上面からこの距離に入ると反発（px）
  GRAVITY_REBOUND_MARGIN_X: 14,  // 反発領域をパドル幅より左右に広げる量（px）
  GRAVITY_REBOUND_ANGLE: 0.75,   // 当たった位置による角度の付き方（通常パドルの最大角に対する比）
  GRAVITY_KEEP_HORIZONTAL: 0.3,  // ボールの横方向の勢いを残す割合
  GRAVITY_PADDLE_INFLUENCE: 0.25,// パドルの移動速度を反発方向に加える割合
  GRAVITY_MIN_UP_DEG: 35,        // 反発後の最小上向き角（水平からの角度）
  GRAVITY_REBOUND_COOLDOWN: 0.3, // 同じボールが再び急反発できるまでの時間（秒）
  GRAVITY_TRAIL_MAX: 60,         // 軌跡を描くボール数の上限（大量分裂時の見やすさ・負荷対策）
  GRAVITY_FX_PER_FRAME: 4,       // 1フレームに出す反発エフェクト（波紋・粒子）の上限

  // ---- 特別イベント「MILLIONAIRE」 ----
  MILLIONAIRE_SCORE: 1000000,      // 1プレイで初めてこの点数以上になった瞬間に1回だけ発動
  MILLIONAIRE_BALLS: 32,           // 炸裂地点から放射状に出るボールの数
  MILLIONAIRE_BALL_SPEED: 1.0,     // 追加ボールの初速（その時点の基準速度に対する倍率）
  MILLIONAIRE_RISE_TIME: 0.9,      // 花火が画面下から炸裂点まで上がる時間（秒）
  MILLIONAIRE_BURST_Y_RATIO: 0.32, // 炸裂点の高さの目安（画面高さに対する割合。ブロックと重なる時は下へずらす）
  MILLIONAIRE_MESSAGE_TIME: 2.0,   // 炸裂後に「MILLIONAIRE!」を表示する時間（秒）
  MILLIONAIRE_SPARKS: 160,         // 炸裂時の光の粒の数
  MILLIONAIRE_SPARK_MAX: 400,      // 花火の粒の同時表示上限（打ち上げの火花を含む）

  // ---- スコア到達イベント（Ver.1.1、演出のみ。ボール・ブロック・得点・速度は一切変えない） ----
  // 各イベントは1プレイ1回。同じフレームで複数の閾値を超えた時は、MILLIONAIRE の後に順番に再生する。
  //   score: 発動する点数 / title, sub: 表示文言 / sparkColors: 花火の粒の色 / textColors: 称号のグラデーション（上→下）
  //   stroke: 称号の縁取り / flash: 画面フラッシュの色(r,g,b) / shells: 花火の数 / sparks: 花火1発の粒の数
  //   waves: 衝撃波の輪の数 / time: 称号の表示時間（秒） / sound: 効果音 / rainbow: 称号を虹色に流す
  SCORE_EVENTS: [
    { score: 2000000, title: 'DOUBLE MILLIONAIRE!', sub: '2,000,000 POINTS',
      sparkColors: ['#ffffff', '#d8f0ff', '#9fd8ff', '#5ab4ff'], textColors: ['#ffffff', '#c4e8ff', '#4aa8ff'],
      stroke: 'rgba(0, 30, 80, 0.85)', flash: '150, 205, 255', shells: 1, sparks: 110, waves: 2, time: 2.0, sound: 'fanfare1' },
    { score: 5000000, title: 'MEGA MILLIONAIRE!', sub: '5,000,000 POINTS',
      sparkColors: ['#ffd700', '#ffe98a', '#fff4c2', '#ffb347', '#ff9a1f'], textColors: ['#fff6c8', '#ffd700', '#e08a00'],
      stroke: 'rgba(80, 40, 0, 0.85)', flash: '255, 215, 90', shells: 3, sparks: 120, waves: 1, time: 2.4, sound: 'fanfare2' },
    { score: 10000000, title: 'OVERDRIVE LEGEND!', sub: '10,000,000 POINTS',
      sparkColors: ['#ff4d6d', '#ffb347', '#ffe14a', '#5dff8a', '#3ef0ff', '#6f8bff', '#d27aff'], textColors: ['#ffffff', '#ffe14a', '#ff4dd2'],
      stroke: 'rgba(30, 0, 50, 0.9)', flash: '255, 255, 255', shells: 5, sparks: 120, waves: 3, time: 3.0, sound: 'fanfare3', rainbow: true },
  ],
  SCORE_EVENT_SPARK_MAX: 700,       // 新イベントの花火の粒の同時表示上限（MILLIONAIRE の粒と合わせた数）
  SCORE_EVENT_SHELL_RISE: 0.7,      // 花火が上がる時間（秒）
  SCORE_EVENT_SHELL_INTERVAL: 0.28, // 複数の花火を打つ間隔（秒）
  SCORE_EVENT_WAVE_TIME: 0.9,       // 衝撃波が広がる時間（秒）
  SCORE_EVENT_TITLE_Y_RATIO: 0.42,  // 称号の表示位置（画面高さに対する割合）
  SCORE_EVENT_TITLE_SIZE: 38,       // 称号の文字の大きさ（画面幅に収まらない時は自動で縮める）
  SCORE_EVENT_GAP: 0.3,             // 続けて発動した時の、前の称号が消えてから次までの間（秒）

  // ---- ストック超過ボーナス（Ver.1.1） ----
  STOCK_OVERFLOW_BONUS: 5000,       // ストック最大の時に S を取ると、ストックの代わりにこの点数（時間倍率は掛けない）

  // ---- 演出 ----
  PARTICLES_PER_BLOCK: 6,
  PARTICLE_MAX: 2500,
  SFX_MIN_INTERVAL: 0.035,     // 効果音の最小間隔（大量破壊時の音割れ防止）
  SFX_VOLUME: 0.18,
  BGM_VOLUME: 0.35,

  // ---- 操作 ----
  CONTROL_MODE_DEFAULT: 'lock',   // 'lock' = ポインターロック / 'cursor' = カーソル位置追従
  MOUSE_SENSITIVITY_DEFAULT: 1.0, // ロック時の移動量倍率（1.0 = カーソルと同じ見かけの速さ）
  MOUSE_SENSITIVITY_MIN: 0.3,
  MOUSE_SENSITIVITY_MAX: 3.0,
  MOVEMENT_SPIKE_LIMIT: 300,      // 1イベントでこれ以上の movementX は異常値として無視（ブラウザの既知の不具合対策）

  // ---- 開発用 ----
  DEV_KEYS_ENABLED: false,     // 開発用キー（D / 1〜4 / B / Ctrl+Shift+F8・F9）を使うか。公開版では false にする
  DEBUG_DEFAULT: true,         // FPS等の表示を初期状態で出すか
  DT_MAX: 1 / 30,              // フレーム落ち時の最大経過時間
};
