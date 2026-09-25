import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RADIUS_KM,
  NEAR_RADIUS_OPTIONS,
  isValidLatLng,
  normalizeRadiusKm,
  parseNearParam,
  serializeNearParam,
} from '../src/geo-search';

// 現在地検索の座標/半径パラメータ（純粋ロジック）の分岐網羅。
// 座標は最寄駅の近似値を想定（距離計算は DB 側）。ここは URL 表現の parse/validate/serialize のみ検証。

describe('isValidLatLng', () => {
  it('範囲内の一般的な座標を許可', () => {
    expect(isValidLatLng(12.3456, 65.4321)).toBe(true);
  });
  it('境界値（±90 / ±180）を許可', () => {
    expect(isValidLatLng(90, 180)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
  });
  it('範囲外（lat>90 / lng<-180）を拒否', () => {
    expect(isValidLatLng(90.0001, 0)).toBe(false);
    expect(isValidLatLng(0, -180.5)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
  });
  it('非有限数（NaN/Infinity）を拒否', () => {
    expect(isValidLatLng(NaN, 65)).toBe(false);
    expect(isValidLatLng(12, Infinity)).toBe(false);
  });
});

describe('normalizeRadiusKm', () => {
  it('許可値（3/5/10/20）はそのまま', () => {
    for (const km of NEAR_RADIUS_OPTIONS) {
      expect(normalizeRadiusKm(km)).toBe(km);
      expect(normalizeRadiusKm(String(km))).toBe(km);
    }
  });
  it('許可値外・非数値・空・null/undefined は既定（10）にフォールバック', () => {
    expect(normalizeRadiusKm(7)).toBe(DEFAULT_RADIUS_KM);
    expect(normalizeRadiusKm(0)).toBe(DEFAULT_RADIUS_KM);
    expect(normalizeRadiusKm(999)).toBe(DEFAULT_RADIUS_KM);
    expect(normalizeRadiusKm('abc')).toBe(DEFAULT_RADIUS_KM);
    expect(normalizeRadiusKm('')).toBe(DEFAULT_RADIUS_KM);
    expect(normalizeRadiusKm(null)).toBe(DEFAULT_RADIUS_KM);
    expect(normalizeRadiusKm(undefined)).toBe(DEFAULT_RADIUS_KM);
  });
  it('10進の整数以外の表記（16進・指数・前後の空白・小数）は、許可値に化けても既定に倒す', () => {
    // Number('0x3') === 3、Number('3e0') === 3、Number(' 5 ') === 5 になるが、受け付けない
    for (const raw of ['0x3', '3e0', ' 5 ', '5.0', '+5', '0b101']) {
      expect(normalizeRadiusKm(raw), raw).toBe(DEFAULT_RADIUS_KM);
    }
  });
});

describe('parseNearParam', () => {
  it('正常な "lat,lng" + radius をパース', () => {
    expect(parseNearParam('12.3456,65.4321', '5')).toEqual({
      lat: 12.3456,
      lng: 65.4321,
      radiusKm: 5,
    });
  });
  it('radius 省略時は既定（10）', () => {
    expect(parseNearParam('12.3456,65.4321', undefined)).toEqual({
      lat: 12.3456,
      lng: 65.4321,
      radiusKm: DEFAULT_RADIUS_KM,
    });
  });
  it('radius 許可値外は既定に正規化（near は成立）', () => {
    expect(parseNearParam('12.3456,65.4321', '7')?.radiusKm).toBe(DEFAULT_RADIUS_KM);
  });
  it('near 無し → null（通常検索フォールバック）', () => {
    expect(parseNearParam(undefined, '10')).toBeNull();
    expect(parseNearParam(null, '10')).toBeNull();
    expect(parseNearParam('', '10')).toBeNull();
  });
  it('形式不正（カンマ無し/3要素/非数値）→ null', () => {
    expect(parseNearParam('12.3456', '10')).toBeNull();
    expect(parseNearParam('12.3,65.4,1', '10')).toBeNull();
    expect(parseNearParam('abc,def', '10')).toBeNull();
  });
  it('空成分（"12.5," / ",65.5" / "," / 空白のみ）→ null（経度0/緯度0への暗黙化け防止）', () => {
    expect(parseNearParam('12.5,', '10')).toBeNull();
    expect(parseNearParam(',65.5', '10')).toBeNull();
    expect(parseNearParam(',', '10')).toBeNull();
    expect(parseNearParam('12.5 , ', '10')).toBeNull();
  });
  it('16進/指数表記 → null（10進のみ許可）', () => {
    expect(parseNearParam('0x22,0x22', '10')).toBeNull();
    expect(parseNearParam('1e1,65', '10')).toBeNull();
    expect(parseNearParam('12,1e2', '10')).toBeNull();
  });
  it('座標が範囲外 → null（改ざん耐性）', () => {
    expect(parseNearParam('999,65', '10')).toBeNull();
    expect(parseNearParam('12.3,500', '10')).toBeNull();
  });
  it('極端に長い入力 → null（正規表現や Number() に渡す前に弾く）', () => {
    expect(parseNearParam(`12.${'3'.repeat(100)},65.4`, '10')).toBeNull();
    // 通常の精度の座標は通る
    expect(parseNearParam('-12.345678,-65.432109', '10')).not.toBeNull();
  });
});

describe('serializeNearParam', () => {
  it('座標を 3 桁丸めで直列化・既定半径(10)は radius 省略', () => {
    expect(serializeNearParam({ lat: 12.345612, lng: 65.432112, radiusKm: 10 })).toEqual({
      near: '12.346,65.432',
      radius: undefined,
    });
  });
  it('非既定半径は radius を付与', () => {
    expect(serializeNearParam({ lat: 12.346, lng: 65.432, radiusKm: 3 })).toEqual({
      near: '12.346,65.432',
      radius: '3',
    });
  });
  it('許可値外の半径は既定に正規化（→ radius 省略）', () => {
    expect(serializeNearParam({ lat: 12.346, lng: 65.432, radiusKm: 7 })?.radius).toBeUndefined();
  });
  it('末尾ゼロを除去（12.300 → 12.3）', () => {
    expect(serializeNearParam({ lat: 12.3, lng: 65.5, radiusKm: 5 })?.near).toBe('12.3,65.5');
  });
  it('無効座標 → null（near パラメータを付与しない）', () => {
    expect(serializeNearParam({ lat: NaN, lng: 65, radiusKm: 5 })).toBeNull();
    expect(serializeNearParam({ lat: 999, lng: 65, radiusKm: 5 })).toBeNull();
  });
  it('parse → serialize の往復で座標が保たれる（3桁内の座標は round-trip 安定）', () => {
    const parsed = parseNearParam('12.346,65.432', '3');
    expect(parsed).not.toBeNull();
    const ser = serializeNearParam(parsed!);
    expect(ser).toEqual({ near: '12.346,65.432', radius: '3' });
  });
});
