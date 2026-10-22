import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { TRA_LINE_TRANSFERS, getTraLineTransfer } from '../src/lib/traLineTransfers';

const tdx = JSON.parse(readFileSync('scripts/tra-transfer-snapshot/v3-LineTransfer.json', 'utf8')).LineTransfers;

test('line transfers match the TDX LineTransfer snapshot', () => {
  assert.equal(TRA_LINE_TRANSFERS.length, tdx.length);
  for (const row of tdx) {
    const ours = getTraLineTransfer(row.FromStationID);
    assert.ok(ours, `missing ${row.FromStationName.Zh_tw}`);
    assert.equal(ours.stationName, row.FromStationName.Zh_tw);
    assert.equal(ours.fromLine, row.FromLineName.Zh_tw);
    assert.equal(ours.fromLineEn, row.FromLineName.En);
    assert.equal(ours.toLine, row.ToLineName.Zh_tw);
    assert.equal(ours.toLineEn, row.ToLineName.En);
    assert.equal(ours.minTransferMinutes, row.MinTransferTime);
    assert.equal(ours.note !== '', (row.TransferDescription ?? '') !== '', `${ours.stationName} note`);
  }
});

test('keys are TRA station ids whose names match the TRA station list', () => {
  const raw = JSON.parse(readFileSync('public/data/tra-stations.json', 'utf8'));
  const tra = new Map<string, string>((Array.isArray(raw) ? raw : raw.Stations).map((s: any) => [s.StationID, s.StationName.Zh_tw]));
  for (const t of TRA_LINE_TRANSFERS) assert.equal(tra.get(t.stationId), t.stationName, t.stationId);
});

test('non-transfer stations and missing ids give nothing', () => {
  assert.equal(getTraLineTransfer('1000'), undefined); // 臺北
  assert.equal(getTraLineTransfer(undefined), undefined);
  assert.equal(getTraLineTransfer('7360')?.toLine, '深澳線');
});
