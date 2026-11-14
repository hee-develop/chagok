/** 차 화면 QR에 담긴 글(`chagok://pair?code=123456`)이나 숫자 6자리에서 연결 번호를 꺼낸다. 아니면 null */
export function codeFromScan(data: string): string | null {
  const text = data.trim();
  if (/^\d{6}$/.test(text)) return text;
  const match = /^chagok:\/\/pair\?(?:.*&)?code=(\d{6})(?:&|$)/.exec(text);
  return match ? match[1] : null;
}

/** 입력한 번호에서 숫자만 남긴다(차 화면처럼 '123 456'으로 넣어도 된다). 최대 6자리 */
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}
