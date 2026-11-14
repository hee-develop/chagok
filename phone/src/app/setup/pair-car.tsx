import { useRouter } from 'expo-router';

import { PairCarScreen } from '../../features/pair-car/PairCarScreen';
import { askNotificationPermission } from '../../features/notifications/permission';

export default function PairCarRoute() {
  const router = useRouter();
  // 첫 설정의 끝(차 연결을 마칠 때)에 알림 권한을 묻는다(정책서 10.4). 거부해도 다음으로 넘어가고 알림은 홈에만 보인다.
  return (
    <PairCarScreen
      onDone={() => {
        void askNotificationPermission();
        router.replace('/setup/fill-places');
      }}
    />
  );
}
