import { describe, expect, it } from 'vitest';
import {
  STAFF_STATUSES,
  STAFF_STATUS_LABEL,
  clearsScheduledLeave,
  isOffboardedStatus,
  isTerminalStaffStatus,
  isValidTransition,
  nextStaffStatuses,
  requiresLeaveDate,
  setsLeftAt,
} from '../src/staff-lifecycle';

describe('nextStaffStatuses', () => {
  it('active からは leaving/left/transferred を選べる', () => {
    expect([...nextStaffStatuses('active')].sort()).toEqual(
      ['leaving', 'left', 'transferred'].sort(),
    );
  });
  it('leaving からは left/transferred と退職の取り消し(active)', () => {
    expect([...nextStaffStatuses('leaving')].sort()).toEqual(
      ['active', 'left', 'transferred'].sort(),
    );
  });
  it('終端(left/transferred)からは何も選べない（一方向）', () => {
    expect(nextStaffStatuses('left')).toEqual([]);
    expect(nextStaffStatuses('transferred')).toEqual([]);
  });
  it('返り値は防御的コピー（呼出側の破壊変更が内部表へ波及しない）', () => {
    const a = nextStaffStatuses('active');
    a.push('trial');
    expect(nextStaffStatuses('active')).not.toContain('trial');
  });
});

describe('isValidTransition', () => {
  it('active→left を許可', () => expect(isValidTransition('active', 'left')).toBe(true));
  it('active→transferred を許可', () => expect(isValidTransition('active', 'transferred')).toBe(true));
  it('leaving→active（退職の取り消し）を許可', () =>
    expect(isValidTransition('leaving', 'active')).toBe(true));
  it('left→active を拒否（終端・一方向）', () =>
    expect(isValidTransition('left', 'active')).toBe(false));
  it('transferred→left を拒否（終端）', () =>
    expect(isValidTransition('transferred', 'left')).toBe(false));
  it('同一状態への遷移は不許可（呼出側で no-op 扱い）', () =>
    expect(isValidTransition('active', 'active')).toBe(false));
  it('定義外の to を拒否', () => expect(isValidTransition('active', 'bogus' as never)).toBe(false));
});

describe('遷移に伴う項目の更新ルール', () => {
  it('leaving は退職予定日が必須', () => {
    expect(requiresLeaveDate('leaving')).toBe(true);
    expect(requiresLeaveDate('left')).toBe(false);
  });
  it('left/transferred は退職日を記録する', () => {
    expect(setsLeftAt('left')).toBe(true);
    expect(setsLeftAt('transferred')).toBe(true);
    expect(setsLeftAt('leaving')).toBe(false);
  });
  it('在籍中へ戻す遷移(active/rookie)は退職予定日を消す', () => {
    expect(clearsScheduledLeave('active')).toBe(true);
    expect(clearsScheduledLeave('rookie')).toBe(true);
    expect(clearsScheduledLeave('leaving')).toBe(false);
    expect(clearsScheduledLeave('left')).toBe(false);
  });
});

describe('isTerminal / isOffboarded', () => {
  it('left/transferred が終端かつ退職済み扱い', () => {
    for (const s of ['left', 'transferred'] as const) {
      expect(isTerminalStaffStatus(s)).toBe(true);
      expect(isOffboardedStatus(s)).toBe(true);
    }
  });
  it('在籍中の状態(trial/rookie/active/leaving)は終端でも退職済みでもない', () => {
    for (const s of ['trial', 'rookie', 'active', 'leaving'] as const) {
      expect(isTerminalStaffStatus(s)).toBe(false);
      expect(isOffboardedStatus(s)).toBe(false);
    }
  });
});

describe('STAFF_STATUS_LABEL', () => {
  it('すべての状態に日本語ラベルがある（状態を追加したときの付け忘れ防止）', () => {
    for (const s of STAFF_STATUSES) {
      expect(STAFF_STATUS_LABEL[s]).toBeTruthy();
    }
  });
});

describe('終端の不変条件（マトリクス全体）', () => {
  it('left/transferred から出る遷移は空', () => {
    expect(nextStaffStatuses('left')).toHaveLength(0);
    expect(nextStaffStatuses('transferred')).toHaveLength(0);
  });
  it('在籍中の状態は必ず1つ以上の遷移先を持つ', () => {
    for (const s of ['trial', 'rookie', 'active', 'leaving'] as const) {
      expect(nextStaffStatuses(s).length).toBeGreaterThan(0);
    }
  });
});
