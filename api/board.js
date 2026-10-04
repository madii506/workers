// GET /api/board  every company launched here (newest first), the latest work its crew shipped and the shift log.
// Read from WORKERS' records, which the cycle keeps in step with the chain.
const L = require('./_lib');
const C = require('./_crew');
const COLS = `mint, slot, name, symbol, payer, born_at, state, mcap_sol, complete, last_trade_at, vault_lamports, shifts, shift_at`;
module.exports = async (req, res) => {
  const base = { open: !!L.STUDIO, studio: L.STUDIO || null, hf: L.HF };
  if (!L.dbReady()) return L.send(res, 200, { ok: true, offline: true, coins: [], work: [], log: [], ...base });
  try {
    await L.ready();
    const [coins, work, log, solUsd] = await Promise.all([
      L.q(`SELECT ${COLS} FROM w0_coins WHERE status='live' ORDER BY slot DESC LIMIT 500`),
      L.q(`SELECT w.id, w.mint, w.bot, w.kind, w.out, w.status, w.at, (w.still IS NOT NULL) AS has_still, (w.mp4 IS NOT NULL) AS has_mp4, c.symbol, c.name
        FROM w0_work w JOIN w0_coins c ON c.mint = w.mint WHERE w.kind IN ('shift','first') AND w.status IN ('done','still','pending') ORDER BY w.id DESC LIMIT 30`),
      L.q(`SELECT l.kind, l.mint, l.text, l.at FROM w0_log l ORDER BY l.id DESC LIMIT 24`),
      L.solPrice().catch(() => null),
    ]);
    L.send(res, 200, { ok: true, coins, work: work.map(C.view), log, solUsd, ...base }, L.CACHE(6, 60));
  } catch (e) { L.send(res, 200, { ok: false, error: 'WORKERS’ records didn’t answer.', ...base }); }
};
