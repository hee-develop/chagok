import { CalendarSelectScreen } from '../../features/calendar-select/CalendarSelectScreen';
import { appEventSync } from '../../features/calendar-sync/eventSync';

export default function CalendarRoute() {
  // 선택을 저장하면 오늘·내일 일정을 서버로 보내기 시작한다(기다리지 않는다).
  return <CalendarSelectScreen onSaved={(ids) => {
        appEventSync.rememberSelection(ids);
        void appEventSync.run();
      }} />;
}
