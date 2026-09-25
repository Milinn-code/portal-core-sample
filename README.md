# portal-core-sample

本番運用中の Web サービスの設計をもとに、汎用的な「店舗ポータル（店舗とスタッフを探すサイト）」を題材にしたサンプルです。
本番のコードを題材に合わせて調整した部分と、このサンプルのために新しく書いた部分があります（下の表の「由来」）。

画面やデータベースは含めず、**判断が入る部分の純粋なロジック**と、その判断をテストでどう保証しているかを示すことを目的にしています。

## 内容

| # | テーマ | 由来 | コード | テスト |
|---|---|---|---|---|
| 1 | スタッフの在籍状態の遷移（6状態・終端は一方向） | 本番のコードを調整 | [`src/staff-lifecycle.ts`](src/staff-lifecycle.ts) | [`__tests__/staff-lifecycle.test.ts`](__tests__/staff-lifecycle.test.ts) |
| 2 | 現在地検索の URL パラメータの入力チェック | 本番のコードを調整 | [`src/geo-search.ts`](src/geo-search.ts) | [`__tests__/geo-search.test.ts`](__tests__/geo-search.test.ts) |
| 3 | 料金プランが順位に影響しないランキング（ベイズ平均） | 新規 | [`src/ranking.ts`](src/ranking.ts) | [`__tests__/ranking.test.ts`](__tests__/ranking.test.ts) |
| 4 | 障害時に空の結果をキャッシュしない仕組み | 新規（実際に起きた障害への対策がもと） | [`src/last-good-cache.ts`](src/last-good-cache.ts) | [`__tests__/last-good-cache.test.ts`](__tests__/last-good-cache.test.ts) |

「本番のコードを調整」は、本番のコードを題材の用語に置き換え、このサンプルに合わせて手を入れたものです。3 のベイズ平均による補正は、このサンプルで加えたものです。

設計の意図と状態遷移の図は [docs/design.md](docs/design.md) にあります。

### 設計のポイント

- **ルールを1か所に置く。** 画面の選択肢とサーバ側のガードが同じ遷移表・同じ検証関数を使うので、両者がずれません（1・2）。状態の遷移は、6×6 の全組み合わせで選択肢とガードの結果が一致することをテストしています（1）。
- **守りたい性質を型で保証する。** ランキングの比較関数は、料金プランを持たない型を受け取るので、型のうえでプランを参照できません。テストでは、プランの割り当てを全通り試しても順位が変わらないことを確かめています（3）。
- **同点を残さない。** 最後の比較まで決めてあるので、入力の順番によって順位が変わりません。スコアは分数のまま比べます。浮動小数点で比べると同点を取り違える具体的な例も、テストに入れています（3）。
- **型を信じすぎない。** 型は実行時には消えるので、DB や URL から来た値は実行時にも確かめます。未知の状態名（`'constructor'` のような名前も含む）や、10進の整数以外で書かれた半径は受け付けません（1・2）。
- **障害を「正常な 0 件」と区別する。** 実際に起きた障害をもとにした設計です。失敗を例外として伝え、キャッシュには直前の正常な結果だけを残します（4）。

## 動かし方

Node.js 22 以上（`.node-version` で 22 を指定）が必要です。
pnpm は `package.json` の `packageManager` で固定しているので、`corepack enable` で同じバージョンが使えます。

```sh
corepack enable  # 初回のみ
pnpm install
pnpm test        # 全テスト（数秒で終わります）
pnpm typecheck   # 型チェック
```

## 含めていないもの

認証・権限、個人情報、口コミの審査の仕組み、データベースのスキーマやクエリ、実在の店舗のデータは含めていません。

## 関連

- [multitenant-rls-sample](https://github.com/Milinn-code/multitenant-rls-sample) — もう1つの公開サンプル（PostgreSQL の Row Level Security によるマルチテナントのデータ分離）

## 作者

[Milinn-code](https://github.com/Milinn-code)
