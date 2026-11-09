import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBusNetwork,
  busRegionsAt,
  foldText,
  headingLabel,
  nearbyPlaces,
  parseBusCityFile,
  placeRouteNames,
  placeSides,
  routeDirections,
  busKeypad,
  routePrefixes,
  searchBus,
} from '../src/lib/busData.js';
import {
  BUS_ETA_MAX_STOPS,
  busRouteEtaUrl,
  busStopEtaUrls,
  etaFor,
  etaFromRow,
  etaText,
  indexEtaRows,
  isEtaExpired,
} from '../src/lib/busEta.js';
import { encodeBusCity, isBusFileUsable } from './tdx-bus.js';

// Shapes follow the TDX v2 Bus swagger (BusRoute, BusStopOfRoute, Embedded.Stop).
const stop = (uid: string, seq: number, name: string, lat: number, lon: number, stationId: string | null, en = '') => ({
  StopUID: uid,
  StopID: uid.slice(3),
  StopName: { Zh_tw: name, En: en },
  StopSequence: seq,
  StopPosition: { PositionLat: lat, PositionLon: lon },
  ...(stationId ? { StationID: stationId } : {}),
});

const route = (uid: string, name: string, dep: string, dest: string, nameEn = name) => ({
  RouteUID: uid,
  RouteName: { Zh_tw: name, En: nameEn },
  DepartureStopNameZh: dep,
  DepartureStopNameEn: '',
  DestinationStopNameZh: dest,
  DestinationStopNameEn: '',
});

// 科技大樓站: east side (S1) and, about 40 m west, the other side (S6).
const TECH_E = [25.026, 121.5435] as const;
const TECH_W = [25.026, 121.5431] as const;

const taipeiRoutes = [
  route('TPE15680', '307', '撫遠街', '板橋前站'),
  route('TPE11111', '紅3', '民生社區', '臺北車站', 'R3'),
  route('TPE11112', '紅5', '捷運劍潭站', '捷運圓山站'),
  route('TPE11113', '紅12', '捷運北投站', '捷運石牌站'),
];

const taipeiStopOfRoute = [
  {
    RouteUID: 'TPE15680', RouteName: { Zh_tw: '307' }, SubRouteName: { Zh_tw: '307' }, Direction: 0,
    Stops: [
      stop('TPE200', 2, '和平復興路口', 25.0245, 121.5435, 'S2'),
      stop('TPE100', 1, '捷運科技大樓站', TECH_E[0], TECH_E[1], 'S1', 'MRT Technology Bldg.'),
      stop('TPE300', 3, '板橋前站', 25.0137, 121.4632, 'S3'),
    ],
  },
  {
    RouteUID: 'TPE15680', RouteName: { Zh_tw: '307' }, SubRouteName: { Zh_tw: '307' }, Direction: 1,
    Stops: [
      stop('TPE301', 1, '板橋前站', 25.0138, 121.4633, 'S4'),
      stop('TPE201', 2, '和平復興路口', 25.0247, 121.5431, 'S5'),
      stop('TPE101', 3, '捷運科技大樓站', TECH_W[0], TECH_W[1], 'S6'),
      stop('TPE401', 4, '撫遠街', 25.06, 121.57, 'S7'),
    ],
  },
  {
    // 紅3 and its shorter 區間車 sub-route, both northbound past 科技大樓.
    RouteUID: 'TPE11111', RouteName: { Zh_tw: '紅3' }, SubRouteName: { Zh_tw: '紅3' }, Direction: 0,
    Stops: [
      stop('TPE110', 1, '捷運科技大樓站', TECH_E[0], TECH_E[1], 'S1'),
      stop('TPE510', 2, '民生社區', 25.06, 121.56, 'S8'),
      stop('TPE610', 3, '臺北車站', 25.0478, 121.517, 'S9'),
    ],
  },
  {
    RouteUID: 'TPE11111', RouteName: { Zh_tw: '紅3' }, SubRouteName: { Zh_tw: '紅3區' }, Direction: 0,
    Stops: [
      stop('TPE111', 1, '捷運科技大樓站', TECH_E[0], TECH_E[1], 'S1'),
      stop('TPE510', 2, '民生社區', 25.06, 121.56, 'S8'),
    ],
  },
  {
    RouteUID: 'TPE11112', RouteName: { Zh_tw: '紅5' }, Direction: 0,
    Stops: [stop('TPE701', 1, '捷運劍潭站', 25.084, 121.525, 'S10'), stop('TPE702', 2, '捷運圓山站', 25.071, 121.52, 'S11')],
  },
  {
    RouteUID: 'TPE11113', RouteName: { Zh_tw: '紅12' }, Direction: 0,
    Stops: [stop('TPE801', 1, '捷運北投站', 25.131, 121.498, 'S12'), stop('TPE802', 2, '捷運石牌站', 25.114, 121.515, null)],
  },
  // Unusable: one stop only after the off-island position is dropped.
  {
    RouteUID: 'TPE99999', RouteName: { Zh_tw: '測試' }, Direction: 0,
    Stops: [stop('TPE901', 1, '某站', 25.03, 121.5, 'S99'), stop('TPE902', 2, '外海', 10, 100, 'S98')],
  },
];

const newTaipeiRoutes = [route('NWT15001', '藍28', '捷運科技大樓站', '新店')];
const newTaipeiStopOfRoute = [
  {
    RouteUID: 'NWT15001', RouteName: { Zh_tw: '藍28' }, Direction: 0,
    Stops: [
      // The same east pole as 臺北's S1, a few metres off, under 新北's own StationID.
      stop('NWT100', 1, '捷運科技大樓站', 25.02602, 121.54352, 'N1'),
      stop('NWT200', 2, '新店', 24.96, 121.54, 'N2'),
    ],
  },
];

function encoded() {
  const tpe = encodeBusCity('Taipei', taipeiRoutes, taipeiStopOfRoute, { updated: '2026-11-08T05:00:00+08:00', version: 7 });
  const nwt = encodeBusCity('NewTaipei', newTaipeiRoutes, newTaipeiStopOfRoute, { updated: '2026-11-09T05:00:00+08:00', version: 3 });
  return { tpe, nwt };
}

function network() {
  const { tpe, nwt } = encoded();
  const a = parseBusCityFile(JSON.parse(JSON.stringify(tpe.file)), 'Taipei');
  const b = parseBusCityFile(JSON.parse(JSON.stringify(nwt.file)), 'NewTaipei');
  assert.ok(a && b);
  return buildBusNetwork([a, b]);
}

test('encode → JSON → parse keeps every row, and the same input in any order gives the same bytes', () => {
  const { tpe } = encoded();
  const parsed = parseBusCityFile(JSON.parse(JSON.stringify(tpe.file)), 'Taipei');
  assert.deepEqual(parsed, tpe.file);
  const shuffled = encodeBusCity('Taipei', [...taipeiRoutes].reverse(), [...taipeiStopOfRoute].reverse(), { updated: '2026-11-08T05:00:00+08:00', version: 7 });
  assert.equal(JSON.stringify(shuffled.file), JSON.stringify(tpe.file));
});

test('stops off the island and records left with one stop are dropped, not guessed', () => {
  const { tpe } = encoded();
  assert.equal(tpe.stats.droppedStops, 1);
  assert.equal(tpe.stats.droppedPatterns, 1);
  assert.ok(!tpe.file.routes.some((r) => r[0] === 'TPE99999'));
  // A stop without StationID still gets a 站位 of its own.
  assert.ok(tpe.file.stations.some((s) => s[0] === '捷運石牌站'));
  // Far below the trust threshold for a real city.
  assert.equal(isBusFileUsable(tpe.stats), false);
});

test('a file of another city, version or with an out-of-range index is rejected', () => {
  const { tpe } = encoded();
  const json = JSON.parse(JSON.stringify(tpe.file));
  assert.equal(parseBusCityFile(json, 'NewTaipei'), null);
  assert.equal(parseBusCityFile({ ...json, v: 2 }, 'Taipei'), null);
  assert.equal(parseBusCityFile({ ...json, stops: [...json.stops, ['TPE1', 9999]] }, 'Taipei'), null);
  assert.equal(parseBusCityFile(null, 'Taipei'), null);
});

test('one place per intersection: same name within 250 m, 臺北 and 新北 poles together', () => {
  const net = network();
  const tech = net.places.filter((p) => p.nameZh === '捷運科技大樓站');
  assert.equal(tech.length, 1);
  const place = tech[0];
  assert.deepEqual(new Set(place.stations.map((s) => s.city)), new Set(['Taipei', 'NewTaipei']));
  assert.equal(place.nameEn, 'MRT Technology Bldg.');
  assert.deepEqual(placeRouteNames(net, place), ['307', '紅3', '藍28']);
  // 307's westbound record ends at 撫遠街 and 板橋前站 is its last stop eastbound:
  // nobody boards 307 at its terminal, so the terminal place has only the other direction.
  const banqiao = net.places.find((p) => p.nameZh === '板橋前站')!;
  assert.deepEqual(banqiao.routeKeys, ['Taipei|TPE15680']);
});

test('stop page: the two sides of the road apart, one row per route and direction, heading named', () => {
  const net = network();
  const place = net.places.find((p) => p.nameZh === '捷運科技大樓站')!;
  const sides = placeSides(place);
  assert.equal(sides.length, 2);
  const east = sides.find((s) => s.stations.some((st) => st.city === 'NewTaipei'))!;
  const west = sides.find((s) => s !== east)!;
  // 臺北 S1 and 新北 N1 are a few metres apart: one side.
  assert.equal(east.stations.length, 2);
  assert.deepEqual(east.rows.map((r) => r.route.nameZh), ['307', '紅3', '藍28']);
  const red3 = east.rows.find((r) => r.route.nameZh === '紅3')!;
  // The 區間車 shares the row; the row heads where the full route goes.
  assert.deepEqual(red3.stopUids.sort(), ['TPE110', 'TPE111']);
  assert.equal(red3.towardZh, '臺北車站');
  assert.deepEqual(west.rows.map((r) => `${r.route.nameZh}→${r.towardZh}`), ['307→撫遠街']);
  assert.equal(headingLabel(0, true), '往北');
  assert.equal(headingLabel(181, false), 'Heading south');
  assert.equal(headingLabel(null, true), '');
});

test('route page: the longest record of each direction', () => {
  const net = network();
  const red3 = net.routeByKey.get('Taipei|TPE11111')!;
  const dirs = routeDirections(red3);
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].stops.length, 3);
  const r307 = net.routeByKey.get('Taipei|TPE15680')!;
  assert.deepEqual(routeDirections(r307).map((p) => p.direction), [0, 1]);
});

test('search: route numbers by prefix in natural order, 臺/台 and full-width folded, places too', () => {
  const net = network();
  assert.equal(foldText('臺北　Ｒ３'), '台北r3');
  const red = searchBus(net, '紅');
  assert.deepEqual(red.routes.map((h) => h.route.nameZh), ['紅3', '紅5', '紅12']);
  assert.equal(searchBus(net, '307').routes[0].rank, 0);
  assert.deepEqual(searchBus(net, 'r3').routes.map((h) => h.route.nameZh), ['紅3']);
  // A terminal name finds the routes ending there.
  assert.ok(searchBus(net, '台北車站').routes.some((h) => h.route.nameZh === '紅3'));
  const places = searchBus(net, '科技', { lat: 25.03, lon: 121.54 }).places;
  assert.equal(places[0].place.nameZh, '捷運科技大樓站');
  assert.ok(places[0].distance! > 0);
  assert.deepEqual(searchBus(net, '  ').routes, []);
});

test('prefix keys come from the data', () => {
  const net = network();
  assert.deepEqual(routePrefixes(net, 10, 3), ['紅']);
  assert.deepEqual(routePrefixes(net, 10, 1), ['紅', '藍']);
});

test('keypad: coloured keys and shared words both come from route names', () => {
  const names = ['敦化幹線', '信義幹線', '南京幹線', '市民小巴1', '市民小巴2', '市民小巴3', '紅3', '紅5', '紅12', '307'];
  const sor = names.map((n, i) => ({
    RouteUID: `TPE7${i}`, RouteName: { Zh_tw: n }, Direction: 0,
    Stops: [stop(`TPE7${i}1`, 1, `甲站${i}`, 25.03 + i / 1000, 121.5, `K${i}a`), stop(`TPE7${i}2`, 2, `乙站${i}`, 25.04 + i / 1000, 121.51, `K${i}b`)],
  }));
  const file = parseBusCityFile(JSON.parse(JSON.stringify(encodeBusCity('Taipei', [], sor, { updated: '', version: 1 }).file)), 'Taipei');
  assert.ok(file);
  const pad = busKeypad(buildBusNetwork([file]));
  assert.deepEqual(pad.keys, ['紅']);
  assert.deepEqual(pad.words, ['小巴', '市民', '幹線']);
  // The word finds every route that carries it.
  assert.deepEqual(searchBus(buildBusNetwork([file]), '幹線').routes.map((h) => h.route.nameZh).sort(), ['信義幹線', '南京幹線', '敦化幹線'].sort());
});

test('nearby: within the radius, nearest first', () => {
  const net = network();
  const near = nearbyPlaces(net, 25.0255, 121.5434, 300, 10);
  assert.deepEqual(near.map((n) => n.place.nameZh), ['捷運科技大樓站', '和平復興路口']);
  assert.ok(near[0].distance < near[1].distance);
  assert.equal(nearbyPlaces(net, 22.6, 120.3, 1000, 10).length, 0);
});

test('regions for a position: 林口 sits in both 臺北＋新北 and 桃園', () => {
  assert.deepEqual(busRegionsAt(25.033, 121.543), ['north']);
  assert.deepEqual(new Set(busRegionsAt(25.07, 121.38)), new Set(['north', 'taoyuan']));
  assert.deepEqual(busRegionsAt(22.63, 120.3), ['kaohsiung']);
  assert.deepEqual(busRegionsAt(23.8, 120.9), []);
});

test('ETA URLs are canonical: same stops in any order → same URL; chunked; junk ids never sent', () => {
  const a = busStopEtaUrls('Taipei', ['TPE200', 'TPE100', 'TPE100']);
  const b = busStopEtaUrls('Taipei', ['TPE100', 'TPE200']);
  assert.deepEqual(a, b);
  assert.equal(a.length, 1);
  assert.equal(
    decodeURIComponent(a[0]),
    "https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City/Taipei?$filter=StopUID eq 'TPE100' or StopUID eq 'TPE200'&$format=JSON",
  );
  // `$` stays literal: the gateway forwards the query verbatim and TDX's WAF rejects %24.
  assert.ok(a[0].includes('?$filter=') && a[0].includes('&$format=JSON'));
  const many = Array.from({ length: BUS_ETA_MAX_STOPS + 3 }, (_, i) => `TPE${1000 + i}`);
  assert.equal(busStopEtaUrls('Taipei', many).length, 2);
  assert.deepEqual(busStopEtaUrls('Taipei', ["TPE1' or 1 eq 1 or StopUID eq '"]), []);
  const r = busRouteEtaUrl('Taipei', '紅3', 'TPE11111')!;
  assert.equal(
    decodeURIComponent(r),
    "https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City/Taipei/紅3?$filter=RouteUID eq 'TPE11111'&$format=JSON",
  );
  assert.equal(busRouteEtaUrl('Taipei', '紅3', 'bad uid'), null);
});

test('ETA rows: whole minutes, 進站中 under a minute, statuses by TDX code, unknown → 無資料', () => {
  assert.deepEqual(etaFromRow({ StopStatus: 0, EstimateTime: 45 }), { kind: 'arriving' });
  assert.deepEqual(etaFromRow({ StopStatus: 0, EstimateTime: 119 }), { kind: 'minutes', minutes: 1 });
  assert.deepEqual(etaFromRow({ StopStatus: 0, EstimateTime: 360 }), { kind: 'minutes', minutes: 6 });
  assert.deepEqual(etaFromRow({ StopStatus: 0 }), { kind: 'none' });
  assert.deepEqual(etaFromRow({ StopStatus: 1, NextBusTime: '2026-11-09T14:35:00+08:00' }), { kind: 'scheduled', time: '14:35' });
  assert.deepEqual(etaFromRow({ StopStatus: 1, EstimateTime: 600 }), { kind: 'notDeparted' });
  assert.deepEqual(etaFromRow({ StopStatus: 2 }), { kind: 'noStop' });
  assert.deepEqual(etaFromRow({ StopStatus: 3 }), { kind: 'lastPassed' });
  assert.deepEqual(etaFromRow({ StopStatus: 4 }), { kind: 'noService' });
  assert.deepEqual(etaFromRow({ StopStatus: 9, EstimateTime: 60 }), { kind: 'none' });
  assert.equal(etaText({ kind: 'minutes', minutes: 6 }, true), '6 分');
  assert.equal(etaText({ kind: 'none' }, false), 'No data');
});

test('ETA index: the soonest of a row’s sub-routes, newest UpdateTime, junk rows ignored', () => {
  const idx = indexEtaRows([
    { RouteUID: 'TPE11111', StopUID: 'TPE110', StopStatus: 0, EstimateTime: 600, UpdateTime: '2026-11-09T14:20:10+08:00' },
    { RouteUID: 'TPE11111', StopUID: 'TPE111', StopStatus: 0, EstimateTime: 180, UpdateTime: '2026-11-09T14:20:40+08:00' },
    { RouteUID: 'TPE15680', StopUID: 'TPE100', StopStatus: 3, UpdateTime: '2026-11-09T14:19:00+08:00' },
    { RouteUID: 'TPE15680', StopUID: 'TPE200', StopStatus: 0, EstimateTime: 20 },
    null,
    { StopUID: 'TPE1' },
  ]);
  assert.equal(idx.rows, 4);
  assert.deepEqual(etaFor(idx, 'TPE11111', ['TPE110', 'TPE111']), { kind: 'minutes', minutes: 3 });
  assert.deepEqual(etaFor(idx, 'TPE15680', ['TPE100']), { kind: 'lastPassed' });
  assert.deepEqual(etaFor(idx, 'TPE15680', ['TPE999']), { kind: 'none' });
  assert.ok(idx.arrivingStops.has('TPE200'));
  assert.equal(idx.asOf, '2026-11-09T14:20:40+08:00');
  assert.equal(indexEtaRows({ message: 'error' }).rows, 0);
  const t = Date.parse('2026-11-09T14:20:40+08:00');
  assert.equal(isEtaExpired(idx.asOf, t + 4 * 60_000), false);
  assert.equal(isEtaExpired(idx.asOf, t + 6 * 60_000), true);
  assert.equal(isEtaExpired(null, t), false);
});

test('a narrow street: poles 12 m apart with buses leaving opposite ways stay two sides', () => {
  const r = [route('TPE20001', '600', '甲', '乙')];
  const sor = [
    { RouteUID: 'TPE20001', RouteName: { Zh_tw: '600' }, Direction: 0, Stops: [
      stop('TPE2001', 1, '窄巷口', 25.05, 121.5, 'W1'), stop('TPE2002', 2, '北站', 25.06, 121.5, 'W2')] },
    { RouteUID: 'TPE20001', RouteName: { Zh_tw: '600' }, Direction: 1, Stops: [
      stop('TPE2003', 1, '窄巷口', 25.05, 121.50012, 'E1'), stop('TPE2004', 2, '南站', 25.04, 121.50012, 'E2')] },
  ];
  const file = parseBusCityFile(JSON.parse(JSON.stringify(encodeBusCity('Taipei', r, sor, { updated: '', version: null }).file)), 'Taipei')!;
  const place = buildBusNetwork([file]).places.find((p) => p.nameZh === '窄巷口')!;
  const sides = placeSides(place);
  assert.equal(sides.length, 2);
  assert.deepEqual(sides.map((s) => headingLabel(s.heading, true)), ['往北', '往南']);
  assert.deepEqual(sides.map((s) => s.rows[0].towardZh), ['北站', '南站']);
});
