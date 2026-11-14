import type { InferResponseType } from 'hono/client';

import { api } from '../../api/client';
import { HttpError } from '../../api/request';

/** 자리별 설정(`GET`·`PUT /settings`, 계약: docs/settings.md). 기본 말 걸기는 끌 수 없는 고정 값이라 서버에 두지 않는다. */
export type Settings = InferResponseType<typeof api.settings.$get, 200>;
export type SettingKey = keyof Settings;

export type SettingsApi = {
  fetchSettings: (signal: AbortSignal) => Promise<Settings>;
  /** 보낸 키만 바꾸고 바뀐 전체 설정을 돌려준다. */
  saveSettings: (patch: Partial<Settings>, signal: AbortSignal) => Promise<Settings>;
};

export const settingsApi: SettingsApi = {
  fetchSettings: async (signal) => {
    const res = await api.settings.$get(undefined, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `GET /settings ${res.status}`);
    return res.json();
  },
  saveSettings: async (patch, signal) => {
    const res = await api.settings.$put({ json: patch }, { init: { signal } });
    if (!res.ok) throw new HttpError(res.status, `PUT /settings ${res.status}`);
    return res.json();
  },
};
