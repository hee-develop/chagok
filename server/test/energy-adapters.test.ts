import { describe, expect, it, vi } from 'vitest';
import { classifySpeed, createEvChargerSource, mapState, parseChargerInfoXml, regionsNear } from '../src/energy/evCharger.js';
import { haversineMeters, katecToWgs84, wgs84ToKatec } from '../src/energy/geo.js';
import { createOpinetSource, parseAroundXml } from '../src/energy/opinet.js';
import { findEnergyOptions } from '../src/energy/options.js';
import { createEnergySources } from '../src/energy/sources.js';
import type { EnergySources } from '../src/energy/types.js';
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

describe('KATEC 변환', () => {
  it('오피넷 문서 예시 좌표(서울 강남)가 강남 일대로 변환된다', () => {
    // 반경 내 주유소 문서의 요청 예시 x=314681.8, y=544837과 응답 예시 첫 주유소(313828.8172, 545078.9899).
    const center = katecToWgs84(314681.8, 544837);
    expect(center.lat).toBeGreaterThan(37.49);
    expect(center.lat).toBeLessThan(37.52);
    expect(center.lng).toBeGreaterThan(127.02);
    expect(center.lng).toBeLessThan(127.05);
    const first = katecToWgs84(313828.8172, 545078.9899);
    // 문서 예시의 DISTANCE는 885.4m. 변환이 맞다면 같은 자릿수여야 한다(KATEC은 평면이라 대원 거리와 수십 m 차이가 난다).
    expect(haversineMeters(center, first)).toBeGreaterThan(800);
    expect(haversineMeters(center, first)).toBeLessThan(970);
  });

  it('왕복 변환 오차가 1m 미만이다(광주·서울·제주·울릉도)', () => {
    for (const p of [{ lat: 35.1681, lng: 126.8888 }, { lat: 37.5012, lng: 127.0396 }, { lat: 33.4996, lng: 126.5312 }, { lat: 37.4844, lng: 130.9057 }]) {
      const { x, y } = wgs84ToKatec(p);
      expect(haversineMeters(p, katecToWgs84(x, y))).toBeLessThan(1);
    }
  });

  it('KATEC은 위도 38도·경도 128도가 (400000, 600000) 부근이다', () => {
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
  });
});

// 오피넷 반경 내 주유소 문서(https://www.opinet.co.kr/user/custapi/openApiInfoDtl.do?apiId=3)의 응답 예시 구조.
// 첫 레코드는 문서 예시 값이고, 나머지는 파싱 경계를 보려고 만든 값이다(브랜드 철자 POLL_DIV_CD, 가격 없음 등).
const OPINET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<RESULT>
  <OIL>
    <UNI_ID>A0009907</UNI_ID>
    <POLL_DIV_CO>GSC</POLL_DIV_CO>
    <OS_NM>에너지플러스허브 삼방주유소</OS_NM>
    <PRICE>1725</PRICE>
    <DISTANCE>885.4</DISTANCE>
    <GIS_X_COOR>313828.81720</GIS_X_COOR>
    <GIS_Y_COOR>545078.98990</GIS_Y_COOR>
  </OIL>
  <OIL>
    <UNI_ID>A0000001</UNI_ID>
    <POLL_DIV_CD>RTE</POLL_DIV_CD>
    <OS_NM>예시 알뜰 &amp; 주유소</OS_NM>
    <PRICE>1699</PRICE>
    <DISTANCE>1200.0</DISTANCE>
    <GIS_X_COOR>315000.0</GIS_X_COOR>
    <GIS_Y_COOR>544900.0</GIS_Y_COOR>
  </OIL>
  <OIL>
    <UNI_ID>A0000002</UNI_ID>
    <OS_NM>가격 없는 주유소</OS_NM>
    <PRICE>0</PRICE>
    <GIS_X_COOR>315000.0</GIS_X_COOR>
    <GIS_Y_COOR>544900.0</GIS_Y_COOR>
  </OIL>
  <OIL>
    <UNI_ID>A0000003</UNI_ID>
    <OS_NM>좌표 없는 주유소</OS_NM>
    <PRICE>1700</PRICE>
  </OIL>
</RESULT>`;

describe('오피넷 어댑터', () => {
  it('문서 예시 응답을 주유소로 읽는다(가격·좌표 없는 항목은 거른다)', () => {
    const stations = parseAroundXml(OPINET_XML);
    expect(stations.map((s) => s.id)).toEqual(['A0009907', 'A0000001']);
    expect(stations[0]).toMatchObject({ name: '에너지플러스허브 삼방주유소', brand: 'GSC', price: 1725 });
    expect(stations[0].lat).toBeCloseTo(37.5038, 2);
    expect(stations[0].lng).toBeCloseTo(127.0231, 2);
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
    expect(Number(url.searchParams.get('x'))).toBeCloseTo(314681.8, 0);
    expect(Number(url.searchParams.get('y'))).toBeCloseTo(544837, 0);
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

  it('서비스를 거치면 문서 예시 주유소가 가격 후보가 된다', async () => {
    const { fn } = fakeFetch(() => xmlResponse(OPINET_XML));
    const sources: EnergySources = { ...newAppSources(), fuelStations: createOpinetSource({ certKey: 'k', fetchImpl: fn }) };
    const origin = katecToWgs84(314681.8, 544837);
    const destination = { lat: origin.lat, lng: origin.lng + 0.02 };
    const r = await findEnergyOptions({ fuel: 'gasoline', origin, destination, stayMinutes: null, at: new Date() }, sources);
    expect(r.source).toBe('live');
    // 1699원이 더 싸다. 둘 다 경로 출발점 근처라 3km 안이다.
    expect(r.candidates.map((c) => [c.id, c.price?.won])).toEqual([
      ['A0000001', 1699],
      ['A0009907', 1725],
    ]);
  });
});

// 한국환경공단 전기자동차 충전소 정보 문서(https://www.data.go.kr/data/15076352/openapi.do)에는 응답 전체 예시 없이
// 필드별 예시 값만 있다. 아래 XML은 그 필드 예시 값(statNm 기후대기관 등)으로 만든 고정 문자열이고,
// header/body/items/item 배치는 문서로 확인하지 못했다(미확인) — 파서는 태그 이름만 본다.
const itemXml = (o: Record<string, string>) =>
  `<item>${Object.entries({
    statNm: '기후대기관',
    statId: '28260005',
    chgerId: '01',
    chgerType: '03',
    addr: '인천광역시 서구 환경로 42',
    lat: '37.569620',
    lng: '126.641973',
    useTime: '24시간 이용가능',
    busiId: 'ME',
    busiNm: '환경부',
    busiCall: '1661-9408',
    stat: '2',
    statUpdDt: '20190829121020',
    powerType: '급속(100kWh동시)',
    zcode: '28',
    parkingFree: 'Y',
    note: '공사로 인해 이용 불가',
    ...o,
  })
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('')}</item>`;
const pageXml = (items: string[], total = items.length, code = '00') =>
  `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>${code}</resultCode><resultMsg>NORMAL SERVICE.</resultMsg><totalCount>${total}</totalCount><pageNo>1</pageNo><numOfRows>9999</numOfRows></header><body><items>${items.join('')}</items></body></response>`;

describe('환경부 충전소 어댑터', () => {
  it('문서의 필드 예시 값을 충전기로 읽는다', () => {
    const page = parseChargerInfoXml(pageXml([itemXml({})]));
    expect(page).toMatchObject({ resultCode: '00', resultMsg: 'NORMAL SERVICE.', totalCount: 1 });
    expect(page.chargers).toEqual([
      {
        stationId: '28260005',
        chargerId: '01',
        name: '기후대기관',
        address: '인천광역시 서구 환경로 42',
        lat: 37.56962,
        lng: 126.641973,
        speed: 'fast',
        state: 'available',
        powerKw: 100,
        operator: '환경부',
        parkingFree: true,
      },
    ]);
  });

  it('상태·속도 분류와 제외 규칙', () => {
    expect(['0', '1', '2', '3', '4', '5', '9', ''].map(mapState)).toEqual(['unknown', 'unavailable', 'available', 'charging', 'unavailable', 'unavailable', 'unknown', 'unknown']);
    expect(classifySpeed('02', '')).toBe('slow');
    expect(classifySpeed('07', '')).toBe('slow');
    expect(classifySpeed('08', '')).toBe('slow');
    expect(classifySpeed('04', '')).toBe('fast');
    expect(classifySpeed('04', '완속(7kW)')).toBe('slow'); // powerType 글자가 코드보다 먼저
    expect(classifySpeed('02', '급속(50kW)')).toBe('fast');

    const page = parseChargerInfoXml(
      pageXml([
        itemXml({ statId: 'a', chgerType: '02', powerType: '', parkingFree: 'N', note: '', busiNm: '' }),
        itemXml({ statId: 'b', limitYn: 'Y' }),
        itemXml({ statId: 'c', delYn: 'Y' }),
        itemXml({ statId: 'd', lat: '' }),
        itemXml({ statId: 'e', lng: 'abc' }),
        itemXml({ statId: 'f', parkingFree: '', stat: '3', statNm: '가 &amp; 나' }),
      ]),
    );
    expect(page.chargers.map((c) => c.stationId)).toEqual(['a', 'f']);
    expect(page.chargers[0]).toMatchObject({ speed: 'slow', powerKw: null, operator: null, parkingFree: false });
    expect(page.chargers[1]).toMatchObject({ state: 'charging', parkingFree: null, name: '가 & 나' });
  });

  it('인천 근처 조회는 인천(zcode 28) 한 곳만 문서의 변수로 부르고 반경으로 거른다', async () => {
    const { fn, urls } = fakeFetch(() => xmlResponse(pageXml([itemXml({}), itemXml({ statId: 'far', lat: '37.58', lng: '126.7' })])));
    const source = createEvChargerSource({ serviceKey: 'SECRET-KEY', fetchImpl: fn });
    const found = await source.findNear({ lat: 37.5696, lng: 126.642 }, 500);
    expect(found.map((c) => c.stationId)).toEqual(['28260005']);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://apis.data.go.kr/B552584/EvCharger/getChargerInfo');
    expect(url.searchParams.get('serviceKey')).toBe('SECRET-KEY');
    expect(url.searchParams.get('zcode')).toBe('28');
    expect(url.searchParams.get('pageNo')).toBe('1');
    expect(url.searchParams.get('numOfRows')).toBe('9999');
  });

  it('받은 시도 데이터는 5분 동안 다시 받지 않는다', async () => {
    let clock = 1_000_000;
    const { fn, mock } = fakeFetch(() => xmlResponse(pageXml([itemXml({})])));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn, now: () => clock });
    const here = { lat: 37.5696, lng: 126.642 };
    await source.findNear(here, 500);
    await source.findNear(here, 500);
    clock += 4 * 60_000;
    await source.findNear(here, 500);
    expect(mock).toHaveBeenCalledTimes(1);
    clock += 2 * 60_000;
    await source.findNear(here, 500);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('동시에 같은 시도를 부르면 한 번만 받는다', async () => {
    const { fn, mock } = fakeFetch(() => xmlResponse(pageXml([itemXml({})])));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn });
    await Promise.all([1, 2, 3].map(() => source.findNear({ lat: 37.5696, lng: 126.642 }, 500)));
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('totalCount가 9999를 넘으면 나머지 쪽도 받는다', async () => {
    const { fn, urls } = fakeFetch((url) => xmlResponse(pageXml([itemXml({ statId: `p${new URL(url).searchParams.get('pageNo')}` })], 25_000)));
    const source = createEvChargerSource({ serviceKey: 'k', fetchImpl: fn });
    const found = await source.findNear({ lat: 37.5696, lng: 126.642 }, 500);
    expect(urls.map((u) => new URL(u).searchParams.get('pageNo'))).toEqual(['1', '2', '3']);
    expect(found.map((c) => c.stationId).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('강원·전북은 개정 전후 코드를 둘 다 부르고 하나만 받아져도 쓰며, 이웃 시도가 실패해도 무시한다', async () => {
    const { fn, urls } = fakeFetch((url) =>
      new URL(url).searchParams.get('zcode') === '51' ? xmlResponse(pageXml([itemXml({ statId: 'gw', lat: '37.88', lng: '127.73' })])) : xmlResponse(pageXml([], 0, '30')),
    );
    const found = await createEvChargerSource({ serviceKey: 'k', fetchImpl: fn }).findNear({ lat: 37.8813, lng: 127.7298 }, 500);
    const zcodes = urls.map((u) => new URL(u).searchParams.get('zcode'));
    expect(zcodes).toEqual(expect.arrayContaining(['42', '51'])); // 경계 쪽 이웃 시도(경기)도 같이 부르지만 실패해도 무시한다
    expect(found.map((c) => c.stationId)).toEqual(['gw']);
  });

  it('가까운 시도 선택: 경계 근처에서만 두 곳', () => {
    expect(regionsNear({ lat: 35.1595, lng: 126.8526 }).map((r) => r.name)).toEqual(['광주']);
    expect(regionsNear({ lat: 37.5, lng: 126.85 }).map((r) => r.name)).toContain('서울');
  });

  it('결과 코드가 00이 아니거나 HTTP 오류·연결 실패면 키와 URL 없는 메시지로 던지고, 바로 다시 부르지 않는다', async () => {
    const here = { lat: 37.5696, lng: 126.642 };
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
      const error = await source.findNear(here, 500).catch((e: Error) => e);
      expect((error as Error).message).not.toMatch(/https?:|SECRET-KEY|serviceKey/i);
      const calls = spy.mock.calls.length;
      await source.findNear(here, 500).catch(() => undefined);
      expect(spy.mock.calls.length).toBe(calls); // 30초 쉬는 동안 다시 부르지 않는다
    }
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
    const here = { lat: 37.5696, lng: 126.642 };
    await expect(source.findNear(here, 500)).rejects.toThrow('늦습니다');
    release(xmlResponse(pageXml([itemXml({})])));
    await new Promise((r) => setTimeout(r, 10));
    expect((await source.findNear(here, 500)).map((c) => c.stationId)).toEqual(['28260005']);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('인코딩된 키(%)는 풀어서 한 번만 인코딩한다', async () => {
    const { fn, urls } = fakeFetch(() => xmlResponse(pageXml([])));
    await createEvChargerSource({ serviceKey: 'ab%2Bc%3D%3D', fetchImpl: fn }).findNear({ lat: 37.5696, lng: 126.642 }, 500);
    expect(new URL(urls[0]).searchParams.get('serviceKey')).toBe('ab+c==');
    expect(urls[0]).toContain('serviceKey=ab%2Bc%3D%3D');
  });

  it('서비스를 거치면 완속 충전기가 목적지 후보가 된다', async () => {
    const { fn } = fakeFetch(() => xmlResponse(pageXml([itemXml({ chgerType: '02', powerType: '완속(7kW)' }), itemXml({ statId: 'busy', stat: '3', chgerType: '02', powerType: '' })])));
    const sources: EnergySources = { ...newAppSources(), chargers: createEvChargerSource({ serviceKey: 'k', fetchImpl: fn }) };
    const r = await findEnergyOptions({ fuel: 'ev', origin: { lat: 37.5, lng: 126.6 }, destination: { lat: 37.5696, lng: 126.642 }, stayMinutes: 180, at: new Date() }, sources);
    expect(r).toMatchObject({ source: 'live', stage: 'destination' });
    expect(r.candidates.map((c) => [c.id, c.charger?.powerKw])).toEqual([['28260005', 7]]);
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
