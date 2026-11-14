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
    ['Room 301', { locationText: 'Room 301' }, 'meetingRoom'],
    ['7F', { locationText: '7F' }, 'meetingRoom'],
    ['본사 2층 라운지', { locationText: '본사 2층 라운지' }, 'meetingRoom'],
    ['강당', { locationText: '강당' }, 'meetingRoom'],
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
    ['영문 건물명 뒤의 층', { locationText: 'Starbucks 2층' }],
    ['영문 건물명 뒤의 라운지', { locationText: 'IFC 라운지' }],
    ['학교 강당', { locationText: '학교 강당' }],
    ['아파트 동·호', { locationText: '102동 1203호' }],
    ['제목만 온라인 회의 준비이고 장소는 카페', { title: '온라인 회의 준비', locationText: '스타벅스 강남점' }],
    ['메모에 호스트 이름만 스침', { locationText: '코엑스', notes: '발표자료는 zoom.us 녹화본 참고' }],
    ['온라인으로 시작하는 단체 이름', { locationText: '온라인마케팅협회 강남사무소' }],
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

  it.each([
    ['온라인', '온라인'],
    ['Zoom', 'Zoom'],
    ['회의실', '본사 3층 회의실'],
    ['7F', '7F'],
  ])('종일 일정은 장소 칸이 %s 표시여도 거르지 않고 이름만 보내되 장소 칸은 비운다', (_name, locationText) => {
    const allDay = event({ allDay: true, title: '팀 워크숍', locationText, notes: 'https://zoom.us/j/1' });
    const { toSend, filtered } = partitionEvents([allDay], none);
    expect(toSend).toEqual([{ ...allDay, notes: null, attendees: [], locationText: null }]);
    expect(filtered).toEqual([]);
  });

  it('종일 일정이어도 "이동 일정이에요"로 바꾼 이름이면 장소 칸을 그대로 둔다', () => {
    const allDay = event({ allDay: true, locationText: '본사 3층 회의실' });
    const { toSend } = partitionEvents([allDay], () => true);
    expect(toSend).toEqual([{ ...allDay, notes: null, attendees: [] }]);
  });

  it('종일 일정의 보통 장소는 후보용으로 남긴다', () => {
    const allDay = event({ allDay: true, locationText: '제주 공항' });
    expect(partitionEvents([allDay], none).toSend[0].locationText).toBe('제주 공항');
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
