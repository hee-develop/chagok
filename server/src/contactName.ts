/**
 * 연락 상대 '표시 이름'으로 서버에 나가도 되는 글자인가(정책서 10.5: 서버에는 표시 이름만 보낸다. 전화번호·이메일은 폰 안에만 둔다).
 * Android의 `DISPLAY_NAME`은 이름이 없는 연락처에서 번호나 이메일로 채워지므로, 이름 자리에 번호·이메일이 그대로 실려 나갈 수 있다.
 * 아래 중 하나면 이름이 아니라 번호·이메일로 보고 거른다(폰은 후보에서 빼고 서버는 400으로 거절한다. 판정은 이 함수 한 곳이다).
 * - `@`가 들어 있다(이메일 모양)
 * - 글자(문자)가 하나도 없다: 숫자·기호뿐이다('010-1234-5678', '+82 10 1234 5678', '---')
 * - 숫자가 7개 이상이다(전화번호 모양: '김과장 01012345678'처럼 이름이 섞여 있어도 번호가 실려 나간다)
 */
export const MIN_PHONE_DIGITS = 7;

export function isNumberOrEmailLike(name: string): boolean {
  if (name.includes('@')) return true;
  if (!/\p{L}/u.test(name)) return true;
  return (name.match(/\p{Nd}/gu)?.length ?? 0) >= MIN_PHONE_DIGITS;
}

/** 서버로 보내도 되는 표시 이름인가(비어 있지 않고 번호·이메일 모양이 아니다). */
export const isSendableContactName = (name: string) => name.trim() !== '' && !isNumberOrEmailLike(name);
