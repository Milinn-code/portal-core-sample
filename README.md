# portal-core-sample

本番運用中の Web サービスの設計の一部を、汎用的な「店舗ポータル（店舗とスタッフを探すサイト）」の題材に置き換えて切り出したサンプルです。

画面やデータベースは含めず、**判断が入る部分の純粋なロジック**と、その判断をテストでどう保証しているかを示すことを目的にしています。

## 内容

| # | テーマ | コード | テスト |
|---|---|---|---|
| 1 | スタッフの在籍状態の遷移（6状態・終端は一方向） | [`src/staff-lifecycle.ts`](src/staff-lifecycle.ts) | [`__tests__/staff-lifecycle.test.ts`](__tests__/staff-lifecycle.test.ts) |
| 2 | 現在地検索の URL パラメータの入力チェック | [`src/geo-search.ts`](src/geo-search.ts) | [`__tests__/geo-search.test.ts`](__tests__/geo-search.test.ts) |
| 3 | 料金プランが順位に影響しないランキング（ベイズ平均） | [`src/ranking.ts`](src/ranking.ts) | [`__tests__/ranking.test.ts`](__tests__/ranking.test.ts) |
| 4 | 障害時に空の結果をキャッシュしない仕組み | [`src/last-good-cache.ts`](src/last-good-cache.ts) | [`__tests__/last-good-cache.test.ts`](__tests__/last-good-cache.test.ts) |

1・2 は本番のコードを題材に合わせて調整したもの、3・4 は新しく書いたものです（ベイズ平均による補正は、このサンプルで加えたものです）。

設計の意図と状態遷移の図は [docs/design.md](docs/design.md) にあります。

### 設計のポイント

- **ルールを1か所に置く。** 画面の選択肢とサーバ側のガードが同じ遷移表・同じ検証関数を使うので、両者がずれません（1・2）。
- **守りたい性質を型で保証する。** ランキングの比較関数には、型のうえで料金プランが渡りません。テストでは、プランの割り当てを全通り試しても順位が変わらないことを確かめています（3）。
- **同点を残さない。** 最後の比較まで決めてあるので、入力の順番によって順位が変わりません。スコアは分数のまま比べ、浮動小数点の誤差が入らないようにしています（3）。
- **障害を「正常な 0 件」と区別する。** 実際に起きた障害をもとにした設計です。失敗を例外として伝え、キャッシュには直前の正常な結果だけを残します（4）。

## 動かし方

Node.js 20 以上と pnpm が必要です。

```sh
pnpm install
pnpm test        # 全テスト（数秒で終わります）
pnpm typecheck   # 型チェック
```

## 含めていないもの

認証・権限、個人情報、口コミの審査の仕組み、データベースのスキーマやクエリ、実在の店舗のデータは含めていません。

## 作者

[Milinn-code](https://github.com/Milinn-code)
