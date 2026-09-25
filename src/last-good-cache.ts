// 障害時に「空の結果」や「劣化した結果」をキャッシュしない、小さなキャッシュ部品。
//
// 背景: 一時的な DB 障害のとき、取得処理が例外を握りつぶして 0 件を返し、その 0 件が
// 60 秒キャッシュされて全員に空のランキングが表示された。キャッシュから見ると
// 「正常な 0 件」と「障害による 0 件」は区別できないため、次の2点で直した。
//
// 1. 取得処理（fetcher）は、失敗したら空を返さずに例外を投げる。
// 2. キャッシュは、例外なら何も保存せず、直前の正常な結果を残したまま例外を呼び出し側へ伝える。
//    さらに isCacheable で「保存してよい結果か」を判定し、該当しない結果は返すだけで保存しない。

export type LastGoodCacheOptions<T> = {
  /** キャッシュの有効期間（ミリ秒）。 */
  ttlMs: number;
  /**
   * 保存してよい結果か。false の結果は呼び出し側へ返すが、キャッシュは更新しない
   * （例: 空配列は「本当に 0 件」の可能性があるので返しはするが、60 秒固定はしない）。
   * 省略時はすべて保存する。
   */
  isCacheable?: (value: T) => boolean;
  /** 現在時刻（ミリ秒）。テストで時間を進めるために差し替える。 */
  now?: () => number;
};

type Entry<T> = { value: T; fetchedAt: number };

export class LastGoodCache<T> {
  private entry: Entry<T> | undefined;
  private inflight: Promise<T> | undefined;
  private readonly ttlMs: number;
  private readonly isCacheable: (value: T) => boolean;
  private readonly now: () => number;

  constructor(
    private readonly fetcher: () => Promise<T>,
    options: LastGoodCacheOptions<T>,
  ) {
    this.ttlMs = options.ttlMs;
    this.isCacheable = options.isCacheable ?? (() => true);
    this.now = options.now ?? Date.now;
  }

  /**
   * 有効期間内ならキャッシュを返す。期限切れなら取り直す。
   * 取得に失敗したら例外を投げる（キャッシュは直前の正常な結果のまま）。
   * 同時に呼ばれた場合、取得は1回だけ行い、結果を共有する。
   */
  async get(): Promise<T> {
    if (this.entry && this.now() - this.entry.fetchedAt < this.ttlMs) {
      return this.entry.value;
    }
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /**
   * 直前の正常な結果（期限切れでも返す）。get() が失敗したときに、
   * 呼び出し側が「古い結果を表示する」か「エラー表示にする」かを選べるようにする。
   */
  lastGood(): Entry<T> | undefined {
    return this.entry;
  }

  private async refresh(): Promise<T> {
    // 失敗時はここで例外がそのまま伝わり、this.entry は書き換えない。
    const value = await this.fetcher();
    if (this.isCacheable(value)) {
      this.entry = { value, fetchedAt: this.now() };
    }
    return value;
  }
}
