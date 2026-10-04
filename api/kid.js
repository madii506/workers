// GET /api/kid?mint=  one company: its record (its one line is public), the page DEV built, the work its crew shipped,
// its job board and what happened to it.
const L = require('./_lib');
const C = require('./_crew');
const COLS = `mint, slot, name, symbol, voice, xhandle, payer, shares, born_at, status, state, mcap_sol, complete, last_trade_at, vault_lamports, created_at, site, shifts, shift_at`;
module.exports = async (req, res) => {
  const mint = String(L.query(req).mint || '').trim();
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a token address.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'WORKERS’ records are offline.' });
  try {
    await L.ready();
    const k = (await L.q(`SELECT ${COLS} FROM wkr_coins WHERE mint=$1`, [mint]))[0];
    if (!k || k.status === 'void') return L.send(res, 200, { ok: false, missing: true, error: 'No company lives at that address.' }, L.CACHE(10));
    const [work, jobs, log] = await Promise.all([
      L.q(`SELECT id, mint, bot, kind, brief, out, status, at, (still IS NOT NULL) AS has_still, (mp4 IS NOT NULL) AS has_mp4 FROM wkr_work WHERE mint=$1 AND status IN ('done','still','pending') ORDER BY id DESC LIMIT 40`, [mint]),
      L.q(`SELECT id, bot, text, votes, status, at FROM wkr_jobs WHERE mint=$1 AND status IN ('open','taken') ORDER BY votes DESC, id LIMIT 30`, [mint]),
      L.q(`SELECT kind, text, at FROM wkr_log WHERE mint=$1 ORDER BY id DESC LIMIT 20`, [mint]),
    ]);
    L.send(res, 200, { ok: true, coin: k, work: work.map(C.view), jobs, log, studio: L.STUDIO || null, hf: L.HF }, L.CACHE(5, 60));
  } catch (e) { L.send(res, 200, { ok: false, error: 'WORKERS’ records didn’t answer.' }); }
};
