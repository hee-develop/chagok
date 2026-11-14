import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useSetupGate } from '../../features/entry/setupGate';
import { FillPlacesScreen } from '../../features/fill-places/FillPlacesScreen';

export default function FillPlacesRoute() {
  const router = useRouter();
  // 이 화면이 새로 열렸는데 첫 설정이 이미 끝나 있으면(4단계 [완료]가 3단계로 되돌려 보낸 경우) 탭으로 간다.
  // 3단계를 처음 보는 중이면 표시가 아직 없고, 4단계에서 뒤로 돌아올 때는 이 화면이 다시 만들어지지 않아 그대로 남는다.
  const gate = useSetupGate();
  useEffect(() => {
    if (gate !== 'done') return;
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, [gate, router]);

  if (gate !== 'needed') return null;
  return <FillPlacesScreen />;
}
