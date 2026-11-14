import type { DeviceEvent } from '../calendar-select/calendarSource';

/**
 * 서버로 보내는 일정 한 건(`PUT /events` 본문 항목). 정책서 10.2: 이동 일정은 제목, 시작·종료, 장소 칸, 메모, 연락 상대 표시 이름만 보낸다.
 * 참석자 이름·이메일은 폰 안에서 연락 상대를 찾는 데만 쓰고 보내지 않는다(`DeviceEvent`와 달리 `attendees`가 없다).
 */
export type WireEvent = Omit<DeviceEvent, 'attendees' | 'attendeeEmails'> & {
  /** 연락 상대 표시 이름(0~2개). 번호·이메일은 담지 않는다. */
  contacts: string[];
};

/** 폰이 읽은 일정에서 보낼 것만 골라 낸다. `contacts`는 이미 찾은 표시 이름(없으면 빈 목록)이다. */
export function toWireEvent(event: DeviceEvent, contacts: readonly string[] = []): WireEvent {
  const { attendees: _attendees, attendeeEmails: _emails, ...rest } = event;
  return { ...rest, contacts: [...contacts] };
}
