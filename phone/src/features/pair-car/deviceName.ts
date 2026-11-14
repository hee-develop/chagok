import * as Device from 'expo-device';

/** 서버가 내려 주는 자리 이름 상한과 같다(server MAX_SEAT_NAME_LENGTH). */
const MAX_NAME_LENGTH = 40;
export const DEFAULT_DEVICE_NAME = '내 폰';

/** 운전자 자리 이름으로 보낼 폰 기기 이름. 기기 이름 → 모델 이름 → '내 폰' 순으로 쓴다. */
export function getDeviceName(): string {
  const raw = Device.deviceName ?? Device.modelName ?? '';
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim();
  return name === '' ? DEFAULT_DEVICE_NAME : name;
}
