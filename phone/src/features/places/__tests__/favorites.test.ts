import { isPlaceTarget, notSaved } from '../favorites';
import { EMPTY, FIELD, GYM, SUGGESTIONS } from '../testSupport';

describe('notSaved', () => {
  it('집·회사·추가 장소에 있는 것을 뺀다', () => {
    expect(notSaved(SUGGESTIONS, EMPTY)).toHaveLength(2);
    expect(notSaved(SUGGESTIONS, { ...EMPTY, others: [GYM] }).map((s) => s.id)).toEqual([FIELD.id]);
    expect(notSaved(SUGGESTIONS, { ...EMPTY, home: FIELD, work: GYM }).map((s) => s.id)).toEqual([]);
  });
});

describe('isPlaceTarget', () => {
  it('home·work·other만 받는다', () => {
    expect(['home', 'work', 'other'].every(isPlaceTarget)).toBe(true);
    expect([undefined, '', 'Home', 'x', 1, ['home']].some(isPlaceTarget)).toBe(false);
  });
});
