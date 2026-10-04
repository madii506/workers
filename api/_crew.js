// WORKERS: every coin launched here is a company with a crew of six small AI bots. This file is the crew: who they are,
// what each one ships, the shift the cycle runs every six hours while a coin trades, and the reading of every coin from
// the chain. Words come from a small OpenAI model, pictures from FLUX (with the coin's own picture as the reference),
// videos from Higgsfield when its key is set (the AI Gateway's video models otherwise).
const L = require('./_lib');
const DAY = 864e5;

const BOTS = {
  CTO: { job: 'runs the crew', art: 34, scene: 27 },
  CLIP: { job: 'TikToks with Higgsfield', art: 35, scene: 28 },
  YAP: { job: 'X posts', art: 36, scene: 29 },
  MEME: { job: 'memes + art', art: 37, scene: 30 },
  DEV: { job: 'builds the site', art: 38, scene: 31 },
  MOD: { job: 'answers holders', art: 39, scene: 32 },
};
const TAKES = ['YAP', 'MEME', 'CLIP', 'DEV'];            // the bots that take jobs off the board
const WHAT = { YAP: 'three X posts', MEME: 'a meme', CLIP: 'a TikTok', DEV: 'a site update', CTO: 'the plan', MOD: 'an answer' };
const RULES = 'House rules: no financial advice, no price predictions, no promises of gains, never tell anyone to buy or sell, never say "100x", "moon" or "guaranteed", no real or famous people, no known characters, nothing sexual, no links.';
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------- the chain: a launch is born once pump.fun shows its split locked exactly as recorded ----------
async function routingOf(mint) {
  if (L.MOCK && L.MOCK.routing) return L.MOCK.routing(mint);
  return require('./_pump').routing(mint, L.accounts);
}
const sameShares = (got, want) => got.length === want.length && want.every((w, i) => got[i].address === w.address && got[i].bps === w.bps);
async function settle(mint) {
  const k = (await L.q('SELECT mint, symbol, status, slot, shares FROM wkr_coins WHERE mint=$1', [mint]))[0];
  if (!k) return { ok: false, error: 'No coin was recorded for that token.' };
  if (k.status === 'live') return { ok: true, live: true, slot: k.slot };
  if (k.status === 'void') return { ok: true, live: false, void: true };
  const r = await routingOf(mint);
  if (!r.exists) return { ok: true, live: false, waiting: 'coin' };
  const shares = typeof k.shares === 'string' ? JSON.parse(k.shares) : k.shares;
  if (!(r.routed && r.revoked && sameShares(r.shareholders, shares))) return { ok: true, live: false, waiting: 'split', mint };
  for (let i = 0; i < 4; i++) {
    try {
      const u = await L.q(`UPDATE wkr_coins SET status='live', slot=(SELECT coalesce(max(slot),-1)+1 FROM wkr_coins WHERE status='live'), born_at=now(), state=$4,
        last_trade_at=now(), mcap_sol=$2, complete=$3 WHERE mint=$1 AND status<>'live' RETURNING slot`, [mint, r.mcapSol, !!r.complete, r.complete ? 'ascended' : 'awake']);
      if (u.length) await L.log('born', mint, `$${k.symbol} opened for business. The crew clocked in.`);
      const s = (await L.q('SELECT slot FROM wkr_coins WHERE mint=$1', [mint]))[0];
      return { ok: true, live: true, slot: s && s.slot };
    } catch (e) { if (!/unique|duplicate/i.test(String(e && e.message))) throw e; }
  }
  return { ok: true, live: false, waiting: 'slot' };
}
async function lastTrade(mint) {
  if (L.MOCK && L.MOCK.lastTrade) return L.MOCK.lastTrade(mint);
  const r = await L.rpc('getSignaturesForAddress', [L.bondingCurveOf(mint), { limit: 1, commitment: 'confirmed' }]).catch(() => null);
  return r && r[0] && r[0].blockTime ? new Date(r[0].blockTime * 1000) : null;
}
// awake while it trades; a day without a trade and it slows ('rot'); seven days and the crew clocks out ('dead')
const stateFor = (k, now) => k.complete ? 'ascended' : !k.last_trade_at ? 'awake' : now - new Date(k.last_trade_at) >= 7 * DAY ? 'dead' : now - new Date(k.last_trade_at) >= DAY ? 'rot' : 'awake';
async function readBoard() {
  const ks = await L.q(`SELECT mint, symbol, state, mcap_sol, complete, last_trade_at FROM wkr_coins WHERE status='live' ORDER BY slot`);
  const vaults = ks.length ? await L.accounts(ks.map(k => L.vaultOf(k.mint))).catch(() => ks.map(() => null)) : [];
  const curves = ks.length ? await L.accounts(ks.map(k => L.bondingCurveOf(k.mint))).catch(() => ks.map(() => null)) : [];
  const now = Date.now(); let changes = 0;
  await L.pool(ks, 6, async (k, i) => {
    let mcap = k.mcap_sol, complete = k.complete;
    if (L.MOCK && L.MOCK.routing) { const r = await L.MOCK.routing(k.mint); mcap = r.mcapSol; complete = !!r.complete; }
    else if (curves[i]) { try { const { PUMP_SDK } = require('@pump-fun/pump-sdk'); const bc = PUMP_SDK.decodeBondingCurve(curves[i]); const vq = bc.virtualSolReserves || bc.virtualQuoteReserves, vt = bc.virtualTokenReserves; complete = !!bc.complete; if (vt && !vt.isZero()) mcap = Number(vq.mul(bc.tokenTotalSupply).div(vt).toString()) / 1e9; } catch {} }
    const vl = vaults[i] ? Math.max(0, vaults[i].lamports - L.RENT0) : 0;
    const t = complete ? null : await lastTrade(k.mint);
    const last = t && (!k.last_trade_at || t > new Date(k.last_trade_at)) ? t : k.last_trade_at;
    const st = stateFor({ ...k, complete, last_trade_at: last }, now);
    if (st !== k.state) { changes++; await L.log(st, k.mint, `$${k.symbol} ${st === 'rot' ? 'is quiet: the crew works slower' : st === 'dead' ? 'went quiet for a week: the crew clocked out' : st === 'ascended' ? 'graduated: its curve is complete' : 'is trading again: the crew is back on shift'}`); }
    await L.q(`UPDATE wkr_coins SET mcap_sol=$2, complete=$3, last_trade_at=$4, state=$5, vault_lamports=$6 WHERE mint=$1`, [k.mint, mcap, complete, last, st, vl]);
  });
  return { coins: ks.length, changes };
}

// ---------- words ----------
const ctx = k => `The memecoin ${k.name} ($${k.symbol}). What it is, in its creator's words: """${L.clean(k.voice, 400)}""".${k.look ? ' Its picture shows: ' + L.clean(k.look, 300) + '.' : ''}`;
// when the house's AI credits run dry, every bot says so plainly instead of pretending
const BREAK = 'The crew is on a break: the house’s AI credits are being topped up. Try again soon.';
const broke = e => /credit balance|top-?up|insufficient|payment required|quota/i.test(String(e || ''));
async function talk(system, user, max = 300) {
  if (!(await L.spendTalk())) return { ok: false, error: 'Today’s budget for words is spent. It resets at 00:00 UTC.', budget: true };
  const r = await L.ai([{ role: 'system', content: system }, { role: 'user', content: user }], max, 20000);
  if (!r.ok && broke(r.error)) return { ok: false, error: BREAK, budget: true };
  return r;
}
async function describe(jpeg) {
  const r = await L.ai([{ role: 'user', content: [{ type: 'text', text: 'Describe the main character, mascot or logo in this image in under 30 words: what it is, colours, vibe.' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpeg.toString('base64') } }] }], 90, 15000).catch(() => null);
  return r && r.ok ? L.clean(r.text, 300) : null;
}
const fallbackPlan = k => [
  { bot: 'YAP', job: `Three posts that introduce $${k.symbol}` },
  { bot: 'MEME', job: `A meme of $${k.symbol} clocking in for its first shift` },
  { bot: 'DEV', job: `Build $${k.symbol}’s page` },
];
// CTO: reads the board and plans the next three jobs, one bot each
async function cto(k, jobs = [], strict = false) {
  const open = jobs.slice(0, 8).map(j => `- for ${j.bot}: ${L.clean(j.text, 140)} (${j.votes} votes)`).join('\n');
  const r = await talk(`You are CTO, the lead bot of a small AI crew that runs the memecoin company ${k.name} ($${k.symbol}). ${ctx(k)} Your crew: YAP writes X posts, MEME makes memes, CLIP films TikToks, DEV builds the coin's site, MOD answers holders. ${RULES}`,
    `Plan the crew's next three jobs. ${open ? 'Holders posted these jobs:\n' + open + '\nPrefer the most-voted. ' : ''}Reply with JSON only: {"plan":[{"bot":"YAP|MEME|CLIP|DEV","job":"one short line under 90 characters"}]} with exactly three items, each for a different bot.`, 260);
  if (strict && !r.ok) return { ok: false, error: r.budget ? r.error : 'CTO didn’t plan this time. Try again.' };
  const j = r.ok ? L.parseJson(r.text) : null;
  let plan = (j && Array.isArray(j.plan) ? j.plan : []).map(p => ({ bot: String(p.bot || '').toUpperCase().trim(), job: L.scrub(String(p.job || '').replace(/\*/g, ''), 100) }))
    .filter(p => TAKES.includes(p.bot) && p.job.length > 4 && !L.BANNED.test(p.job));
  plan = plan.filter((p, i) => plan.findIndex(q => q.bot === p.bot) === i).slice(0, 3);
  if (plan.length < 3) for (const f of fallbackPlan(k)) if (plan.length < 3 && !plan.some(p => p.bot === f.bot)) plan.push(f);
  return { ok: true, out: { plan } };
}
// YAP: three X posts
async function yap(k, brief) {
  const r = await talk(`You are YAP, the bot that writes the X posts for the memecoin company ${k.name} ($${k.symbol}). ${ctx(k)} Voice: funny, short, confident, crypto-native, never cringe. ${RULES}`,
    `${brief ? 'The job: ' + L.clean(brief, 160) + '. ' : ''}Write three different X posts, each under 220 characters, each with $${k.symbol} once. At most one hashtag and one emoji per post, no links. Reply with JSON only: {"posts":["...","...","..."]}`, 420);
  if (r.budget) return { ok: false, error: r.error };
  const j = r.ok ? L.parseJson(r.text) : null;
  const posts = (j && Array.isArray(j.posts) ? j.posts : []).map(p => L.scrub(String(p).replace(/\*/g, '').replace(/^"|"$/g, ''), 260)).filter(p => p.length > 10 && !L.BANNED.test(p)).slice(0, 3);
  if (!posts.length) return { ok: false, error: 'YAP came up empty. Try again.' };
  return { ok: true, out: { posts } };
}
// DEV: the coin's page (the words on it)
async function dev(k, brief) {
  const r = await talk(`You are DEV, the bot that builds the website for the memecoin company ${k.name} ($${k.symbol}). ${ctx(k)} Write like a sharp landing page: short, bold, funny. Never invent a team, partners, listings, a roadmap or numbers. ${RULES}`,
    `${brief ? 'The job: ' + L.clean(brief, 160) + '. ' : ''}Write the page. Reply with JSON only: {"headline":"under 48 characters","tagline":"under 90 characters","about":"two sentences under 260 characters","points":["three short lines under 70 characters each"],"cta":"button text under 20 characters"}`, 360);
  if (r.budget) return { ok: false, error: r.error };
  const j = r.ok ? L.parseJson(r.text) : null;
  if (!j || !j.headline) return { ok: false, error: 'DEV’s build failed. Try again.' };
  const site = { headline: L.scrub(j.headline, 60), tagline: L.scrub(j.tagline, 110), about: L.scrub(j.about, 300), points: (Array.isArray(j.points) ? j.points : []).map(p => L.scrub(p, 90)).filter(Boolean).slice(0, 3), cta: L.scrub(j.cta, 24) || 'Read more' };
  if (L.BANNED.test([site.headline, site.tagline, site.about, ...site.points, site.cta].join(' '))) return { ok: false, error: 'DEV’s draft broke the house rules, so it was thrown out. Try again.' };
  return { ok: true, out: site };
}
// MOD: answers a holder
async function mod(k, question) {
  const qn = L.clean(question, 240);
  const r = await talk(`You are MOD, the bot that answers holders' questions for the memecoin company ${k.name} ($${k.symbol}). ${ctx(k)} Answer in under 280 characters, friendly and plain. If asked about price, gains, when to buy or sell, or anything financial, say you can't talk price and point them to the chart. Never invent facts about a team, partners, listings, a roadmap or numbers: if you don't know, say so. The coin's crew: CTO runs it, YAP writes X posts, MEME makes memes, CLIP films TikToks, DEV builds the site, and holders post jobs on the coin's job board. ${RULES}`,
    qn, 200);
  if (r.budget) return { ok: false, error: r.error };
  let a = r.ok ? L.scrub(String(r.text).replace(/\*/g, ''), 300) : '';
  if (!a) return { ok: false, error: 'MOD didn’t answer. Try again.' };
  if (L.BANNED.test(a)) a = `I can’t talk price. $${k.symbol} is ${L.clean(k.voice, 160)}. The chart is on its page.`;
  return { ok: true, out: { q: qn, a } };
}
// a holder's job, turned into one safe scene (no real people, no known characters, nothing sexual)
async function sceneOf(k, brief) {
  const r = await talk(`You turn a request into one short visual scene for an AI picture of the mascot of the memecoin ${k.name}. ${k.look ? 'The mascot: ' + L.clean(k.look, 200) + '. ' : ''}Refuse anything with real or famous people, known cartoon, game or film characters, brand logos, minors, gore or anything sexual.`,
    `Request: """${L.clean(brief, 200)}""". Reply with JSON only: {"ok":true,"scene":"what the mascot is doing and where, under 30 words"} or {"ok":false}`, 120);
  if (!r.ok) return { error: r.budget ? r.error : 'The crew didn’t read that job. Try again.' };
  const j = L.parseJson(r.text);
  if (!j || !j.ok || !j.scene) return { refused: true };
  const sc = L.clean(j.scene, 220); return L.BANNED.test(sc) ? { refused: true } : { scene: sc };
}

// ---------- pictures ----------
const MEME_SCENES = [
  'sits at a tiny office desk wearing an orange construction hard hat, typing on a laptop with intense focus',
  'operates a big yellow crane that lifts a giant plain gold coin over a construction site',
  'stands at a podium at a serious press conference with dozens of microphones pointed at it',
  'lifts a heavy barbell made of plain gold coins in a gritty gym',
  'clocks in at an old punch-card machine at a factory gate at dawn',
  'drives a tiny forklift stacked with plain gold coins through a warehouse',
  'drinks coffee from a huge mug on a steel beam high above the city, legs dangling',
  'gives a dramatic thumbs up in front of a huge fireworks show',
];
const KEEP_MEME = ' Keep the character or logo from the image exactly as it is: same shape, colours and features. A funny viral meme photo, photorealistic, square, sharp detail, dramatic lighting. No words or letters anywhere, no captions, no logos other than the one from the image, no watermark.';
const TRENDS = [
  { name: 'the walk-in', scene: 'walks confidently toward the camera down a neon-lit city street at night, a viral TikTok walk-in', motion: 'It struts toward the camera with swagger as the camera slowly pulls back, neon lights flicker.' },
  { name: 'the dance', scene: 'does a viral TikTok dance in a bedroom lit by pink and blue LED strips and a ring light', motion: 'It dances to the beat with bouncy, funny moves while the camera holds steady.' },
  { name: 'the vlog', scene: 'wears an orange construction hard hat on a busy building site at sunrise, holding a coffee, vlog style', motion: 'It sips the coffee and waves at the camera while workers move behind it, handheld vlog camera.' },
  { name: 'the reaction', scene: 'reacts with a shocked face to something on a phone, sitting on a couch in ring-light glow', motion: 'Its eyes go wide and it leans toward the camera in shock, quick push-in.' },
  { name: 'the unboxing', scene: 'opens a big glowing box on a table as sparkles fly out, cozy room', motion: 'It lifts the lid, sparkles burst out, it looks at the camera amazed.' },
  { name: 'the crash zoom', scene: 'stands on a rooftop at golden hour with the city behind it, dramatic pose', motion: 'A fast crash zoom into its face as the wind blows, dramatic.' },
];
const KEEP_CLIP = ' Keep the character or logo from the image exactly as it is: same shape, colours and features. A vertical 9:16 TikTok video still, photorealistic, funny viral energy, sharp detail. No words or letters anywhere, no captions, no logos other than the one from the image, no watermark.';
async function meme(k, refB64, brief) {
  if (!refB64) return { ok: false, error: 'MEME needs the coin’s picture.' };
  let scene = null;
  if (brief) { const so = await sceneOf(k, brief); if (so.error) return { ok: false, error: so.error }; if (!so.scene) return { ok: false, refused: true, error: 'MEME passed on that job: it breaks the house rules.' }; scene = so.scene; }
  if (!(await L.spendShot())) return { ok: false, error: 'Today’s picture budget is spent. It resets at 00:00 UTC.' };
  const prompt = scene ? `Starring the exact character or logo from this image: ${scene}.` : `The exact character or logo from this image ${pick(MEME_SCENES)}.`;
  let ph = await L.photo(prompt + KEEP_MEME, refB64, 55000, '1024x1024');
  if (!ph.ok && /size|dimension|width|height/i.test(ph.error || '')) ph = await L.photo(prompt + KEEP_MEME, refB64, 50000);
  if (!ph.ok) return { ok: false, error: broke(ph.error) ? BREAK : 'The meme didn’t come out. Try again in a minute.', why: ph.error };
  const img = await require('sharp')(ph.buf, { limitInputPixels: 60e6 }).resize(1024, 1024, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { ok: true, still: img, model: ph.model, out: scene ? { scene } : {} };
}
async function caption(k, trend) {
  const r = await talk(`You are CLIP, the bot that films the TikToks for the memecoin ${k.name} ($${k.symbol}). ${ctx(k)} ${RULES}`,
    `Write the TikTok caption for ${trend.name} video: one punchy hook line under 110 characters, then three hashtags including #aigenerated, and $${k.symbol} once. Plain text only.`, 100);
  const t = r && r.ok ? L.scrub(String(r.text || '').replace(/^"|"$/g, '').replace(/#\$/g, '$').replace(/\*/g, ''), 180) : '';
  return t && !L.BANNED.test(t) ? t : `${trend.name}, starring $${k.symbol}. #aigenerated #fyp #memecoin`;
}
async function clipStill(k, refB64, brief) {
  if (!refB64) return { ok: false, error: 'CLIP needs the coin’s picture.' };
  let trend = pick(TRENDS);
  if (brief) { const so = await sceneOf(k, brief); if (so.error) return { ok: false, error: so.error }; if (!so.scene) return { ok: false, refused: true, error: 'CLIP passed on that job: it breaks the house rules.' }; trend = { name: 'a holder’s idea', scene: so.scene, motion: 'It moves naturally through the scene, handheld phone video, lively and funny.' }; }
  if (!(await L.spendShot())) return { ok: false, error: 'Today’s picture budget is spent. It resets at 00:00 UTC.' };
  const prompt = `The exact character or logo from this image ${trend.scene}.` + KEEP_CLIP;
  let ph = await L.photo(prompt, refB64, 55000, '768x1344');
  if (!ph.ok && /size|dimension|width|height/i.test(ph.error || '')) ph = await L.photo(prompt, refB64, 50000);
  if (!ph.ok) return { ok: false, error: broke(ph.error) ? BREAK : 'CLIP’s shot didn’t come out. Try again in a minute.', why: ph.error };
  const img = await require('sharp')(ph.buf, { limitInputPixels: 60e6 }).resize(720, 1280, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const cap = await caption(k, trend);
  return { ok: true, still: img, model: ph.model, trend, out: { trend: trend.name, caption: cap } };
}
// the video: Higgsfield first when its key is set (it needs the still's public address), the AI Gateway otherwise
async function startVideo(trend, still, imageUrl) {
  if (!(await L.spendVid())) return { ok: false, error: 'Today’s video budget is spent. It resets at 00:00 UTC.' };
  const prompt = `${trend.motion} Keep everything in the image the same, including the character or logo. Photorealistic vertical phone video, natural motion, no text, no captions.`;
  let s = L.HF && imageUrl ? await L.hfStart(prompt, imageUrl) : { ok: false };
  if (!s.ok) s = await L.videoStart(prompt, still.toString('base64'), { resolution: '720x1280' });
  if (!s.ok && /resolution/i.test(s.error || '')) s = await L.videoStart(prompt, still.toString('base64'));
  if (!s.ok) { const money = /balance|credit|payment|quota/i.test(s.error || ''); return { ok: false, error: money ? 'Videos open soon: the video credits aren’t loaded yet. The still is ready.' : 'The camera didn’t start this time. The still is ready.', why: s.error }; }
  return { ok: true, model: s.model, operation: s.operation };
}
async function poll(v) {
  if (v.status !== 'pending') return v;
  if (v.polled_at && Date.now() - new Date(v.polled_at) < 3000) return v;
  await L.q(`UPDATE wkr_work SET polled_at=now() WHERE id=$1`, [v.id]);
  const op = typeof v.op === 'string' ? JSON.parse(v.op) : v.op;
  const st = String(v.model || '').startsWith('higgsfield/') ? await L.hfStatus(op && op.hf) : await L.videoStatus(v.model, op);
  const old = Date.now() - new Date(v.at);
  const still = async err => { await L.q(`UPDATE wkr_work SET status='still', err=$2 WHERE id=$1`, [v.id, String(err || '').slice(0, 200)]); return { ...v, status: 'still' }; };
  if (!st.ok) return old > 15 * 60000 ? still(st.error) : v;
  if (st.status === 'pending') return old > 20 * 60000 ? still('timed out') : v;
  if (st.status === 'error') return still(st.error);
  const buf = await L.videoBytes(st.video).catch(() => null);
  if (!buf || buf.length < 1000) return still('empty video');
  await L.q(`UPDATE wkr_work SET status='done', mp4=$2, done_at=now(), op=NULL WHERE id=$1 AND status='pending'`, [v.id, buf]);
  return { ...v, status: 'done', has_mp4: true };
}

// ---------- one piece of work, kept as a row ----------
function view(w) {
  const out = typeof w.out === 'string' ? JSON.parse(w.out) : (w.out || {});
  return { id: Number(w.id), bot: w.bot, kind: w.kind, mint: w.mint || null, brief: w.brief || null, out, status: w.status,
    still: w.has_still ? '/api/crew?s=' + w.id : null, url: w.status === 'done' && w.has_mp4 ? '/api/crew?v=' + w.id : null, at: w.at, symbol: w.symbol, name: w.name };
}
async function work({ k, bot, brief = null, kind, mint = null, refB64 = null, site = null, job = null }) {
  let r;
  if (bot === 'YAP') r = await yap(k, brief);
  else if (bot === 'DEV') r = await dev(k, brief);
  else if (bot === 'CTO') r = await cto(k, [], kind === 'test');
  else if (bot === 'MOD') r = await mod(k, brief || `What is $${k.symbol}?`);
  else if (bot === 'MEME') r = await meme(k, refB64, brief);
  else if (bot === 'CLIP') r = await clipStill(k, refB64, brief);
  else return { ok: false, error: 'No such bot.' };
  if (!r.ok) return r;
  const ins = await L.q(`INSERT INTO wkr_work (mint, kind, bot, brief, job, out, still, model, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, at`,
    [mint, kind, bot, brief ? L.clean(brief, 200) : null, job, JSON.stringify(r.out || {}), r.still || null, r.model || null, r.still ? 'still' : 'done']);
  const id = ins[0].id; let status = r.still ? 'still' : 'done', note = null;
  if (bot === 'CLIP') {
    const v = await startVideo(r.trend, r.still, site ? site + '/api/crew?s=' + id : null);
    if (v.ok) { await L.q(`UPDATE wkr_work SET status='pending', model=$2, op=$3 WHERE id=$1`, [id, v.model, JSON.stringify(v.operation)]); status = 'pending'; }
    else note = v.error;
  }
  if (bot === 'DEV' && mint) await L.q(`UPDATE wkr_coins SET site=$2 WHERE mint=$1`, [mint, JSON.stringify(r.out)]);
  return { ok: true, ...view({ id, bot, kind, mint, brief, out: r.out, status, at: ins[0].at, has_still: !!r.still }), filming: status === 'pending', note };
}
// which bot an "anyone" job goes to: CTO reads it
function route(text) {
  const t = String(text).toLowerCase();
  if (/tiktok|video|film|clip|reel|dance/.test(t)) return 'CLIP';
  if (/meme|picture|image|art|draw|banner|pfp|sticker|photo/.test(t)) return 'MEME';
  if (/site|page|website|landing|copy|headline/.test(t)) return 'DEV';
  return 'YAP';
}
const refOf = k => (k.img ? Buffer.from(k.img).toString('base64') : null);
// a shift: the top job holders posted, or the CTO's own plan when the board is empty
async function shift(k, site) {
  const jobs = await L.q(`SELECT id, bot, text, votes FROM wkr_jobs WHERE mint=$1 AND status='open' ORDER BY votes DESC, id LIMIT 8`, [k.mint]);
  let p;
  if (jobs.length) { const j = jobs[0]; p = { bot: j.bot === 'ANY' ? route(j.text) : j.bot, brief: j.text, job: j.id }; await L.q(`UPDATE wkr_jobs SET status='taken' WHERE id=$1`, [j.id]); }
  else {
    const recent = (await L.q(`SELECT bot FROM wkr_work WHERE mint=$1 AND kind IN ('shift','first') ORDER BY id DESC LIMIT 3`, [k.mint])).map(r => r.bot);
    const plan = (await cto(k, [])).out.plan; const q = plan.find(x => !recent.includes(x.bot)) || plan[0];
    p = { bot: q.bot, brief: q.job, job: null };
  }
  const r = await work({ k, bot: p.bot, brief: p.brief, kind: 'shift', mint: k.mint, refB64: refOf(k), site, job: p.job });
  if (p.job) await L.q(`UPDATE wkr_jobs SET status=$2, work=$3, done_at=now() WHERE id=$1`, [p.job, r.ok ? 'done' : r.refused ? 'refused' : 'open', r.ok ? r.id : null]);
  await L.q(`UPDATE wkr_coins SET shift_at=now(), shifts=shifts+$2 WHERE mint=$1`, [k.mint, r.ok ? 1 : 0]);
  if (r.ok) await L.log('shift', k.mint, `${p.bot} shipped ${WHAT[p.bot]} for $${k.symbol}${p.job ? ', a holder’s job' : ''}`);
  else if (r.refused) await L.log('refused', k.mint, `${p.bot} passed on a job for $${k.symbol}: it broke the house rules`);
  return r;
}
// a fresh coin's first shift: DEV builds its page, YAP writes the launch posts, MEME makes the first meme
async function first(k, site) {
  const [d, y] = await Promise.all([
    work({ k, bot: 'DEV', kind: 'first', mint: k.mint }),
    work({ k, bot: 'YAP', brief: 'launch day: the company just opened and the crew clocked in', kind: 'first', mint: k.mint }),
  ]);
  const m = await work({ k, bot: 'MEME', kind: 'first', mint: k.mint, refB64: refOf(k), site });
  const n = [d, y, m].filter(x => x.ok).length;
  await L.q(`UPDATE wkr_coins SET shift_at=now(), shifts=shifts+$2 WHERE mint=$1`, [k.mint, n]);
  if (n) await L.log('shift', k.mint, `First shift for $${k.symbol}: ${[d.ok && 'DEV built the page', y.ok && 'YAP wrote the launch posts', m.ok && 'MEME made the first meme'].filter(Boolean).join(', ')}`);
  return { ok: n > 0, work: [d, y, m].filter(x => x.ok), error: n ? null : (d.error || y.error || m.error) };
}
module.exports = { BOTS, TAKES, WHAT, settle, routingOf, readBoard, describe, cto, yap, dev, mod, meme, clipStill, work, poll, view, shift, first, route };
