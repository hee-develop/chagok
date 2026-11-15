import { useLocalSearchParams } from 'expo-router';

import { isPlaceTarget } from '../../features/places/favorites';
import { PlaceSearchScreen } from '../../features/places/PlaceSearchScreen';

export default function PlaceSearchRoute() {
  const { target, from, picker } = useLocalSearchParams<{ target?: string; from?: string; picker?: string }>();
  // picker는 가족 요청의 장소 칸이 고른 장소를 돌려받는 키다(서버에 저장하지 않는다). 단계 표시 없이 열린다.
  if (typeof picker === 'string' && picker.trim() !== '' && picker.length <= 40) return <PlaceSearchScreen pickerKey={picker} standalone />;
  return <PlaceSearchScreen target={isPlaceTarget(target) ? target : 'other'} standalone={from === 'tab'} />;
}
