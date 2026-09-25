// スタッフの在籍状態と、その遷移ルール（純粋ロジック）。
// 管理画面のドロップダウン生成と、サーバ側の更新ガードが同じ表を参照することで、
// 「画面では選べないのに API を直接叩けば通る」ずれを防ぐ。

/** スタッフの在籍状態（6状態）。 */
export const STAFF_STATUSES = [
  'trial',
  'rookie',
  'active',
  'leaving',
  'left',
  'transferred',
] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/**
 * 状態遷移マトリクス。
 *
 * ここで定義するのは **店舗の管理者が手動で起こせる遷移** のみ。
 * 日付による自動遷移（在籍日数に達したら rookie→active、退職予定日に達したら leaving→left）は
 * 定期実行ジョブ側で扱う（このサンプルの対象外）。
 *
 * left / transferred は終端。退職・移籍は一方向で、在籍中の状態には戻せない
 * （同じ店舗に戻る場合は、新しく trial から始める）。
 */
const ALLOWED_TRANSITIONS: Record<StaffStatus, readonly StaffStatus[]> = {
  trial: ['rookie', 'active', 'leaving', 'left', 'transferred'],
  rookie: ['active', 'leaving', 'left', 'transferred'],
  active: ['leaving', 'left', 'transferred'],
  // leaving → active は「退職の取り消し」。rookie は経由せず、通常の在籍へ戻す。
  leaving: ['left', 'transferred', 'active'],
  left: [],
  transferred: [],
};

/** current から管理者が選べる遷移先（UI のドロップダウン生成用・防御的コピー）。 */
export function nextStaffStatuses(current: StaffStatus): StaffStatus[] {
  return [...(ALLOWED_TRANSITIONS[current] ?? [])];
}

/** from→to が許可された遷移か（サーバ側で fail-closed に弾くためのガード）。同一状態は不許可。 */
export function isValidTransition(from: StaffStatus, to: StaffStatus): boolean {
  if (!(STAFF_STATUSES as readonly string[]).includes(to)) return false;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** leaving（退職予定）へ移すときは、退職予定日（scheduledLeaveAt）の入力が必須。 */
export function requiresLeaveDate(to: StaffStatus): boolean {
  return to === 'leaving';
}

/**
 * left / transferred は退職の確定＝退職日（leftAt）を記録する。
 * leftAt は、退職後の公開情報（写真など）を一定期間後に削除する処理の起点になる。
 */
export function setsLeftAt(to: StaffStatus): boolean {
  return to === 'left' || to === 'transferred';
}

/** 在籍中へ戻す遷移（退職の取り消し＝active / 本採用＝rookie・active）は退職予定日を消す。 */
export function clearsScheduledLeave(to: StaffStatus): boolean {
  return to === 'rookie' || to === 'active';
}

/** 終端状態（これ以上、管理者からの遷移はない）。 */
export function isTerminalStaffStatus(s: StaffStatus): boolean {
  return s === 'left' || s === 'transferred';
}

/** 退職済み（退職・移籍）の状態＝公開側（検索・一覧・詳細）で表示しない状態。 */
export function isOffboardedStatus(s: StaffStatus): boolean {
  return s === 'left' || s === 'transferred';
}

/** 日本語の表示ラベル（UI のバッジ・遷移先の選択肢）。 */
export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  trial: '試用',
  rookie: '新人',
  active: '在籍',
  leaving: '退職予定',
  left: '退職',
  transferred: '移籍',
};
