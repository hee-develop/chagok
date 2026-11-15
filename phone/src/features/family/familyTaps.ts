import { registerTapHandler, type TapHandler } from '../notifications/taps';

/** 서버 알림 종류(server/src/notify/types.ts)와 같다. 보낸 요청의 상태가 바뀌었을 때 보낸 사람에게만 간다(받는 사람 폰에는 알림이 없다). */
export const FAMILY_STATUS_KIND = 'family-status';

/** 가족 탭의 요청 상태 화면 경로. `request`가 있으면 그 요청이 맨 위에 표시된다. */
export const familyRequestPath = (requestId: string | undefined) => (requestId ? { pathname: '/family', params: { request: requestId } } : '/family');

type Route = ReturnType<typeof familyRequestPath>;

/** 화면 이동. 기본은 expo-router의 명령형 `router.navigate`(불러오는 시점을 늦춰 테스트가 라우터 없이 이 파일을 가져올 수 있게 한다). */
const navigateRoute = async (route: Route) => {
  const { router } = await import('expo-router');
  router.navigate(route as Parameters<typeof router.navigate>[0]);
};

/**
 * `family-status`(보낸 요청의 상태가 바뀌었어요) 알림을 누르면 가족 탭에서 그 요청(`data.requestId`)의 상태를 연다. 요청 id가 없으면 가족 탭만 연다.
 * 알림함에서 읽음 처리는 `handleNotificationTap`이 먼저 한다.
 */
export function createFamilyStatusTapHandler(navigate: (route: Route) => void | Promise<void> = navigateRoute): TapHandler {
  return async (tap) => {
    await navigate(familyRequestPath(tap.data.requestId));
  };
}

registerTapHandler(FAMILY_STATUS_KIND, createFamilyStatusTapHandler());
