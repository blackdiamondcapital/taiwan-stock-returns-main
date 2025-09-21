#!/usr/bin/env node
/*
  Seed stock_symbols from official exchanges:
  - TWSE (listed): https://openapi.twse.com.tw/v1/opendata/t187ap03_L
  - TPEx (otc):    https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R

  Env vars for DB connection (same as index.js defaults):
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
*/
const https = require('https');
const { Client } = require('pg');

function fetchJSON(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'User-Agent': 'Mozilla/5.0 (compatible; QuantGemsSeeder/1.0)' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`)); }
      });
    });
    req.setTimeout(15000, () => { req.destroy(new Error('Request timeout')); });
    req.on('error', async (err) => {
      if (attempt < 2) {
        // simple retry once
        try { const data = await fetchJSON(url, attempt + 1); return resolve(data); } catch (e) { return reject(e); }
      }
      reject(err);
    });
  });
}

function normalizeTWSE(rows) {
  const out = [];
  for (const r of rows || []) {
    const code = String(r['公司代號'] || '').trim();
    const name = String(r['公司名稱'] || '').trim();
    const industry = (r['產業別'] || '').toString().trim() || null;
    if (/^\d{4}$/.test(code) && name) {
      out.push({ symbol: `${code}.TW`, name, market: 'listed', industry });
    }
  }
  return out;
}

function normalizeTPEX(rows) {
  const out = [];
  for (const r of rows || []) {
    const code = String(r['公司代號'] || '').trim();
    const name = String(r['公司名稱'] || '').trim();
    const industry = (r['產業別'] || '').toString().trim() || null;
    if (/^\d{4}$/.test(code) && name) {
      out.push({ symbol: `${code}.TWO`, name, market: 'otc', industry });
    }
  }
  return out;
}

async function upsertSymbols(client, items) {
  if (!items.length) return { inserted: 0, updated: 0 };
  let inserted = 0, updated = 0;
  const text = `
    INSERT INTO stock_symbols(symbol, name, market, industry)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (symbol) DO UPDATE SET
      name = EXCLUDED.name,
      market = EXCLUDED.market,
      industry = EXCLUDED.industry
  `;
  for (const it of items) {
    const res = await client.query(text, [it.symbol, it.name, it.market, it.industry]);
    // pg doesn't tell if insert vs update easily; we can check existing first for accuracy but it's fine to count all as upserts
    inserted += 1;
  }
  return { inserted, updated };
}

(async () => {
  const db = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 's8304021',
    database: process.env.DB_NAME || 'postgres',
  });
  try {
    console.log('Connecting to DB...');
    await db.connect();
    console.log('Fetching TWSE list...');
    const twseRaw = await fetchJSON('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
    const twse = normalizeTWSE(Array.isArray(twseRaw) ? twseRaw : []);
    console.log(`TWSE normalized: ${twse.length} items`);

    console.log('Fetching TPEx list...');
    const tpexRaw = await fetchJSON('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R');
    const tpex = normalizeTPEX(Array.isArray(tpexRaw) ? tpexRaw : []);
    console.log(`TPEx normalized: ${tpex.length} items`);
    if (tpex.length === 0) {
      console.warn('Warning: TPEx returned 0 items. The endpoint may be temporarily unavailable. You can rerun later; TWSE symbols will still be inserted.');
    }

    const all = [...twse, ...tpex];
    console.log(`Upserting ${all.length} items into stock_symbols...`);
    const res = await upsertSymbols(db, all);
    console.log('Done upserting. Total:', res.inserted);

    // Show samples
    console.log('Sample records:', all.slice(0, 5));
    process.exit(0);
  } catch (err) {
    console.error('seed_from_exchanges failed:', err);
    process.exit(1);
  } finally {
    try { await db.end(); } catch (_) {}
  }
})();
