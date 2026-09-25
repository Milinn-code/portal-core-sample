// 現在地検索（near）の座標・半径パラメータの純粋ロジック（parse / validate / serialize）。
// サーバ依存なし＝client（検索フォームの URL 組み立て）と server（検索ページの URL パラメータ解析）の双方で
// 同一規則を共有し、分岐網羅をテスト可能にする。距離計算そのものは DB 側が担う。
//
// URL 表現: `?near=<lat>,<lng>&radius=<km>`。near 座標が無効（範囲外/非数値）なら near 検索は成立させない
// （通常検索へフォールバック）。radius は UI セレクタの許可値に限定し、URL 改ざんでの想定外の広域走査を防ぐ。

/** 半径セレクタの許可値（km）。UI セレクタ・URL 検証・DB クエリの単一ソース。 */
export const NEAR_RADIUS_OPTIONS = [3, 5, 10, 20] as const;
export type NearRadiusKm = (typeof NEAR_RADIUS_OPTIONS)[number];

/** 初期半径（km）。未指定/許可値外のフォールバック既定。 */
export const DEFAULT_RADIUS_KM: NearRadiusKm = 10;

/** パース済みの現在地検索条件。radiusKm は必ず許可値に正規化済み。 */
export type NearQuery = { lat: number; lng: number; radiusKm: NearRadiusKm };

/** 緯度経度が地理的に妥当な範囲か（lat: -90..90 / lng: -180..180、いずれも有限数）。 */
export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** 数値が許可半径かを判定する型ガード（as キャスト無しで NearRadiusKm に絞る）。 */
function isNearRadiusKm(n: number): n is NearRadiusKm {
  return (NEAR_RADIUS_OPTIONS as readonly number[]).includes(n);
}

/** radius 入力を許可値に正規化。許可値外・非数値・空は DEFAULT_RADIUS_KM にフォールバック。 */
export function normalizeRadiusKm(raw: string | number | null | undefined): NearRadiusKm {
  const n = typeof raw === 'number' ? raw : raw == null || raw === '' ? NaN : Number(raw);
  return isNearRadiusKm(n) ? n : DEFAULT_RADIUS_KM;
}

// 10進数（任意符号・小数）のみ許可する厳格パターン。空文字/空白（Number('')===0 で経度0に化ける罠）・
// 16進(0x..)・指数表記(1e1) を弾く＝navigator.geolocation 由来の通常の10進座標のみを受理する。
const DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * URL パラメータ（near="lat,lng" / radius="km"）を NearQuery にパースする。
 * near が無い / "lat,lng" 形式でない / 座標が範囲外 → null（near 検索なし＝通常検索にフォールバック）。
 * radius は normalizeRadiusKm で許可値に丸める（不正でも near 自体は成立させ既定半径を使う）。
 */
export function parseNearParam(
  near: string | null | undefined,
  radius: string | null | undefined,
): NearQuery | null {
  if (!near) return null;
  const parts = near.split(',');
  if (parts.length !== 2) return null;
  const latStr = parts[0]!.trim();
  const lngStr = parts[1]!.trim();
  // 空成分・16進・指数表記を Number() に渡す前に弾く（Number('')===0 / Number('0x22')===34 等の暗黙化けを防ぐ）。
  if (!DECIMAL_RE.test(latStr) || !DECIMAL_RE.test(lngStr)) return null;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng, radiusKm: normalizeRadiusKm(radius) };
}

// 座標は小数 3 桁（≈110m）に丸めて URL に載せる。距離判定は最寄駅（100m〜km 規模）の座標で近似し、半径も 3km 以上の
// ため 110m 精度で十分。桁を抑えて URL を短く保ち、生の GPS 座標が過剰な精度でアクセスログや Referer に残るのも避ける
// （5桁=1m は半径検索には過剰）。
const COORD_PRECISION = 3;
function formatCoord(n: number): string {
  // toFixed の余分な末尾 0 を Number 化で除去（34.7 → "34.700" → "34.7"）。
  return String(Number(n.toFixed(COORD_PRECISION)));
}

/**
 * NearQuery を URL パラメータへ直列化する。radius は既定値なら省略（URL を短く保つ）。
 * 防御的に座標が無効なら null を返す（呼び出し側で near パラメータを付与しない）。
 */
export function serializeNearParam(near: {
  lat: number;
  lng: number;
  radiusKm: number;
}): { near: string; radius?: string } | null {
  if (!isValidLatLng(near.lat, near.lng)) return null;
  const radiusKm = normalizeRadiusKm(near.radiusKm);
  return {
    near: `${formatCoord(near.lat)},${formatCoord(near.lng)}`,
    radius: radiusKm === DEFAULT_RADIUS_KM ? undefined : String(radiusKm),
  };
}
