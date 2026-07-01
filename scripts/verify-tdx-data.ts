import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateJsonPayload } from './tdx-data-integrity.js';

type DatasetCheck = {
  path: string;
  collection?: string;
  minimumItems: number;
};

const checks: DatasetCheck[] = [
  { path: 'public/data/tra-stations.json', collection: 'Stations', minimumItems: 200 },
  { path: 'public/data/thsr-stations.json', minimumItems: 10 },
  { path: 'public/data/tra-timetable.json', collection: 'TrainTimetables', minimumItems: 500 },
  { path: 'public/data/thsr-timetable.json', minimumItems: 100 },
];

for (const check of checks) {
  const filePath = resolve(check.path);
  const payload = validateJsonPayload(await readFile(filePath));
  const collection = check.collection
    ? (payload as Record<string, unknown>)[check.collection]
    : payload;

  if (!Array.isArray(collection) || collection.length < check.minimumItems) {
    throw new Error(
      `${check.path} failed integrity check: expected at least ${check.minimumItems} items`,
    );
  }

  console.log(`✓ ${check.path}: ${collection.length} items`);
}
