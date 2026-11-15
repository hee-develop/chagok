import type { Contact, ContactsSource } from './contactsSource';
import { ContactsPermissionError } from './contactsSource';
import { findNumberByDisplayName, normalizeKoreanMobile } from './findNumber';

const source = (contacts: Contact[], permission: 'granted' | 'ask' | 'denied' = 'granted'): ContactsSource => ({
  kind: 'device',
  permission: async () => permission,
  request: async () => permission,
  list: async () => contacts,
});
const c = (name: string, phones: string[], id = name): Contact => ({ id, name, emails: [], phones });

describe('normalizeKoreanMobile', () => {
  it.each([
    ['010-1234-5678', '01012345678'],
    ['010 1234 5678', '01012345678'],
    ['+82 10-1234-5678', '01012345678'],
    ['82-10-1234-5678', '01012345678'],
    ['(010) 1234.5678', '01012345678'],
    ['02-123-4567', null],
    ['010-123-456', null],
    ['011-1234-5678', null],
    ['+1 415 555 0100', null],
    ['', null],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeKoreanMobile(raw)).toBe(expected);
  });
});

describe('findNumberByDisplayName', () => {
  it('표시 이름으로 번호를 꺼낸다(공백·대소문자 무시, 한국 휴대폰 번호는 010######## 모양)', async () => {
    const s = source([c('김민수', ['+82 10-1234-5678']), c('Alex Kim', ['010-2222-3333'])]);
    expect(await findNumberByDisplayName('김민수', s)).toBe('01012345678');
    expect(await findNumberByDisplayName('  alex   kim ', s)).toBe('01022223333');
  });

  it('번호가 여럿이면 한국 휴대폰 번호를 먼저 고른다', async () => {
    expect(await findNumberByDisplayName('김민수', source([c('김민수', ['02-123-4567', '010-9999-0000'])]))).toBe('01099990000');
  });

  it('한국 휴대폰 번호가 없으면 첫 번호의 숫자(앞의 +는 유지)를 낸다', async () => {
    expect(await findNumberByDisplayName('김민수', source([c('김민수', ['+1 (415) 555-0100'])]))).toBe('+14155550100');
  });

  it('같은 이름이 여럿이어도 번호가 같으면 그 번호, 다르면(동명이인) 고르지 않는다', async () => {
    expect(await findNumberByDisplayName('김민수', source([c('김민수', ['010-1111-2222'], 'a'), c('김민수', ['+82 10 1111 2222'], 'b')]))).toBe('01011112222');
    expect(await findNumberByDisplayName('김민수', source([c('김민수', ['010-1111-2222'], 'a'), c('김민수', ['010-3333-4444'], 'b')]))).toBeNull();
  });

  it('이름이 일부만 같거나 없으면 null이다', async () => {
    const s = source([c('김민수', ['010-1111-2222'])]);
    expect(await findNumberByDisplayName('민수', s)).toBeNull();
    expect(await findNumberByDisplayName('', s)).toBeNull();
    expect(await findNumberByDisplayName('박서연', s)).toBeNull();
  });

  it('번호가 없는 연락처는 null이다', async () => {
    expect(await findNumberByDisplayName('김민수', source([c('김민수', [])]))).toBeNull();
  });

  it('권한이 없으면 목록을 읽지 않고 null이다(창도 띄우지 않는다)', async () => {
    const s = { ...source([c('김민수', ['010-1111-2222'])], 'denied'), list: jest.fn(), request: jest.fn() };
    expect(await findNumberByDisplayName('김민수', s)).toBeNull();
    expect(s.list).not.toHaveBeenCalled();
    expect(s.request).not.toHaveBeenCalled();
  });

  it('읽다가 던져도(권한 오류·네이티브 오류) null이다', async () => {
    const denied = { ...source([]), list: async () => { throw new ContactsPermissionError(); } };
    const broken = { ...source([]), list: async () => { throw new Error('native'); } };
    expect(await findNumberByDisplayName('김민수', denied)).toBeNull();
    expect(await findNumberByDisplayName('김민수', broken)).toBeNull();
  });
});
