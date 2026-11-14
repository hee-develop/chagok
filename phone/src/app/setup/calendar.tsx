import { useLocalSearchParams } from 'expo-router';

import { CalendarSelectScreen } from '../../features/calendar-select/CalendarSelectScreen';
import { appEventSync } from '../../features/calendar-sync/eventSync';

/** 첫 설정 1단계이면서 설정 탭의 [캘린더 고르기]가 여는 화면이다(`from=tab`이면 단계 표시 없이 열리고 끝나면 설정 탭으로 돌아간다). */
export default function CalendarRoute() {
  const { from } = useLocalSearchParams<{ from?: string | string[] }>();
  // 선택을 저장하면 오늘·내일 일정을 서버로 보내기 시작한다(기다리지 않는다).
  return <CalendarSelectScreen standalone={from === 'tab'} onSaved={(ids) => {
        appEventSync.rememberSelection(ids);
        void appEventSync.run();
      }} />;
}
