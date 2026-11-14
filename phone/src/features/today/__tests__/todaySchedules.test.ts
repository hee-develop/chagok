import { DENTIST, GAME, LUNCH, ONLINE, ANCHOR } from '../testSupport';
import { isMissingPlace, isTodaySchedule, splitSchedules } from '../todaySchedules';

describe('isTodaySchedule', () => {
  it('서버가 말하는 오늘(anchor의 서울 날짜)에 시작한 일정만 오늘이다', () => {
    expect(isTodaySchedule(LUNCH, ANCHOR)).toBe(true);
    expect(isTodaySchedule(DENTIST, ANCHOR)).toBe(false);
  });

  it('서울 자정을 기준으로 가른다(UTC 날짜가 아니라)', () => {
    // 2026-11-05T16:00Z = 서울 11월 6일 01:00
    const lateNight = { ...LUNCH, start: '2026-11-05T16:00:00Z', end: '2026-11-05T17:00:00Z' };
    expect(isTodaySchedule(lateNight, ANCHOR)).toBe(true);
    // 2026-11-06T15:30Z = 서울 11월 7일 00:30
    const nextDay = { ...LUNCH, start: '2026-11-06T15:30:00Z', end: '2026-11-06T16:30:00Z' };
    expect(isTodaySchedule(nextDay, ANCHOR)).toBe(false);
  });

  it('전날 시작해 anchor 시각에 아직 끝나지 않은 일정은 오늘이다', () => {
    const overnight = { ...LUNCH, start: '2026-11-05T14:00:00Z', end: '2026-11-06T02:00:00Z' };
    expect(isTodaySchedule(overnight, ANCHOR)).toBe(true);
    expect(isTodaySchedule({ ...overnight, end: '2026-11-06T00:00:00Z' }, ANCHOR)).toBe(false);
  });
});

describe('splitSchedules', () => {
  it('오늘 일정과 다른 날 장소 빈 일정, 합친 빈 개수를 돌려준다', () => {
    const split = splitSchedules([LUNCH, ONLINE, GAME, DENTIST], ANCHOR);
    expect(split.today.map((s) => s.id)).toEqual(['lunch', 'online', 'game']);
    expect(split.otherMissing.map((s) => s.id)).toEqual(['dentist']);
    // 오늘 점심 1 + 다른 날 치과 1. 이동 없음(online)과 장소 있는 일정은 세지 않는다.
    expect(split.missingCount).toBe(2);
  });

  it('이미 끝난 지난 일정은 다른 날 빈 일정으로 세지 않는다', () => {
    const past = { ...LUNCH, id: 'past', start: '2026-11-01T04:00:00Z', end: '2026-11-01T05:00:00Z' };
    expect(splitSchedules([past], ANCHOR).otherMissing).toEqual([]);
  });

  it('isMissingPlace는 후보가 있어도 장소 없음으로 센다', () => {
    expect(isMissingPlace(DENTIST)).toBe(true);
    expect(isMissingPlace(ONLINE)).toBe(false);
    expect(isMissingPlace(GAME)).toBe(false);
  });
});
