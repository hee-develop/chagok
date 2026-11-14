import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import type { DeviceEvent } from '../calendar-select/calendarSource';
import { settingsApi } from '../settings/settingsApi';
import { defaultContactsSource, type ContactsSource } from './contactsSource';
import { indexContacts, matchContacts, type ContactIndex } from './matchContacts';

/** 일정 하나의 연락 상대 표시 이름(0~2개). 이동 일정이 아니면(종일) 늘 빈 목록이다. */
export type EventContactLookup = (event: DeviceEvent) => string[];

export interface ContactFinder {
  /**
   * 이번에 일정을 보낼 때 쓸 조회 함수. '늦을 때 연락'이 꺼져 있거나 연락처 권한이 없으면 null(상대를 찾지 않는다).
   * 던지지 않는다: 설정·연락처를 못 읽으면 찾지 않고 이어 간다.
   */
  prepare(): Promise<EventContactLookup | null>;
}

/** 연락처를 읽어 색인한 결과를 이 시간 동안 다시 쓴다(앞에 있는 동안 3분마다 읽으므로 매번 전체를 읽지 않는다). */
export const CONTACT_CACHE_MS = 5 * 60 * 1000;

export type ContactFinderOptions = {
  source?: ContactsSource;
  /** 서버에 저장된 '늦을 때 연락' 값. 기본은 `GET /settings`. */
  fetchLateContact?: (signal: AbortSignal) => Promise<boolean>;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
  log?: (message: string) => void;
};

const devLog = (message: string) => {
  if (__DEV__) console.warn(message);
};

/**
 * 폰이 일정을 읽으면서 이동 일정마다 연락 상대를 미리 찾는 조회 함수를 만든다(정책서 10.5).
 * 서버가 아는 설정(`lateContact`)이 켜져 있고 연락처 권한이 있을 때만 찾는다. 설정을 읽지 못하면 마지막으로 안 값을 쓰고(처음이면 꺼짐),
 * 연락처를 읽지 못하면 이전 색인을, 그것도 없으면 찾지 않는다(일정 보내기는 멈추지 않는다). 일정 내용·이름은 로그에 남기지 않는다.
 */
export function createContactFinder({
  source = defaultContactsSource,
  fetchLateContact = async (signal) => (await settingsApi.fetchSettings(signal)).lateContact,
  now = () => Date.now(),
  ttlMs = CONTACT_CACHE_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
  log = devLog,
}: ContactFinderOptions = {}): ContactFinder {
  let lateKnown = false;
  let cache: { at: number; index: ContactIndex } | null = null;

  return {
    async prepare() {
      try {
        lateKnown = await requestWithTimeout(fetchLateContact, timeoutMs);
      } catch {
        log('[contacts] 설정 읽기 실패: 마지막으로 안 값을 씁니다');
      }
      if (!lateKnown) {
        cache = null; // 꺼 두면 읽어 둔 연락처를 들고 있지 않는다
        return null;
      }
      try {
        if ((await source.permission()) !== 'granted') {
          cache = null;
          return null;
        }
      } catch {
        return null;
      }
      if (cache === null || now() - cache.at >= ttlMs) {
        try {
          cache = { at: now(), index: indexContacts(await source.list()) };
        } catch {
          log('[contacts] 연락처 읽기 실패');
          if (cache === null) return null;
        }
      }
      const index = cache.index;
      return (event) =>
        event.allDay
          ? []
          : matchContacts(index, { title: event.title, notes: event.notes, attendeeNames: event.attendees, attendeeEmails: event.attendeeEmails ?? [] });
    },
  };
}

/** 앱 전체가 하나를 공유한다(일정 보내기가 쓴다). */
export const appContactFinder: ContactFinder = createContactFinder();
