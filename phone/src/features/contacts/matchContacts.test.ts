import type { Contact } from './contactsSource';
import { givenNameOf, indexContacts, isTitleOrKinship, matchContacts, MAX_CONTACT_CANDIDATES, wordIndexOf, type MatchInput } from './matchContacts';

let nextId = 0;
const person = (name: string, extra: Partial<Contact> = {}): Contact => ({ id: `c${nextId++}`, name, emails: [], phones: ['010-1111-2222'], ...extra });
const input = (over: Partial<MatchInput> = {}): MatchInput => ({ title: '', notes: null, attendeeNames: [], attendeeEmails: [], ...over });
const find = (contacts: Contact[], over: Partial<MatchInput>) => matchContacts(indexContacts(contacts), input(over));

describe('직함·관계 말(isTitleOrKinship)', () => {
  it.each([['팀장', true], ['과장님', true], ['부장', true], ['엄마', true], ['언니', true], ['삼촌', true], ['외삼촌', true], ['할머니', true], ['과장씨', true], ['민수', false], ['가게', false], ['지원', false], ['', false]])(
    '%j → %s',
    (word, expected) => expect(isTitleOrKinship(word)).toBe(expected),
  );
});

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
    ['할머니', undefined, null], // 관계 말
    ['어머니', undefined, null],
    ['박팀장님', undefined, null],
    ['Alex Kim', undefined, null], // 영문 이름
    ['꽃가게', undefined, '가게'], // 직함·관계 말이 아니면 만든다(조사가 붙었을 때만 맞는다)
    ['이사랑', undefined, '사랑'],
    // 직함·관계 말은 성을 뺀 이름으로 만들지 않는다
    ['박팀장', undefined, null],
    ['김과장', undefined, null],
    ['김부장님', undefined, null],
    ['김이사', undefined, null],
    ['외삼촌', undefined, null],
    ['친언니', undefined, null],
    ['큰엄마', undefined, null],
    // OS가 성·이름을 나눠 준 경우도 같다
    ['김민수', '민수', '민수'],
    ['김민수', '김민수', '민수'], // OS가 나누지 않은 연락처(전체와 같은 이름 부분)는 가늠한다
    ['남궁민수', '민수', '민수'],
    ['김철', '철', null],
    ['박과장', '과장', null],
    ['큰엄마', '엄마', null],
    ['김팀장', '팀장님', null],
    ['사공이가', '이가', '이가'],
  ])('%s (OS 이름 부분 %s) → %s', (name, os, expected) => {
    expect(givenNameOf(name, os)).toBe(expected);
  });
});

describe('낱말 경계와 조사·호칭(wordIndexOf)', () => {
  it.each([
    // [글, 이름, 조사·호칭이 붙어야만 맞음(attachedOnly), 기대 위치]
    ['민수랑 저녁', '민수', true, 0],
    ['민수랑 저녁', '민수', false, 0],
    ['저녁 민수와 약속', '민수', true, 3],
    ['민수씨 안녕', '민수', true, 0],
    ['민수에게 전달', '민수', true, 0],
    ['민수한테 줄 선물', '민수', true, 0],
    ['민수와의 점심', '민수', true, 0], // 조사 + 보조 조사
    ['민수랑은 점심', '민수', true, 0],
    ['민수씨에게 전달', '민수', true, 0],
    ['민수 형 만나기', '민수', true, 0], // 띄어쓰기 뒤 호칭
    ['민수 팀장님과 미팅', '민수', true, 0],
    ['민수 누나 생일', '민수', true, 0],
    ['김민수님 미팅', '김민수', false, 0],
    // 조사·호칭 없이 낱말이 끝나는 경우: 전체 이름은 맞고 성을 뺀 이름(attachedOnly)은 아니다
    ['민수 저녁', '민수', false, 0],
    ['민수 저녁', '민수', true, -1],
    ['지원 회의', '지원', true, -1],
    ['민수, 승현과 점심', '민수', true, -1],
    ['민수, 승현과 점심', '민수', false, 0],
    ['민수', '민수', true, -1],
    ['민수', '민수', false, 0],
    ['민수 다음 형 만나기', '민수', true, -1], // 호칭이 바로 이어지지 않는다
    // 다른 낱말의 일부
    ['국민수영장', '민수', false, -1],
    ['민수영장 가기', '민수', false, -1],
    ['민수영장 가기', '민수', true, -1],
    ['민수이야기', '민수', true, -1],
    ['alexander', 'alex', false, -1],
    ['alex 점심', 'alex', false, 0],
    ['alex랑 점심', 'alex', true, 0],
    ['dr.alex', 'alex', false, 3], // 점은 낱말 글자가 아니다
    ['alex2', 'alex', false, -1],
    ['x민수', '민수', false, -1],
    ['', '민수', false, -1],
    ['민수', '', false, -1],
  ])('%j 안의 %j (attachedOnly=%s) → %i', (text, needle, attachedOnly, expected) => {
    expect(wordIndexOf(text, needle, attachedOnly)).toBe(expected);
  });

  it('첫 위치가 낱말이 아니면 다음 위치를 본다', () => {
    expect(wordIndexOf('국민수 민수랑', '민수', true)).toBe(4);
  });
});

describe('제목 속 이름', () => {
  const minsu = person('김민수');

  it('성을 뺀 이름에 조사·호칭이 붙어 있으면 그 사람이다("민수랑 저녁" → 김민수)', () => {
    expect(find([minsu], { title: '민수랑 저녁' })).toEqual(['김민수']);
    expect(find([minsu], { title: '민수와 점심' })).toEqual(['김민수']);
    expect(find([minsu], { title: '민수씨 면담' })).toEqual(['김민수']);
    expect(find([minsu], { title: '민수 형 만나기' })).toEqual(['김민수']);
    expect(find([minsu], { title: '민수에게 선물 전달' })).toEqual(['김민수']);
  });

  it('성을 뺀 이름만 맨 낱말로 있으면 맞지 않는다(오탐보다 미탐: "민수 저녁")', () => {
    expect(find([minsu], { title: '민수 저녁' })).toEqual([]);
    expect(find([minsu], { title: '저녁 민수' })).toEqual([]);
    expect(find([minsu], { title: '민수, 승현과 점심' })).toEqual([]);
  });

  it('전체 이름은 낱말로 있으면 조사 없이도 맞는다', () => {
    expect(find([minsu], { title: '김민수 면접 응원' })).toEqual(['김민수']);
    expect(find([minsu], { title: '김민수님 면담' })).toEqual(['김민수']);
  });

  it('이름이 없으면 못 찾은 것이다(빈 목록)', () => {
    expect(find([minsu], { title: '치과', notes: '10시 30분' })).toEqual([]);
    expect(find([minsu], { title: '', notes: null })).toEqual([]);
  });

  it('대소문자·여러 공백을 무시한다(영문 이름)', () => {
    expect(find([person('Alex Kim')], { title: 'ALEX   KIM과 점심' })).toEqual(['Alex Kim']);
  });

  it('두 글자 이름만 있는 연락처는 조사·호칭이 붙었을 때만 맞는다(흔한 낱말과 겹치기 쉬워서)', () => {
    expect(find([person('민수')], { title: '민수랑 저녁' })).toEqual(['민수']);
    expect(find([person('민수')], { title: '민수 저녁' })).toEqual([]);
  });

  it('부분 문자열 오탐: 연락처 "민수"와 제목 "국민수영장"은 맞지 않는다', () => {
    expect(find([person('민수')], { title: '국민수영장 가기' })).toEqual([]);
    expect(find([minsu], { title: '국민수영장 가기' })).toEqual([]);
    expect(find([minsu], { title: '민수영장' })).toEqual([]);
  });

  it('이름이 두 글자 미만이면(성 + 한 글자) 성을 뺀 이름으로는 찾지 않는다', () => {
    const contacts = [person('김수')];
    expect(find(contacts, { title: '수랑 점심' })).toEqual([]);
    expect(find(contacts, { title: '김수랑 점심' })).toEqual(['김수']); // 전체 이름(조사 붙음)은 맞는다
  });

  it('복성(남궁민수)도 성을 뺀 이름으로 찾는다', () => {
    expect(find([person('남궁민수')], { title: '민수랑 저녁' })).toEqual(['남궁민수']);
  });

  it('OS가 나눠 준 이름 부분을 쓴다', () => {
    expect(find([person('독고탁', { givenName: '탁' })], { title: '탁이랑 점심' })).toEqual([]);
    expect(find([person('사공이가', { givenName: '이가' })], { title: '이가랑 점심' })).toEqual(['사공이가']);
  });
});

describe('메모에서는 전체 이름만 본다', () => {
  const minsu = person('김민수');

  it('성을 뺀 이름은 메모에서 찾지 않는다(조사가 붙어 있어도)', () => {
    expect(find([minsu], { title: '저녁 약속', notes: '민수가 식당 예약함' })).toEqual([]);
    expect(find([minsu], { title: '저녁 약속', notes: '민수랑 같이 가기' })).toEqual([]);
  });

  it('전체 이름은 메모에서도 낱말 경계를 지키며 맞는다', () => {
    expect(find([minsu], { title: '저녁 약속', notes: '김민수가 식당 예약함' })).toEqual(['김민수']);
    expect(find([minsu], { title: '저녁 약속', notes: '국김민수영장' })).toEqual([]);
  });

  it('제목의 성을 뺀 이름과 메모의 전체 이름은 한 사람으로 합친다', () => {
    expect(find([minsu], { title: '민수랑 저녁', notes: '김민수 연락처 확인' })).toEqual(['김민수']);
  });
});

describe('직함·관계 말 오탐(호칭은 연락처에 그 이름 그대로 저장된 경우에만)', () => {
  it.each([
    ['박팀장', '팀장 면담'],
    ['김과장', '과장님 보고'],
    ['꽃가게', '가게 들르기'],
    ['외삼촌', '삼촌 댁 방문'],
    ['친언니', '언니랑 쇼핑'],
    ['이대리', '대리님과 점심'],
    ['최사장', '사장님 미팅'],
    ['박원장', '원장님께 인사'],
    ['큰엄마', '엄마랑 병원'],
  ])('연락처 %s는 제목 "%s"로 부르지 않는다', (name, title) => {
    expect(find([person(name)], { title })).toEqual([]);
  });

  it('"엄마 생신"은 연락처 "엄마"만 부르고 "큰엄마"는 부르지 않는다', () => {
    expect(find([person('엄마'), person('큰엄마')], { title: '엄마 생신' })).toEqual(['엄마']);
  });

  it('OS가 성·이름을 나눠 준 연락처도 직함·관계 말로는 부르지 않는다', () => {
    expect(find([person('박과장', { givenName: '과장' })], { title: '과장님과 보고' })).toEqual([]);
    expect(find([person('큰엄마', { givenName: '엄마' })], { title: '엄마랑 병원' })).toEqual([]);
  });

  it('호칭 그대로 저장된 연락처는 맞는다("엄마", "팀장", "김 과장님")', () => {
    expect(find([person('엄마')], { title: '엄마랑 병원' })).toEqual(['엄마']);
    expect(find([person('엄마')], { title: '엄마 생신' })).toEqual(['엄마']);
    expect(find([person('팀장')], { title: '팀장 면담' })).toEqual(['팀장']);
    expect(find([person('할머니')], { title: '할머니 댁 방문' })).toEqual(['할머니']);
    const manager = person('김 과장님');
    expect(find([manager], { title: '김 과장님과 미팅' })).toEqual(['김 과장님']);
  });

  it('호칭이 연락처에 없으면(다른 이름으로 저장) 맞지 않는다', () => {
    expect(find([person('김영희')], { title: '엄마랑 병원' })).toEqual([]);
  });

  it('"김 과장님"은 성만 같은 다른 연락처나 성을 뺀 이름으로는 맞지 않는다', () => {
    const manager = person('김 과장님');
    expect(find([manager], { title: '과장님과 미팅' })).toEqual([]);
    expect(find([manager], { title: '김 과장 미팅' })).toEqual([]);
    expect(find([person('김민수')], { title: '김 과장님과 미팅' })).toEqual([]);
  });

  it('호칭에서 성을 떼어 이름을 만들지 않는다("할머니" → "머니")', () => {
    expect(find([person('할머니')], { title: '머니 챙기기' })).toEqual([]);
  });

  it('"엄마친구" 같은 다른 낱말에 들어 있으면 맞지 않는다', () => {
    expect(find([person('엄마')], { title: '엄마친구 모임' })).toEqual([]);
  });
});

describe('흔한 낱말과 같은 이름 오탐', () => {
  it.each([
    ['김지원', '지원 회의'],
    ['박수정', '수정 요청'],
    ['김하나', '하나 더 사기'],
    ['오늘', '오늘 저녁 약속'],
    ['이서연', '서연 점심'],
    ['김민수', '민수 저녁'],
  ])('연락처 %s는 제목 "%s"로 부르지 않는다', (name, title) => {
    expect(find([person(name)], { title })).toEqual([]);
  });

  it.each([
    ['김지원', '지원이랑 회의'],
    ['박수정', '수정씨한테 요청'],
    ['김하나', '하나와 쇼핑'],
    ['오늘', '오늘이랑 약속'],
    ['김민수', '민수 형 만나기'],
    ['김민수', '민수에게 연락'],
  ])('조사·호칭이 붙으면 연락처 %s를 제목 "%s"로 부른다', (name, title) => {
    expect(find([person(name)], { title })).toEqual([name]);
  });

  it('메모 속 흔한 낱말도 부르지 않는다(메모는 전체 이름만)', () => {
    expect(find([person('김지원'), person('오늘')], { title: '회의', notes: '지원이랑 오늘 정리' })).toEqual([]);
  });
});

describe('참석자', () => {
  it('참석자 이메일이 연락처에 있으면 그 사람이다(대소문자 무시)', () => {
    const contacts = [person('박서연', { emails: ['Seoyeon@Example.com'] })];
    expect(find(contacts, { title: '주간 회의', attendeeEmails: ['seoyeon@example.COM'] })).toEqual(['박서연']);
  });

  it('참석자 이름이 연락처에 있으면 그 사람이다(공백·대소문자 무시, 전체가 같아야 한다)', () => {
    const contacts = [person('박서연'), person('Alex Kim')];
    expect(find(contacts, { title: '회의', attendeeNames: ['박서연'] })).toEqual(['박서연']);
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

  it('두 명이 정확히 맞으면 두 후보를 낸다(글에 먼저 나온 순)', () => {
    const two = [person('김민수'), person('최서연')];
    expect(find(two, { title: '서연이랑 민수와 점심' })).toEqual(['최서연', '김민수']);
    expect(find(two, { title: '민수와 서연이랑 점심' })).toEqual(['김민수', '최서연']);
    expect(MAX_CONTACT_CANDIDATES).toBe(2);
  });

  it('세 명 이상이면 못 찾은 것으로 본다(성만 다른 세 명)', () => {
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

describe('번호·이메일이 표시 이름으로 나가지 않는다(Android는 이름 없는 연락처의 DISPLAY_NAME을 번호·이메일로 채운다)', () => {
  const nameless = [person('010-1234-5678', { phones: ['010-1234-5678'] }), person('partner@corp.example', { emails: ['partner@corp.example'] })];

  it('재현 사례: 참석자 이메일과 메모의 번호가 연락처 이름과 같아도 후보가 되지 않는다', () => {
    expect(find(nameless, { title: '출장', notes: '담당 기사 010-1234-5678', attendeeEmails: ['partner@corp.example'] })).toEqual([]);
  });

  it.each(['010-1234-5678', '+82 10 1234 5678', '01012345678', 'partner@corp.example', '12345', '---', '김과장 010-1234-5678', '김과장 kim@corp.example'])(
    '이름이 %s 모양이면 연락처가 있어도 제목·메모·참석자 어디서도 찾지 않는다',
    (name) => {
      const contacts = [person(name, { emails: ['x@corp.example'] })];
      expect(find(contacts, { title: `${name} 미팅`, notes: name, attendeeNames: [name], attendeeEmails: ['x@corp.example'] })).toEqual([]);
    },
  );

  it('이름이 있는 연락처는 번호·이메일이 같이 있어도 이름만 낸다', () => {
    const mixed = [...nameless, person('김민수', { emails: ['m@x.com'], phones: ['010-9999-0000'] })];
    expect(find(mixed, { title: '민수랑 저녁 010-1234-5678', attendeeEmails: ['partner@corp.example', 'm@x.com'] })).toEqual(['김민수']);
  });

  it('숫자가 섞인 평범한 이름은 그대로 쓴다', () => {
    expect(find([person('7-Eleven')], { title: '7-Eleven 알바 면접' })).toEqual(['7-Eleven']);
    expect(find([person('Dr. Kim 2')], { title: 'dr. kim 2 상담' })).toEqual(['Dr. Kim 2']);
  });
});

describe('긴 입력(ReDoS 회귀)과 성능', () => {
  const elapsed = (run: () => void) => {
    const started = Date.now();
    run();
    return Date.now() - started;
  };
  const minsu = indexContacts([person('김민수')]);

  it('조사가 길게 반복돼도 오래 걸리지 않는다(예전 정규식은 "민수" + "이랑"×26 + "힣"에서 4초 넘게 걸렸다)', () => {
    const attack = `민수${'이랑'.repeat(26)}힣`;
    expect(elapsed(() => expect(wordIndexOf(attack, '민수', true)).toBe(-1))).toBeLessThan(50);
    expect(elapsed(() => expect(matchContacts(minsu, input({ title: attack }))).toEqual([]))).toBeLessThan(50);
  });

  it.each([1000, 5000])('조사 덩어리 %i개가 이어진 글도 선형 시간이다', (n) => {
    const attack = `민수${'이랑'.repeat(n)}힣`;
    expect(elapsed(() => matchContacts(minsu, input({ title: attack, notes: attack })))).toBeLessThan(100);
  });

  it('같은 이름이 수천 번 반복되거나 조사만 반복돼도 제한 안에 끝난다', () => {
    const repeated = '민수 '.repeat(1000);
    const joined = '민수'.repeat(2000);
    const josa = `민수${'와'.repeat(3000)}`;
    expect(elapsed(() => matchContacts(minsu, input({ title: repeated, notes: repeated })))).toBeLessThan(200);
    expect(elapsed(() => matchContacts(minsu, input({ title: joined, notes: joined })))).toBeLessThan(200);
    expect(elapsed(() => matchContacts(minsu, input({ title: josa, notes: josa })))).toBeLessThan(200);
  });

  it('공백이 길게 이어진 글도 호칭 검사가 제한 안에 끝난다', () => {
    const spaced = `민수${' '.repeat(5000)}형`;
    expect(elapsed(() => wordIndexOf(spaced, '민수', true))).toBeLessThan(50);
  });

  it('연락처 5000명 × 일정 100건을 빠르게 처리한다', () => {
    const names = '김이박최정강조윤장임'.split('');
    const given = ['민수', '서연', '지우', '하준', '도윤', '서준', '예준', '시우', '주원', '지호'];
    const many = Array.from({ length: 5000 }, (_, i) => person(`${names[i % 10]}${given[Math.floor(i / 10) % 10]}${String.fromCharCode(0xac00 + (i % 500))}`));
    const index = indexContacts(many);
    expect(elapsed(() => {
      for (let i = 0; i < 100; i++) matchContacts(index, input({ title: `점심 약속 ${i}`, notes: '메모 '.repeat(100) }));
    })).toBeLessThan(2000);
  });
});
