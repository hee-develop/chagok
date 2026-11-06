import { useLocalSearchParams } from 'expo-router';

import { isPlaceTarget } from '../../features/places/favorites';
import { PlaceSearchScreen } from '../../features/places/PlaceSearchScreen';

export default function PlaceSearchRoute() {
  const { target } = useLocalSearchParams<{ target?: string }>();
  return <PlaceSearchScreen target={isPlaceTarget(target) ? target : 'other'} />;
}
