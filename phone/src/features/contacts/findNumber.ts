import { ContactsPermissionError, defaultContactsSource, type Contact, type ContactsSource } from './contactsSource';

const collapse = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** 한국 휴대폰 번호(010 + 8자리, +82 10…도 받음)를 `010########`으로 맞춘다. 아니면 null. */
export function normalizeKoreanMobile(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const local = digits.startsWith('+82') ? `0${digits.slice(3)}` : digits.startsWith('82') && digits.length === 12 ? `0${digits.slice(2)}` : digits;
  const only = local.replace(/\D/g, '');
  return /^010\d{8}$/.test(only) ? only : null;
}

/** 한 연락처에서 문자를 보낼 번호 하나: 한국 휴대폰 번호를 먼저, 없으면 첫 번호(숫자와 앞의 +만 남김). 번호가 없으면 null. */
function bestNumber(contact: Contact): string | null {
  const phones = contact.phones.map((p) => p.trim()).filter((p) => p !== '');
  for (const phone of phones) {
    const mobile = normalizeKoreanMobile(phone);
    if (mobile) return mobile;
  }
  const first = phones[0];
  return first === undefined ? null : first.replace(/(?!^\+)[^\d]/g, '');
}

/**
 * 표시 이름으로 연락처에서 번호를 다시 꺼낸다(정책서 10.5: 서버에는 표시 이름만 보내고 번호는 폰 안에 두었다가 보낼 때 꺼낸다. 늦을 때 연락 묶음 J9가 쓴다).
 * 이름은 공백·대소문자를 무시하고 전체가 같아야 한다. 같은 이름의 연락처가 여럿이어도 고른 번호가 모두 같으면 그 번호이고,
 * 서로 다르면(동명이인) 고를 수 없으므로 null이다(차가 번호를 묻는다). 권한이 없거나 못 읽거나 찾지 못해도 null이다. 권한 창은 띄우지 않는다.
 */
export async function findNumberByDisplayName(name: string, source: ContactsSource = defaultContactsSource): Promise<string | null> {
  const wanted = collapse(name);
  if (wanted === '') return null;
  try {
    if ((await source.permission()) !== 'granted') return null;
    const numbers = new Set<string>();
    for (const contact of await source.list()) {
      if (collapse(contact.name) !== wanted) continue;
      const number = bestNumber(contact);
      if (number !== null) numbers.add(number);
    }
    return numbers.size === 1 ? [...numbers][0]! : null;
  } catch (error) {
    if (error instanceof ContactsPermissionError) return null;
    return null;
  }
}
