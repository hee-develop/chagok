import type { Contact } from './contactsSource';
import { givenNameOf, indexContacts, matchContacts, MAX_CONTACT_CANDIDATES, wordIndexOf, type MatchInput } from './matchContacts';

let nextId = 0;
const person = (name: string, extra: Partial<Contact> = {}): Contact => ({ id: `c${nextId++}`, name, emails: [], phones: ['010-1111-2222'], ...extra });
const input = (over: Partial<MatchInput> = {}): MatchInput => ({ title: '', notes: null, attendeeNames: [], attendeeEmails: [], ...over });
const find = (contacts: Contact[], over: Partial<MatchInput>) => matchContacts(indexContacts(contacts), input(over));

describe('성을 뺀 이름(givenNameOf)', () => {
  it.each([
    ['김민수', undefined, '민수'],
    ['이영희', undefined, '영희'],
    ['남궁민수', undefined, '민수'], // 복성
    ['황보석', undefined, '보석'], // 세 글자는 성을 한 글자로 본다(복성인지 알 수 없다)
    ['김수', undefined, null], // 성 + 한 글자 이름은 두 글자 미만
    ['민수', undefined, null], // 두 글자 이름은 성을 뗄 수 없다
    ['엄마', undefined, null],
    ['김 과장님', undefined, null], // 띄어쓰기가 있으면 사람 이름 모양이 아니다
    ['할머니', undefined, null], // 호칭·관계 말
    ['어머니', undefined, null],
    ['박팀장님', undefined, null],
    ['Alex Kim', undefined, null], // 영문 이름
    ['김민수', '민수', '민수'],
    ['김민수', '김민수', '민수'], // OS가 나누지 않은 연락처(전체와 같은 이름 부분)는 가늠한다
    ['남궁민수', '민수', '민수'],
    ['김철', '철', null],
  ])('%s (OS 이름 부분 %s) → %s', (name, os, expected) => {
    expect(givenNameOf(name, os)).toBe(expected);
  });
});

describe('낱말 경계(wordIndexOf)', () => {
  it.each([
    ['민수랑 저녁', '민수', 0],
    ['저녁 민수와 약속', '민수', 3],
    ['김민수님 미팅', '김민수', 0],
    ['민수', '민수', 0],
    ['민수, 승현과 점심', '민수', 0],
    ['민수와의 점심', '민수', 0], // 조사가 이어서 붙어도(와+의) 맞는다
    ['민수한테 줄 선물', '민수', 0],
    ['국민수영장', '민수', -1], // 앞에 한글이 붙은 다른 낱말
    ['민수영장 가기', '민수', -1], // 뒤에 조사가 아닌 글자가 붙은 다른 낱말
    ['민수이야기', '민수', -1],
    ['alexander', 'alex', -1],
    ['alex 점심', 'alex', 0],
    ['alex랑 점심', 'alex', 0],
    ['dr.alex', 'alex', 3], // 점은 낱말 글자가 아니다
    ['alex2', 'alex', -1],
    ['x민수', '민수', -1],
    ['', '민수', -1],
    ['민수', '', -1],
  ])('%j 안의 %j → %i', (text, needle, expected) => {
    expect(wordIndexOf(text, needle)).toBe(expected);
  });

  it('첫 위치가 낱말이 아니면 다음 위치를 본다', () => {
    expect(wordIndexOf('국민수 민수랑', '민수')).toBe(4);
  });
});

describe('제목·메모 속 이름', () => {
  const minsu = person('김민수');

  it('성을 뺀 이름이 제목에 있으면 그 사람이다("민수랑 저녁" → 김민수)', () => {
    expect(find([minsu], { title: '민수랑 저녁' })).toEqual(['김민수']);
  });

  it('전체 이름이 제목에 있으면 그 사람이다', () => {
    expect(find([minsu], { title: '김민수 면접 응원' })).toEqual(['김민수']);
  });

  it('메모 속 이름도 본다', () => {
    expect(find([minsu], { title: '저녁 약속', notes: '민수가 식당 예약함' })).toEqual(['김민수']);
  });

  it('이름이 없으면 못 찾은 것이다(빈 목록)', () => {
    expect(find([minsu], { title: '치과', notes: '10시 30분' })).toEqual([]);
    expect(find([minsu], { title: '', notes: null })).toEqual([]);
  });

  it('대소문자·여러 공백을 무시한다(영문 이름)', () => {
    expect(find([person('Alex Kim')], { title: 'ALEX   KIM과 점심' })).toEqual(['Alex Kim']);
  });

  it('두 글자 이름만 있는 연락처는 전체 이름이 낱말로 있을 때만 맞는다', () => {
    expect(find([person('민수')], { title: '민수랑 저녁' })).toEqual(['민수']);
  });

  it('부분 문자열 오탐: 연락처 "민수"와 제목 "국민수영장"은 맞지 않는다', () => {
    expect(find([person('민수')], { title: '국민수영장 가기' })).toEqual([]);
    expect(find([minsu], { title: '국민수영장 가기' })).toEqual([]);
    expect(find([minsu], { title: '민수영장' })).toEqual([]);
  });

  it('이름이 두 글자 미만이면(성 + 한 글자) 성을 뺀 이름으로는 찾지 않는다', () => {
    const contacts = [person('김수')];
    expect(find(contacts, { title: '수랑 점심' })).toEqual([]);
    expect(find(contacts, { title: '김수랑 점심' })).toEqual(['김수']); // 전체 이름은 맞는다
  });

  it('복성(남궁민수)도 성을 뺀 이름으로 찾는다', () => {
    expect(find([person('남궁민수')], { title: '민수랑 저녁' })).toEqual(['남궁민수']);
  });

  it('OS가 나눠 준 이름 부분을 쓴다', () => {
    expect(find([person('독고탁', { givenName: '탁' })], { title: '탁이랑 점심' })).toEqual([]);
    expect(find([person('사공이가', { givenName: '이가' })], { title: '이가랑 점심' })).toEqual(['사공이가']);
  });

  describe('호칭은 연락처에 그 이름으로 저장된 경우에만', () => {
    it('"엄마"가 연락처에 있으면 맞는다', () => {
      expect(find([person('엄마')], { title: '엄마랑 병원' })).toEqual(['엄마']);
    });

    it('"엄마"가 연락처에 없으면(다른 이름으로 저장) 맞지 않는다', () => {
      expect(find([person('김영희')], { title: '엄마랑 병원' })).toEqual([]);
    });

    it('"김 과장님"은 그 이름으로 저장된 경우에만 맞고, 성만 같은 다른 연락처나 성을 뺀 이름으로는 맞지 않는다', () => {
      const manager = person('김 과장님');
      expect(find([manager], { title: '김 과장님과 미팅' })).toEqual(['김 과장님']);
      expect(find([manager], { title: '과장님과 미팅' })).toEqual([]);
      expect(find([manager], { title: '김 과장 미팅' })).toEqual([]);
      expect(find([person('김민수')], { title: '김 과장님과 미팅' })).toEqual([]);
    });

    it('호칭에서 성을 떼어 이름을 만들지 않는다("할머니" → "머니")', () => {
      expect(find([person('할머니')], { title: '머니 챙기기' })).toEqual([]);
      expect(find([person('할머니')], { title: '할머니 댁 방문' })).toEqual(['할머니']);
    });

    it('"엄마친구" 같은 다른 낱말에 들어 있으면 맞지 않는다', () => {
      expect(find([person('엄마')], { title: '엄마친구 모임' })).toEqual([]);
    });
  });
});

describe('참석자', () => {
  it('참석자 이메일이 연락처에 있으면 그 사람이다(대소문자 무시)', () => {
    const contacts = [person('박서연', { emails: ['Seoyeon@Example.com'] })];
    expect(find(contacts, { title: '주간 회의', attendeeEmails: ['seoyeon@example.COM'] })).toEqual(['박서연']);
  });

  it('참석자 이름이 연락처에 있으면 그 사람이다(공백·대소문자 무시, 전체가 같아야 한다)', () => {
    const contacts = [person('박서연'), person('Alex Kim')];
    expect(find(contacts, { title: '회의', attendeeNames: ['박 서연'.replace(' ', '')] })).toEqual(['박서연']);
    expect(find(contacts, { title: '회의', attendeeNames: ['alex  kim'] })).toEqual(['Alex Kim']);
    expect(find(contacts, { title: '회의', attendeeNames: ['박서연 팀장'] })).toEqual([]); // 일부만 같으면 맞지 않는다
  });

  it('이메일이나 이름이 연락처에 없으면 못 찾은 것이다', () => {
    expect(find([person('박서연', { emails: ['a@x.com'] })], { attendeeEmails: ['b@x.com'], attendeeNames: ['모르는 사람'] })).toEqual([]);
  });

  it('참석자가 제목·메모의 사람보다 앞에 온다', () => {
    const contacts = [person('김민수'), person('박서연', { emails: ['s@x.com'] })];
    expect(find(contacts, { title: '민수랑 저녁', attendeeEmails: ['s@x.com'] })).toEqual(['박서연', '김민수']);
  });

  it('같은 사람이 참석자와 제목에 모두 나와도 한 명이다', () => {
    const contacts = [person('김민수', { emails: ['m@x.com'] })];
    expect(find(contacts, { title: '민수랑 저녁', attendeeEmails: ['m@x.com'], attendeeNames: ['김민수'] })).toEqual(['김민수']);
  });
});

describe('결과 수: 한 명 · 두 명 · 세 명 이상', () => {
  const contacts = [person('김민수'), person('이민수'), person('박민수'), person('최서연')];

  it('한 명이면 그 사람', () => {
    expect(find(contacts, { title: '서연이랑 점심' })).toEqual(['최서연']);
  });

  it('두 명이 정확히 맞으면 두 후보를 낸다', () => {
    const two = [person('김민수'), person('최서연')];
    expect(find(two, { title: '서연이랑 민수 점심' })).toEqual(['최서연', '김민수']);
    expect(find(two, { title: '민수 서연 점심' })).toEqual(['김민수', '최서연']);
    expect(MAX_CONTACT_CANDIDATES).toBe(2);
  });

  it('세 명 이상이면 못 찾은 것으로 본다(동명이인 성만 다른 세 명)', () => {
    expect(find(contacts, { title: '민수랑 저녁' })).toEqual([]);
  });

  it('성만 다른 두 명이면 두 후보다', () => {
    expect(find([person('김민수'), person('이민수')], { title: '민수랑 저녁' })).toEqual(['김민수', '이민수']);
  });

  it('참석자와 제목을 합쳐 세 명이 되면 못 찾은 것이다', () => {
    const three = [person('김민수'), person('박서연', { emails: ['s@x.com'] }), person('최지우', { emails: ['j@x.com'] })];
    expect(find(three, { title: '민수랑 회의', attendeeEmails: ['s@x.com', 'j@x.com'] })).toEqual([]);
  });
});

describe('동명이인·중복·번호 없는 연락처', () => {
  it('같은 이름의 연락처 둘은 한 사람으로 센다(서버에는 표시 이름만 가서 차가 구별할 수 없다)', () => {
    const twins = [person('김민수', { phones: ['010-1111-2222'] }), person('김민수', { phones: ['010-3333-4444'] })];
    expect(find(twins, { title: '민수랑 저녁' })).toEqual(['김민수']);
  });

  it('같은 이름(공백·대소문자만 다름)은 합치고 이메일은 모두 참석자 조회에 쓴다', () => {
    const twins = [person('Alex Kim', { emails: ['a@x.com'] }), person('alex  kim', { emails: ['b@x.com'] })];
    expect(find(twins, { attendeeEmails: ['b@x.com'] })).toEqual(['Alex Kim']);
  });

  it('번호가 하나도 없는 연락처는 문자를 보낼 수 없으므로 찾지 않는다', () => {
    const contacts = [person('김민수', { phones: [] }), person('이영희', { phones: ['  '] })];
    expect(find(contacts, { title: '민수랑 영희랑 저녁' })).toEqual([]);
    const withMail = [person('박서연', { emails: ['s@x.com'], phones: [] })];
    expect(find(withMail, { attendeeEmails: ['s@x.com'] })).toEqual([]);
  });

  it('이름이 빈 연락처는 건너뛴다', () => {
    expect(find([person('   '), person('김민수')], { title: '민수랑 저녁' })).toEqual(['김민수']);
  });

  it('응답에는 표시 이름만 있다(번호·이메일이 섞이지 않는다)', () => {
    const result = find([person('김민수', { emails: ['m@x.com'], phones: ['010-9999-0000'] })], { title: '민수랑 저녁' });
    expect(JSON.stringify(result)).not.toMatch(/010|@/);
  });

  it('표시 이름은 연락처에 저장된 그대로 낸다(공백만 정리)', () => {
    expect(find([person(' 김  과장님 ')], { title: '김 과장님과 미팅' })).toEqual(['김 과장님']);
  });
});

describe('성능', () => {
  it('연락처 5000명 × 일정 100건을 빠르게 처리한다', () => {
    const names = '김이박최정강조윤장임'.split('');
    const given = ['민수', '서연', '지우', '하준', '도윤', '서준', '예준', '시우', '주원', '지호'];
    const many = Array.from({ length: 5000 }, (_, i) => person(`${names[i % 10]}${given[Math.floor(i / 10) % 10]}${String.fromCharCode(0xac00 + (i % 500))}`));
    const index = indexContacts(many);
    const started = Date.now();
    for (let i = 0; i < 100; i++) matchContacts(index, input({ title: `점심 약속 ${i}`, notes: '메모 '.repeat(100) }));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
