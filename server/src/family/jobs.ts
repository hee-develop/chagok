import type { Scheduler } from '../scheduler.js';
import type { FamilyRequests } from './service.js';

/** 정기 작업 이름. 정책서 11장 '매일 새벽 … 날짜가 지난 가족 요청 삭제'. */
export const FAMILY_REQUESTS_EXPIRE_JOB = 'family-requests-expire';

/**
 * 날짜가 지난 가족 요청(서울 날짜)·완료 보관 시간이 지난 요청·날짜가 지난 주행 상태·만료된 초대 코드·오래 쓰지 않은 기기 id 구성원을 지우는 작업을
 * 스케줄러에 등록한다. 작업은 주입된 시계로 스스로 '지울 것이 있는가'를 판정하므로 5분마다 불려도 안전하다
 * (읽기·쓰기는 날짜가 지난 요청을 이미 보지 않으므로, 이 작업은 메모리를 비우는 몫이다).
 */
export const registerFamilyRequestJobs = (scheduler: Pick<Scheduler, 'register'>, familyRequests: Pick<FamilyRequests, 'purge'>) =>
  scheduler.register({ name: FAMILY_REQUESTS_EXPIRE_JOB, run: (at) => void familyRequests.purge(at) });
