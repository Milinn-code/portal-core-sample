import { describe, expect, it, vi } from 'vitest';
import { LastGoodCache } from '../src/last-good-cache';

/** テスト用の時計。advance(ms) で時間を進める。 */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

const TTL = 60_000;

describe('LastGoodCache: 正常時', () => {
  it('有効期間内は取り直さずにキャッシュを返す', async () => {
    const clock = fakeClock();
    const fetcher = vi.fn(async () => ['a', 'b']);
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL, now: clock.now });

    expect(await cache.get()).toEqual(['a', 'b']);
    clock.advance(TTL - 1);
    expect(await cache.get()).toEqual(['a', 'b']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('期限が切れたら取り直す', async () => {
    const clock = fakeClock();
    const fetcher = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(['old']).mockResolvedValueOnce(['new']);
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL, now: clock.now });

    expect(await cache.get()).toEqual(['old']);
    clock.advance(TTL);
    expect(await cache.get()).toEqual(['new']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('同時に呼ばれても、取得は1回だけ', async () => {
    const fetcher = vi.fn(async () => ['a']);
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL });

    const results = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(results).toEqual([['a'], ['a'], ['a']]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('LastGoodCache: 取得に失敗したとき', () => {
  it('例外を呼び出し側へ伝え、空の結果は返さない', async () => {
    const cache = new LastGoodCache(async () => {
      throw new Error('db unavailable');
    }, { ttlMs: TTL });

    await expect(cache.get()).rejects.toThrow('db unavailable');
    expect(cache.lastGood()).toBeUndefined();
  });

  it('直前の正常な結果を残す（失敗で上書きしない）', async () => {
    const clock = fakeClock();
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['a', 'b'])
      .mockRejectedValueOnce(new Error('db unavailable'));
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL, now: clock.now });

    await cache.get();
    clock.advance(TTL);
    await expect(cache.get()).rejects.toThrow('db unavailable');
    expect(cache.lastGood()).toEqual({ value: ['a', 'b'], fetchedAt: 0 });
  });

  it('失敗のあと、次の呼び出しでもう一度取りに行く（失敗をキャッシュしない）', async () => {
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce(['recovered']);
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL });

    await expect(cache.get()).rejects.toThrow();
    expect(await cache.get()).toEqual(['recovered']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('同時に呼ばれて失敗したら、全員に同じ例外が届く', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('db unavailable');
    });
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL });

    const results = await Promise.allSettled([cache.get(), cache.get()]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('LastGoodCache: isCacheable', () => {
  const nonEmpty = (v: string[]) => v.length > 0;

  it('保存しない結果（空配列）は返すが、キャッシュは更新しない', async () => {
    const clock = fakeClock();
    const fetcher = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['a'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['b']);
    const cache = new LastGoodCache(fetcher, { ttlMs: TTL, isCacheable: nonEmpty, now: clock.now });

    expect(await cache.get()).toEqual(['a']);
    clock.advance(TTL);
    expect(await cache.get()).toEqual([]);
    expect(cache.lastGood()?.value).toEqual(['a']);
    // 空は保存されていないので、時間を進めなくても次の呼び出しで取り直す
    expect(await cache.get()).toEqual(['b']);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
