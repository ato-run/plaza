# Plaza操作UIのstaging確認 — 2026-10-08

モバイルのCrouch/Jumpを48pxへ変更し、safe-areaを考慮した画面下部へ配置した。joystickも下方へ寄せ、Talkを主操作としてリアクション4種を1つの入口へ折り畳む。実際の操作ハンドラは維持し、会話/リアクションの認証境界を変更していない。

PCでは`Click to explore`の初回クリック後だけ8秒間の操作案内を表示する。実際に対応するWASD移動・視点・Spaceジャンプ・Esc解除を示す。pointer lockではマウス解除、drag fallbackでは探索モード終了と表示し、対応していない矢印キーを案内しない。説明の先頭も広場を歩いて人と会話する用途へ変更し、instanceの技術説明は詳細に残した。

## 配信

- 配信ソース: `56ecf56310587b06a4c41076766e1daf174ff4b9` / `feat/plaza-compact-controls`。
- [Draft PR #15](https://github.com/ato-run/plaza/pull/15)。main/productionへの反映は行っていない。
- 公開Capsule: `cap_plaza`、revision `caprev_plaza_0025`。
- Materialization: `swm_plaza_1SCdRnoGIo5ToqCi`。
- Manifest: `sha256:c4264fd2f45c8691c0b02e373c16ce119235b7bdb5d148f2885859f796d60c5d`。
- 56ファイル / 17,630,829 bytes。APIの既存`publish-materialization.mjs --env staging`で全ファイルをR2 read-back hash確認後に公開し、`seed-discover.mjs --env staging`で既存`discover-plaza`を更新。
- https://stg-app.ato.run の実Plaza iframeがこのmanifestの`index-CV7WMeyt.js`を参照し、実3D画面が表示されることを確認。

## 検証

typecheck/build成功、Vitest 188件/19スイート成功。依存はroot/controllerともlockfile固定で導入し、lockfile変更なし。

ローカルの実PlazaエンジンをChromiumで実行し、PCの初回操作案内、解除、再入場時に案内が繰り返されないことを確認。タッチ端末相当の`pointer:coarse`環境ではCrouch/Jump各48×48px、下端余白132px/76px、joystick約106px、Talk入口、リアクション4種の開閉を確認した。未ログインなら既存どおり`Sign in to talk`を表示する。

タッチ判定はviewport幅だけでは変わらない。stgのPCブラウザを390pxへ縮めた状態をモバイル実機Acceptanceと呼ばず、タッチ操作はローカルの実ブラウザ検証と配信ファイルの同一性を根拠にする。stg埋め込み内のクリックは確認用ブラウザからの制御が失敗したため、stgで操作案内までクリック検証済みとは報告しない。

実行記録: `.tmp/refinement-tests.log`、`.tmp/check-plaza-ui.mjs`、`.tmp/plaza-ui-check.json`、`.tmp/plaza-desktop.png`、`.tmp/plaza-mobile.png`。APIの公開/seedログは同タスクのAPI worktreeに保持。記録用の後続commitは配信ソースSHAとは区別する。
