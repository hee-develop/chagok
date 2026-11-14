import { useLocalSearchParams, useRouter } from 'expo-router';

import { markSetupDone } from '../../features/entry/setupGate';
import { PairCarScreen } from '../../features/pair-car/PairCarScreen';

/**
 * 첫 설정의 4단계이면서 오늘·설정 탭의 [차 연결하기]가 여는 화면이다.
 * - 탭에서 열면(`from=tab`) 단계 표시 없이 열리고 [완료]로 왔던 탭에 돌아간다.
 * - 첫 설정이면 [건너뛰기](연결 전)와 [완료](연결 뒤) 둘 다 '끝냈거나 건너뜀' 표시를 남기고 설정 화면을 모두 닫아 오늘 탭으로 간다.
 */
export default function PairCarRoute() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string | string[] }>();
  if (from === 'tab') return <PairCarScreen standalone />;

  const finishSetup = async () => {
    // 표시는 메모리에 먼저 남으므로 저장소 쓰기가 실패해도 이번 실행에서는 탭으로 간다.
    await markSetupDone();
    // 탭이 처음부터 첫 설정으로 보내 둔 경우 닫을 화면이 없을 수 있다. 그 뒤 '/'로 바꿔 탭을 새로 열면 표시를 읽어 오늘 탭이 된다.
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  };
  return <PairCarScreen onSkip={() => void finishSetup()} onDone={() => void finishSetup()} />;
}
