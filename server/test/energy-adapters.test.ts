import { describe, expect, it, vi } from 'vitest';
import { classifyCharger, createEvChargerSource, mapState, parseChargerInfoXml, REGIONS, regionsNear } from '../src/energy/evCharger.js';
import { createGate } from '../src/energy/flight.js';
import { haversineMeters, katecToWgs84, wgs84ToKatec } from '../src/energy/geo.js';
import { createOpinetSource, parseAroundXml } from '../src/energy/opinet.js';
import { findEnergyOptions } from '../src/energy/options.js';
import { createEnergySources } from '../src/energy/sources.js';
import type { EnergySources } from '../src/energy/types.js';
import { MAX_XML_CHARS } from '../src/energy/constants.js';
import { xmlRecords, xmlValue } from '../src/energy/xml.js';
import { newApp } from './helpers.js';

/** 네트워크 없이 고정 응답을 돌려주는 fetch. 호출한 URL을 모아 둔다. */
const fakeFetch = (respond: (url: string) => Response | Promise<Response>) => {
  const urls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return respond(url);
  });
  return { fn: fn as unknown as typeof fetch, urls, mock: fn };
};
const xmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/xml' } });

describe('KATEC 변환(정밀도 미검증: 왕복 일관성과 문서 예시와의 대략적 일치만 확인)', () => {
  // 공식 기준점(KATEC 좌표와 위경도 쌍)을 찾지 못했다. KATEC은 EPSG 코드가 없는 비공식 좌표계다(docs/energy.md).
  it('문서 예시 좌표가 강남 일대로, 문서의 DISTANCE와 같은 자릿수로 변환된다(대략적 일치)', () => {
    // 오피넷 반경 내 주유소 문서의 요청 예시 x=314681.8, y=544837과 응답 예시 첫 주유소(313828.8172, 545078.9899, DISTANCE 885.4m).
    const center = katecToWgs84(314681.8, 544837);
    expect(center.lat).toBeGreaterThan(37.49);
    expect(center.lat).toBeLessThan(37.52);
    expect(center.lng).toBeGreaterThan(127.02);
    expect(center.lng).toBeLessThan(127.05);
    const first = katecToWgs84(313828.8172, 545078.9899);
    // KATEC은 평면이라 대원 거리와 수십 m 차이가 난다.
    expect(haversineMeters(center, first)).toBeGreaterThan(800);
    expect(haversineMeters(center, first)).toBeLessThan(970);
  });

  it('왕복 변환이 1m 안으로 되돌아온다(광주·서울·제주·울릉도) — 변환식의 정밀도가 아니라 일관성만 본다', () => {
    for (const p of [{ lat: 35.1681, lng: 126.8888 }, { lat: 37.5012, lng: 127.0396 }, { lat: 33.4996, lng: 126.5312 }, { lat: 37.4844, lng: 130.9057 }]) {
      const { x, y } = wgs84ToKatec(p);
      expect(haversineMeters(p, katecToWgs84(x, y))).toBeLessThan(1);
    }
  });

  it('투영 원점(위도 38도·경도 128도)이 가산값 (400000, 600000)에서 측지계 보정 폭 안에 있다', () => {
    const { x, y } = wgs84ToKatec({ lat: 38, lng: 128 });
    expect(Math.abs(x - 400_000)).toBeLessThan(500); // 측지계 보정 때문에 원점에서 수백 m 벗어난다
    expect(Math.abs(y - 600_000)).toBeLessThan(700);
  });
});

describe('XML 읽기', () => {
  it('평평한 레코드를 읽고 엔티티·CDATA·빈 요소를 처리한다', () => {
    const xml = '<r><item><a>1 &amp; 2</a><b><![CDATA[<x>]]></b><c/><d> 공백 </d></item><item><a>&#xAC00;&#44032;</a></item></r>';
    expect(xmlRecords(xml, 'item')).toEqual([
      { a: '1 & 2', b: '<x>', c: '', d: '공백' },
      { a: '가가' },
    ]);
    expect(xmlValue('<h><resultCode>00</resultCode></h>', 'resultCode')).toBe('00');
    expect(xmlValue('<h/>', 'resultCode')).toBeNull();
    expect(xmlValue('<h><t><![CDATA[a&b]]></t></h>', 't')).toBe('a&b');
  });

  it('닫히지 않은 블록·중첩 요소는 읽지 않고 닫힌 앞부분만 돌려준다', () => {
    expect(xmlRecords('<item><a>1</a></item><item><a>2</a>', 'item')).toEqual([{ a: '1' }]);
    expect(xmlRecords('<item><a><b>x</b></a><c>3</c></item>', 'item')).toEqual([{ b: 'x', c: '3' }]);
  });

  describe('큰 악성 입력도 제한 시간 안에 끝난다(선형 시간)', () => {
    const inTime = (name: string, run: () => unknown) =>
      it(name, () => {
        const started = performance.now();
        run();
        expect(performance.now() - started).toBeLessThan(1500);
      });
    inTime('닫히지 않은 <item> 30만 개', () => expect(xmlRecords('<item>'.repeat(300_000), 'item')).toEqual([]));
    inTime('닫히지 않은 <a>가 40만 개인 블록 하나', () => xmlRecords(`<item>${'<a>'.repeat(400_000)}</a></item>`, 'item'));
    inTime('끝나지 않는 CDATA가 10만 개인 블록', () => xmlRecords(`<item>${'<a><![CDATA['.repeat(100_000)}</item>`, 'item'));
    inTime('CDATA 끝이 맨 뒤에만 있는 블록', () => xmlRecords(`<item>${'<a><![CDATA['.repeat(100_000)}]]></item>`, 'item'));
    inTime('닫는 태그 없는 <resultCode> 40만 개 읽기', () => expect(xmlValue('<resultCode>'.repeat(400_000), 'resultCode')).toBeNull());
    inTime('정상 레코드 5만 건', () => expect(xmlRecords('<item><a>1</a><b>2</b></item>'.repeat(50_000), 'item')).toHaveLength(50_000));
  });

  it('문서가 상한(MAX_XML_CHARS)을 넘으면 던진다', () => {
    const big = 'x'.repeat(MAX_XML_CHARS + 1);
    expect(() => xmlRecords(big, 'item')).toThrow('너무 큽니다');
    expect(() => xmlValue(big, 'resultCode')).toThrow('너무 큽니다');
  });
});

// 오피넷 반경 내 주유소 문서(https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3)의 응답 예시 구조.
// 좌표 값은 문서 예시이고, 상호·ID는 중립적인 가짜 값이다. 나머지 레코드는 파싱 경계를 보려고 만든 값이다(브랜드 철자 POLL_DIV_CD, 가격 없음 등).
const OPINET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RESULT>
  <OIL>
    <UNI_ID>EX0001</UNI_ID>
    <POLL_DIV_CO>GSC</POLL_DIV_CO>
    <OS_NM>예시 주유소 가</OS_NM>
    <PRICE>1725</PRICE>
    <DISTANCE>885.4</DISTANCE>
    <GIS_X_COOR>313828.81720</GIS_X_COOR>
    <GIS_Y_COOR>545078.98990</GIS_Y_COOR>
  </OIL>
  <OIL>
    <UNI_ID>EX0002</UNI_ID>
    <POLL_DIV_CD>RTE</POLL_DIV_CD>
    <OS_NM>예시 알뜰 &amp; 주유소</OS_NM>
    <PRICE>1699</PRICE>
    <DISTANCE>1200.0</DISTANCE>
    <GIS_X_COOR>315000.0</GIS_X_COOR>
    <GIS_Y_COOR>544900.0</GIS_Y_COOR>
  </OIL>
  <OIL>
    <UNI_ID>EX0003</UNI_ID>
    <OS_NM>가격 없는 주유소</OS_NM>
    <PRICE>0</PRICE>
    <GIS_X_COOR>315000.0</GIS_X_COOR>
    <GIS_Y_COOR>544900.0</GIS_Y_COOR>
  </OIL>
  <OIL>
    <UNI_ID>EX0004</UNI_ID>
    <OS_NM>좌표 없는 주유소</OS_NM>
    <PRICE>1700</PRICE>
  </OIL>
</RESULT>`;

/** signal이 중단되면 거절하고 그 전에는 끝나지 않는 fetch. */
const hangingFetch = () =>
  vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('오피넷 어댑터', () => {
  it('문서 예시 구조의 응답을 주유소로 읽는다(가격·좌표 없는 항목은 거른다)', () => {
    const stations = parseAroundXml(OPINET_XML);
    expect(stations.map((s) => s.id)).toEqual(['EX0001', 'EX0002']);
    expect(stations[0]).toMatchObject({ name: '예시 주유소 가', brand: 'GSC', price: 1725 });
    // 좌표 변환 정밀도는 검증하지 못했다. 강남 일대 범위에 드는지만 본다.
    expect(stations[0].lat).toBeGreaterThan(37.49);
    expect(stations[0].lat).toBeLessThan(37.52);
    expect(stations[0].lng).toBeGreaterThan(127.02);
    expect(stations[0].lng).toBeLessThan(127.05);
    expect(stations[1]).toMatchObject({ name: '예시 알뜰 & 주유소', brand: 'RTE', price: 1699 });
  });

  it('요청은 문서의 변수(certkey·out·x·y·radius·prodcd·sort)를 KATEC 좌표로 채운다', async () => {
    const { fn, urls } = fakeFetch(() => xmlResponse(OPINET_XML));
    const source = createOpinetSource({ certKey: 'SECRET-KEY', fetchImpl: fn });
    const center = katecToWgs84(314681.8, 544837);
    const stations = await source.findNear(center, 9999, 'diesel');
    expect(stations).toHaveLength(2);
    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://www.opinet.co.kr/api/aroundAll.do');
    expect(url.searchParams.get('certkey')).toBe('SECRET-KEY');
    expect(url.searchParams.get('out')).toBe('xml');
    // 조회 중심은 0.005도 격자로 맞춰지므로(캐시 공유) 최대 약 0.5km 안에서 요청 좌표와 다르다.
    expect(Math.abs(Number(url.searchParams.get('x')) - 314681.8)).toBeLessThan(500);
    expect(Math.abs(Number(url.searchParams.get('y')) - 544837)).toBeLessThan(500);
    expect(url.searchParams.get('radius')).toBe('5000'); // 문서 상한
    expect(url.searchParams.get('prodcd')).toBe('D047');
    expect(url.searchParams.get('sort')).toBe('1');
    await source.findNear(center, 3000, 'gasoline');
    expect(new URL(urls[1]).searchParams.get('prodcd')).toBe('B027');
    expect(new URL(urls[1]).searchParams.get('radius')).toBe('3000');
  });

  it('한반도 밖 좌표는 호출하지 않고 빈 목록을 준다', async () => {
    const { fn, mock } = fakeFetch(() => xmlResponse(OPINET_XML));
    const source = createOpinetSource({ certKey: 'k', fetchImpl: fn });
    expect(await source.findNear({ lat: 37.77, lng: -122.42 }, 5000, 'gasoline')).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  it('HTTP 오류·연결 실패·형식 오류는 키와 URL 없는 메시지로 던진다', async () => {
    const center = { lat: 37.5, lng: 127.03 };
    const cases = [
      fakeFetch(() => xmlResponse('error', 500)).fn,
      (async () => {
        throw new TypeError('fetch failed: https://www.opinet.co.kr/api/aroundAll.do?certkey=SECRET-KEY');
      }) as unknown as typeof fetch,
      fakeFetch(() => xmlResponse('<html>점검 중</html>')).fn,
    ];
    for (const fetchImpl of cases) {
      const error = await createOpinetSource({ certKey: 'SECRET-KEY', fetchImpl }).findNear(center, 5000, 'gasoline').catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/https?:|SECRET-KEY|certkey/i);
    }
  });

  it('응답이 바이트 상한을 넘으면 읽기를 멈추고 던진다(Content-Length·본문 모두)', async () => {
    const big = `<RESULT>${'<OIL></OIL>'.repeat(300_000)}</RESULT>`; // 약 3.3MB
    const declared = new Response('<RESULT></RESULT>', { headers: { 'content-length': String(3 * 1024 * 1024) } });
    for (const res of [xmlResponse(big), declared]) {
      const source = createOpinetSource({ certKey: 'k', fetchImpl: (async () => res) as unknown as typeof fetch });
      await expect(source.findNear({ lat: 37.5, lng: 127.03 }, 5000, 'gasoline')).rejects.toThrow('너무 큽니다');
    }
  });

  it('서비스를 거치면 문서 예시 구조의 주유소가 가격 후보가 된다', async () => {
    const { fn } = fakeFetch(() => xmlResponse(OPINET_XML));
    const sources: EnergySources = { ...newAppSources(), fuelStations: createOpinetSource({ certKey: 'k', fetchImpl: fn }) };
    const origin = katecToWgs84(314681.8, 544837);
    const destination = { lat: origin.lat, lng: origin.lng + 0.02 };
    const r = await findEnergyOptions({ fuel: 'gasoline', origin, destination, stayMinutes: null, at: new Date() }, sources);
    expect(r.source).toBe('live');
    // 1699원이 더 싸다. 둘 다 경로 출발점 근처라 3km 안이다.
    expect(r.candidates.map((c) => [c.id, c.price?.won])).toEqual([
      ['EX0002', 1699],
      ['EX0001', 1725],
    ]);
  });

  describe('호출 증폭 방지', () => {
    const here = { lat: 37.5, lng: 127.03 };

    it('같은 격자·연료·반경은 5분 동안 다시 부르지 않고, 연료·격자·반경이 다르면 따로 부른다', async () => {
      let clock = 1_000_000;
      const { fn, mock } = fakeFetch(() => xmlResponse(OPINET_XML));
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn, now: () => clock });
      await source.findNear(here, 5000, 'gasoline');
      await source.findNear({ lat: here.lat + 0.001, lng: here.lng - 0.001 }, 5000, 'gasoline'); // 같은 격자
      expect(mock).toHaveBeenCalledTimes(1);
      await source.findNear(here, 5000, 'diesel');
      await source.findNear({ lat: here.lat + 0.02, lng: here.lng }, 5000, 'gasoline');
      await source.findNear(here, 3000, 'gasoline');
      expect(mock).toHaveBeenCalledTimes(4);
      clock += 5 * 60_000 + 1;
      await source.findNear(here, 5000, 'gasoline');
      expect(mock).toHaveBeenCalledTimes(5);
    });

    it('캐시 항목 수 상한을 넘으면 가장 오래 안 쓴 것부터 버린다', async () => {
      const { fn, mock } = fakeFetch(() => xmlResponse(OPINET_XML));
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn, cacheMaxEntries: 2 });
      const at = (i: number) => ({ lat: 37 + i * 0.1, lng: 127 });
      await source.findNear(at(0), 5000, 'gasoline');
      await source.findNear(at(1), 5000, 'gasoline');
      await source.findNear(at(0), 5000, 'gasoline'); // 0을 최근으로 올린다
      await source.findNear(at(2), 5000, 'gasoline'); // 1이 밀려난다
      expect(mock).toHaveBeenCalledTimes(3);
      await source.findNear(at(0), 5000, 'gasoline');
      expect(mock).toHaveBeenCalledTimes(3);
      await source.findNear(at(1), 5000, 'gasoline');
      expect(mock).toHaveBeenCalledTimes(4);
    });

    it('실패한 호출은 캐시에 남기지 않는다', async () => {
      let fail = true;
      const { fn, mock } = fakeFetch(() => (fail ? xmlResponse('x', 500) : xmlResponse(OPINET_XML)));
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn });
      await expect(source.findNear(here, 5000, 'gasoline')).rejects.toThrow();
      fail = false;
      expect(await source.findNear(here, 5000, 'gasoline')).toHaveLength(2);
      expect(mock).toHaveBeenCalledTimes(2);
    });

    it('같은 키의 동시 호출은 한 번만 나간다', async () => {
      const { fn, mock } = fakeFetch(() => xmlResponse(OPINET_XML));
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn });
      const all = await Promise.all([1, 2, 3, 4].map(() => source.findNear(here, 5000, 'gasoline')));
      expect(all.every((l) => l.length === 2)).toBe(true);
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('서버 전체 동시 호출은 상한을 넘지 않는다', async () => {
      let active = 0;
      let peak = 0;
      const fetchImpl = (async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(5);
        active -= 1;
        return xmlResponse(OPINET_XML);
      }) as unknown as typeof fetch;
      const source = createOpinetSource({ certKey: 'k', fetchImpl, maxConcurrent: 2 });
      await Promise.all(Array.from({ length: 8 }, (_, i) => source.findNear({ lat: 36 + i * 0.1, lng: 127 }, 5000, 'gasoline')));
      expect(peak).toBe(2);
    });

    it('대기열이 가득 차면 바로 실패한다', async () => {
      const fn = hangingFetch();
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn as unknown as typeof fetch, maxConcurrent: 1, maxQueue: 1 });
      const ac = new AbortController();
      const first = source.findNear({ lat: 36, lng: 127 }, 5000, 'gasoline', ac.signal).catch((e: Error) => e);
      const second = source.findNear({ lat: 36.5, lng: 127 }, 5000, 'gasoline', ac.signal).catch((e: Error) => e);
      await expect(source.findNear({ lat: 37, lng: 127 }, 5000, 'gasoline')).rejects.toThrow('대기열');
      ac.abort();
      expect(await first).toBeInstanceOf(Error);
      expect(await second).toBeInstanceOf(Error);
    });

    it('signal이 중단되면 나가던 호출을 멈추고, 대기 중이던 호출은 나가지 않는다', async () => {
      const fn = hangingFetch();
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn as unknown as typeof fetch, maxConcurrent: 1 });
      const ac = new AbortController();
      const running = source.findNear({ lat: 36, lng: 127 }, 5000, 'gasoline', ac.signal);
      const queued = source.findNear({ lat: 37, lng: 127 }, 5000, 'gasoline', ac.signal);
      await tick();
      expect(fn).toHaveBeenCalledTimes(1);
      ac.abort();
      await expect(running).rejects.toThrow('취소');
      await expect(queued).rejects.toThrow('취소');
      await tick();
      expect(fn).toHaveBeenCalledTimes(1); // 대기 중이던 것은 나가지 않았다
      expect((fn.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    });

    it('합쳐진 호출은 기다리는 사람이 모두 떠났을 때만 멈춘다', async () => {
      const fn = hangingFetch();
      const source = createOpinetSource({ certKey: 'k', fetchImpl: fn as unknown as typeof fetch });
      const a = new AbortController();
      const b = new AbortController();
      const pa = source.findNear(here, 5000, 'gasoline', a.signal).catch((e: Error) => e);
      const pb = source.findNear(here, 5000, 'gasoline', b.signal).catch((e: Error) => e);
      await tick();
      a.abort();
      await pa;
      expect((fn.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false); // b가 아직 기다린다
      b.abort();
      await pb;
      expect((fn.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('동시 실행 게이트', () => {
  it('상한까지만 동시에 실행하고 나머지는 차례로, 대기열 상한을 넘으면 거절한다', async () => {
    const gate = createGate(1, 1);
    const order: string[] = [];
    const slow = (name: string) => async () => {
      order.push(`start ${name}`);
      await tick(5);
      order.push(`end ${name}`);
      return name;
    };
    const p1 = gate.run(undefined, slow('a'));
    const p2 = gate.run(undefined, slow('b'));
    await expect(gate.run(undefined, slow('c'))).rejects.toThrow('대기열');
    expect(await Promise.all([p1, p2])).toEqual(['a', 'b']);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect([gate.active, gate.queued]).toEqual([0, 0]);
  });
});

// 한국환경공단 전기자동차 충전소 정보 공식 활용 가이드 v1.25(https://www.data.go.kr/data/15076352/openapi.do 의 참고문서)의
// 응답 구조(response/header/body/items/item)와 필드·코드표를 따른 고정 문자열이다. 이름·주소는 중립적인 가짜 값이다.
// 실제 키로 받은 응답은 아니다(미확인).
const itemXml = (o: Record<string, string>) =>
  `<item>${Object.entries({
    statNm: '예시 충전소',
    statId: 'EX000001',
    chgerId: '01',
    chgerType: '04',
    addr: '가상시 가상구 예시로 1',
    addrDetail: '지상주차장',
    lat: '37.500000',
    lng: '126.650000',
    useTime: '24시간 이용가능',
    busiId: 'XX',
    bnm: '예시기관',
    busiNm: '예시운영',
    busiCall: '000-0000',
    stat: '2',
    statUpdDt: '20190829121020',
    powerType: '급속(100kW동시)',
    output: '100',
    method: '단독',
    zcode: '28',
    zscode: '28260',
    kind: 'F0',
    kindDetail: 'F002',
    parkingFree: 'Y',
    note: '예시 안내',
    limitYn: 'N',
    delYn: 'N',
    ...o,
  })
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('')}</item>`;
const pageXml = (items: string[], total = items.length, code = '00') =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>${code}</resultCode><resultMsg>NORMAL SERVICE.</resultMsg><totalCount>${total}</totalCount><pageNo>1</pageNo><numOfRows>9999</numOfRows></header><body><items>${items.join('')}</items></body></response>`;

const INCHEON = { lat: 37.5, lng: 126.65 };
const SEOUL = { lat: 37.5665, lng: 126.978 };
const BUSAN = { lat: 35.1796, lng: 129.0756 };
const GWANGJU_PT = { lat: 35.1595, lng: 126.8526 };

describe('환경부 충전소 어댑터', () => {
  it('공식 가이드의 필드·구조로 충전기를 읽는다(output으로 kW와 급속을 정한다)', () => {
    const page = parseChargerInfoXml(pageXml([itemXml({})]));
    expect(page).toMatchObject({ resultCode: '00', resultMsg: 'NORMAL SERVICE.', totalCount: 1 });
    expect(page.chargers).toEqual([
      {
        stationId: 'EX000001',
        chargerId: '01',
        name: '예시 충전소',
        address: '가상시 가상구 예시로 1',
        lat: 37.5,
        lng: 126.65,
        speed: 'fast',
        state: 'available',
        powerKw: 100,
        operator: '예시운영',
        parkingFree: true,
      },
    ]);
  });

  it('output(kW)이 powerType 글자·타입 코드보다 먼저다', () => {
    expect(classifyCharger('04', '7', '급속(100kW동시)')).toEqual({ speed: 'slow', powerKw: 7 });
    expect(classifyCharger('02', '50', '완속(7kW)')).toEqual({ speed: 'fast', powerKw: 50 });
    expect(classifyCharger('02', '3', '')).toEqual({ speed: 'slow', powerKw: 3 });
    expect(classifyCharger('04', '200', '')).toEqual({ speed: 'fast', powerKw: 200 });
    expect(classifyCharger('04', '49', '')).toEqual({ speed: 'slow', powerKw: 49 }); // 기준(50kW)은 가안
  });

  it('output이 없거나 숫자가 아니면 powerType 글자, 그것도 없으면 타입 코드로 정한다', () => {
    expect(classifyCharger('04', undefined, '완속(7kW)')).toEqual({ speed: 'slow', powerKw: 7 });
    expect(classifyCharger('02', '', '급속(50kW)')).toEqual({ speed: 'fast', powerKw: 50 });
    expect(classifyCharger('04', 'abc', '')).toEqual({ speed: 'fast', powerKw: null });
    expect(classifyCharger('02', undefined, '')).toEqual({ speed: 'slow', powerKw: null });
    expect(classifyCharger('08', undefined, '')).toEqual({ speed: 'slow', powerKw: null });
    expect(classifyCharger('01', undefined, '')).toEqual({ speed: 'fast', powerKw: null });
  });

  it('stat 코드표: 2 사용 가능, 3·6 사용 중, 1·4·5 쓸 수 없음, 0·9·그 밖은 알 수 없음', () => {
    expect(['0', '1', '2', '3', '4', '5', '6', '9', '', '7'].map(mapState)).toEqual([
      'unknown',
      'unavailable',
      'available',
      'charging',
      'unavailable',
      'unavailable',
      'charging',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });

  it('제외 규칙: 이용자 제한·삭제·좌표 없음·버스 전용(chgerType 11)', () => {
    const page = parseChargerInfoXml(
      pageXml([
        itemXml({ statId: 'a', chgerType: '02', output: '', powerType: '', parkingFree: 'N', note: '', busiNm: '' }),
        itemXml({ statId: 'b', limitYn: 'Y' }),
        itemXml({ statId: 'c', delYn: 'Y' }),
        itemXml({ statId: 'd', lat: '' }),
        itemXml({ statId: 'e', lng: 'abc' }),
        itemXml({ statId: 'bus', chgerType: '11' }),
        itemXml({ statId: 'f', parkingFree: '', stat: '6', statNm: '가 &amp; 나' }),
      ]),
    );
    expect(page.chargers.map((c) => c.stationId)).toEqual(['a', 'f']);
    expect(page.chargers[0]).toMatchObject({ speed: 'slow', powerKw: null, operator: null, parkingFree: false });
    expect(page.chargers[1]).toMatchObject({ state: 'charging', parkingFree: null, name: '가 & 나' });
  });

  it('시도 코드표: 공식 가이드의 zcode 전부를 쓰고, 옛 광주·전남 코드(29·46)만 더 부른다', () => {
    const used = REGIONS.flatMap((r) => r.zcodes).sort();
    const guide = ['11', '12', '26', '27', '28', '30', '31', '36', '41', '43', '44', '47', '48', '50', '51', '52'];
    expect(used).toEqual([...guide, '29', '46'].sort());
    expect(REGIONS.find((r) => r.zcodes.includes('12'))!.zcodes).toEqual(['12', '29', '46']);
    expect(used).not.toContain('42'); // 가이드 v1.25 표에 없는 옛 강원 코드
    expect(used).not.toContain('45'); // 가이드 v1.25 표에 없는 옛 전북 코드
  });

  it('인천 근처 조회는 인천(zcode 28) 한 곳만 가이드의 변수(dataType=XML 포함)로 부르고 반경으로 거른다', async () => {
    const { fn, urls } = fakeFetch(() => xmlResponse(pageXml([itemXml({}), itemXml({ statId: 'far', lat: '37.58', lng: '126.7' })])));
    const source = createEvChargerSource({ serviceKey: 'SECRET-KEY', fetchImpl: fn });
    const found = await source.findNear(INCHEON, 500);
    expect(found.map((c) => c.stationId)).toEqual(['EX000001']);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://apis.data.go.kr/B552584/EvCharger/getChargerInfo');
    expect(url.searchParams.get('serviceKey')).toBe('SECRET-KEY');
    expect(url.searchParams.get('zcode')).toBe('28');
    expect(url.searchParams.get('dataType')).toBe('XML');
    expect(url.searchParams.get('pageNo')).toBe('1');
    expect(url.searchParams.get('numOfRows')).toBe('9999');
  });

  it('한반도 밖 좌표는 호출하지 않고 빈 목록을 준다', async () => {
    const { fn, mock } = fakeFetch(() => xmlResponse(pageXml([itemXml({})])));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn });
    expect(await source.findNear({ lat: 37.77, lng: -122.42 }, 500)).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  it('받은 시도 데이터는 5분 동안 다시 받지 않는다', async () => {
    let clock = 1_000_000;
    const { fn, mock } = fakeFetch(() => xmlResponse(pageXml([itemXml({})])));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, now: () => clock });
    await source.findNear(INCHEON, 500);
    await source.findNear(INCHEON, 500);
    clock += 4 * 60_000;
    await source.findNear(INCHEON, 500);
    expect(mock).toHaveBeenCalledTimes(1);
    clock += 2 * 60_000;
    await source.findNear(INCHEON, 500);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('동시에 같은 시도를 부르면 한 번만 받는다', async () => {
    const { fn, mock } = fakeFetch(() => xmlResponse(pageXml([itemXml({})])));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn });
    await Promise.all([1, 2, 3].map(() => source.findNear(INCHEON, 500)));
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('totalCount가 9999를 넘으면 나머지 쪽도 받는다', async () => {
    const { fn, urls } = fakeFetch((url) => xmlResponse(pageXml([itemXml({ statId: `p${new URL(url).searchParams.get('pageNo')}` })], 25_000)));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn });
    const found = await source.findNear(INCHEON, 500);
    expect(urls.map((u) => new URL(u).searchParams.get('pageNo'))).toEqual(['1', '2', '3']);
    expect(found.map((c) => c.stationId).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('광주·전남은 신 코드 12와 옛 코드 29·46을 함께 부르고, 하나만 받아져도 쓰며, 같은 충전기는 한 번만 센다', async () => {
    const { fn, urls } = fakeFetch((url) => {
      const z = new URL(url).searchParams.get('zcode');
      if (z === '12') return xmlResponse(pageXml([itemXml({ statId: 'gj', lat: '35.16', lng: '126.85' })]));
      if (z === '46') return xmlResponse(pageXml([itemXml({ statId: 'gj', lat: '35.16', lng: '126.85' })])); // 같은 충전기가 옛 코드에서도 옴
      return xmlResponse(pageXml([], 0, '03')); // 29는 데이터 없음
    });
    const found = await createEvChargerSource({ serviceKey: 'k', fetchImpl: fn }).findNear(GWANGJU_PT, 2000);
    expect(urls.map((u) => new URL(u).searchParams.get('zcode')).sort()).toEqual(expect.arrayContaining(['12', '29', '46']));
    expect(found.map((c) => c.stationId)).toEqual(['gj']);
  });

  it('강원은 가이드의 코드 51만 부르고, 이웃 시도가 실패해도 무시한다', async () => {
    const { fn, urls } = fakeFetch((url) =>
      new URL(url).searchParams.get('zcode') === '51' ? xmlResponse(pageXml([itemXml({ statId: 'gw', lat: '37.88', lng: '127.73' })])) : xmlResponse(pageXml([], 0, '30')),
    );
    const found = await createEvChargerSource({ serviceKey: 'k', fetchImpl: fn }).findNear({ lat: 37.8813, lng: 127.7298 }, 500);
    const zcodes = urls.map((u) => new URL(u).searchParams.get('zcode'));
    expect(zcodes).toContain('51');
    expect(zcodes).not.toContain('42');
    expect(found.map((c) => c.stationId)).toEqual(['gw']);
  });

  it('가까운 시도 선택: 큰 시도는 여러 도시를 앵커로 쓰고, 경계 근처에서만 두 곳', () => {
    expect(regionsNear(GWANGJU_PT).map((r) => r.name)).toEqual(['광주·전남']);
    expect(regionsNear({ lat: 34.76, lng: 127.66 }).map((r) => r.name)[0]).toBe('광주·전남'); // 여수: 광주 시청에서 150km 넘게 떨어져도 전남
    expect(regionsNear({ lat: 36.019, lng: 129.3435 }).map((r) => r.name)[0]).toBe('경북'); // 포항
    expect(regionsNear({ lat: 37.5, lng: 126.85 }).map((r) => r.name)).toContain('서울');
  });

  it('결과 코드가 00이 아니거나 HTTP 오류·연결 실패면 키와 URL 없는 메시지로 던지고, 바로 다시 부르지 않는다', async () => {
    const cases: [string, typeof fetch][] = [
      ['결과 코드', fakeFetch(() => xmlResponse(pageXml([], 0, '30'))).fn],
      ['HTTP', fakeFetch(() => xmlResponse('x', 503)).fn],
      [
        '연결',
        (async () => {
          throw new TypeError('fetch failed https://apis.data.go.kr/B552584/EvCharger/getChargerInfo?serviceKey=SECRET-KEY');
        }) as unknown as typeof fetch,
      ],
    ];
    for (const [, fetchImpl] of cases) {
      const spy = vi.fn(fetchImpl);
      const source = createEvChargerSource({ serviceKey: 'SECRET-KEY', fetchImpl: spy as unknown as typeof fetch, now: () => 5_000 });
      const error = await source.findNear(INCHEON, 500).catch((e: Error) => e);
      expect((error as Error).message).not.toMatch(/https?:|SECRET-KEY|serviceKey/i);
      const calls = spy.mock.calls.length;
      await source.findNear(INCHEON, 500).catch(() => undefined);
      expect(spy.mock.calls.length).toBe(calls); // 30초 쉬는 동안 다시 부르지 않는다
    }
  });

  it('받기가 실패해 쉬는 동안에도 30분 안의 오래된 캐시가 있으면 그것으로 답한다', async () => {
    let clock = 1_000_000;
    let healthy = true;
    const { fn, mock } = fakeFetch(() => (healthy ? xmlResponse(pageXml([itemXml({})])) : xmlResponse('x', 503)));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, now: () => clock });
    expect((await source.findNear(INCHEON, 500)).map((c) => c.stationId)).toEqual(['EX000001']);
    healthy = false;
    clock += 6 * 60_000; // 캐시 만료 → 새로 받다 실패하지만 오래된 것으로 답한다
    expect((await source.findNear(INCHEON, 500)).map((c) => c.stationId)).toEqual(['EX000001']);
    expect(mock).toHaveBeenCalledTimes(2);
    clock += 10_000; // 30초 쉬는 동안: 다시 부르지 않고 오래된 것으로 답한다
    expect((await source.findNear(INCHEON, 500)).map((c) => c.stationId)).toEqual(['EX000001']);
    expect(mock).toHaveBeenCalledTimes(2);
    clock += 30 * 60_000; // 30분이 넘으면 낡은 데이터는 버린다
    await expect(source.findNear(INCHEON, 500)).rejects.toThrow();
  });

  it('메모리에 두는 충전기 수 상한을 넘으면 가장 오래 안 쓴 시도부터 버린다', async () => {
    const { fn, mock } = fakeFetch(() => xmlResponse(pageXml([itemXml({ lat: '35.18', lng: '129.07' }), itemXml({ chgerId: '02', lat: '35.18', lng: '129.07' })])));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, maxCachedChargers: 3 });
    await source.findNear(SEOUL, 500); // 서울 2대
    await source.findNear(BUSAN, 500); // 부산 2대 → 합계 4 > 3, 서울이 밀려난다
    expect(mock).toHaveBeenCalledTimes(2);
    await source.findNear(BUSAN, 500);
    expect(mock).toHaveBeenCalledTimes(2);
    await source.findNear(SEOUL, 500);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('서버 전체 동시 받기 수를 넘으면 새 시도 받기를 시작하지 않고 실패한다', async () => {
    const hang = new Promise<Response>(() => undefined);
    const { fn, mock } = fakeFetch((url) => (new URL(url).searchParams.get('zcode') === '11' ? hang : xmlResponse(pageXml([itemXml({})]))));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, waitMs: 20, maxConcurrentLoads: 1 });
    await expect(source.findNear(SEOUL, 500)).rejects.toThrow('늦습니다');
    const callsBefore = mock.mock.calls.length;
    await expect(source.findNear(BUSAN, 500)).rejects.toThrow('동시 받기');
    expect(mock.mock.calls.length).toBe(callsBefore);
  });

  it('한 쪽 응답이 바이트 상한을 넘으면 던진다', async () => {
    const { fn } = fakeFetch(() => xmlResponse(pageXml([itemXml({})])));
    await expect(createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, maxPageBytes: 200 }).findNear(INCHEON, 500)).rejects.toThrow('너무 큽니다');
  });

  it('응답이 늦으면 호출자는 기다리다 실패하고, 받기는 이어져 다음 호출은 캐시를 쓴다', async () => {
    let release!: (r: Response) => void;
    let first = true;
    const { fn, mock } = fakeFetch(() => {
      if (!first) return xmlResponse(pageXml([itemXml({})]));
      first = false;
      return new Promise<Response>((resolve) => (release = resolve));
    });
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, waitMs: 20 });
    await expect(source.findNear(INCHEON, 500)).rejects.toThrow('늦습니다');
    release(xmlResponse(pageXml([itemXml({})])));
    await new Promise((r) => setTimeout(r, 10));
    expect((await source.findNear(INCHEON, 500)).map((c) => c.stationId)).toEqual(['EX000001']);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('호출자의 signal이 중단되면 기다리던 조회를 그만둔다', async () => {
    const { fn } = fakeFetch(() => new Promise<Response>(() => undefined));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, waitMs: 5_000 });
    const ac = new AbortController();
    const pending = source.findNear(INCHEON, 500, ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(pending).rejects.toThrow('취소');
  });

  it('인코딩된 키(%)는 풀어서 한 번만 인코딩한다', async () => {
    const { fn, urls } = fakeFetch(() => xmlResponse(pageXml([])));
    await createEvChargerSource({ serviceKey: 'ab%2Bc%3D%3D', fetchImpl: fn }).findNear(INCHEON, 500);
    expect(new URL(urls[0]).searchParams.get('serviceKey')).toBe('ab+c==');
    expect(urls[0]).toContain('serviceKey=ab%2Bc%3D%3D');
  });

  it('서비스를 거치면 완속 충전기가 목적지 후보가 된다', async () => {
    const { fn } = fakeFetch(() =>
      xmlResponse(
        pageXml([
          itemXml({ chgerType: '02', output: '7', powerType: '완속(7kW)' }),
          itemXml({ statId: 'busy', stat: '3', chgerType: '02', output: '7', powerType: '' }),
          itemXml({ statId: 'reserved', stat: '6', chgerType: '02', output: '7', powerType: '' }),
        ]),
      ),
    );
    const sources: EnergySources = { ...newAppSources(), chargers: createEvChargerSource({ serviceKey: 'k', fetchImpl: fn }) };
    const r = await findEnergyOptions({ fuel: 'ev', origin: { lat: 37.45, lng: 126.6 }, destination: INCHEON, stayMinutes: 180, at: new Date() }, sources);
    expect(r).toMatchObject({ source: 'live', stage: 'destination' });
    expect(r.candidates.map((c) => [c.id, c.charger?.powerKw])).toEqual([['EX000001', 7]]);
  });
});

describe('createEnergySources', () => {
  it('키가 없으면 둘 다 픽스처', () => {
    const s = createEnergySources({});
    expect([s.chargers.kind, s.fuelStations.kind]).toEqual(['fixture', 'fixture']);
  });

  it('키가 있는 쪽만 실제 어댑터가 되고, 빈 값은 없는 것으로 본다', () => {
    expect([createEnergySources({ EV_CHARGER_KEY: 'a' }).chargers.kind, createEnergySources({ EV_CHARGER_KEY: 'a' }).fuelStations.kind]).toEqual(['live', 'fixture']);
    expect([createEnergySources({ OPINET_KEY: 'b' }).chargers.kind, createEnergySources({ OPINET_KEY: 'b' }).fuelStations.kind]).toEqual(['fixture', 'live']);
    expect(createEnergySources({ EV_CHARGER_KEY: '  ', OPINET_KEY: '' }).chargers.kind).toBe('fixture');
  });

  it('픽스처 휴게소는 키와 상관없이 쓴다', () => {
    expect(createEnergySources({ EV_CHARGER_KEY: 'a', OPINET_KEY: 'b' }).restStops.list().length).toBeGreaterThan(0);
  });
});

function newAppSources(): EnergySources {
  return createEnergySources({});
}
