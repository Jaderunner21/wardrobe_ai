/**
 * Seeds the 15 demo wardrobes — node scripts/demo/seed.mjs [--only email] [--dry-run]
 *
 * For every account in lib/demo-accounts.json:
 *   1. creates the user (confirmed, password DEMO_PASSWORD) or resets its password
 *   2. WIPES that account's items, outfits, feedback and stored photos — demo accounts
 *      only, matched by exact email; nothing else in the project is touched
 *   3. files 19–25 pieces from scripts/demo/assets with real photos, prices, shops and
 *      purchase dates, then ~60 days of wear history, saved outfits and a planned week
 *
 * Safe to rerun: every run rebuilds each demo wardrobe from scratch, which is also how
 * to reset them after judges have been clicking around.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEMO_PASSWORD in
 * .env.local. Uses the service-role key, so it runs on your machine, never in the app.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { CATALOG } from './catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const ASSETS = join(here, 'assets');
const require = createRequire(join(root, 'package.json'));
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const ACCOUNTS = JSON.parse(readFileSync(join(root, 'lib', 'demo-accounts.json'), 'utf8'));

const HISTORY_DAYS = 60;
/** Days from today each saved outfit is planned for. */
const PLAN_OFFSETS = [0, 1, 2, -2, -4, -6];
const TIMEZONE = 'Asia/Kolkata';

// ─────────────────────────────────────────── setup

function loadEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

/** Deterministic per-account randomness, so a rerun rebuilds the same wardrobe. */
function rng(seedText) {
  let h = createHash('sha256').update(seedText).digest().readUInt32LE(0) || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const shuffle = (rand, list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Today in India as YYYY-MM-DD, offset by `days`. */
function day(offset = 0) {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

const must = (label) => ({ error }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

// ─────────────────────────────────────────── choosing a wardrobe

const MINIMUM = { top: 5, bottom: 3, footwear: 3, outerwear: 2, accessory: 2 };

function chooseItems(account, rand) {
  const pool = CATALOG.filter(
    (c) => (c.g === account.g || c.g === 'u') && existsSync(join(ASSETS, `${c.key}.webp`)),
  );
  const score = (c) =>
    (c.style === account.styles[0] ? 3 : c.style === account.styles[1] ? 2 : 0) + rand() * 2.5;
  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  const chosen = new Set();
  const minimum = { ...MINIMUM, ...(account.g === 'w' ? { fullbody: 2 } : {}) };
  for (const [slot, n] of Object.entries(minimum)) {
    ranked.filter((c) => c.slot === slot).slice(0, n).forEach((c) => chosen.add(c));
  }
  for (const c of ranked) {
    if (chosen.size >= account.size) break;
    chosen.add(c);
  }
  return [...chosen];
}

/** A plausible outfit from a wardrobe: fullbody or top+bottom, shoes, maybe a layer. */
function composeOutfit(items, rand, style) {
  const by = (slot) => items.filter((i) => i.slot === slot);
  const prefer = (list) => {
    const matching = list.filter((i) => i.style === style);
    return pick(rand, matching.length && rand() < 0.7 ? matching : list);
  };
  const out = [];
  const full = by('fullbody');
  if (full.length && rand() < 0.35) out.push(prefer(full));
  else {
    if (by('top').length) out.push(prefer(by('top')));
    if (by('bottom').length) out.push(prefer(by('bottom')));
  }
  if (by('footwear').length) out.push(prefer(by('footwear')));
  if (by('outerwear').length && rand() < 0.3) out.push(prefer(by('outerwear')));
  if (by('accessory').length && rand() < 0.5) out.push(prefer(by('accessory')));
  return out;
}

const RATIONALES = [
  'Neutrals anchor the look, so the one colour gets to do the talking.',
  'Balanced formality: nothing here is working harder than the occasion.',
  'Light layers for a warm day, with shoes that can handle a walk.',
  'A piece you have not reached for lately, paired with two reliable favourites.',
  'Tonal and easy. Everything sits within the same warm family.',
  'Crisp on top, relaxed below. Right for a long day that ends out.',
];

// ─────────────────────────────────────────── per account

async function seedAccount(admin, account, password, { dryRun }) {
  const rand = rng(account.email);
  const items = chooseItems(account, rand);
  if (dryRun) {
    console.log(`  ${account.email}: ${items.length} items — ${items.map((i) => i.key).join(', ')}`);
    return;
  }

  // 1 — the user
  let userId;
  const created = await admin.auth.admin.createUser({
    email: account.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: account.name },
  });
  if (created.data?.user) userId = created.data.user.id;
  else {
    const existing = await findUser(admin, account.email);
    if (!existing) throw new Error(`${account.email}: ${created.error?.message}`);
    userId = existing.id;
    must('reset password')(await admin.auth.admin.updateUserById(userId, { password, email_confirm: true }));
  }

  // 2 — wipe (outfits first; items cascade to outfit_items, feedback, condition_log)
  must('wipe outfits')(await admin.from('outfits').delete().eq('user_id', userId));
  must('wipe feedback')(await admin.from('feedback').delete().eq('user_id', userId));
  must('wipe items')(await admin.from('items').delete().eq('user_id', userId));
  const prefix = `items/${userId}`;
  const { data: objects } = await admin.storage.from('items').list(prefix, { limit: 1000 });
  if (objects?.length) {
    must('wipe photos')(await admin.storage.from('items').remove(objects.map((o) => `${prefix}/${o.name}`)));
  }

  must('profile')(
    await admin
      .from('profiles')
      .update({
        display_name: account.name,
        city: account.city,
        country: 'IN',
        timezone: TIMEZONE,
        currency: 'INR',
        plan: 'premium',
        onboarding: { demo: true },
      })
      .eq('id', userId),
  );

  // categories: system rows (user_id null), by slug
  const { data: cats } = await admin.from('categories').select('id, slug').is('user_id', null);
  const categoryId = Object.fromEntries((cats ?? []).map((c) => [c.slug, c.id]));

  // 3 — items + photos
  const rows = [];
  for (const piece of items) {
    const id = randomUUID();
    const main = readFileSync(join(ASSETS, `${piece.key}.webp`));
    const thumb = await sharp(main).resize(240, 240, { fit: 'inside' }).webp({ quality: 70 }).toBuffer();
    const meta = await sharp(main).metadata();

    const storagePath = `items/${userId}/${id}.webp`;
    const thumbPath = `items/${userId}/${id}_t.webp`;
    for (const [path, body] of [[storagePath, main], [thumbPath, thumb]]) {
      must(`upload ${piece.key}`)(
        await admin.storage.from('items').upload(path, body, { contentType: 'image/webp', upsert: true }),
      );
    }

    const monthsOwned = 2 + Math.floor(rand() * 30);
    const addedDaysAgo = HISTORY_DAYS + 5 + Math.floor(rand() * 40);
    rows.push({
      id,
      user_id: userId,
      status: 'ready',
      storage_path: storagePath,
      thumb_path: thumbPath,
      bytes: main.length,
      width: meta.width,
      height: meta.height,
      content_hash: createHash('sha256').update(main).digest('hex'),
      category_id: categoryId[piece.category] ?? null,
      slot: piece.slot,
      style: piece.style,
      name: piece.name,
      subtype: piece.subtype,
      primary_color: piece.color,
      color_hex: piece.hex,
      pattern: piece.pattern,
      material: piece.material,
      formality: piece.formality,
      warmth: piece.warmth,
      seasons: piece.seasons,
      brand: piece.brand,
      retailer: piece.retailer,
      price: Math.round(piece.price * (0.85 + rand() * 0.3)),
      currency: 'INR',
      purchased_on: day(-monthsOwned * 30),
      favourite: rand() < 0.18,
      // Wears from before the app, as the user estimated them — module 05.
      initial_wear_count: monthsOwned > 8 ? Math.floor(rand() * 25) : 0,
      wear_count: 0,
      ai_model: 'demo-seed',
      ai_confidence: 0.9,
      created_at: new Date(Date.now() - addedDaysAgo * 86_400_000).toISOString(),
      _piece: piece,
    });
  }

  // 4 — wear history: most days in the last HISTORY_DAYS, one outfit a day
  const worn = new Map(rows.map((r) => [r.id, []]));
  for (let d = HISTORY_DAYS; d >= 1; d--) {
    if (rand() < 0.28) continue;
    const style = rand() < 0.6 ? account.styles[0] : pick(rand, [account.styles[1], 'casual', 'lounge']);
    for (const r of composeOutfit(rows.map((x) => ({ ...x._piece, id: x.id })), rand, style)) {
      worn.get(r.id).push(day(-d));
    }
  }

  const insertRows = rows.map(({ _piece, ...r }) => {
    const days = worn.get(r.id);
    const wearCount = r.initial_wear_count + days.length;
    const rated = wearCount >= 10;
    return {
      ...r,
      wear_count: wearCount,
      last_worn_on: days.length ? days[days.length - 1] : null,
      condition: rated ? 3 + Math.floor(rand() * 3) : null,
      condition_rated_at: rated ? new Date(Date.now() - Math.floor(rand() * 20) * 86_400_000).toISOString() : null,
      condition_at_wear: rated ? Math.max(0, wearCount - Math.floor(rand() * 8)) : null,
    };
  });
  must('insert items')(await admin.from('items').insert(insertRows));

  const feedback = [];
  for (const [itemId, days] of worn) {
    for (const d of days) {
      feedback.push({
        user_id: userId,
        item_id: itemId,
        kind: 'worn',
        worn_on: d,
        created_at: new Date(`${d}T09:00:00+05:30`).toISOString(),
      });
    }
  }
  for (let i = 0; i < feedback.length; i += 500) {
    must('insert wear history')(await admin.from('feedback').insert(feedback.slice(i, i + 500)));
  }

  // 5 — saved outfits, each on the calendar somewhere around today
  const wardrobe = rows.map((x) => ({ ...x._piece, id: x.id }));
  const outfitStyles = shuffle(rand, [...account.styles, 'casual', account.styles[0], 'lounge', account.styles[1]]);
  let outfitCount = 0;
  for (const [i, style] of outfitStyles.slice(0, 6).entries()) {
    const pieces = composeOutfit(wardrobe, rand, style);
    if (pieces.length < 2) continue;
    const outfitId = randomUUID();
    must('insert outfit')(
      await admin.from('outfits').insert({
        id: outfitId,
        user_id: userId,
        source: 'rules',
        style,
        score: Number((0.7 + rand() * 0.15).toFixed(2)),
        rationale: RATIONALES[i % RATIONALES.length],
        saved: true,
        // Spread across the last week and the next few days, so whichever month the
        // calendar opens on has plans in it.
        planned_for: day(PLAN_OFFSETS[i] ?? 0),
        created_at: new Date(Date.now() - (i + 1) * 3 * 86_400_000).toISOString(),
      }),
    );
    must('insert outfit items')(
      await admin
        .from('outfit_items')
        .insert(pieces.map((p) => ({ outfit_id: outfitId, item_id: p.id, slot: p.slot }))),
    );
    must('insert outfit feedback')(
      await admin.from('feedback').insert({ user_id: userId, outfit_id: outfitId, kind: 'up' }),
    );
    outfitCount++;
  }

  must('profile count')(
    await admin.from('profiles').update({ item_count: insertRows.length }).eq('id', userId),
  );

  console.log(
    `  ✓ ${account.name.padEnd(16)} ${insertRows.length} items · ${feedback.length} wears · ${outfitCount} outfits`,
  );
}

async function findUser(admin, email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

// ─────────────────────────────────────────── main

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, DEMO_PASSWORD: password } = process.env;
  if (!dryRun && (!url || !key)) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)');
  if (!dryRun && (!password || password.length < 8)) throw new Error('DEMO_PASSWORD (8+ characters) must be set (.env.local)');

  const missing = CATALOG.filter((c) => !existsSync(join(ASSETS, `${c.key}.webp`))).map((c) => c.key);
  if (missing.length) console.log(`Note: no photo yet for ${missing.length} pieces, which are left out: ${missing.join(', ')}`);

  const admin = dryRun ? null : createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const accounts = only ? ACCOUNTS.filter((a) => a.email === only) : ACCOUNTS;
  console.log(`${dryRun ? 'Dry run: ' : ''}seeding ${accounts.length} demo wardrobes`);

  for (const account of accounts) {
    await seedAccount(admin, account, password, { dryRun });
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
