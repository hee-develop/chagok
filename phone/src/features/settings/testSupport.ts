import type { Contact, ContactsPermission, ContactsSource } from '../contacts/contactsSource';
import type { Settings, SettingsApi } from './settingsApi';

export const OFF: Settings = { plusMode: false, lateContact: false, voiceOnly: false };

/** 서버처럼 보낸 키만 바꾸고 바뀐 전체를 돌려주는 가짜 설정 API. */
export const makeSettingsApi = (initial: Partial<Settings> = {}, overrides: Partial<SettingsApi> = {}) => {
  let current: Settings = { ...OFF, ...initial };
  return {
    fetchSettings: jest.fn(async () => ({ ...current })),
    saveSettings: jest.fn(async (patch: Partial<Settings>) => {
      current = { ...current, ...patch };
      return { ...current };
    }),
    ...overrides,
  } as SettingsApi & { fetchSettings: jest.Mock; saveSettings: jest.Mock };
};

/** 약속을 밖에서 끝낼 수 있게 한다(응답 순서를 마음대로 만든다). */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Mock = ContactsSource & { permission: jest.Mock; request: jest.Mock; list: jest.Mock };
/** 권한 창을 눌렀을 때 결과(answer)로 바뀌는 가짜 연락처 출처. */
export const makeContacts = (initial: ContactsPermission = 'ask', answer: ContactsPermission = 'granted', contacts: Contact[] = []): Mock => {
  let current = initial;
  return {
    kind: 'device',
    permission: jest.fn(async () => current),
    request: jest.fn(async () => {
      if (current === 'ask') current = answer;
      return current;
    }),
    list: jest.fn(async () => contacts),
  } as Mock;
};
