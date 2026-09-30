/**
 * Demo photography from Pexels (free to use, no attribution required — we credit anyway).
 * Needs PEXELS_API_KEY in .env.local (free at pexels.com/api).
 *
 *   node scripts/demo/fetch-stock.mjs candidates <outDir> [key...]
 *       searches each piece, downloads up to 8 candidates, and writes numbered contact
 *       sheets (4 pieces per sheet) to <outDir> for a person to choose from
 *
 *   node scripts/demo/fetch-stock.mjs unsplash <outDir> <found.json> [key...]
 *       the same, from Unsplash candidates gathered in a browser (see fromUnsplashList)
 *
 *   node scripts/demo/fetch-stock.mjs pick <outDir> key=index [key=index...]
 *       crops the chosen candidate to an 800px square around its subject and writes
 *       scripts/demo/assets/{key}.webp (and public/landing/), recording the credit in
 *       assets/credits.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, byKey } from './catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const ASSETS = join(here, 'assets');
const CREDITS = join(ASSETS, 'credits.json');
const sharp = createRequire(createRequire(join(root, 'package.json')).resolve('next/package.json'))('sharp');

const PER_ITEM = 8;
const TILE = 180;
const CREAM = { r: 244, g: 239, b: 232, alpha: 1 };

/** Search terms that find product shots rather than people wearing the thing. */
const QUERY = {
  'white-oxford-shirt': 'white dress shirt',
  'light-blue-linen-shirt': 'blue linen shirt',
  'navy-polo': 'navy polo shirt',
  'grey-crew-tee': 'grey t-shirt',
  'black-crew-tee': 'black t-shirt',
  'olive-henley': 'henley shirt',
  'charcoal-hoodie': 'grey hoodie',
  'cream-cable-sweater': 'cable knit sweater',
  'beige-kurta': 'kurta',
  'striped-breton-top': 'breton striped shirt',
  'ivory-silk-blouse': 'silk blouse',
  'black-fitted-tee': 'black tshirt',
  'white-cotton-kurti': 'chikankari kurti',
  'mustard-knit-top': 'mustard sweater',
  'dusty-pink-shirt': 'pink blouse',
  'indigo-slim-jeans': 'dark jeans',
  'khaki-chinos': 'khaki chinos',
  'charcoal-trousers': 'grey trousers',
  'black-joggers': 'black joggers',
  'navy-shorts': 'chino shorts',
  'high-waist-blue-jeans': 'blue jeans',
  'black-tailored-trousers': 'black trousers',
  'pleated-midi-skirt': 'pleated skirt',
  'linen-wide-pants': 'linen pants',
  'black-leggings': 'black leggings',
  'grey-running-shorts': 'running shorts',
  'floral-midi-dress': 'floral dress',
  'black-slip-dress': 'black slip dress',
  'mustard-anarkali': 'anarkali',
  'white-sundress': 'white sundress',
  'emerald-saree': 'green silk saree',
  'navy-blazer': 'navy blazer',
  'denim-jacket': 'denim jacket',
  'olive-bomber': 'bomber jacket',
  'camel-trench': 'trench coat',
  'black-leather-jacket': 'leather jacket',
  'grey-cardigan': 'grey cardigan',
  'nehru-jacket': 'nehru jacket',
  'white-sneakers': 'white sneakers',
  'brown-loafers': 'loafers',
  'black-oxfords': 'oxford shoes',
  'running-shoes': 'running shoes',
  'chelsea-boots': 'chelsea boots',
  'block-heels': 'block heels',
  'tan-sandals': 'leather sandals',
  'gold-juttis': 'jutti',
  'black-ankle-boots': 'ankle boots',
  'leather-watch': 'leather watch',
  'brown-belt': 'leather belt',
  'canvas-backpack': 'canvas backpack',
  'aviator-sunglasses': 'aviator sunglasses',
  'tan-tote': 'leather tote bag',
  'gold-hoops': 'gold hoop earrings',
  'silk-scarf': 'silk scarf',
  'black-crossbody': 'crossbody bag',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

/** Pexels search, normalised to the fields the rest of this file reads. */
async function search(q) {
  const url =
    'https://api.pexels.com/v1/search?' + new URLSearchParams({ query: q, per_page: '20' });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
    if (res.ok) {
      return (await res.json()).photos.map((p) => ({
        url: p.src.large,
        width: p.width,
        height: p.height,
        title: p.alt || null,
        creator: p.photographer,
        license: 'pexels',
        license_version: null,
        foreign_landing_url: p.url,
        source: 'Pexels',
      }));
    }
    if (res.status === 429) {
      await sleep(15_000 * attempt);
      continue;
    }
    throw new Error(`search ${q}: ${res.status} ${await res.text()}`);
  }
  throw new Error(`search ${q}: rate limited`);
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'wardrobe-ai-demo-seed/1.0' } });
  if (!res.ok) throw new Error(`${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf).metadata(); // throws on anything that is not an image
  return buf;
}

/**
 * Unsplash candidates gathered in a browser from search pages (license=free), one line
 * per piece: `key=<photo id>~<short id>,…`. Unsplash License: free to use, commercial
 * included, no attribution required.
 */
function fromUnsplashList(file) {
  const found = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => {
        const [key, list] = line.split('=');
        return [key.trim(), list.split(',').map((c) => c.split('~'))];
      }),
  );
  return async (key) =>
    (found[key] ?? []).map(([id, shortId]) => ({
      url: `https://images.unsplash.com/photo-${id}?w=1000&q=80&fm=jpg`,
      width: 1000,
      height: 1000,
      title: null,
      creator: null,
      license: 'unsplash',
      license_version: null,
      // Short ids are 11 characters; anything shorter was clipped while gathering.
      foreign_landing_url: shortId?.length === 11 ? `https://unsplash.com/photos/${shortId}` : 'https://unsplash.com',
      source: 'Unsplash',
    }));
}

async function candidates(outDir, keys, finder = (key) => search(QUERY[key] ?? byKey[key].name)) {
  mkdirSync(join(outDir, 'raw'), { recursive: true });
  const items = keys.length ? keys.map((k) => byKey[k]) : CATALOG;
  const meta = existsSync(join(outDir, 'meta.json'))
    ? JSON.parse(readFileSync(join(outDir, 'meta.json'), 'utf8'))
    : {};

  for (const item of items) {
    const results = (await finder(item.key)).filter(
      (r) => (r.width ?? 0) >= 400 && (r.height ?? 0) >= 400,
    );
    meta[item.key] = [];
    for (const r of results) {
      if (meta[item.key].length >= PER_ITEM) break;
      try {
        const buf = await download(r.url);
        const i = meta[item.key].length;
        writeFileSync(join(outDir, 'raw', `${item.key}-${i}`), buf);
        meta[item.key].push({
          url: r.url,
          title: r.title,
          creator: r.creator,
          license: r.license,
          license_version: r.license_version,
          landing: r.foreign_landing_url,
          source: r.source,
        });
      } catch {
        /* dead link — try the next result */
      }
    }
    console.log(`  ${item.key}: ${meta[item.key].length} candidates`);
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  }

  // Contact sheets: one row per piece, candidates numbered left to right from 0.
  const all = Object.keys(meta);
  for (let s = 0; s * 4 < all.length; s++) {
    const rows = all.slice(s * 4, s * 4 + 4);
    const composites = [];
    for (const [row, key] of rows.entries()) {
      const label = Buffer.from(
        `<svg width="${TILE * PER_ITEM}" height="24"><rect width="100%" height="100%" fill="#222"/>` +
          `<text x="6" y="17" font-size="15" font-family="Arial" fill="#fff">${key}</text></svg>`,
      );
      composites.push({ input: label, left: 0, top: row * (TILE + 24) });
      for (let i = 0; i < meta[key].length; i++) {
        const tile = await sharp(join(outDir, 'raw', `${key}-${i}`))
          .resize(TILE, TILE, { fit: 'contain', background: CREAM })
          .composite([
            {
              input: Buffer.from(
                `<svg width="26" height="22"><rect width="26" height="22" fill="#c00"/>` +
                  `<text x="7" y="16" font-size="15" font-family="Arial" fill="#fff">${i}</text></svg>`,
              ),
              left: 0,
              top: 0,
            },
          ])
          .png()
          .toBuffer();
        composites.push({ input: tile, left: i * TILE, top: row * (TILE + 24) + 24 });
      }
    }
    await sharp({
      create: { width: TILE * PER_ITEM, height: rows.length * (TILE + 24), channels: 4, background: '#ffffff' },
    })
      .composite(composites)
      .jpeg({ quality: 80 })
      .toFile(join(outDir, `sheet-${String(s).padStart(2, '0')}.jpg`));
  }
  console.log(`sheets written to ${outDir}`);
}

async function pick(outDir, picks) {
  mkdirSync(ASSETS, { recursive: true });
  const meta = JSON.parse(readFileSync(join(outDir, 'meta.json'), 'utf8'));
  const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {};

  for (const arg of picks) {
    // key=index, or key=index@west (any sharp gravity) when the subject is off-centre.
    const [key, rest] = arg.split('=');
    const [idx, gravity] = rest.split('@');
    const chosen = meta[key]?.[Number(idx)];
    if (!chosen) throw new Error(`no candidate ${arg}`);
    const webp = await sharp(join(outDir, 'raw', `${key}-${idx}`))
      .rotate()
      // Fill the square, cropping to the most salient region: letterboxing left most
      // photos as a small picture inside a cream band once the grid crops them again.
      .resize(800, 800, { fit: 'cover', position: gravity ?? sharp.strategy.attention })
      .flatten({ background: CREAM })
      .webp({ quality: 80 })
      .toBuffer();
    writeFileSync(join(ASSETS, `${key}.webp`), webp);
    // The landing and sign-in pages show the same photos, served statically.
    mkdirSync(join(root, 'public', 'landing'), { recursive: true });
    writeFileSync(join(root, 'public', 'landing', `${key}.webp`), webp);
    credits[key] = chosen;
    console.log(`  ✓ ${key} ← #${idx} (${chosen.license} ${chosen.creator ?? ''})`);
  }
  writeFileSync(CREDITS, JSON.stringify(credits, null, 2));
}

loadEnv();
const [mode, outDir, ...rest] = process.argv.slice(2);
if (!outDir || !['candidates', 'unsplash', 'pick'].includes(mode)) {
  console.error('usage: fetch-stock.mjs candidates|unsplash|pick <outDir> ...');
  process.exit(2);
}
if (mode === 'candidates' && !process.env.PEXELS_API_KEY) {
  console.error('PEXELS_API_KEY is not set (.env.local) — free at https://www.pexels.com/api/');
  process.exit(2);
}
const run =
  mode === 'candidates'
    ? candidates(outDir, rest)
    : mode === 'unsplash'
      ? candidates(outDir, rest.slice(1), fromUnsplashList(rest[0]))
      : pick(outDir, rest);
run.catch((e) => {
  console.error(e);
  process.exit(1);
});
