import { describe, expect, it } from 'vitest';
import {
  PLANS,
  PRIOR_WEIGHT,
  RANKING_LIMIT,
  buildRanking,
  compareRankedShops,
  type ApprovedReview,
  type Plan,
  type Shop,
} from '../src/ranking';

// 前半: 並べ替えのルールの細部によらず成り立つべき性質（プラン非依存・絞り込み・決定性）。
// 後半: 採用したルール（ベイズ平均 → 件数 → 店名 → 店舗 ID）そのもの。

const shop = (id: string, plan: Plan = 'free'): Shop => ({ id, name: `店舗${id}`, plan });
const reviewsOf = (shopId: string, ...ratings: number[]): ApprovedReview[] =>
  ratings.map((rating) => ({ shopId, rating }));

/** 配列の全順列（小さな入力の網羅テスト用）。 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** n 店舗へのプランの割り当てを全通り（3^n）列挙する。 */
function allPlanAssignments(n: number): Plan[][] {
  if (n === 0) return [[]];
  return allPlanAssignments(n - 1).flatMap((rest) => PLANS.map((p) => [p, ...rest]));
}

const ids = (rows: { shopId: string }[]) => rows.map((r) => r.shopId);

describe('buildRanking: 料金プランは順位に影響しない', () => {
  const baseShops = ['a', 'b', 'c', 'd', 'e'].map((id) => shop(id));
  const reviews = [
    ...reviewsOf('a', 5, 4),
    ...reviewsOf('b', 3, 3, 4),
    ...reviewsOf('c', 5, 5, 5),
    ...reviewsOf('d', 2),
    ...reviewsOf('e', 4, 4, 4, 5),
  ];

  it('プランの割り当てを全通り（3^5 = 243 通り）変えても、順位は同じ', () => {
    const expected = ids(buildRanking(baseShops, reviews));
    for (const plans of allPlanAssignments(baseShops.length)) {
      const shops = baseShops.map((s, i) => ({ ...s, plan: plans[i]! }));
      expect(ids(buildRanking(shops, reviews))).toEqual(expected);
    }
  });

  it('結果の行に plan は含まれない', () => {
    const shops = baseShops.map((s) => ({ ...s, plan: 'premium' as const }));
    for (const row of buildRanking(shops, reviews)) {
      expect(row).not.toHaveProperty('plan');
    }
  });
});

describe('buildRanking: 対象の絞り込み', () => {
  it('口コミが0件の店舗は対象外（premium でも出ない）', () => {
    const shops = [shop('a'), shop('b', 'premium')];
    const rows = buildRanking(shops, reviewsOf('a', 3));
    expect(ids(rows)).toEqual(['a']);
  });

  it('口コミが1件もなければ空のランキング', () => {
    expect(buildRanking([shop('a'), shop('b')], [])).toEqual([]);
  });

  it(`上位 ${RANKING_LIMIT} 件までに絞る`, () => {
    const shops = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => shop(id));
    const reviews = shops.flatMap((s) => reviewsOf(s.id, 4));
    expect(buildRanking(shops, reviews)).toHaveLength(RANKING_LIMIT);
  });

  it('limit に 0 以下を渡すと空', () => {
    expect(buildRanking([shop('a')], reviewsOf('a', 5), { limit: 0 })).toEqual([]);
    expect(buildRanking([shop('a')], reviewsOf('a', 5), { limit: -1 })).toEqual([]);
  });

  it('店舗一覧にない店舗の口コミは無視する', () => {
    const rows = buildRanking([shop('a')], [...reviewsOf('a', 3), ...reviewsOf('ghost', 5)]);
    expect(ids(rows)).toEqual(['a']);
  });

  it('範囲外・整数でない評価は集計から外す', () => {
    const rows = buildRanking([shop('a')], reviewsOf('a', 4, 0, 6, 4.5, NaN));
    expect(rows).toEqual([
      { shopId: 'a', name: '店舗a', ratingSum: 4, reviewCount: 1, averageRating: 4, adjustedRating: 4 },
    ]);
  });
});

describe('buildRanking: 集計', () => {
  it('承認済みの口コミの平均と件数を出す', () => {
    const rows = buildRanking([shop('a')], reviewsOf('a', 5, 4, 3));
    expect(rows).toEqual([
      { shopId: 'a', name: '店舗a', ratingSum: 12, reviewCount: 3, averageRating: 4, adjustedRating: 4 },
    ]);
  });
});

describe('buildRanking: 並び順', () => {
  it('件数が同じなら、平均評価が高い店舗が上', () => {
    const shops = [shop('low'), shop('high'), shop('mid')];
    const reviews = [
      ...reviewsOf('low', 2, 3, 3),
      ...reviewsOf('high', 5, 5, 4),
      ...reviewsOf('mid', 4, 4, 3),
    ];
    expect(ids(buildRanking(shops, reviews))).toEqual(['high', 'mid', 'low']);
  });

  it('入力の順番を全通り入れ替えても、結果は同じ（平均も件数も同じ店舗があっても決定的）', () => {
    const shops = [shop('a'), shop('b'), shop('c'), shop('d')];
    // b と c は平均も件数も同じ
    const reviews = [
      ...reviewsOf('a', 5, 5),
      ...reviewsOf('b', 4, 4),
      ...reviewsOf('c', 4, 4),
      ...reviewsOf('d', 3, 3),
    ];
    const expected = ids(buildRanking(shops, reviews));
    for (const order of permutations(shops)) {
      for (const reviewOrder of [reviews, [...reviews].reverse()]) {
        expect(ids(buildRanking(order, reviewOrder))).toEqual(expected);
      }
    }
  });
});

describe('buildRanking: 口コミが少ない店舗の補正（ベイズ平均）', () => {
  it('5.0 が1件の店舗より、4.8 が50件の店舗が上', () => {
    const shops = [shop('one'), shop('many')];
    const reviews = [
      ...reviewsOf('one', 5),
      ...reviewsOf('many', ...Array<number>(40).fill(5), ...Array<number>(10).fill(4)), // 平均 4.8
    ];
    // 全体の平均 C = 4.2 とする（この2店舗だけから計算すると C ≈ 4.80 と高く、
    // m = 5 では C が約 4.755 を超えると「5.0 が1件」の店舗が上に来てしまう）
    const rows = buildRanking(shops, reviews, { prior: { ratingSum: 42, reviewCount: 10 } });
    expect(ids(rows)).toEqual(['many', 'one']);
    // 表示用の素の平均は補正しない
    expect(rows.find((r) => r.shopId === 'one')?.averageRating).toBe(5);
  });

  it('調整後スコアは (合計 + m×C) / (件数 + m)', () => {
    // C = (5 + 3) / 2 = 4、m = PRIOR_WEIGHT
    const rows = buildRanking([shop('a'), shop('b')], [...reviewsOf('a', 5), ...reviewsOf('b', 3)]);
    const a = rows.find((r) => r.shopId === 'a')!;
    expect(a.adjustedRating).toBeCloseTo((5 + PRIOR_WEIGHT * 4) / (1 + PRIOR_WEIGHT));
  });

  it('prior を渡すと、その値を全体の平均として使う', () => {
    // 渡した口コミだけなら C = 5 だが、prior で C = 1 にすると補正が強く下向きに効く
    const rows = buildRanking([shop('a')], reviewsOf('a', 5), { prior: { ratingSum: 10, reviewCount: 10 } });
    expect(rows[0]!.adjustedRating).toBeCloseTo((5 + PRIOR_WEIGHT * 1) / (1 + PRIOR_WEIGHT));
  });

  it('prior が整数でなければエラー', () => {
    expect(() =>
      buildRanking([shop('a')], reviewsOf('a', 5), { prior: { ratingSum: 4.2, reviewCount: 1 } }),
    ).toThrow(RangeError);
  });

  it('prior が「1〜5 の評価の合計」として成り立たなければエラー（全体の平均が 1〜5 の外になる）', () => {
    for (const prior of [
      { ratingSum: 10, reviewCount: 0 },
      { ratingSum: -100, reviewCount: 10 },
      { ratingSum: 9, reviewCount: 10 }, // 平均 0.9
      { ratingSum: 51, reviewCount: 10 }, // 平均 5.1
    ]) {
      expect(() => buildRanking([shop('a')], reviewsOf('a', 5), { prior }), JSON.stringify(prior)).toThrow(
        RangeError,
      );
    }
  });

  it('compareRankedShops を直接呼んでも、不正な prior は分かる例外になる（BigInt の変換エラーにしない）', () => {
    const [row] = buildRanking([shop('a')], reviewsOf('a', 5));
    expect(() => compareRankedShops(row!, row!, { ratingSum: 4.2, reviewCount: 1 })).toThrow(
      /prior must be integers/,
    );
  });
});

describe('buildRanking: 入力の検査', () => {
  it('同じ店舗 ID が2行あればエラー（JOIN の重複などで同じ店舗が2枠を占めないように）', () => {
    const shops = [shop('a', 'free'), shop('a', 'premium'), shop('b')];
    const reviews = [...reviewsOf('a', 5), ...reviewsOf('b', 4)];
    expect(() => buildRanking(shops, reviews)).toThrow(/duplicate shop id: a/);
  });
});

describe('buildRanking: 同点のときの並び', () => {
  it('調整後スコアが同じなら、口コミが多い店舗が上', () => {
    // C = 36 / 9 = 4、m = 5 のとき
    //   few : (5 + 20) / (1 + 5)  = 25/6
    //   many: (30 + 20) / (7 + 5) = 50/12 = 25/6  ← 同点
    expect(PRIOR_WEIGHT).toBe(5);
    const shops = [shop('few'), shop('many'), shop('low')];
    const reviews = [
      ...reviewsOf('few', 5),
      ...reviewsOf('many', 5, 5, 4, 4, 4, 4, 4),
      ...reviewsOf('low', 1),
    ];
    expect(ids(buildRanking(shops, reviews))).toEqual(['many', 'few', 'low']);
  });

  it('浮動小数点では差が出てしまう同点も、分数で比べるので件数順になる', () => {
    // C = 4 / 3、m = 5 のとき、分数ではどちらも 13/9 で同点:
    //   few : (2 + 5×4/3) / (1 + 5)   = 13/9
    //   many: (15 + 5×4/3) / (10 + 5) = 13/9
    // ところが浮動小数点で計算すると few = 1.4444444444444444、many = 1.4444444444444442 になり、
    // 小数で比べる実装では件数の少ない few が上に来てしまう。
    const shops = [shop('few'), shop('many')];
    const reviews = [...reviewsOf('few', 2), ...reviewsOf('many', 1, 1, 1, 1, 1, 2, 2, 2, 2, 2)];
    const rows = buildRanking(shops, reviews, { prior: { ratingSum: 4, reviewCount: 3 } });

    const adjusted = Object.fromEntries(rows.map((r) => [r.shopId, r.adjustedRating]));
    expect(adjusted['few']).toBeGreaterThan(adjusted['many']!); // 小数の値だけ見ると few が上に見える
    expect(ids(rows)).toEqual(['many', 'few']); // 分数で比べると同点 → 件数の多い many が上
  });

  it('スコアも件数も同じなら、店名の五十音順（ひらがな・カタカナ・英字をまとめて比べる）', () => {
    const shops = [
      { ...shop('1'), name: 'さくら' },
      { ...shop('2'), name: 'Bloom' },
      { ...shop('3'), name: 'アオイ' },
      { ...shop('4'), name: 'apple' },
    ];
    const reviews = shops.flatMap((s) => reviewsOf(s.id, 4));
    expect(buildRanking(shops, reviews).map((r) => r.name)).toEqual(['apple', 'Bloom', 'アオイ', 'さくら']);
  });

  it('読みがながあれば、漢字の店名も読みの順', () => {
    const shops = [
      { ...shop('1'), name: '東京店', nameKana: 'とうきょうてん' },
      { ...shop('2'), name: '青山店', nameKana: 'あおやまてん' },
    ];
    const reviews = shops.flatMap((s) => reviewsOf(s.id, 4));
    expect(buildRanking(shops, reviews).map((r) => r.name)).toEqual(['青山店', '東京店']);
  });

  it('店名まで同じ扱い（あおい / アオイ）なら、店舗 ID 順', () => {
    const shops = [
      { ...shop('b'), name: 'あおい' },
      { ...shop('a'), name: 'アオイ' },
    ];
    const reviews = shops.flatMap((s) => reviewsOf(s.id, 4));
    for (const order of permutations(shops)) {
      expect(ids(buildRanking(order, reviews))).toEqual(['a', 'b']);
    }
  });
});
