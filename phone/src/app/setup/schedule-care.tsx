import { Redirect, useLocalSearchParams } from 'expo-router';

import { ScheduleCareScreen } from '../../features/fill-places/ScheduleCareScreen';

export default function ScheduleCareRoute() {
  const { scheduleId, title, care, from } = useLocalSearchParams<{
    scheduleId?: string | string[];
    title?: string | string[];
    care?: string | string[];
    from?: string | string[];
  }>();
  if (typeof scheduleId !== 'string' || scheduleId.trim() === '' || scheduleId.length > 100) {
    return <Redirect href="/setup/fill-places" />;
  }
  return (
    <ScheduleCareScreen
      key={scheduleId}
      scheduleId={scheduleId}
      title={typeof title === 'string' ? title : ''}
      initialCare={typeof care === 'string' ? care : ''}
      standalone={from === 'today'}
    />
  );
}
