/*
 * Country flag for a driver from iRacing's "flair" (DriverInfo.Drivers[].FlairName, e.g.
 * "United States", "Isle of Man", "Scotland"). Returns the flag code used for
 * src/renderer/flags/<code>.png, or null for "iRacing", "Unaffiliated" and unknown names.
 */
const COUNTRIES = require('./countries.json'); // code -> name, from flag-icons (scripts/build-flags.js)

// iRacing's spelling where it differs from flag-icons'
const ALIASES = {
  'united states': 'us', usa: 'us', 'united kingdom': 'gb', 'great britain': 'gb',
  england: 'gb-eng', scotland: 'gb-sct', wales: 'gb-wls', 'northern ireland': 'gb-nir',
  czechia: 'cz', 'ivory coast': 'ci', 'cote d ivoire': 'ci', macedonia: 'mk', micronesia: 'fm',
  palestine: 'ps', 'pitcairn islands': 'pn', 'saint helena': 'sh', svalbard: 'sj',
  'vatican city': 'va', 'cape verde': 'cv', 'british virgin islands': 'vg', 'virgin islands': 'vi',
  'south georgia and south sandwich islands': 'gs', turkey: 'tr', 'russian federation': 'ru',
  korea: 'kr', 'republic of korea': 'kr', 'brunei darussalam': 'bn', macau: 'mo', 'hong kong': 'hk',
  'sint maarten': 'sx', 'saint martin': 'mf', reunion: 're', 'timor leste': 'tl',
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z]+/g, ' ').trim();

const BY_NAME = new Map();
for (const [code, name] of Object.entries(COUNTRIES)) BY_NAME.set(norm(name), code);
for (const [name, code] of Object.entries(ALIASES)) BY_NAME.set(norm(name), code);

function flagCode(flairName) {
  const code = BY_NAME.get(norm(flairName));
  return code && COUNTRIES[code] ? code : null;
}

module.exports = { flagCode };
