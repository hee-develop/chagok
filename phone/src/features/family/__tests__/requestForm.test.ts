import { NOW } from '../../../__tests__/support/familySupport';
import { buildRequest, dateOf, emptyForm, matchesSent, normalizeTime, parseCompanions, type RequestForm } from '../requestForm';
import { normalizeRequest } from '../requestModel';

const member = { kind: 'member', memberId: 'mom1' } as const;
const form = (change: Partial<RequestForm>): RequestForm => ({ ...emptyForm(), recipient: member, ...change });
const ok = (change: Partial<RequestForm>) => {
  const result = buildRequest(form(change), NOW);
  if (!result.ok) throw new Error(`검증 실패: ${JSON.stringify(result.errors)}`);
  return result.body;
};
const errors = (change: Partial<RequestForm>) => {
  const result = buildRequest(form(change), NOW);
  if (result.ok) throw new Error('통과하면 안 된다');
  return result.errors;
};

describe('시각·날짜', () => {
  it('콜론이 있든 없든 HH:MM으로 맞춘다', () => {
    expect(normalizeTime('1830')).toBe('18:30');
    expect(normalizeTime('930')).toBe('09:30');
    expect(normalizeTime('9:30')).toBe('09:30');
    expect(normalizeTime(' 18:30 ')).toBe('18:30');
    expect(normalizeTime('2400')).toBeNull();
    expect(normalizeTime('1860')).toBeNull();
    expect(normalizeTime('18')).toBeNull();
    expect(normalizeTime('')).toBeNull();
  });

  it('오늘·내일은 기기 시간대와 상관없이 서울 날짜다', () => {
    expect(dateOf('today', NOW)).toBe('2026-11-06');
    expect(dateOf('tomorrow', NOW)).toBe('2026-11-07');
    // UTC 15:30 = 서울 다음 날 00:30
    expect(dateOf('today', new Date('2026-11-06T15:30:00Z'))).toBe('2026-11-07');
  });

  it('함께 가는 사람은 쉼표·가운뎃점·슬래시로 나누고 빈 이름은 버린다', () => {
    expect(parseCompanions('지우, 하준 · 서연/ ,')).toEqual(['지우', '하준', '서연']);
    expect(parseCompanions('  ')).toEqual([]);
  });
});

describe('카테고리와 받는 사람', () => {
  it('카테고리를 안 골랐으면 카테고리 오류 하나만 돌려준다', () => {
    expect(buildRequest(emptyForm(), NOW)).toEqual({ ok: false, errors: { category: '카테고리를 골라 주세요.' } });
  });

  it('받는 사람을 안 골랐으면 칸마다 오류와 함께 받는 사람 오류도 돌려준다', () => {
    const result = buildRequest({ ...emptyForm(), category: 'care', item: '우산', timing: 'take-along' }, NOW);
    expect(result).toEqual({ ok: false, errors: { recipient: '받는 사람을 골라 주세요.' } });
  });

  it("'우리 차'는 carRef로 보낸다", () => {
    const body = ok({ category: 'care', item: '우산', timing: 'bring-back', recipient: { kind: 'car', carRef: 'car-1' } });
    expect(body.recipient).toEqual({ carRef: 'car-1' });
  });
});

describe('채비', () => {
  it('물건·가져갈 때/가져올 때·날짜(기본 오늘)를 평평한 본문으로 만든다', () => {
    expect(ok({ category: 'care', item: '  우산  ', timing: 'take-along' })).toEqual({ category: 'care', recipient: { memberId: 'mom1' }, item: '우산', timing: 'take-along', date: '2026-11-06' });
    expect(ok({ category: 'care', item: '도시락', timing: 'bring-back', day: 'tomorrow' })).toMatchObject({ date: '2026-11-07' });
  });

  it('물건이 비었거나 60자를 넘거나 타이밍이 없으면 칸마다 오류', () => {
    expect(errors({ category: 'care', item: ' ', timing: null })).toEqual({ item: '물건을 적어 주세요.', timing: '가져갈 때인지 가져올 때인지 골라 주세요.' });
    expect(errors({ category: 'care', item: 'ㄱ'.repeat(61), timing: 'take-along' })).toEqual({ item: '60자 안쪽으로 적어 주세요.' });
  });
});

describe('들르기', () => {
  const stop = { category: 'stop', place: { text: '다이소', lat: 35.1, lng: 126.8 }, item: '건전지' } as const;

  it('장소(글자+좌표)·살 것·기한 오늘 중', () => {
    expect(ok({ ...stop })).toEqual({ category: 'stop', recipient: { memberId: 'mom1' }, place: { text: '다이소', lat: 35.1, lng: 126.8 }, item: '건전지', deadline: { type: 'today' }, date: '2026-11-06' });
  });

  it('오늘의 이미 지난 시각을 기한으로 적으면 막고(지금 09:30), 내일이면 지난 시각처럼 보여도 받는다', () => {
    const stop = { category: 'stop', place: { text: '다이소' }, item: '건전지', deadlineType: 'by' } as const;
    expect(errors({ ...stop, time: '0900' })).toEqual({ time: '이미 지난 시각이에요. 지금 이후의 시각으로 적어 주세요.' });
    expect(buildRequest(form({ ...stop, time: '0931' }), NOW).ok).toBe(true);
    expect(ok({ ...stop, time: '0900', day: 'tomorrow' })).toMatchObject({ deadline: { type: 'by', time: '09:00' }, date: '2026-11-07' });
  });

  it('기한이 시각이면 HH:MM으로 보낸다', () => {
    expect(ok({ ...stop, deadlineType: 'by', time: '1830' })).toMatchObject({ deadline: { type: 'by', time: '18:30' } });
    expect(errors({ ...stop, deadlineType: 'by', time: '25:00' })).toEqual({ time: '기한을 24시간으로 적어 주세요. 예: 18:30' });
  });

  it('좌표 없이 글자만 넣어도 보낼 수 있다(좌표는 보내지 않는다)', () => {
    const body = ok({ category: 'stop', place: { text: '동네 마트' }, item: '우유' });
    expect(body.place).toEqual({ text: '동네 마트' });
  });

  it('장소와 물건이 비면 오류', () => {
    expect(errors({ category: 'stop', place: { text: '  ' }, item: '' })).toEqual({ place: '장소를 적거나 찾아 주세요.', item: '물건을 적어 주세요.' });
  });
});

describe('약속 가기', () => {
  it('서울 시각(+09:00)과 장소, 함께 가는 사람', () => {
    const body = ok({ category: 'appointment', time: '1800', place: { text: '챔피언스필드' }, companions: '지우, 하준' });
    expect(body).toEqual({ category: 'appointment', recipient: { memberId: 'mom1' }, at: '2026-11-06T18:00:00+09:00', place: { text: '챔피언스필드' }, companions: ['지우', '하준'] });
  });

  it('내일 시각, 함께 가는 사람은 비워도 된다', () => {
    const body = ok({ category: 'appointment', time: '0900', day: 'tomorrow', place: { text: '병원' } });
    expect(body.at).toBe('2026-11-07T09:00:00+09:00');
    expect(body).not.toHaveProperty('companions');
  });

  it('이미 지난 시각·잘못된 시각·빈 장소는 오류, 지금 이후면 통과', () => {
    expect(errors({ category: 'appointment', time: '0900', place: { text: '병원' } })).toEqual({ time: '이미 지난 시각이에요. 지금 이후의 시각으로 적어 주세요.' });
    expect(errors({ category: 'appointment', time: '99', place: { text: '' } })).toEqual({ time: '시각을 24시간으로 적어 주세요. 예: 18:30', place: '장소를 적거나 찾아 주세요.' });
    expect(buildRequest(form({ category: 'appointment', time: '0931', place: { text: '병원' } }), NOW).ok).toBe(true);
  });

  it('함께 가는 사람은 10명·한 사람 40자까지', () => {
    const many = Array.from({ length: 11 }, (_, i) => `사람${i}`).join(',');
    expect(errors({ category: 'appointment', time: '1800', place: { text: '병원' }, companions: many })).toEqual({ companions: '함께 가는 사람은 10명까지 적을 수 있어요.' });
    expect(errors({ category: 'appointment', time: '1800', place: { text: '병원' }, companions: 'ㄱ'.repeat(41) })).toEqual({ companions: '이름은 한 사람당 40자 안쪽으로 적어 주세요.' });
  });
});

describe('데려다주기·픽업', () => {
  it('누구를·어디서·어디로·몇 시', () => {
    const body = ok({ category: 'ride', who: '지우', pickup: { text: '학원', lat: 1, lng: 2 }, dropoff: { text: '집' }, time: '1830' });
    expect(body).toEqual({ category: 'ride', recipient: { memberId: 'mom1' }, who: '지우', pickup: { text: '학원', lat: 1, lng: 2 }, dropoff: { text: '집' }, at: '2026-11-06T18:30:00+09:00' });
  });

  it('누구를·장소 둘·시각이 비면 칸마다 오류', () => {
    expect(errors({ category: 'ride' })).toEqual({ who: '누구를 데려다주는지 적어 주세요.', pickup: '장소를 적거나 찾아 주세요.', dropoff: '장소를 적거나 찾아 주세요.', time: '시각을 24시간으로 적어 주세요. 예: 18:30' });
  });
});

describe('한 줄 메모', () => {
  const care = { category: 'care', item: '우산', timing: 'take-along' } as const;

  it('줄바꿈·연속 공백은 공백 하나로 하고 비면 보내지 않는다', () => {
    expect(ok({ ...care, memo: '  현관   앞에\n두기 ' })).toMatchObject({ memo: '현관 앞에 두기' });
    expect(ok({ ...care, memo: '   ' })).not.toHaveProperty('memo');
  });

  it('30자를 넘어도 보낼 수 있다(차가 메모가 있어요만 말한다). 100자를 넘으면 오류', () => {
    expect(ok({ ...care, memo: 'ㄱ'.repeat(31) })).toHaveProperty('memo');
    expect(errors({ ...care, memo: 'ㄱ'.repeat(101) })).toEqual({ memo: '메모는 100자 안쪽으로 적어 주세요.' });
  });
});

describe('폼을 연 때(openedAt) 기준의 오늘·내일', () => {
  const care = { category: 'care', item: '우산', timing: 'take-along' } as const;

  it('자정을 넘겨 열려 있어도 고른 날짜는 폼을 연 날(서울) 기준으로 고정된다', () => {
    const opened = NOW; // 2026-11-06 09:30
    const afterMidnight = new Date('2026-11-06T15:30:00Z'); // 서울 11-07 00:30
    const built = buildRequest(form({ ...care, day: 'tomorrow' }), afterMidnight, opened);
    expect(built.ok && built.body.date).toBe('2026-11-07');
    const noOpened = buildRequest(form({ ...care, day: 'tomorrow' }), afterMidnight);
    expect(noOpened.ok && noOpened.body.date).toBe('2026-11-08');
  });

  it('지난 시각 판정은 지금 기준이다', () => {
    const afterMidnight = new Date('2026-11-06T15:30:00Z');
    const r = buildRequest(form({ category: 'appointment', time: '0010', place: { text: '병원' } }), afterMidnight, NOW);
    expect(r.ok).toBe(false);
  });
});

describe('보낸 요청과 같은 요청인가(matchesSent)', () => {
  const sent = (extra: Record<string, unknown>) => normalizeRequest({
    id: 'x', memo: null, date: '2026-11-06', status: 'sent', createdAt: '2026-11-06T00:30:05.000Z', from: { memberId: 'me1', name: '아빠' },
    to: { kind: 'member', memberId: 'mom1', name: '엄마' }, reachable: true, drivingNow: false, etaStage: null, ...extra,
  })!;
  const since = NOW.getTime();

  it('채비: 카테고리·받는 사람·물건·가져갈 때가 같고 보내기 시작한 뒤에 만들어졌으면 같은 요청이다', () => {
    const body = ok({ category: 'care', item: '우산', timing: 'take-along' });
    expect(matchesSent(body, sent({ category: 'care', item: '우산', timing: 'take-along' }), since)).toBe(true);
    expect(matchesSent(body, sent({ category: 'care', item: '우산', timing: 'bring-back' }), since)).toBe(false);
    expect(matchesSent(body, sent({ category: 'care', item: '장갑', timing: 'take-along' }), since)).toBe(false);
    expect(matchesSent(body, sent({ category: 'care', item: '우산', timing: 'take-along', to: { kind: 'member', memberId: 'kid1', name: '지우' } }), since)).toBe(false);
    expect(matchesSent(body, sent({ category: 'care', item: '우산', timing: 'take-along', to: { kind: 'car', carRef: 'car-1' } }), since)).toBe(false);
  });

  it('보내기 전에 이미 있던 같은 내용의 요청(오래전에 만든 것)은 같은 요청으로 보지 않는다(시계 어긋남 2분 여유)', () => {
    const body = ok({ category: 'care', item: '우산', timing: 'take-along' });
    const old = sent({ category: 'care', item: '우산', timing: 'take-along', createdAt: '2026-11-06T00:10:00.000Z' });
    expect(matchesSent(body, old, since)).toBe(false);
    const skewed = sent({ category: 'care', item: '우산', timing: 'take-along', createdAt: new Date(since - 90_000).toISOString() });
    expect(matchesSent(body, skewed, since)).toBe(true);
  });

  it("'우리 차'와 메모까지 맞춘다", () => {
    const body = ok({ category: 'care', item: '우산', timing: 'take-along', recipient: { kind: 'car', carRef: 'car-1' }, memo: '현관 앞' });
    const same = { category: 'care', item: '우산', timing: 'take-along', to: { kind: 'car', carRef: 'car-1' }, memo: '현관 앞' };
    expect(matchesSent(body, sent(same), since)).toBe(true);
    expect(matchesSent(body, sent({ ...same, memo: null }), since)).toBe(false);
  });

  it('들르기·약속 가기·데려다주기·픽업은 장소 글자·기한·시각·누구를까지 같아야 한다', () => {
    const stop = ok({ category: 'stop', place: { text: '다이소', lat: 1, lng: 2 }, item: '건전지', deadlineType: 'by', time: '1830' });
    const stopRaw = { category: 'stop', place: { text: '다이소', lat: 1, lng: 2 }, item: '건전지', deadline: { type: 'by', time: '18:30' } };
    expect(matchesSent(stop, sent(stopRaw), since)).toBe(true);
    expect(matchesSent(stop, sent({ ...stopRaw, deadline: { type: 'today' } }), since)).toBe(false);
    expect(matchesSent(stop, sent({ ...stopRaw, place: { text: '마트' } }), since)).toBe(false);

    const appt = ok({ category: 'appointment', time: '1800', place: { text: '병원' } });
    const apptRaw = { category: 'appointment', at: '2026-11-06T09:00:00.000Z', place: { text: '병원' }, companions: [] };
    expect(matchesSent(appt, sent(apptRaw), since)).toBe(true);
    expect(matchesSent(appt, sent({ ...apptRaw, at: '2026-11-06T10:00:00.000Z' }), since)).toBe(false);

    const ride = ok({ category: 'ride', who: '지우', pickup: { text: '학원' }, dropoff: { text: '집' }, time: '1830' });
    const rideRaw = { category: 'ride', who: '지우', pickup: { text: '학원' }, dropoff: { text: '집' }, at: '2026-11-06T09:30:00.000Z' };
    expect(matchesSent(ride, sent(rideRaw), since)).toBe(true);
    expect(matchesSent(ride, sent({ ...rideRaw, dropoff: { text: '학교' } }), since)).toBe(false);
    expect(matchesSent(ride, sent({ ...rideRaw, who: '하준' }), since)).toBe(false);
    expect(matchesSent(ride, sent({ ...apptRaw }), since)).toBe(false);
  });
});
