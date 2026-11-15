import mockContacts from '../../../../fixtures/contacts/mock-contacts.json';

/**
 * 연락처를 읽는 포트(정책서 10.4·10.5). 실제는 `expo-contacts`, `EXPO_PUBLIC_CONTACTS_SOURCE=mock`이면 `fixtures/contacts/mock-contacts.json`(E2E·테스트용).
 * 권한 창은 '늦을 때 연락'을 켤 때만 띄운다(`request`). 읽기(`list`)는 창을 띄우지 않는다.
 * 연락처 전체(번호·이메일 포함)는 폰 안에서만 쓴다. 서버로는 일정마다 찾은 상대의 표시 이름만 간다(`docs/contacts.md`).
 */

/** 연락처 한 사람. 번호·이메일은 폰 밖으로 나가지 않는다. */
export type Contact = {
  id: string;
  /** 연락처에 저장된 이름(표시 이름). */
  name: string;
  /** OS가 성·이름을 나눠 줬을 때 이름 부분(없으면 `name`에서 가늠한다). */
  givenName?: string;
  emails: string[];
  phones: string[];
};

/** 권한이 없을 때 `list`가 던진다. 안내는 설정 화면이 맡는다(여기서는 창을 띄우지 않는다). */
export class ContactsPermissionError extends Error {
  constructor() {
    super('연락처 권한이 없습니다');
    this.name = 'ContactsPermissionError';
    Object.setPrototypeOf(this, ContactsPermissionError.prototype);
  }
}

/** granted 켜짐 / ask 아직 안 물었거나 다시 물을 수 있음 / denied 설정에서만 켤 수 있음 */
export type ContactsPermission = 'granted' | 'ask' | 'denied';

export interface ContactsSource {
  /** 'mock'이면 기기 연락처를 건드리지 않는다(권한 창도 없다). */
  readonly kind: 'mock' | 'device';
  /** 지금 권한 상태. 창을 띄우지 않는다. */
  permission(): Promise<ContactsPermission>;
  /** 시스템 권한 창을 띄운다(다시 물을 수 없으면 창 없이 현재 상태). 결과 상태를 돌려준다. */
  request(): Promise<ContactsPermission>;
  /** 연락처 전체. 권한 창은 띄우지 않고, 권한이 없으면 `ContactsPermissionError`. */
  list(): Promise<Contact[]>;
}

type Response = { granted: boolean; canAskAgain: boolean };
export const toContactsPermission = (r: Response): ContactsPermission => (r.granted ? 'granted' : r.canAskAgain ? 'ask' : 'denied');

// expo-contacts는 처음 쓸 때 불러온다. 목 출처로 돌 때나 테스트에서는 네이티브 모듈을 건드리지 않는다.
// 새 객체 API는 Expo Go에서 쓸 수 없을 수 있어 캘린더처럼 legacy 함수 API를 쓴다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadContacts = () => require('expo-contacts/legacy') as typeof import('expo-contacts/legacy');

/** 한 번에 읽는 수와 읽는 쪽수 상한(연락처가 아주 많아도 끝난다). */
const PAGE_SIZE = 1000;
const MAX_PAGES = 30;

export const deviceContactsSource: ContactsSource = {
  kind: 'device',
  permission: async () => toContactsPermission(await loadContacts().getPermissionsAsync()),
  request: async () => toContactsPermission(await loadContacts().requestPermissionsAsync()),
  async list() {
    const Contacts = loadContacts();
    if (toContactsPermission(await Contacts.getPermissionsAsync()) !== 'granted') throw new ContactsPermissionError();
    const fields = [Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers];
    const out: Contact[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await Contacts.getContactsAsync({ fields, pageSize: PAGE_SIZE, pageOffset: page * PAGE_SIZE });
      for (const c of res.data) {
        const name = (c.name ?? [c.lastName, c.firstName].filter(Boolean).join('')).trim();
        if (name === '') continue;
        out.push({
          id: c.id ?? name,
          name,
          // 성과 이름이 따로 저장된 연락처만 이름 부분을 쓴다(한 칸에 다 적은 연락처의 firstName은 전체 이름이다).
          ...(c.lastName && c.firstName ? { givenName: c.firstName } : {}),
          emails: (c.emails ?? []).map((e) => e.email ?? '').filter((e) => e !== ''),
          phones: (c.phoneNumbers ?? []).map((p) => p.number ?? p.digits ?? '').filter((n) => n !== ''),
        });
      }
      if (!res.hasNextPage) break;
    }
    return out;
  },
};

/** 목 출처: 권한 창 없이 늘 켜짐이고 `fixtures/contacts/mock-contacts.json`을 돌려준다(폰 E2E·테스트용). */
export const mockContactsSource: ContactsSource = {
  kind: 'mock',
  permission: async () => 'granted',
  request: async () => 'granted',
  list: async () => mockContacts.contacts.map((c) => ({ ...c, emails: [...c.emails], phones: [...c.phones] })),
};

/**
 * EXPO_PUBLIC_CONTACTS_SOURCE로 연락처 출처를 고른다. 'mock'이면 목, 그 밖(비어 있음 포함)은 실제 기기 연락처.
 * 실제 사용자의 앱에서 가짜 연락처가 보이면 안 되므로 기본은 device다.
 * Expo는 process.env.EXPO_PUBLIC_* 를 빌드 때 값으로 바꾸므로 환경 변수 이름을 그대로 써야 한다.
 */
export const pickContactsSource = (value: string | undefined): ContactsSource => (value === 'mock' ? mockContactsSource : deviceContactsSource);

export const defaultContactsSource: ContactsSource = pickContactsSource(process.env.EXPO_PUBLIC_CONTACTS_SOURCE);
