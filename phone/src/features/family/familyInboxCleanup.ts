import { appInbox, type Inbox } from '../notifications/inbox';
import { FAMILY_STATUS_KIND } from './familyTaps';
import { memberSession, type MemberSession } from './memberSecret';

/**
 * 가족에서 나가거나(나가기) 서버가 모르는 구성원이 돼 구성원 비밀값이 지워지면 폰 알림함의 `family-status` 알림을 모두 지운다.
 * 그 알림이 가리키던 요청은 서버에서 이미 지워졌고(나간 사람의 요청·알림은 서버가 지움), 폰 알림함에 7일 남아 있으면 가족이 아닌 사람의 요청 상태가 홈에 계속 보인다.
 * 해제 함수를 돌려준다.
 */
export function bindFamilyInboxCleanup(member: Pick<MemberSession, 'subscribe'> = memberSession, inbox: Pick<Inbox, 'load' | 'dismissKind'> = appInbox): () => void {
  return member.subscribe((event) => {
    // 앱을 막 연 순간(저장소에서 아직 불러오기 전)에 알게 돼도 저장된 알림까지 지우도록 불러온 뒤에 지운다.
    if (event.type === 'cleared') void inbox.load().then(() => inbox.dismissKind(FAMILY_STATUS_KIND));
  });
}

// 앱 루트가 이 파일을 불러오면 앱이 도는 동안 계속 듣는다.
bindFamilyInboxCleanup();
