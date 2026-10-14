import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusStation } from '../src/lib/api.ts';
import {
  busRouteKey,
  collectOtherStopRoutes,
  orderFavoritesFirst,
  toggleFavorite,
} from '../src/lib/busRoutes.ts';

const route = (uid: string | undefined, id: string, name: string) => ({
  RouteUID: uid,
  RouteID: id,
  RouteName: { Zh_tw: name },
});

const station = (id: string, distance: number, routes: ReturnType<typeof route>[]): BusStation => ({
  StationID: id,
  StationUID: id,
  StationName: { Zh_tw: id },
  Stops: routes,
  Distance: distance,
});

test('route identity uses the city-prefixed RouteUID, falling back to RouteID', () => {
  assert.equal(busRouteKey(route('TPE10132', '10132', '1')), 'TPE10132');
  assert.notEqual(busRouteKey(route('TPE1', '1', '1')), busRouteKey(route('NWT1', '1', '1')));
  assert.equal(busRouteKey(route(undefined, '307', '307')), 'id:307');
});

test('favourites move to the top, both groups keep the stop order', () => {
  const routes = [route('A', '1', '14'), route('B', '2', '39'), route('C', '3', '218'), route('D', '4', '221')];
  const ordered = orderFavoritesFirst(routes, new Set(['D', 'B']));
  assert.deepEqual(ordered.map((r) => r.RouteName.Zh_tw), ['39', '221', '14', '218']);
});

test('other-stop routes skip what the selected stop serves and keep the nearest stop', () => {
  const stations = [
    station('selected', 50, [route('A', '1', '14')]),
    station('far', 400, [route('A', '1', '14'), route('B', '2', '39'), route('C', '3', '5')]),
    station('near', 120, [route('B', '2', '39')]),
  ];
  const others = collectOtherStopRoutes(stations, 'selected');
  assert.deepEqual(
    others.map((o) => [o.route.RouteName.Zh_tw, o.station.StationID]),
    [['39', 'near'], ['5', 'far']],
  );
});

test('routes at the same stop sort by name with numeric order', () => {
  const stations = [
    station('selected', 10, []),
    station('other', 100, [route('X', '2', '262'), route('Y', '3', '39'), route('Z', '4', '藍1')]),
  ];
  assert.deepEqual(
    collectOtherStopRoutes(stations, 'selected').map((o) => o.route.RouteName.Zh_tw),
    ['39', '262', '藍1'],
  );
});

test('toggleFavorite adds then removes', () => {
  assert.deepEqual(toggleFavorite([], 'A'), ['A']);
  assert.deepEqual(toggleFavorite(['A', 'B'], 'A'), ['B']);
});
