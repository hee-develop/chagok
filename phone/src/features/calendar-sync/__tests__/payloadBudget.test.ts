import type { DeviceEvent } from '../../calendar-select/calendarSource';
import { fitToBudget, utf8Length } from '../payloadBudget';

const event = (id: string, title = 't'): DeviceEvent => ({
  id,
  calendarId: '1',
  title,
  start: '2026-11-11T05:00:00.000Z',
  end: '2026-11-11T06:00:00.000Z',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: [],
});

describe('utf8Length', () => {
  it.each([
    ['abc', 3],
    ['가', 3],
    ['é', 2],
    ['😀', 4],
  ])('%s는 %i바이트', (text, bytes) => {
    expect(utf8Length(text)).toBe(bytes);
    expect(new TextEncoder().encode(text).length).toBe(bytes);
  });
});

describe('fitToBudget', () => {
  it('예산 안이면 그대로 돌려준다', () => {
    const list = [event('a'), event('b')];
    expect(fitToBudget(list)).toEqual(list);
  });

  it('예산을 넘기 전까지 앞에서부터만 남기고 실제 본문 크기가 예산 이하다', () => {
    const list = Array.from({ length: 20 }, (_, i) => event(`e${i}`, '가'.repeat(100)));
    const kept = fitToBudget(list, 2000);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(20);
    expect(kept).toEqual(list.slice(0, kept.length));
    expect(new TextEncoder().encode(JSON.stringify({ events: kept })).length).toBeLessThanOrEqual(2000);
  });

  it('하나도 못 담으면 빈 목록', () => {
    expect(fitToBudget([event('a')], 10)).toEqual([]);
  });
});
