// 店舗ランキング（純粋ロジック）。
// 店舗は料金プラン（free / basic / premium）を持つが、ランキングの順位には一切使わない。
// 「お金を払えば上位に出る」ランキングは、利用者にとっての信頼性を損なうため。
//
// これを「気をつける」ではなく構造で保証するため、集計の段階で plan を落とした
// RankedShop を作り、比較関数には plan が渡らないようにしている。
//
// 順位はベイズ平均（調整後スコア）で決める。単純な平均だと「5.0 が1件」の店舗が
// 「4.8 が50件」の店舗より上に出てしまうため、全体の平均 C の口コミを
// 各店舗に PRIOR_WEIGHT 件ずつ足してから平均を取る（IMDb や BoardGameGeek と同じ形）。
//
//   調整後スコア = (星の合計 + m × C) / (件数 + m)

export const PLANS = ['free', 'basic', 'premium'] as const;
export type Plan = (typeof PLANS)[number];

export type Shop = {
  id: string;
  name: string;
  /** 店名の読みがな（任意）。漢字の店名を五十音順に並べるために使う。 */
  nameKana?: string;
  /** 料金プラン。表示用のバッジなどには使ってよいが、順位には使わない。 */
  plan: Plan;
};

/** 承認済みの口コミ（審査を通ったものだけが渡される前提）。rating は 1〜5 の整数。 */
export type ApprovedReview = {
  shopId: string;
  rating: number;
};

/** ランキングの1行。plan を持たないことで、比較関数からプランが見えないようにしている。 */
export type RankedShop = {
  shopId: string;
  name: string;
  nameKana?: string;
  /** 承認済みの口コミの星の合計（整数）。 */
  ratingSum: number;
  /** 承認済みの口コミの件数（1 以上）。 */
  reviewCount: number;
  /** 素の平均評価（1〜5）。画面に表示する星はこちら。 */
  averageRating: number;
  /** 調整後スコア（順位の根拠。表示・説明用で、並べ替えには使わない）。 */
  adjustedRating: number;
};

/**
 * 全体の平均 C を「星の合計 ÷ 件数」の整数の組で表したもの。
 * 整数のまま持つことで、調整後スコアの比較を誤差なしで行える。
 */
export type Prior = { ratingSum: number; reviewCount: number };

/** ランキングに表示する件数の上限。 */
export const RANKING_LIMIT = 4;

/** ランキングの対象になるのに必要な、承認済みの口コミの最低件数。 */
export const MIN_REVIEW_COUNT = 1;

/** 各店舗に足す、全体の平均の仮想の口コミの件数（ベイズ平均の m）。 */
export const PRIOR_WEIGHT = 5;

/** 店名の比較（ひらがな・カタカナ・英字を五十音順・アルファベット順に並べる）。 */
const nameCollator = new Intl.Collator('ja');

/** 評価として受け付ける値か（1〜5 の整数）。範囲外の値は集計から外す。 */
function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

/**
 * 調整後スコアを分数（分子 / 分母）で返す。
 * (sum + m × S/G) / (n + m) を、分母を払って (sum×G + m×S) / ((n + m)×G) にする。
 */
function adjustedScore(row: RankedShop, prior: Prior): { num: bigint; den: bigint } {
  const m = BigInt(PRIOR_WEIGHT);
  const g = BigInt(prior.reviewCount);
  return {
    num: BigInt(row.ratingSum) * g + m * BigInt(prior.ratingSum),
    den: (BigInt(row.reviewCount) + m) * g,
  };
}

/**
 * ランキングの並べ替えルール。a を先に並べるなら負の数、b を先なら正の数を返す。
 *
 * 1. 調整後スコアが高い順（分数のたすき掛けで、誤差なく比べる）
 * 2. 同じなら、口コミの件数が多い順
 * 3. 同じなら、店名（読みがながあれば読みがな）の五十音順・アルファベット順
 * 4. それでも同じなら（「あおい」と「アオイ」など）、店舗 ID 順（入力の順番によらず決まるように）
 */
export function compareRankedShops(a: RankedShop, b: RankedShop, prior: Prior): number {
  const sa = adjustedScore(a, prior);
  const sb = adjustedScore(b, prior);
  const lhs = sb.num * sa.den;
  const rhs = sa.num * sb.den;
  if (lhs !== rhs) return lhs < rhs ? -1 : 1;
  if (a.reviewCount !== b.reviewCount) return b.reviewCount - a.reviewCount;
  const byName = nameCollator.compare(a.nameKana ?? a.name, b.nameKana ?? b.name);
  if (byName !== 0) return byName;
  return a.shopId < b.shopId ? -1 : a.shopId > b.shopId ? 1 : 0;
}

export type BuildRankingOptions = {
  /** 表示する件数の上限（既定: RANKING_LIMIT）。 */
  limit?: number;
  /**
   * 全体の平均 C。省略時は、渡された口コミ全体から計算する。
   * 検索条件で絞った口コミを渡すと C が変わって順位が揺れるため、そのときは
   * 全体から計算した値（定期的に保存したものなど）を渡す。
   */
  prior?: Prior;
};

/**
 * 店舗と承認済みの口コミから、ランキング（上位 limit 件）を作る。
 * 口コミが MIN_REVIEW_COUNT 件に満たない店舗は対象外。
 */
export function buildRanking(
  shops: readonly Shop[],
  reviews: readonly ApprovedReview[],
  options: BuildRankingOptions = {},
): RankedShop[] {
  const limit = options.limit ?? RANKING_LIMIT;

  const totals = new Map<string, { sum: number; count: number }>();
  let allSum = 0;
  let allCount = 0;
  for (const review of reviews) {
    if (!isValidRating(review.rating)) continue;
    const t = totals.get(review.shopId) ?? { sum: 0, count: 0 };
    t.sum += review.rating;
    t.count += 1;
    totals.set(review.shopId, t);
    allSum += review.rating;
    allCount += 1;
  }

  const prior = options.prior ?? { ratingSum: allSum, reviewCount: allCount };
  if (!Number.isInteger(prior.ratingSum) || !Number.isInteger(prior.reviewCount)) {
    throw new RangeError('prior must be integers (ratingSum / reviewCount)');
  }

  const rows: RankedShop[] = [];
  for (const shop of shops) {
    const t = totals.get(shop.id);
    if (!t || t.count < MIN_REVIEW_COUNT) continue;
    // ここで plan を落とす。以降の並べ替えはプランを知らない。
    rows.push({
      shopId: shop.id,
      name: shop.name,
      ...(shop.nameKana === undefined ? {} : { nameKana: shop.nameKana }),
      ratingSum: t.sum,
      reviewCount: t.count,
      averageRating: t.sum / t.count,
      adjustedRating: 0, // prior が決まったあとで下で埋める
    });
  }
  if (rows.length === 0) return [];
  if (prior.reviewCount <= 0) {
    throw new RangeError('prior.reviewCount must be positive when there are reviewed shops');
  }

  const priorMean = prior.ratingSum / prior.reviewCount;
  for (const row of rows) {
    row.adjustedRating = (row.ratingSum + PRIOR_WEIGHT * priorMean) / (row.reviewCount + PRIOR_WEIGHT);
  }

  return rows.sort((a, b) => compareRankedShops(a, b, prior)).slice(0, Math.max(0, limit));
}
