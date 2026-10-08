/*
 * Code signing rewrites the installer, so the sha512/size in latest.yml and the
 * .blockmap that electron-builder wrote no longer match it, and auto-update would
 * reject the download. Rebuild both from the signed files.
 *
 *   node scripts/rehash.js [dist]
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function main() {
  const dir = process.argv[2] || 'dist';
  const ymlPath = path.join(dir, 'latest.yml');
  let text = fs.readFileSync(ymlPath, 'utf8');
  const info = yaml.load(text);
  for (const f of info.files) {
    const file = path.join(dir, f.url);
    const r = await buildBlockMap(file, 'gzip', file + '.blockmap');
    // edit the text rather than re-dumping it, so everything else stays byte-for-byte
    text = text.split(f.sha512).join(r.sha512).replace(`size: ${f.size}\n`, `size: ${r.size}\n`);
    console.log(`${f.url}: ${f.size} -> ${r.size} bytes, sha512 ${r.sha512 === f.sha512 ? 'unchanged' : 'updated'}`);
  }
  fs.writeFileSync(ymlPath, text);
}

main().catch((e) => { console.error(e); process.exit(1); });
