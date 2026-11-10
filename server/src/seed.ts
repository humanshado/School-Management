/** Reset the database to the sample data in data/sample.json (or a JSON file given as the first argument). */
import './preflight.ts';
import { readFileSync } from 'node:fs';
import { loadSample, openStore, SAMPLE_FILE } from './db.ts';

const file = process.argv[2] ?? SAMPLE_FILE;
const store = openStore();
loadSample(store, file);
console.log(`Database reset from ${file}`);
