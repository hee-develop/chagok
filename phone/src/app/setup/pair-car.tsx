import { useRouter } from 'expo-router';

import { PairCarScreen } from '../../features/pair-car/PairCarScreen';
import { askNotificationPermissionOnce } from '../../features/notifications/permission';

export default function PairCarRoute() {
  const router = useRouter();
  // 첫 설정의 끝(차 연결을 마칠 때)에 알림 권한을 한 번 묻는다(정책서 10.4). 거부해도 다음으로 넘어가고 알림은 홈에만 보인다.
  // 이동 목적지는 PairCarScreen의 기본 동작과 같다(main 그대로). 아래 탭 구조(J5a)가 들어오면 docs/notifications.md의 '이어 붙일 지점'을 따른다.
  return (
    <PairCarScreen
      onDone={() => {
        void askNotificationPermissionOnce();
        router.replace('/setup/fill-places');
      }}
    />
  );
}
