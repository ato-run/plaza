# Plaza compact controlsのmain統合 — 2026-10-08

ユーザーのmainマージ依頼に合わせ、PR #15の`feat/plaza-compact-controls`へ最新main `da85e1c`を統合した。コンパクトなTalk/リアクションUIと、mainで追加された住民会話の2箇所が競合した。

リアクションはmainの住民/ガイドに対する許可条件を維持し、実際の`reactAtTarget`後に折り畳む。Talkは折り畳みを閉じてから既存の`conversationNpc`に従い、Nagi、近所の住民、通常チャットへ分岐する。mainのEnter経路、Eによる会話の廃止、Jump/Crouchのアイコンを維持した。モバイル操作の48px化・リアクションの単一入口・PC初回案内も保持する。

統合後はtypecheck/build成功、Vitest 20ファイル/191件成功。既存の実PlazaエンジンによるローカルChromium検証も再実行し、初回案内1回のみ、解除/再入場、タッチ48px操作、joystick、Talk導線とリアクション4種の開閉が成功した。ログは`.tmp/merge-typecheck.log`、`merge-tests.log`、`merge-build.log`、`merge-ui.log`。

今回の作業はmainへのコード統合で、Plazaのstaging/production公開artifactは更新していない。過去のstaging公開と今回の最新main統合を区別する。最終merge commitは[PR #15](https://github.com/ato-run/plaza/pull/15)のGitHub merge記録を参照する。
