// GET  /api/job?mint=               a company's job board: open jobs by votes, and the latest done
// POST /api/job {mint, bot, text}   post a job for the crew (bot: YAP, MEME, CLIP, DEV or ANY: CTO routes it)
// POST /api/job {vote: id}          one vote per person per job
// POST /api/job {mint, ask}         ask MOD a question (answers aren't kept)
const L = require('./_lib');
const C = require('./_crew');
const BOTS = new Set([...C.TAKES, 'ANY']);
module.exports = async (req, res) => {
  L.setOidc(req);
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'WORKERS’ records are offline.' });
  try {
    await L.ready();
    if (req.method === 'GET') {
      const mint = String(L.query(req).mint || '');
      if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a token address.' });
      const [open, done] = await Promise.all([
        L.q(`SELECT id, bot, text, votes, status, at FROM wkr_jobs WHERE mint=$1 AND status IN ('open','taken') ORDER BY votes DESC, id LIMIT 30`, [mint]),
        L.q(`SELECT id, bot, text, votes, status, work, done_at FROM wkr_jobs WHERE mint=$1 AND status IN ('done','refused') ORDER BY done_at DESC NULLS LAST LIMIT 12`, [mint]),
      ]);
      return L.send(res, 200, { ok: true, open, done }, L.CACHE(4, 30));
    }
    if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
    const b = await L.body(req, 8192), who = L.ip(req);
    if (b.vote != null) {
      const id = String(b.vote); if (!/^\d{1,12}$/.test(id)) return L.send(res, 200, { ok: false, error: 'No such job.' });
      if (L.limited('vote:' + who, 40, 600000)) return L.send(res, 200, { ok: false, error: 'Too many votes. Wait a few minutes.' });
      const ins = await L.q(`INSERT INTO wkr_votes (job, ip) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING job`, [id, who]);
      if (!ins.length) return L.send(res, 200, { ok: false, error: 'You already voted for that one.' });
      const r = await L.q(`UPDATE wkr_jobs SET votes=votes+1 WHERE id=$1 AND status='open' RETURNING votes`, [id]);
      return L.send(res, 200, r.length ? { ok: true, votes: r[0].votes } : { ok: false, error: 'That job is already taken.' });
    }
    const mint = String(b.mint || '');
    if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a token address.' });
    const k = (await L.q(`SELECT mint, name, symbol, voice, look, status, state FROM wkr_coins WHERE mint=$1`, [mint]))[0];
    if (!k || k.status !== 'live') return L.send(res, 200, { ok: false, error: 'That company isn’t open yet.' });
    if (b.ask != null) {
      const ask = L.clean(b.ask, 240);
      if (ask.length < 3) return L.send(res, 200, { ok: false, error: 'Ask MOD something.' });
      if (L.limited('ask:' + who, 10, 600000)) return L.send(res, 200, { ok: false, error: 'MOD needs a breather: ten questions per ten minutes.' });
      const r = await C.mod(k, ask);
      return L.send(res, 200, r.ok ? { ok: true, q: r.out.q, a: r.out.a } : r);
    }
    const bot = String(b.bot || 'ANY').toUpperCase(), text = L.clean(b.text, 140);
    if (!BOTS.has(bot)) return L.send(res, 200, { ok: false, error: 'Pick a bot for the job.' });
    if (text.length < 8) return L.send(res, 200, { ok: false, error: 'Describe the job in a few words.' });
    if (L.BANNED.test(text) || /https?:\/\//i.test(text)) return L.send(res, 200, { ok: false, error: 'That job breaks the house rules.' });
    if (L.limited('job:' + who, 5, 3600000)) return L.send(res, 200, { ok: false, error: 'Five jobs an hour from here. Vote on the others meanwhile.' });
    const open = await L.q(`SELECT count(*)::int AS n FROM wkr_jobs WHERE mint=$1 AND status='open'`, [mint]);
    if (open[0].n >= 60) return L.send(res, 200, { ok: false, error: 'The board is full. Vote for a job that’s already up.' });
    const r = await L.q(`INSERT INTO wkr_jobs (mint, bot, text, ip) VALUES ($1,$2,$3,$4) RETURNING id, bot, text, votes, status, at`, [mint, bot, text, who]);
    await L.q(`INSERT INTO wkr_votes (job, ip) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r[0].id, who]);
    L.send(res, 200, { ok: true, job: r[0] });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The job board didn’t answer. Try again.', why: String(e && e.message).slice(0, 160) }); }
};
