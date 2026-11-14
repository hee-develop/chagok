import { useLocalSearchParams } from 'expo-router';

import { isPlaceTarget } from '../../features/places/favorites';
import { PlaceSearchScreen } from '../../features/places/PlaceSearchScreen';

export default function PlaceSearchRoute() {
  const { target, from } = useLocalSearchParams<{ target?: string; from?: string }>();
  return <PlaceSearchScreen target={isPlaceTarget(target) ? target : 'other'} standalone={from === 'tab'} />;
}
