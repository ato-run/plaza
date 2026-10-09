# Plazaの最小描画とdocument保持の検証

Plaza #19はDraft・未マージ。source `18a5ca6bb3272db8f8d92a2b526faf04393b00a9`をstaging
`caprev_plaza_0034` / `swm_plaza_L3Ca0X1CiFMe2ULi`へ公開して検証した。
manifest digestは`sha256:41e957734813453fbad207cecb9b64b88a2173473e04e36cc7f3659ce9a28c2e`。
58ファイル・17,897,828 bytesを配信から取得しdigestを照合した。本番公開・マージは行っていない。

最小Worldを先に描画し、local readyとroom connected・optional completeを分ける。
World生成後にSDKのretention contractを登録し、complete後に保持可能になる。suspend/resumeはWorld inputを休止・clearし、
host側がRAF/timer/audio/WSを休止する。vendor SDKはAPI startup assetと同じbytes。
古いhostでregisterRetentionが存在しない場合は既存起動を維持する。

geometry・textureのCPU/GPU copy・mipmap・canvas・heapを見積もり、未知のimageはInfinityで保持拒否する。
実Chromeのestimateは418,339,344 bytes（約399MiB）、deviceMemory=16GiBだった。
host側は8GiB以上の場合だけ512MiB、他は256MiBを上限にする。OSのRSS硬上限ではない。

API final `86c970e`、PWA final `7d85d04`に固定した通常cache再訪5回は
2.500/2.256/2.380/2.016/2.057秒（中央値2.256、最大2.500）。
新しい親JS取得の最初の4.843秒も保存した。World構築約240〜257ms、初回CPU約187〜243msが残る。
completeのmodel10/texture41は転送0 bytes。画質や資産は減らしていない。

2048から保持Plazaへ戻る5回は0.883/0.864/0.774/0.964/0.936秒（中央値0.883、最大0.964）。
元のiframeを維持し、document/JS/Worldの再初期化通知はなかった。実Menu操作を確認した。
一部の直後の自動clickではMenuが開かず、後続native clickで開いたため、ready通知の値を
人間の最初の入力応答時間とは扱わない。30秒後は破棄され、復帰は新Worldで2.884秒だった。
非SDK/unsupported/busy/期限/権限失効時はhostが保持を拒否し通常起動する。

231 testsとbuildが成功。権限失効の実データ操作・低memory/mobile実機・長時間休止負荷は未検証。
通常起動の1秒目標と約10秒HTTP外れ値の説明は未達。Browser/static routeにprocess warm poolは追加していない。

[PWAの全サンプルとHTTP相関証跡](https://github.com/ato-run/ato-pwa/blob/perf/iframe-startup/docs/ops/2026-10-09-startup-http-retention.md)を参照。
