import { DEFAULT_DEVICE_NAME, getDeviceName } from '../deviceName';

const mockDevice: { deviceName: string | null; modelName: string | null } = { deviceName: null, modelName: null };
jest.mock('expo-device', () => ({
  get deviceName() {
    return mockDevice.deviceName;
  },
  get modelName() {
    return mockDevice.modelName;
  },
}));

beforeEach(() => {
  mockDevice.deviceName = null;
  mockDevice.modelName = null;
});

describe('getDeviceName', () => {
  it('기기 이름을 쓰고, 없으면 모델 이름, 그것도 없으면 "내 폰"이다', () => {
    mockDevice.deviceName = '희의 Pixel';
    mockDevice.modelName = 'Pixel 9';
    expect(getDeviceName()).toBe('희의 Pixel');
    mockDevice.deviceName = null;
    expect(getDeviceName()).toBe('Pixel 9');
    mockDevice.modelName = null;
    expect(getDeviceName()).toBe(DEFAULT_DEVICE_NAME);
    expect(DEFAULT_DEVICE_NAME).toBe('내 폰');
  });

  it('공백을 정리하고 40자로 줄이며, 공백뿐이면 "내 폰"이다', () => {
    mockDevice.deviceName = '  Galaxy   S25  ';
    expect(getDeviceName()).toBe('Galaxy S25');
    mockDevice.deviceName = 'x'.repeat(80);
    expect(getDeviceName()).toHaveLength(40);
    mockDevice.deviceName = '   ';
    expect(getDeviceName()).toBe('내 폰');
  });
});
