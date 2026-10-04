const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { flagCode } = require('../../src/main/flags');
const COUNTRIES = require('../../src/main/countries.json');

test('iRacing flair names map to flag codes', () => {
  const cases = {
    'United States': 'us', 'United Kingdom': 'gb', Germany: 'de', Brazil: 'br', 'Isle of Man': 'im',
    'Puerto Rico': 'pr', 'New Zealand': 'nz', England: 'gb-eng', Scotland: 'gb-sct', Wales: 'gb-wls',
    'Northern Ireland': 'gb-nir', Czechia: 'cz', 'Ivory Coast': 'ci', 'Saint Pierre & Miquelon': 'pm',
    'Saint-Barthélemy': 'bl', 'Sint Maarten (Dutch part)': 'sx', 'Bonaire, Sint Eustatius and Saba': 'bq',
    'Trinidad and Tobago': 'tt', Macedonia: 'mk', 'Vatican City': 'va', Serbia: 'rs', France: 'fr',
  };
  for (const [name, code] of Object.entries(cases)) assert.equal(flagCode(name), code, name);
});

test('no flag for the iRacing logo, unaffiliated, unknown or missing flairs', () => {
  for (const n of ['iRacing', 'Unaffiliated', 'Atlantis', '', undefined, null]) assert.equal(flagCode(n), null, String(n));
});

test('every country has a flag image shipped with the overlays', () => {
  const dir = path.join(__dirname, '..', '..', 'src', 'renderer', 'flags');
  for (const code of Object.keys(COUNTRIES)) assert.ok(fs.existsSync(path.join(dir, code + '.png')), code);
});
