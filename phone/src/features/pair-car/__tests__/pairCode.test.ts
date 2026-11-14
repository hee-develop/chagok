import { codeFromScan, digitsOnly } from '../pairCode';

it('차 화면 QR 글이나 숫자 6자리에서 연결 번호를 꺼낸다', () => {
  expect(codeFromScan('chagok://pair?code=012345')).toBe('012345');
  expect(codeFromScan(' 654321 ')).toBe('654321');
  expect(codeFromScan('chagok://pair?v=1&code=111222')).toBe('111222');
});

it('차곡 QR이 아니거나 번호가 6자리가 아니면 null', () => {
  expect(codeFromScan('https://example.com/?code=123456')).toBeNull();
  expect(codeFromScan('chagok://pair?code=12345')).toBeNull();
  expect(codeFromScan('chagok://pair?code=1234567')).toBeNull();
  expect(codeFromScan('12345')).toBeNull();
});

it('입력에서 숫자만 6자리까지 남긴다', () => {
  expect(digitsOnly('123 456')).toBe('123456');
  expect(digitsOnly('12-34-56-78')).toBe('123456');
  expect(digitsOnly('abc')).toBe('');
});
