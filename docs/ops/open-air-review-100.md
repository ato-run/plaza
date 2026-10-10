# Plaza 100項目の対応と受入確認 — 2026-10-10

レビュー100項目を対象にした実装と試作。100件の既存バグの修正ではない。
この表の「実装」はコードに入った内容であり、全項目の実機合格を意味しない。
実機スマホ、三人の人間、初見五人の評価と音の聴取は未実施。単体テストとスクリプトでは代替しない。

物理は40Hzの共有ログに基づく簡易モデルで、連続した剛体シミュレーションではない。
飛行は10秒、漂流は180秒、砂模様は64件・45秒、所持更新は本人だけという上限を持つ。
新しい持ち上げ操作は未発生の予定衝突を取消し、チェックポイント後も同じ軌道を復元する。

## 対応表

ソースは `src/playground/` 配下。自動検証は `openAir/experiments.test.ts`、`model.test.ts`、
`coop/adapter.test.ts` とAPIの実Durable Objectを使用するApp Roomテストで実施。
地形密度テストは配置の距離検査であり、初心者の歩行結果ではない。

| #   | レビュー項目                                             | 入れた変更                                                             | 主なソース                                                               |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | 夜でも歩く面を読める明るさにする                         | 夜の月光、砂の反射、補助光と露出を調整                                 | scene / layout / engine / feedback / world / CSS                         |
| 2   | 選択表示とサーバーの受付を一致させる                     | サーバーの新鮮な本人位置と、上限付きの操作時位置を照合                 | scene / layout / engine / feedback / world / CSS                         |
| 3   | `plaza_out_of_reach`を利用者向けの文に変える             | 内部エラーを回復操作を示す文へ変換                                     | scene / layout / engine / feedback / world / CSS                         |
| 4   | 確定前に成功を言い切らない                               | 操作IDごとの確定結果で所持品と通知を更新。待機を成功表示から分離       | scene / layout / engine / feedback / world / CSS                         |
| 5   | キャンプの柱とベンチの重なりを直す                       | 柱・屋根・ベンチ・座席の配置を共通定義から再構成                       | scene / layout / engine / feedback / world / CSS                         |
| 6   | 座席から海を見る視線を空ける                             | 正面の看板とヤシを移動。夜の住人の立ち位置を座席の後ろへ               | scene / layout / engine / feedback / world / CSS                         |
| 7   | 座った直後の向きを座席に合わせる                         | 座席の海向きへ0.24秒で回転。動きを減らす設定では即時。以後自由に見回す | scene / layout / engine / feedback / world / CSS                         |
| 8   | 看板の裏面の鏡文字を直す                                 | 看板を両面の個別文字面へ変更                                           | scene / layout / engine / feedback / world / CSS                         |
| 9   | 吹き出しの重なりと同じ台詞の同時発生を止める             | 同時の同文を抑制し、スクリーン上の吹き出しを避け合う                   | scene / layout / engine / feedback / world / CSS                         |
| 10  | 直開き画面のApp infoと持ち物操作の重なりを直す           | ホスト表示を避け、持ち物・ノート・操作位置を再配置                     | scene / layout / engine / feedback / world / CSS                         |
| 11  | 選択中の貝そのものを輪郭で示す                           | 選択物の発光と足元の輪で対象を表示                                     | interaction / worldMath / engine / model / centralGeometry               |
| 12  | 操作表示を対象の下へ逃がす                               | 対象ボタンを画面下部へ移し、背景はドラッグを通す                       | interaction / worldMath / engine / model / centralGeometry               |
| 13  | 物のボタンを具体的な動詞にする                           | 対象名を含む具体的な操作文をボタンに表示                               | interaction / worldMath / engine / model / centralGeometry               |
| 14  | 対象選択に短い保持時間を入れる                           | 160msの対象保持と角度の猶予                                            | interaction / worldMath / engine / model / centralGeometry               |
| 15  | 遮蔽物越しの選択を防ぐ                                   | 不透明な可視物による遮蔽を照合。非表示物は遮蔽物に含めない             | interaction / worldMath / engine / model / centralGeometry               |
| 16  | 小さい物には拾いやすい選択範囲を使う                     | 小物に広い角度と近距離の選択範囲                                       | interaction / worldMath / engine / model / centralGeometry               |
| 17  | 最初の30秒で触れる物を置く                               | 入口に手の届くボールを配置。押す・拾う・投げる・犬の追跡を接続         | interaction / worldMath / engine / model / centralGeometry               |
| 18  | 任意の小走りを試作する                                   | Shiftの小走りとキー変更                                                | interaction / worldMath / engine / model / centralGeometry               |
| 19  | ジャンプの高さを押す長さで調整できるようにする           | ジャンプを離したときの上昇を抑え、小跳躍と長押しを区別                 | interaction / worldMath / engine / model / centralGeometry               |
| 20  | 展望台の石段とヤシの配置を整理する                       | 石段の入口を塞ぐヤシを移動                                             | interaction / worldMath / engine / model / centralGeometry               |
| 21  | 段差判定を、その場所の地面からの高さで調整する           | 足元から段差を判定し、貝の台の周囲に地形の傾斜を追加                   | layout / mantle / engine / scene / coast                                 |
| 22  | 足場を離れた直後のジャンプに短い猶予を入れる             | 100msの崖際猶予と既存の着地前入力バッファ                              | layout / mantle / engine / scene / coast                                 |
| 23  | よじ登りの開始と終了を動きで伝える                       | よじ登りの弧、短い上下動、開始・終了音と表示                           | layout / mantle / engine / scene / coast                                 |
| 24  | 着地の強さを短い動きで返す                               | 着地速度と材質に応じた音と任意の視点の反応                             | layout / mantle / engine / scene / coast                                 |
| 25  | カニが隠れる過程を見せる                                 | 接近速度としゃがみに応じてカニを滑らかに退避                           | layout / mantle / engine / scene / coast                                 |
| 26  | 開始視点に三つの関心を収める                             | 入口の近いボール・遠いアーチ・帆を見通す配置                           | layout / mantle / engine / scene / coast                                 |
| 27  | 砂丘で少し先を隠す                                       | 入り江の手前に低い砂丘の肩を追加                                       | layout / mantle / engine / scene / coast                                 |
| 28  | 展望台だけで分かる発見を作る                             | 高台から見える、入り江の貝のらせんを配置                               | layout / mantle / engine / scene / coast                                 |
| 29  | 展望台に別の登り方を作る                                 | 高台へ低い岩をたどる別経路を追加                                       | layout / mantle / engine / scene / coast                                 |
| 30  | 海岸・高台・キャンプを周回路で結ぶ                       | 高台・潮だまり・桟橋・キャンプの地続きの周回を維持                     | layout / mantle / engine / scene / coast                                 |
| 31  | 潮だまりから桟橋への途中にも試行を置く                   | 岸の木片、葉、貝を共通の物体操作で配置                                 | model / scene / coast / scenery                                          |
| 32  | 探索密度を歩いて測る                                     | 周回路のサンプル点から15m以内の関心点を自動検証し配置を補充            | model / scene / coast / scenery                                          |
| 33  | 外周の砂壁を区間ごとに変える                             | 岩の区間、崩れた地形、植生の区間を外周へ配置                           | model / scene / coast / scenery                                          |
| 34  | 潮だまりを岩のくぼみとして造形する                       | 円盤の水を取り除き、共通地形のくぼみと岩の縁へ変更                     | model / scene / coast / scenery                                          |
| 35  | 遠景の形で場所を識別できるようにする                     | 石の高台、アーチ、帆、屋根と灯りの異なる輪郭                           | model / scene / coast / scenery                                          |
| 36  | 道標に置いた貝も拾えるようにする                         | 道標の貝を通常の共有アイテムへ統一                                     | model / scene / coast / scenery                                          |
| 37  | 空の展示案内板を縮めて視線の脇へ移す                     | 空の展示板を縮め、入口から脇へ移動                                     | model / scene / coast / scenery                                          |
| 38  | 桟橋の先に行きたくなる変化を置く                         | 桟橋の先の浮く木片と葉を配置                                           | model / scene / coast / scenery                                          |
| 39  | 飛び石の間隔と高さに変化を付ける                         | 飛び石の位置、半径、高さを変化                                         | model / scene / coast / scenery                                          |
| 40  | 深い水への限界を身体の反応で伝える                       | 深い流れの表示、水しぶき、潮で動く安全ブイと退路                       | model / scene / coast / scenery                                          |
| 41  | 投げる上下方向を視線に合わせる                           | 投げる高さと上下速度を視線から計算                                     | physics / model / scene / clock / PlaygroundPage                         |
| 42  | 投げる強さを調整できるようにする                         | 押す長さで強さを調整し、軌道を表示                                     | physics / model / scene / clock / PlaygroundPage                         |
| 43  | 置く前に置き場所を薄く表示する                           | 地面・支持物の高さを選ぶ置き場所のゴースト                             | physics / model / scene / clock / PlaygroundPage                         |
| 44  | 置く物の向きを調整できるようにする                       | Rと回転ボタンで持ち物の向きを調整                                      | physics / model / scene / clock / PlaygroundPage                         |
| 45  | 物同士が接触して支え合う規則を作る                       | 物体の支持、積み重ね、重さによる衝突を共有状態に記録                   | physics / model / scene / clock / PlaygroundPage                         |
| 46  | 他の人の持ち物を見せる                                   | 本人以外の手元にも共有所持物を表示                                     | physics / model / scene / clock / PlaygroundPage                         |
| 47  | 葉の流れる向きを共有する風に合わせる                     | 葉・帆・植生が共有の風ベクトルを読む。風の切替は移動を積分             | physics / model / scene / clock / PlaygroundPage                         |
| 48  | 浮く木を意味のある距離まで運ぶ                           | 浮く物を共有の流れで最長180秒、約8m運ぶ                                | physics / model / scene / clock / PlaygroundPage                         |
| 49  | ボールを拾わずに軽く押せるようにする                     | 移動中にボールへ触れると上限付きの弱い押しを送信                       | physics / model / scene / clock / PlaygroundPage                         |
| 50  | 持ち物の90秒失効を無言にしない                           | 本人の所持を10秒ごとに更新。切断時は90秒で回収可能                     | physics / model / scene / clock / PlaygroundPage                         |
| 51  | 石で葉を押さえられるようにする                           | 石の支持関係で葉の風による移動を抑える                                 | physics / model / scene / villager / notebook                            |
| 52  | 波と潮が貝の露出を変えるようにする                       | 共通の水位と波で水際の貝の露出を変える                                 | physics / model / scene / villager / notebook                            |
| 53  | 犬が実際に転がるボールを追うようにする                   | 犬が最近動いた実際のボールの位置を追跡                                 | physics / model / scene / villager / notebook                            |
| 54  | 浮く木に軽い物を載せて運べるようにする                   | 軽い積荷を木へ載せて運び、偏った重い積荷は落下する                     | physics / model / scene / villager / notebook                            |
| 55  | カニを住人と一緒に観察できるようにする                   | 住人のしゃがむ姿勢とカニの接近反応を接続                               | physics / model / scene / villager / notebook                            |
| 56  | 貝の配置そのものに住人が反応する                         | 台上の実際の座標から貝の列・輪・集まりを判定                           | physics / model / scene / villager / notebook                            |
| 57  | 条件が合う投げ方で石が水面を跳ねるようにする             | 石の速度・角度・水面の衝突から水切りを判定                             | physics / model / scene / villager / notebook                            |
| 58  | 砂に短い線や模様を残せるようにする                       | 上限付きの共有砂模様。時間と潮で消す                                   | physics / model / scene / villager / notebook                            |
| 59  | 木片を低い溝へ渡して足場にできるようにする               | 置いた木の形から歩行支持面を作り、浅い溝を渡れる判定                   | physics / model / scene / villager / notebook                            |
| 60  | 一つの発見から次の試行を二つ用意する                     | 発見ごとに次の実験の選択肢をノートへ残す                               | physics / model / scene / villager / notebook                            |
| 61  | 修理の行為で対象が変わるようにする                       | 実際の木の材料で修理を記録し、板と屋根のたわみを変更                   | model / work / life / villager / GuideDialog / escortChoices             |
| 62  | 木を集める住人が共有物を動かすようにする                 | 共有時計の運搬サイクルと同じ通常の木片を描画                           | model / work / life / villager / GuideDialog / escortChoices             |
| 63  | 落とし物の探し方を世界の中で伝える                       | 落とした貝の実位置へOliveの向きと探す姿勢を向ける                      | model / work / life / villager / GuideDialog / escortChoices             |
| 64  | 会話を直前の行為に合わせる                               | 本人の実際の接点と直近の発見を会話へ反映                               | model / work / life / villager / GuideDialog / escortChoices             |
| 65  | 短い会話は相手の顔を見ながら続けられるようにする         | 短い会話を画面の隅へ。詳しい会話は任意に展開                           | model / work / life / villager / GuideDialog / escortChoices             |
| 66  | 同行先を住人の関心と現在地で変える                       | 住人ごとの関心と現在地から同行先を選ぶ                                 | model / work / life / villager / GuideDialog / escortChoices             |
| 67  | 同行の開始・待機・到着を伝える                           | 同行の歩行・待機・到着状態を表示し、姿勢へ反映                         | model / work / life / villager / GuideDialog / escortChoices             |
| 68  | 同行を途中でやめる操作を用意する                         | 同行相手と解散ボタンを探索中にも表示                                   | model / work / life / villager / GuideDialog / escortChoices             |
| 69  | 同行の到着後に一緒に行動する                             | 到着先に応じてカニ・木・景色の活動へ移行                               | model / work / life / villager / GuideDialog / escortChoices             |
| 70  | 反応を表情・姿勢・行為でも返す                           | 物体の出来事に短い身体反応。同じ保持更新では台詞を繰り返さない         | model / work / life / villager / GuideDialog / escortChoices             |
| 71  | 共有の昼夜を滑らかに移す                                 | 共有時計の進行度で空の色と照明を補間                                   | lighting / clock / environment / coastShader / scene / life              |
| 72  | 個人照明を切り替えたら、空・星・ランプの見え方をそろえる | 個人照明で空・星・ランプを統一。遊びの時計は共有                       | lighting / clock / environment / coastShader / scene / life              |
| 73  | 照明変更中は実世界の状態も分かるようにする               | ノートに個人照明と実際の共有状態を別々に表示                           | lighting / clock / environment / coastShader / scene / life              |
| 74  | 潮の表示を水位と増減から決める                           | 潮の微分と極値から満ち引きを判定                                       | lighting / clock / environment / coastShader / scene / life              |
| 75  | 潮位の変化を岩の濡れ跡や漂着線で予告する                 | 水位に追従する岩の濡れ帯と漂着物                                       | lighting / clock / environment / coastShader / scene / life              |
| 76  | 潮が満ちたときの戻り道を景色で示す                       | 高い潮でも露出する岩、ブイ、浅い方へ戻る移動を維持                     | lighting / clock / environment / coastShader / scene / life              |
| 77  | 雨で地面と物の反応を変える                               | 雨による濡れた地面、水たまり、葉の付着                                 | lighting / clock / environment / coastShader / scene / life              |
| 78  | 雨宿りの判定を実際の屋根に合わせる                       | 屋根の実際の形・高さ・修理のたわみから雨宿りを判定                     | lighting / clock / environment / coastShader / scene / life              |
| 79  | 風車の回転速度を風の強さに合わせる                       | 風の強さに応じて風車を回転                                             | lighting / clock / environment / coastShader / scene / life              |
| 80  | 住人が天候の変化に段階的に気づくようにする               | 住人ごとに時差を付けて天候・生活の移動を開始                           | lighting / clock / environment / coastShader / scene / life              |
| 81  | Enterで話す相手を事前に示す                              | 会話先をTalkボタンへ表示。住人会話もEnterへ統一                        | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 82  | 移動・視点・物体操作のキーを変更できるようにする         | 移動・物体・視点キーを保存し、予約キーと重複を拒否                     | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 83  | ノートの内部IDを利用者の言葉へ変える                     | ノートを住人名と出来事の文章へ変換                                     | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 84  | ノートに次に試せる手掛かりを一つ残す                     | 直近の発見から次の試行の手掛かりを表示                                 | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 85  | 訪れた場所を自然に記録する                               | 場所へ入ったときに本人の訪問を共有ログへ記録                           | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 86  | メニューの場所ボタンの結果を明示する                     | 場所ボタンをShow route toへ変更                                        | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 87  | 持っている物の形をHUDにも示す                            | 持ち物の種類・形・色の小さな図を表示                                   | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 88  | タッチ操作は両親指の動作で設計する                       | 両親指の領域へ操作を再配置。投げるボタンもtouch identifierで追跡       | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 89  | 視野角も調整できるようにする                             | 視野角50〜95度を本人設定として保存                                     | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 90  | 動きを減らしても世界の変化が読めるようにする             | 動きを抑えても濡れた地面・水たまり・帆の向きで状態を表示               | PlaygroundPage / PlazaMenu / ExploreControls / settings / notebook / CSS |
| 91  | 追加した石段・アーチ・桟橋の仕上げを統一する             | 石の材質と面取りを統一。既存のアバターは維持                           | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 92  | カニの形と動きを生き物として読めるようにする             | カニへ脚、はさみ、目、歩行と退避を追加                                 | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 93  | 貝に少数の形・模様の違いを作る                           | 貝へ色と表面の山の形の差を追加                                         | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 94  | 浅瀬と岩際の泡の切れ方を直す                             | 共通地形と水深の連続した泡へ変更                                       | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 95  | 噴水の飛沫を大きい白い四角から変える                     | 飛沫を柔らかい小さい点へ変更                                           | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 96  | 環境音を寄り道の手掛かりとして調整する                   | 方位から左右の音を計算し、カニと修理の音を追加。聴取評価は未実施       | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 97  | 入力から結果までの時間を実機で測る                       | 入力→描画と操作→共有確定を種類別にローカル計測。実機の受入計測は継続   | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 98  | 実機スマホで同時タッチと復帰を確認する                   | 実機の同時タッチ・回転・復帰の手順を整備。実機検証は未実施             | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 99  | 三人の人間で自然な共同プレイを確認する                   | 独立クライアントの共有検証を実施。三人の人間の共同プレイは未実施       | stone / scene / ocean / props / audio / metrics / acceptance kit         |
| 100 | 初見の五人が説明なしで遊べることを合格条件にする         | 五人の初見プレイの記録様式と合格条件を整備。人の観察は未実施           | stone / scene / ocean / props / audio / metrics / acceptance kit         |

## 人の受入確認

音: 音量を同じにし、噴水・火・カニ・修理から離れる／左右へ向く。方向と距離を聴取し、気付けた寄り道を記録する。

スマホ: 実機、OS、ブラウザ、縦横を記録。移動＋視点＋拾う／置く／投げる、ジャンプの長押し、Menu開閉、画面回転、別アプリからの復帰を行う。二本目・三本目の指で移動や視点が途切れないこと、復帰後に投げっぱなしや歩きっぱなしにならないことを確認する。

三人: 同じ物を同時に拾う、手渡す、貝の輪を一緒に作る、一人が木を浮かべ別の人が貝を載せる、住人の同行と解散、退出後の回収を行う。順序の一致と人が結果を説明できることを別々に記録する。

初見五人: 操作の説明を口で補わず、各人の最初の操作時刻、三分以内の寄り道、思い付いた二つの試行、迷った対象・場所を記録する。30秒以内の最初の操作、三分以内の寄り道、二つ以上の自発的な試行を仮の合格条件とし、未達なら配置と操作を直す。人数、所要時間、結果を作り上げない。

記録欄: 実機／参加者（匿名ID）／開始時刻／最初の操作秒／寄り道秒／試行1／試行2／詰まり／結果／再調整。

## 検証記録

Plaza: 初期231件から回帰テストを追加。型検査、全テスト、buildを実施。最新の件数と配信先は下の追記を正とする。
API: 共通ソースから生成したアダプターを実Durable Object・D1・WebSocketのテストで検証。
staging: mainに未統合の既存キュレーション機能を落とさず、現在のstagingをベースに今回の差分だけを重ねる。
本番の配信・migration・feature flagの変更は対象外。

ブラウザでの測定値は、入力から次のWebGL描画、操作送信からその操作IDの共有状態適用までを測る。
前者はDOMの最終paintを厳密に保証する計測ではなく、後者は回線を含む。
隠れたDOM outputに個人を含まない集計だけを表示し、外部へ送信しない。ツールの往復時間を入力遅延として扱わない。

### ローカルの確認済み結果

- Plaza: 255テスト / 30ファイル、型検査、build成功。初期JS 990.32kB（gzip 292.06kB）。既存の500kB警告は残る。任意アセットの遅延読み込みは維持。
- IABの1280×720で実際のキー入力を測定。視点10件: 中央27.1ms / p95 29.0ms。移動10件: 中央27.3ms / p95 28.2ms。対象表示20件: 中央27.3ms / p95 29.0ms。回線なしのローカル描画の一回のコホートで、スマホや共有確定の計測ではない。
- 夜の地面と小物の可読性、入口のボール、両面看板、Menuの照明・キー・視野角の表示をブラウザで確認。証跡はworkspaceの `.tmp/plaza-open-air-review-100/`。
- 開発途中のHMRで一時的な古い関数呼び出しの例外が出た。該当呼び出しを除き、型検査とbuildを通して再読み込みした。配信版の確認は別途記録する。

### 実プレイで追加した回帰修正

キャンプのベンチ本体が自分自身の座席への視線を遮り、座席を選びにくかった。ベンチに所有する座席IDを付け、その座席を狙う場合だけ自分のベンチを遮蔽物から除く。他のベンチ・小物・人物への遮蔽判定は維持する。実際のThree.jsのRaycasterで、自分の座席は選べることと別対象は遮られることを回帰検証した。

追加後: 256テスト / 30ファイル、型検査とbuild成功。初期JS 990.60kB（gzip 292.48kB）。配信の確認結果は次の追記へ記録する。

住人・Nagi・プレイヤーの頭部にも同じ自己遮蔽が起きるため、同じ対象IDの仕組みを適用した。3種類のキャラクターについて自分のモデルは遮らず、別の対象は遮ることを実Raycasterで追加検証した。ローカルブラウザで「Sit」と「Talk to Nagi」が選択できることを確認した。

場面のボタンをマウスで使った後、そのボタンにフォーカスが残ると移動キーまで止まっていた。ボタンのEnter・Spaceによる通常操作とテキスト入力は維持し、場面のボタンにフォーカスが残っていても移動・視点のキーを受け付けるようにした。会話・Menuを開いている間の停止は維持する。

ローカルの実ブラウザでノートのボタンにフォーカスが残ったままWと右矢印を操作し、移動・視点の描画計測が増えることを確認。そのままSpaceでノートが閉じることも確認した。型検査とbuild成功。直前の259テストは共有・選択ロジックの結果であり、このフォーカス変更は実ブラウザで検証した。

stagingのプレイで、会話パネルの旧中央寄せの変換が残って左端が切れることを発見した。コンパクト表示の変換を解除し、内側余白を指定幅に含めて狭い画面にも収める。

同行の開始は共有確定したが、自分は一人称のため表示アバターの位置一覧に含まれず、住人が本人の位置を参照できなかった。本人のカメラ位置も共有状態を表示するための位置一覧へ含める。待機の4m境界をわずかに超えても、サーバーの到達距離4.5m内で予約を更新できるようにした。配信後の移動・待機・解散の実プレイ結果は次の追記へ記録する。

予約・持ち物の自動更新は入力→描画のサンプルから除外する。共有確定の計測は引き続き本人が送った操作IDに結び付ける。

会話パネルの実ブラウザ確認: 1280px画面では左16px・幅380px、390×844のviewportでは左16px・幅358pxで左右が収まる。「Continue conversation」も高さ44pxの共通ボタンにした。viewportの検証は実機スマホ・同時タッチの検証ではない。
