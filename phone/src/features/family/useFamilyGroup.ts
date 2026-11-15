import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { REQUEST_TIMEOUT_MS, requestWithTimeout } from '../../api/request';
import { strings } from '../../i18n/ko';
import { FamilyHttpError, familyGroupApi, type FamilyGroupApi, type FamilyView } from './familyGroupApi';
import { memberSession, type MemberClearReason, type MemberSession } from './memberSecret';

export type FamilyState =
  | { status: 'loading' }
  | { status: 'error' }
  /** 가족이 없다. `notice`가 있으면 가족에서 나온 직후다(`gone`: 다른 곳에서 나갔거나 오래 쓰지 않아 정리됨, `left`: 내가 나감). */
  | { status: 'none'; notice: MemberClearReason | null }
  | { status: 'ready'; family: FamilyView };

/** 화면이 한 번에 하나만 두는 저장 동작. `share`는 사람마다(`memberId`) 따로 표시한다. */
export type GroupAction = { kind: 'create' | 'join' | 'invite' | 'rename' | 'leave' } | { kind: 'share'; memberId: string };
export type GroupKind = GroupAction['kind'];

const t = strings.family;

/**
 * 만들기·참여·초대 코드 응답을 기다리는 최대 시간(밀리초). 이 응답에만 있는 구성원 비밀값을 놓치지 않으려고 보통 시간 제한(`timeoutMs`)에는 끊지 않고 기다리며,
 * 이 시간까지 응답이 없을 때만 포기한다(그때 서버가 이미 만들었을 수 있어 안내한다).
 */
export const PATIENT_ACTION_MS = 90_000;

/** 동작이 실패했을 때 사용자에게 보일 문구. 서버가 준 이유 코드(`reason`)와 상태로 가른다. */
export function issueMessage(action: GroupAction['kind'], error: unknown): string {
  const reason = error instanceof FamilyHttpError ? error.reason : null;
  switch (action) {
    case 'create':
      if (reason === 'rate-limited') return t.createRateLimited;
      if (reason === 'too-many-families') return t.createTooMany;
      return t.createFailed;
    case 'join':
      if (reason === 'invalid') return t.joinInvalid;
      if (reason === 'already-in-family') return t.joinAlready;
      if (reason === 'family-full') return t.joinFull;
      if (reason === 'locked') return t.joinLocked(error instanceof FamilyHttpError && error.retryAfterSeconds !== null ? error.retryAfterSeconds : 60);
      return t.joinFailed;
    case 'invite':
      if (reason === 'family-full') return t.inviteFull;
      if (reason === 'rate-limited') return t.inviteRateLimited;
      return t.inviteFailed;
    case 'rename':
      return t.renameFailed;
    case 'leave':
      return t.leaveFailed;
    case 'share':
      return t.shareFailed;
  }
}

/**
 * 내 가족(가족 탭의 가족 묶기·구성원·초대 코드·도착 예정 공유)을 읽고 바꾼다.
 * - 화면이 포커스를 얻을 때마다 새로 읽는다. 이미 읽은 가족이 있으면 다시 읽는 동안 그대로 보여 깜빡이지 않는다. 새 조회가 시작되면 이전 조회를 취소하고, 늦은 응답은 버린다.
 * - 저장(만들기·참여·초대 코드·이름·나가기·공유)은 **한 번에 하나**만 보낸다. 저장이 시작되면 진행 중인 조회는 취소해 저장 전 상태가 화면을 덮어쓰지 않게 하고, 화면이 사라져도 저장은 끝까지 보낸다
 *   (만들기·참여 응답에만 있는 구성원 비밀값을 놓치지 않게. 비밀값은 `familyGroupApi`가 응답을 받자마자 저장한다). 만들기·참여·초대 코드는 시간 제한으로 끊지 않고 '확인 중'으로 바꿔 기다린다(`run`).
 * - 저장한 비밀값이 지워지면(나감, 서버가 모르는 구성원) '가족에서 나왔어요' 상태로 돌아간다.
 */
export function useFamilyGroup({
  api = familyGroupApi,
  member = memberSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
  giveUpMs = PATIENT_ACTION_MS,
}: { api?: FamilyGroupApi; member?: Pick<MemberSession, 'subscribe'>; timeoutMs?: number; giveUpMs?: number } = {}) {
  const [state, setState] = useState<FamilyState>({ status: 'loading' });
  const [action, setAction] = useState<GroupAction | null>(null);
  const [issue, setIssue] = useState<{ message: string; action: GroupAction['kind'] } | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** 응답을 기다린 지 `timeoutMs`가 넘은 만들기·참여·초대 코드('확인 중'). 끊지 않고 계속 기다리며 같은 동작은 다시 누를 수 없다. */
  const [slow, setSlow] = useState(false);
  /** 구성원 비밀값을 폰 저장소에 쓰지 못했다(이번 실행 동안만 유지됨). */
  const [storageIssue, setStorageIssue] = useState(false);
  const loadRequest = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    loadRequest.current = controller;
    setState((prev) => (prev.status === 'ready' || prev.status === 'none' ? prev : { status: 'loading' }));
    void (async () => {
      try {
        const family = await requestWithTimeout((signal) => api.fetchFamily(signal), timeoutMs, controller);
        if (loadRequest.current !== controller) return;
        setState((prev) => (family !== null ? { status: 'ready', family } : { status: 'none', notice: prev.status === 'none' ? prev.notice : null }));
      } catch {
        if (loadRequest.current === controller) setState((prev) => (prev.status === 'ready' ? prev : { status: 'error' }));
      }
    })();
    return () => {
      if (loadRequest.current === controller) loadRequest.current = null;
      controller.abort();
    };
  // attempt는 사용자가 다시 시도할 때 조회를 처음부터 다시 시작하기 위한 값이다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, timeoutMs, attempt]));

  // 비밀값이 지워지면(어느 호출이든) 가족이 없는 상태로 돌아가고 이유를 알린다.
  useEffect(() => member.subscribe((event) => {
    if (event.type === 'cleared') {
      setStorageIssue(false);
      setState({ status: 'none', notice: event.reason });
    } else {
      setStorageIssue(!event.persisted);
    }
  }), [member]);

  useEffect(() => {
    if (issue) AccessibilityInfo.announceForAccessibility(issue.message);
  }, [issue]);

  /**
   * 저장 하나를 보낸다. 이미 저장 중이면 아무것도 하지 않는다. 성공하면 true.
   * `patient`(만들기·참여·초대 코드)는 `timeoutMs`에 요청을 끊지 않는다: 끊으면 응답에만 있는 구성원 비밀값을 놓치고, 다시 누르면 가족이 또 생기거나 고아 구성원이 생긴다.
   * 대신 `timeoutMs`가 지나면 '확인 중'(`slow`)으로 바꾸고 늦게 온 응답도 저장·반영하며(화면이 사라졌어도 저장은 끝낸다), 그동안 같은 동작은 다시 누를 수 없다.
   */
  const run = async (what: GroupAction, task: (signal: AbortSignal) => Promise<void>, patient = false): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    // 조회가 저장보다 늦게 도착해 저장 전 상태로 덮어쓰지 않도록 취소한다.
    loadRequest.current?.abort();
    loadRequest.current = null;
    if (mounted.current) {
      setAction(what);
      setIssue(null);
      setSlow(false);
    }
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
    let gaveUp = false;
    try {
      if (patient) {
        const controller = new AbortController();
        slowTimer = setTimeout(() => { if (mounted.current) setSlow(true); }, timeoutMs);
        giveUpTimer = setTimeout(() => { gaveUp = true; controller.abort(); }, giveUpMs);
        await task(controller.signal);
      } else {
        await requestWithTimeout(task, timeoutMs);
      }
      return true;
    } catch (error) {
      if (mounted.current) {
        setIssue({ message: gaveUp ? t.unconfirmed : issueMessage(what.kind, error), action: what.kind });
        // 가족 상태가 달라졌을 수 있는 거절(이미 가족임·가족 없음)은 다시 읽어 맞춘다.
        if (error instanceof FamilyHttpError && (error.reason === 'already-in-family' || error.reason === 'not-in-family' || error.reason === 'unknown-member')) setAttempt((n) => n + 1);
      }
      return false;
    } finally {
      if (slowTimer !== null) clearTimeout(slowTimer);
      if (giveUpTimer !== null) clearTimeout(giveUpTimer);
      saving.current = false;
      if (mounted.current) {
        setAction(null);
        setSlow(false);
      }
    }
  };

  const showFamily = (family: FamilyView) => {
    if (mounted.current) setState({ status: 'ready', family });
  };

  return {
    state,
    action,
    busy: action !== null,
    slow,
    storageIssue,
    issue,
    clearIssue: () => setIssue(null),
    /** 조회를 처음부터 다시 한다(오류 화면의 다시 시도). */
    retry: () => {
      setState({ status: 'loading' });
      setAttempt((n) => n + 1);
    },
    /** 가족을 만들고 내가 첫 구성원이 된다. */
    create: (name: string) => run({ kind: 'create' }, async (signal) => showFamily(await api.invite(name, signal)), true),
    join: (code: string, name: string) => run({ kind: 'join' }, async (signal) => showFamily(await api.join(code, name, signal)), true),
    /** 새 초대 코드(이전 코드는 무효). */
    remakeInvite: () => run({ kind: 'invite' }, async (signal) => showFamily(await api.invite(undefined, signal)), true),
    rename: (name: string) => run({ kind: 'rename' }, async (signal) => {
      await api.rename(name, signal);
      // 겹치는 이름은 서버가 바꿔 주므로 가족을 다시 읽어 최종 이름을 보인다.
      const family = await api.fetchFamily(signal);
      if (family !== null) showFamily(family);
    }),
    leave: () => run({ kind: 'leave' }, async (signal) => {
      await api.leave(signal);
      if (mounted.current) setState({ status: 'none', notice: 'left' });
    }),
    setShare: (memberId: string, enabled: boolean) => run({ kind: 'share', memberId }, async (signal) => {
      await api.setShare(memberId, enabled, signal);
      // 응답은 { memberId, enabled }뿐이라 구성원 목록을 그 값으로 고친다.
      setState((prev) => prev.status === 'ready'
        ? { status: 'ready', family: { ...prev.family, members: prev.family.members.map((m) => (m.memberId === memberId ? { ...m, shareWithThem: enabled } : m)) } }
        : prev);
    }),
  };
}
