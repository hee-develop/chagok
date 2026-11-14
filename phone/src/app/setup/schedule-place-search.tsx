import { Redirect, useLocalSearchParams } from 'expo-router';

import { PlaceSearchScreen } from '../../features/places/PlaceSearchScreen';

export default function SchedulePlaceSearchRoute() {
  const { scheduleId, from } = useLocalSearchParams<{ scheduleId?: string | string[]; from?: string | string[] }>();
  if (typeof scheduleId !== 'string' || scheduleId.trim() === '' || scheduleId.length > 100) {
    return <Redirect href="/setup/fill-places" />;
  }
  return <PlaceSearchScreen key={scheduleId} scheduleId={scheduleId} standalone={from === 'today'} />;
}
