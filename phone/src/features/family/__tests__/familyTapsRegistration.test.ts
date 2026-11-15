import '../familyTaps';
import { registerTapHandler } from '../../notifications/taps';

jest.mock('../../notifications/taps', () => ({ registerTapHandler: jest.fn(() => () => undefined) }));

describe('family-status 누름 처리기 등록', () => {
  it('루트 레이아웃이 이 파일을 불러오면(앱을 열면) family-status 종류에 처리기가 등록된다', () => {
    expect(registerTapHandler).toHaveBeenCalledTimes(1);
    expect(registerTapHandler).toHaveBeenCalledWith('family-status', expect.any(Function));
  });
});
