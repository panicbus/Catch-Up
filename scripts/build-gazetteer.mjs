#!/usr/bin/env node
/** One-time maintenance script that (re)builds main/data/cities.json, the bundled place-name
 * gazetteer used by main/locality/ to resolve a user's home city and to spot place mentions in
 * article text. Not part of the normal build — run manually, only when re-trimming the dataset.
 *
 * Source: GeoNames cities5000 (all populated places with population > 5000, ~70k rows) +
 * admin1CodesASCII (state/province names), both CC BY 4.0 (https://www.geonames.org/) — see the
 * attribution note in README.md. cities5000 (not the smaller cities15000 cut) is deliberate: a
 * lot of real "local news" datelines are small towns under 15,000 people (e.g. Banff, AB, pop.
 * ~8,300 — the motivating example for this feature).
 *
 * Usage:
 *   curl -o /tmp/cities5000.zip https://download.geonames.org/export/dump/cities5000.zip
 *   curl -o /tmp/admin1CodesASCII.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *   unzip -o /tmp/cities5000.zip -d /tmp
 *   node scripts/build-gazetteer.mjs /tmp/cities5000.txt /tmp/admin1CodesASCII.txt
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [, , citiesPath, admin1Path] = process.argv;
if (!citiesPath || !admin1Path) {
  console.error('Usage: node scripts/build-gazetteer.mjs <cities15000.txt> <admin1CodesASCII.txt>');
  process.exit(1);
}

const admin1Names = new Map(); // "CC.XX" -> admin1 ASCII name
for (const line of readFileSync(admin1Path, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const [code, , asciiName] = line.split('\t');
  admin1Names.set(code, asciiName);
}

const rows = [];
for (const line of readFileSync(citiesPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const cols = line.split('\t');
  const [, name, asciiname, , lat, lon, , , countryCode, , admin1Code] = cols;
  const population = Number(cols[14]) || 0;
  const adm1 = admin1Names.get(`${countryCode}.${admin1Code}`) ?? null;
  rows.push({
    n: name,
    a: asciiname,
    lat: Math.round(Number(lat) * 1e5) / 1e5,
    lon: Math.round(Number(lon) * 1e5) / 1e5,
    cc: countryCode,
    adm1,
    pop: population,
  });
}

rows.sort((a, b) => b.pop - a.pop);

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'main', 'data', 'cities.json');
writeFileSync(outPath, JSON.stringify(rows));
console.log(`Wrote ${rows.length} cities to ${outPath}`);
