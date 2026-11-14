import { useEffect } from 'react';

import { markSetupDone } from '../../features/entry/setupGate';
import { PairCarScreen } from '../../features/pair-car/PairCarScreen';
import { pairingApi } from '../../features/pair-car/pairingApi';
import { recordPairedCar } from '../../features/today/carConnection';

// 연결에 성공하면 그 차 id를 폰에 남겨 오늘·설정 탭이 연결 상태를 묻는다. 화면 코드는 그대로 두고 api만 감싼다.
const recordingApi = recordPairedCar(pairingApi);

export default function PairCarRoute() {
  // 4단계에 닿았다는 것은 1~3단계를 끝냈거나 건너뛰었다는 뜻이다. 다음에 앱을 열면 탭으로 들어간다.
  useEffect(() => {
    void markSetupDone();
  }, []);
  return <PairCarScreen api={recordingApi} />;
}
