/**
 * 파싱한 글자를 오래 들고 있을 때 쓰는 도구.
 *
 * V8은 긴(13자 이상) 문자열의 `slice`를 원문을 가리키는 '슬라이스'로 만든다. 응답 한 쪽(수 MB)에서 잘라 낸 이름 하나를 캐시에 두면
 * 그 쪽 원문 전체가 같이 살아남아, 30만 대를 두는 캐시가 응답 원문 수십 쪽 분량(수백 MB)을 잡는다(실측은 docs/energy.md).
 * 그래서 오래 두는 값은 `detach`로 새 문자열에 복사해 담는다.
 */

/**
 * 원문을 붙잡지 않는 새 문자열. JSON 왕복은 문자열을 새로 만들어 돌려준다(Buffer·node 타입 없이 쓸 수 있는 방법 중, 같은 방법을 이어 붙인 뒤
 * 다시 자르는 쪽은 원문 일부를 계속 붙잡는 것을 실측으로 확인해 고르지 않았다).
 */
export const detach = (s: string): string => JSON.parse(JSON.stringify(s)) as string;

export type Interner = {
  /** 같은 글자는 처음 본 사본 하나를 돌려준다(처음 보는 글자만 `detach`로 복사). */
  (s: string): string;
  /** 지금까지 새로 둔 글자의 추정 바이트(글자당 2바이트로 쳐 윗값에 가깝게, 문자열 머리 16바이트 포함). */
  readonly bytes: number;
};

/**
 * 같은 충전소의 충전기들은 충전소 ID·이름·주소·운영기관이 같다. 한 시도를 받는 동안만 쓰는 표로 같은 글자를 한 번만 두어 메모리를 줄인다.
 * 표는 받기가 끝나면 버려지고, 글자는 그것을 가진 충전기가 살아 있는 동안만 산다.
 */
export function createInterner(): Interner {
  const table = new Map<string, string>();
  let bytes = 0;
  const intern = (s: string): string => {
    let v = table.get(s);
    if (v === undefined) {
      v = detach(s);
      table.set(v, v);
      bytes += 16 + 2 * v.length;
    }
    return v;
  };
  return Object.defineProperty(intern, 'bytes', { get: () => bytes }) as Interner;
}
