import type { DeviceEvent } from '../../calendar-select/calendarSource';
import { partitionEvents } from '../travelFilter';

const event = (over: Partial<DeviceEvent> = {}): DeviceEvent => ({
  id: 'e1@1',
  calendarId: '1',
  title: '팀 회의',
  start: '2026-11-11T05:00:00.000Z',
  end: '2026-11-11T06:00:00.000Z',
  allDay: false,
  locationText: null,
  notes: null,
  attendees: ['김철수'],
  ...over,
});
const none = () => false;

describe('partitionEvents (정책서 10.3 표 1~3번)', () => {
  it.each([
    ['온라인 장소', { locationText: '온라인' }, 'online'],
    ['메모의 화상 회의 링크', { notes: '참여 https://meet.google.com/abc-defg-hij' }, 'online'],
    ['장소 전체가 화상', { locationText: '화상' }, 'online'],
    ['장소 전체가 비대면', { locationText: '비대면' }, 'online'],
    ['7층 대회의실', { locationText: '7층 대회의실' }, 'meetingRoom'],
    ['3A룸', { locationText: '3A룸' }, 'meetingRoom'],
    ['라운지', { locationText: '라운지' }, 'meetingRoom'],
    ['301호', { locationText: '301호' }, 'meetingRoom'],
  ] as const)('보내지 않고 폰에만 남긴다: %s', (_name, over, reason) => {
    const { toSend, filtered } = partitionEvents([event(over)], none);
    expect(toSend).toEqual([]);
    expect(filtered).toEqual([{ id: 'e1@1', title: '팀 회의', start: '2026-11-11T05:00:00.000Z', end: '2026-11-11T06:00:00.000Z', reason }]);
  });

  it('거른 일정의 장소·메모·참석자는 폰 로컬 목록에도 담지 않는다', () => {
    const { filtered } = partitionEvents([event({ locationText: 'Zoom', notes: '비밀 메모', attendees: ['김철수'] })], none);
    expect(JSON.stringify(filtered)).not.toMatch(/Zoom|비밀|김철수/);
  });

  it.each([
    ['보통 장소', { locationText: '광주 육전집' }],
    ['장소 칸이 빔', { locationText: null }],
    ['주소가 함께 있는 건물 안 표시', { locationText: '서울 강남구 테헤란로 152 7층 회의실' }],
    ['건물 이름 뒤의 층', { locationText: '챔피언스필드 2층' }],
    ['화상 병원', { locationText: '베스티안 화상전문병원' }],
  ])('그대로 보낸다: %s', (_name, over) => {
    const e = event(over);
    const { toSend, filtered } = partitionEvents([e], none);
    expect(toSend).toEqual([e]);
    expect(filtered).toEqual([]);
  });

  it('종일 일정은 이름만 보낸다(메모·참석자는 비우고 장소 칸은 후보용으로 남긴다)', () => {
    const allDay = event({ allDay: true, title: '제주 출장', locationText: '제주', notes: '항공권 번호 ABC', attendees: ['김철수'] });
    const { toSend, filtered } = partitionEvents([allDay], none);
    expect(toSend).toEqual([{ ...allDay, notes: null, attendees: [] }]);
    expect(filtered).toEqual([]);
  });

  it('종일 일정은 온라인 표시가 있어도 거르지 않고 보낸다', () => {
    const { toSend, filtered } = partitionEvents([event({ allDay: true, locationText: '온라인' })], none);
    expect(toSend).toHaveLength(1);
    expect(filtered).toEqual([]);
  });

  it('"이동 일정이에요"로 바꾼 이름은 거르지 않고 보내며 서버 안전망을 건너뛰게 표시한다', () => {
    const e = event({ locationText: '7층 대회의실' });
    const { toSend, filtered } = partitionEvents([e], (title) => title === '팀 회의');
    expect(toSend).toEqual([{ ...e, travelConfirmed: true }]);
    expect(filtered).toEqual([]);
  });

  it('예외 이름이어도 걸리지 않는 일정에는 표시를 달지 않는다', () => {
    const e = event({ locationText: '광주 육전집' });
    expect(partitionEvents([e], () => true).toSend).toEqual([e]);
  });

  it('여러 일정은 섞어 나눈다', () => {
    const a = event({ id: 'a', locationText: '광주 육전집' });
    const b = event({ id: 'b', locationText: 'Zoom' });
    const c = event({ id: 'c', allDay: true, notes: 'x' });
    const { toSend, filtered } = partitionEvents([a, b, c], none);
    expect(toSend.map((e) => e.id)).toEqual(['a', 'c']);
    expect(filtered.map((e) => e.id)).toEqual(['b']);
  });
});
