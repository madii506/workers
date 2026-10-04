// WORKERS' shared server code. Every upstream call has a timeout and an honest failure message.
// Upstreams: Solana RPC, Jupiter's price API and coins' own metadata. Nothing here holds a key: there is no wallet on this server.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const SOL = 'So11111111111111111111111111111111111111112';
const RPCS = (process.env.RPC_URLS || 'https://solana-rpc.publicnode.com,https://api.mainnet-beta.solana.com').split(',').map(s => s.trim()).filter(Boolean);
const MOCK = process.env.NI_MOCK ? require(process.env.NI_MOCK) : null;   // dev only: canned upstreams

function send(res, code, obj, cache = 'no-store') {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // shared caching only at Vercel's CDN; browsers always revalidate, so a stale copy never sticks in someone's tab
  if (/s-maxage/.test(cache)) { res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); res.setHeader('CDN-Cache-Control', cache.replace(/max-age=0,\s*/, '')); }
  else res.setHeader('Cache-Control', cache);
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.end(JSON.stringify(obj));
}
const CACHE = (s, swr = s * 10) => `public, max-age=0, s-maxage=${s}, stale-while-revalidate=${swr}`;
function query(req) { if (req.query) return req.query; return Object.fromEntries(new URL(req.url, 'http://x').searchParams); }
async function body(req, max = 64 * 1024) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { if (req.body.length > max) return { tooBig: true }; try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let n = 0; for await (const c of req) { chunks.push(c); n += c.length; if (n > max) return { tooBig: true }; }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
function ip(req) { return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim(); }
const hits = new Map();
function limited(key, n, ms) { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); a.push(now); hits.set(key, a); if (hits.size > 5000) hits.delete(hits.keys().next().value); return a.length > n; }

async function getJson(url, opt = {}, ms = 9000) {
  if (MOCK) return MOCK.fetch(url, opt);
  const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, accept: 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(ms) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
async function rpcRaw(method, params, ms = 12000) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await getJson(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, ms);
      if (r.json && (r.json.result !== undefined || (r.json.error && (method === 'sendTransaction' || method === 'simulateTransaction')))) return r.json;
      last = new Error((r.json && r.json.error && r.json.error.message) || 'rpc ' + r.status);
    } catch (e) { last = e; }
  }
  throw last || new Error('rpc failed');
}
async function rpc(method, params, ms) { const j = await rpcRaw(method, params, ms); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result; }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch {} } })); }
const memo = new Map();
const forget = key => memo.delete(key);
async function remember(key, ms, fn) {
  const m = memo.get(key); if (m && Date.now() - m.at < ms) return m.v;
  if (m && m.p) return m.p;
  const p = fn().then(v => { memo.set(key, { at: Date.now(), v }); return v; }).catch(e => { if (m) memo.set(key, m); else memo.delete(key); throw e; });
  memo.set(key, { ...(m || { at: 0 }), p }); return p;
}


// ---------- Solana bits without @solana/web3.js: base58, program-derived addresses, the LaunchLab pool layout ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf) {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(str) {
  let n = 0n; for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return Buffer.from(out);
}
const P25519 = (1n << 255n) - 19n;
const modp = a => ((a % P25519) + P25519) % P25519;
function powp(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P25519; b = b * b % P25519; e >>= 1n; } return r; }
const D25519 = modp(-121665n * powp(121666n, P25519 - 2n));
const SQRTM1 = powp(2n, (P25519 - 1n) / 4n);
function onCurve(bytes) {                          // is this 32-byte string a valid ed25519 point? (PDAs must not be)
  const b = Buffer.from(bytes); b[31] &= 0x7f;
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(b[i]);
  if (y >= P25519) return false;
  const y2 = y * y % P25519, u = modp(y2 - 1n), v = modp(D25519 * y2 + 1n);
  const x2 = u * powp(v, P25519 - 2n) % P25519;
  if (x2 === 0n) return true;
  let x = powp(x2, (P25519 + 3n) / 8n);
  if (x * x % P25519 === x2) return true;
  x = x * SQRTM1 % P25519;
  return x * x % P25519 === x2;
}
function pda(seeds, programId) {
  const crypto = require('crypto'); const prog = b58dec(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash('sha256');
    for (const sd of seeds) h.update(typeof sd === 'string' ? (L58(sd) ? b58dec(sd) : Buffer.from(sd)) : Buffer.from(sd));
    h.update(Buffer.from([bump])); h.update(prog); h.update(Buffer.from('ProgramDerivedAddress'));
    const k = h.digest(); if (!onCurve(k)) return b58enc(k);
  }
  throw new Error('no pda');
}
const L58 = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

// ---------- the split: every child's creator fees, locked by pump.fun's own fee sharing ----------
const SYSTEM = '11111111111111111111111111111111';
const STUDIO = (process.env.STUDIO_WALLET || '').trim();        // the house: its public address only
const YOURS = 7000, HOUSE = 3000;                               // 70% the launcher, 30% payroll (the house pays every crew's compute)
const PARENT = 0;
function sharesOf(payer) { return payer === STUDIO ? [{ address: payer, bps: 10000 }] : [{ address: payer, bps: YOURS }, { address: STUDIO, bps: HOUSE }]; }

// ---------- pump.fun addresses (computed here so reading the chain needs no SDK) ----------
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const bondingCurveOf = mint => pda([Buffer.from('bonding-curve'), b58dec(mint)], PUMP);
const sharingConfigOf = mint => pda([Buffer.from('sharing-config'), b58dec(mint)], PUMP_FEES);
const vaultOf = mint => pda([Buffer.from('creator-vault'), b58dec(sharingConfigOf(mint))], PUMP);
const RENT0 = 890880;                         // lamports a data-less account keeps to stay rent-exempt
async function accounts(addrs) {             // raw accounts in order, null where none exists
  const out = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const r = await rpc('getMultipleAccounts', [addrs.slice(i, i + 100), { encoding: 'base64', commitment: 'confirmed' }]);
    for (const a of r.value) out.push(a ? { data: Buffer.from(a.data[0], 'base64'), lamports: a.lamports, owner: a.owner } : null);
  }
  return out;
}
const RPC_URL = () => RPCS[0];

// ---------- prices ----------
async function solPrice() {
  return remember('solprice', 60000, async () => {
    try { const r = await getJson('https://lite-api.jup.ag/price/v3?ids=' + SOL, {}, 6000); const p = r.json && r.json[SOL] && Number(r.json[SOL].usdPrice); if (p > 0) return p; } catch {}
    return null;
  });
}

// ---------- the database: Postgres (Neon on Vercel; PGlite in local dev) ----------
let pg = null, made = null;
async function q(text, params = []) {
  if (process.env.NI_PGLITE) {
    if (!pg) { const { PGlite } = require('@electric-sql/pglite'); pg = new PGlite(process.env.NI_PGLITE); }
    return (await pg.query(text, params)).rows;
  }
  if (!pg) { const { neon } = require('@neondatabase/serverless'); pg = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL); }
  return pg.query(text, params);
}
const dbReady = () => !!(process.env.NI_PGLITE || process.env.DATABASE_URL || process.env.POSTGRES_URL);
function ready() {
  if (!made) made = (async () => {
    for (const st of [
      `CREATE TABLE IF NOT EXISTS wkr_coins (mint text PRIMARY KEY, id text UNIQUE NOT NULL, slot int, name text NOT NULL, symbol text NOT NULL, voice text NOT NULL,
        look text, xhandle text, payer text NOT NULL, shares jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), born_at timestamptz,
        state text NOT NULL DEFAULT 'awake', mcap_sol float8, complete boolean NOT NULL DEFAULT false, last_trade_at timestamptz, vault_lamports bigint NOT NULL DEFAULT 0,
        img bytea, site jsonb, shifts int NOT NULL DEFAULT 0, shift_at timestamptz)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS wkr_slot ON wkr_coins(slot)`,
      `CREATE TABLE IF NOT EXISTS wkr_work (id bigserial PRIMARY KEY, mint text, kind text NOT NULL, bot text NOT NULL, brief text, job bigint, out jsonb, still bytea, mp4 bytea,
        model text, op jsonb, status text NOT NULL DEFAULT 'done', err text, polled_at timestamptz, at timestamptz NOT NULL DEFAULT now(), done_at timestamptz)`,
      `CREATE INDEX IF NOT EXISTS wkr_work_mint ON wkr_work(mint, id DESC)`,
      `CREATE INDEX IF NOT EXISTS wkr_work_status ON wkr_work(status, id)`,
      `CREATE TABLE IF NOT EXISTS wkr_jobs (id bigserial PRIMARY KEY, mint text NOT NULL, bot text NOT NULL, text text NOT NULL, votes int NOT NULL DEFAULT 1, ip text,
        status text NOT NULL DEFAULT 'open', work bigint, at timestamptz NOT NULL DEFAULT now(), done_at timestamptz)`,
      `CREATE INDEX IF NOT EXISTS wkr_jobs_mint ON wkr_jobs(mint, status, votes DESC, id)`,
      `CREATE TABLE IF NOT EXISTS wkr_votes (job bigint NOT NULL, ip text NOT NULL, PRIMARY KEY (job, ip))`,
      `CREATE TABLE IF NOT EXISTS wkr_log (id bigserial PRIMARY KEY, kind text NOT NULL, mint text, text text NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS wkr_state (id int PRIMARY KEY, cycle int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(), lock_at timestamptz,
        shots_day date, shots int NOT NULL DEFAULT 0, vids_day date, vids int NOT NULL DEFAULT 0, talk_day date, talk int NOT NULL DEFAULT 0)`,
    ]) await q(st);
    await q(`INSERT INTO wkr_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  })().catch(e => { made = null; throw e; });
  return made;
}
const DAILY_TALK = Math.max(1, Number(process.env.DAILY_TALK) || 4000);       // the house's text budget per UTC day
async function spendTalk(n = 1) {
  const r = await q(`UPDATE wkr_state SET talk = CASE WHEN talk_day = (now() AT TIME ZONE 'utc')::date THEN talk + $2 ELSE $2 END, talk_day = (now() AT TIME ZONE 'utc')::date
    WHERE id=1 AND (talk_day IS DISTINCT FROM (now() AT TIME ZONE 'utc')::date OR talk < $1) RETURNING talk`, [DAILY_TALK, n]);
  return r.length > 0;
}
const log = (kind, mint, text) => q('INSERT INTO wkr_log (kind, mint, text) VALUES ($1,$2,$3)', [kind, mint || null, String(text).slice(0, 300)]).catch(() => {});



// ---------- the studio: FLUX (Black Forest Labs) for the photos, a small OpenAI model for the captions, both through
// Vercel's AI Gateway (OIDC from the request, or a key if one is set) ----------
const MODEL = (process.env.CAPTION_MODEL || 'openai/gpt-4.1-mini').trim();
const DAILY_SHOTS = Math.max(1, Number(process.env.DAILY_SHOTS) || 240);       // the house's photo budget per UTC day
let OIDC = null;
const setOidc = req => { const t = req && req.headers && req.headers['x-vercel-oidc-token']; if (t) OIDC = t; };
const gatewayToken = () => process.env.AI_GATEWAY_API_KEY || OIDC || process.env.VERCEL_OIDC_TOKEN || null;
async function ai(messages, maxTokens = 220, ms = 20000) {
  if (MOCK && MOCK.ai) return MOCK.ai(messages);
  const token = gatewayToken();
  if (!token) return { ok: false, error: 'no token' };
  try {
    const r = await getJson('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: .95, messages }) }, ms);
    const c = r.json && r.json.choices && r.json.choices[0], text = c && c.message && c.message.content;
    if (!text) return { ok: false, status: r.status, error: String((r.json && r.json.error && (r.json.error.message || r.json.error.type)) || r.text || '').slice(0, 200) };
    return { ok: true, text: String(text) };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 200) }; }
}
// one photo. ref: the character's own portrait (base64 JPEG), so the same face comes back in a new scene. With a portrait
// it goes through the images/edits endpoint (FLUX.2 [pro] first, FLUX Kontext second); without one, plain generation.
const IMG_EDIT = (process.env.IMG_MODELS || 'bfl/flux-2-pro,bfl/flux-kontext-pro').split(',').map(s => s.trim()).filter(Boolean);
let lastImgError = null;
async function photo(prompt, ref, ms = 50000, size = null) {
  if (MOCK && MOCK.photo) return MOCK.photo(prompt, ref);
  const token = gatewayToken();
  if (!token) return { ok: false, error: 'no token' };
  const t0 = Date.now(), left = () => Math.max(10000, ms - (Date.now() - t0));
  if (ref) {
    for (const model of IMG_EDIT) {
      if (Date.now() - t0 > ms - 12000) break;
      try {
        const fd = new FormData();
        fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1'); fd.append('response_format', 'b64_json');
        fd.append('image', new Blob([Buffer.from(ref, 'base64')], { type: 'image/jpeg' }), 'face.jpg'); if (size) fd.append('size', size);
        const r = await fetch('https://ai-gateway.vercel.sh/v1/images/edits', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd, signal: AbortSignal.timeout(left()) });
        const j = await r.json().catch(() => null), d = j && j.data && j.data[0];
        if (d && d.b64_json) return { ok: true, buf: Buffer.from(d.b64_json, 'base64'), model, ref: true };
        lastImgError = model + ' edit: ' + String((j && j.error && (j.error.message || j.error.type)) || r.status).slice(0, 200);
      } catch (e) { lastImgError = model + ': ' + String(e && e.message).slice(0, 160); }
    }
    return { ok: false, error: lastImgError || 'no image' };
  }
  try {
    const r = await getJson('https://ai-gateway.vercel.sh/v1/images/generations', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ model: 'bfl/flux-2-pro', prompt, n: 1, response_format: 'b64_json', ...(size ? { size } : {}), providerOptions: { blackForestLabs: { outputFormat: 'jpeg', safetyTolerance: 2 } } }) }, left());
    const d = r.json && r.json.data && r.json.data[0];
    if (d && d.b64_json) return { ok: true, buf: Buffer.from(d.b64_json, 'base64'), model: 'bfl/flux-2-pro', ref: false };
    lastImgError = String((r.json && r.json.error && (r.json.error.message || r.json.error.type)) || r.status).slice(0, 200);
  } catch (e) { lastImgError = String(e && e.message).slice(0, 160); }
  return { ok: false, error: lastImgError || 'no image' };
}
// a day's budget, counted in the database so every function instance shares it
async function spendShot() {
  const r = await q(`UPDATE wkr_state SET shots = CASE WHEN shots_day = (now() AT TIME ZONE 'utc')::date THEN shots + 1 ELSE 1 END, shots_day = (now() AT TIME ZONE 'utc')::date
    WHERE id=1 AND (shots_day IS DISTINCT FROM (now() AT TIME ZONE 'utc')::date OR shots < $1) RETURNING shots`, [DAILY_SHOTS]);
  return r.length > 0;
}

// ---------- the camera: image-to-video through the AI Gateway's video API. Start a job, then ask for its status; the
// finished MP4 is kept in the database so the page can play it and the creator can download it. ----------
const VID_MODELS = (process.env.VIDEO_MODELS || 'bytedance/seedance-v1.0-pro-fast,alibaba/wan-v2.6-i2v-flash').split(',').map(s => s.trim()).filter(Boolean);
const DAILY_VIDS = Math.max(1, Number(process.env.DAILY_VIDS) || 80);         // the house's video budget per UTC day
const GW_AI = 'https://ai-gateway.vercel.sh/v4/ai';
let lastVidError = null;
function gwHeaders(model) {
  return { 'content-type': 'application/json', authorization: 'Bearer ' + gatewayToken(), 'ai-gateway-protocol-version': '0.0.1',
    'ai-gateway-auth-method': process.env.AI_GATEWAY_API_KEY ? 'api-key' : 'oidc', 'ai-video-model-specification-version': '4', 'ai-model-id': model };
}
const errText = r => String((r.json && r.json.error && (r.json.error.message || r.json.error.type || r.json.error)) || (r.json && r.json.message) || r.text || r.status).slice(0, 260);
async function videoStart(prompt, jpegB64, opt = {}) {
  if (MOCK && MOCK.videoStart) return MOCK.videoStart(prompt, opt);
  if (!gatewayToken()) return { ok: false, error: 'no token' };
  for (const model of (opt.models || VID_MODELS)) {
    const body = { prompt, n: 1, aspectRatio: '9:16', duration: opt.duration || 5, generateAudio: false,
      frameImages: [{ image: { type: 'file', mediaType: 'image/jpeg', data: jpegB64 }, frameType: 'first_frame' }] };
    if (opt.resolution) body.resolution = opt.resolution;
    try {
      const r = await getJson(GW_AI + '/video-model/start', { method: 'POST', headers: gwHeaders(model), body: JSON.stringify(body) }, 30000);
      if (r.ok && r.json && r.json.operation != null) return { ok: true, model, operation: r.json.operation };
      lastVidError = model + ': ' + errText(r);
    } catch (e) { lastVidError = model + ': ' + String(e && e.message).slice(0, 200); }
  }
  return { ok: false, error: lastVidError || 'no video model answered' };
}
async function videoStatus(model, operation) {
  if (MOCK && MOCK.videoStatus) return MOCK.videoStatus(operation);
  try {
    const r = await getJson(GW_AI + '/video-model/status', { method: 'POST', headers: gwHeaders(model), body: JSON.stringify({ operation }) }, 25000);
    const j = r.json || {};
    if (j.status === 'completed') return { ok: true, status: 'completed', video: (j.videos || [])[0] || null };
    if (j.status === 'error' || j.status === 'cancelled') return { ok: true, status: 'error', error: String(j.error || j.status).slice(0, 260) };
    if (j.status === 'pending') return { ok: true, status: 'pending' };
    return { ok: false, error: errText(r) };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 200) }; }
}
async function videoBytes(v) {
  if (!v) return null;
  if (MOCK && MOCK.videoBytes) return MOCK.videoBytes(v);
  if (v.type === 'base64' && v.data) return Buffer.from(v.data, 'base64');
  if (v.type === 'url' && v.url) { const r = await fetch(v.url, { signal: AbortSignal.timeout(40000) }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
  return null;
}
// Higgsfield (api.higgsfield.ai), used first when its key is set in the project's environment as HF_CREDENTIALS
// ("KEY_ID:KEY_SECRET"): image-to-video with DoP from the portrait's public URL. Without a key, the AI Gateway films.
const HF = (process.env.HF_CREDENTIALS || (process.env.HF_API_KEY && process.env.HF_API_SECRET ? process.env.HF_API_KEY + ':' + process.env.HF_API_SECRET : '')).trim();
const HF_MODEL = (process.env.HF_VIDEO_MODEL || 'dop-turbo').trim();
async function hfStart(prompt, imageUrl) {
  if (!HF) return { ok: false, error: 'no higgsfield key' };
  try {
    const r = await getJson('https://api.higgsfield.ai/v1/image2video/dop', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Key ' + HF },
      body: JSON.stringify({ model: HF_MODEL, prompt, input_images: [{ type: 'image_url', image_url: imageUrl }] }) }, 30000);
    const id = r.json && (r.json.request_id || r.json.id);
    if (r.ok && id) return { ok: true, model: 'higgsfield/' + HF_MODEL, operation: { hf: id } };
    return { ok: false, error: 'higgsfield: ' + errText(r) };
  } catch (e) { return { ok: false, error: 'higgsfield: ' + String(e && e.message).slice(0, 200) }; }
}
async function hfStatus(id) {
  try {
    const r = await getJson('https://api.higgsfield.ai/requests/' + encodeURIComponent(id) + '/status', { headers: { authorization: 'Key ' + HF } }, 20000);
    const j = r.json || {};
    if (j.status === 'completed') { const u = (j.video && j.video.url) || (j.videos && j.videos[0] && j.videos[0].url) || (j.jobs && j.jobs[0] && j.jobs[0].results && j.jobs[0].results.raw && j.jobs[0].results.raw.url); return { ok: true, status: 'completed', video: u ? { type: 'url', url: u } : null }; }
    if (['failed', 'nsfw', 'cancelled', 'canceled'].includes(j.status)) return { ok: true, status: 'error', error: j.status };
    if (['queued', 'in_progress', 'pending', 'processing'].includes(j.status)) return { ok: true, status: 'pending' };
    return { ok: false, error: errText(r) };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 200) }; }
}
async function spendVid() {
  const r = await q(`UPDATE wkr_state SET vids = CASE WHEN vids_day = (now() AT TIME ZONE 'utc')::date THEN vids + 1 ELSE 1 END, vids_day = (now() AT TIME ZONE 'utc')::date
    WHERE id=1 AND (vids_day IS DISTINCT FROM (now() AT TIME ZONE 'utc')::date OR vids < $1) RETURNING vids`, [DAILY_VIDS]);
  return r.length > 0;
}

// ---------- the house rules every thought is screened against ----------
const BANNED = /\b(guarantee[ds]?|100x|1000x|10x|financial advice|not financial advice|nfa|to the moon|mooning|moon soon|pump(ing|s)?|dump|rug|buy now|ape in|price target|will go up|cant lose|can't lose|risk[- ]free)\b/i;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function scrub(t, n) {
  t = clean(t, 600).replace(/https?:\/\/\S+/gi, '').replace(/@(\w)/g, '$1').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
}
function parseJson(text) { const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; } }

const isAddr = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const metaId = mint => String(mint).slice(0, 12);
function origin(req) { const h = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'; const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(h) ? 'http' : 'https'); return proto + '://' + h; }

module.exports = {
  UA, SOL, send, CACHE, query, body, ip, limited, getJson, rpc, rpcRaw, pool, remember, forget,
  isAddr, metaId, origin, b58enc, b58dec, pda, SYSTEM, STUDIO, YOURS, PARENT, HOUSE, sharesOf,
  PUMP, PUMP_FEES, bondingCurveOf, sharingConfigOf, vaultOf, RENT0, accounts, RPC_URL, solPrice, q, ready, dbReady, log,
  setOidc, gatewayToken, ai, photo, spendShot, spendTalk, DAILY_TALK, MODEL, IMG_EDIT, DAILY_SHOTS, MOCK, BANNED, clean, scrub, parseJson,
  videoStart, videoStatus, videoBytes, spendVid, DAILY_VIDS, VID_MODELS, lastVidError: () => lastVidError, HF: !!HF, hfStart, hfStatus,
};
