import { api } from '../../api/client';
import { HttpError } from '../../api/request';
import type { ServerNotification } from './types';

export type NotificationsApi = {
  /** `since`(알림 id)보다 나중에 온 알림을 오래된 것부터 받는다. 토큰이 없거나 연결 전이면 서버가 빈 목록을 준다. */
  fetchNew: (since: string | null, signal: AbortSignal) => Promise<ServerNotification[]>;
  /** 읽어 간 알림을 서버 알림함에서 지운다. */
  ack: (ids: string[], signal: AbortSignal) => Promise<void>;
};

/** 서버 알림함(`GET /notifications`, `POST /notifications/ack`). 계약: docs/notifications.md. 클라이언트를 바꿔 끼울 수 있게 한 겹 둔다(테스트). */
export const createNotificationsApi = (client: Pick<typeof api, 'notifications'>): NotificationsApi => ({
  fetchNew: async (since, signal) => {
    const res = await client.notifications.$get({ query: { since: since ?? undefined } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /notifications ${res.status}`);
    const body = await res.json();
    return body.notifications;
  },
  ack: async (ids, signal) => {
    if (ids.length === 0) return;
    const res = await client.notifications.ack.$post({ json: { ids } }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `POST /notifications/ack ${res.status}`);
  },
});

export const notificationsApi = createNotificationsApi(api);
