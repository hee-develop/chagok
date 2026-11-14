import { Redirect, useLocalSearchParams } from 'expo-router';

import { FamilySendScreen } from '../../features/family/FamilySendScreen';

export default function FamilySendRoute() {
  const { scheduleId, title } = useLocalSearchParams<{ scheduleId?: string | string[]; title?: string | string[] }>();
  if (typeof scheduleId !== 'string' || scheduleId.trim() === '' || scheduleId.length > 100) {
    return <Redirect href="/setup/fill-places" />;
  }
  return <FamilySendScreen key={scheduleId} scheduleId={scheduleId} title={typeof title === 'string' ? title : ''} />;
}
