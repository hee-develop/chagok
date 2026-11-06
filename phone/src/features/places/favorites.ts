import type { Favorites, Place } from './placesApi';

/** 장소를 넣을 자리. other는 집·회사 아래에 이어 붙는다. */
export type PlaceTarget = 'home' | 'work' | 'other';

export const isPlaceTarget = (value: unknown): value is PlaceTarget => value === 'home' || value === 'work' || value === 'other';

/** 집·회사·추가한 장소 어디에도 없는 장소만 남긴다. */
export function notSaved<T extends Pick<Place, 'id'>>(candidates: T[], favorites: Favorites): T[] {
  const saved = new Set([favorites.home?.id, favorites.work?.id, ...favorites.others.map((p) => p.id)]);
  return candidates.filter((c) => !saved.has(c.id));
}
