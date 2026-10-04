// GET /api/cycle  one cycle of WORKERS, run by a schedule (safe for anyone to call: it locks, and runs at most once per
// 25 minutes; the video check runs every call). It finishes launches the page didn't see through, voids ones that never
// landed, reads every coin from the chain, runs the next shift for every company that's due (one every six hours while
// its coin trades, twelve once it's quiet for a day, none after a quiet week) and collects finished videos.
const L = require('./_lib');
const C = require('./_crew');
const PER_CYCLE = 3;
module.exports = async (req, res) => {
  L.setOidc(req);
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'records offline' });
  try {
    await L.ready();
    const pend = await L.q(`SELECT id, mint, kind, bot, model, op, status, polled_at, at FROM w0_work WHERE status='pending' ORDER BY id LIMIT 8`);
    let done = 0; await L.pool(pend, 4, async v => { const r = await C.poll(v); if (r.status === 'done') done++; });
    const got = await L.q(`UPDATE w0_state SET lock_at=now() WHERE id=1 AND (lock_at IS NULL OR lock_at < now() - interval '3 minutes') AND next_at <= now() RETURNING cycle`);
    if (!got.length) return L.send(res, 200, { ok: true, skipped: true, pending: pend.length, done });
    const cycle = got[0].cycle + 1, out = { ok: true, cycle, settled: 0, voided: 0, shifts: 0, done };
    try {
      for (const p of await L.q(`SELECT mint FROM w0_coins WHERE status='pending' AND created_at > now() - interval '3 hours'`)) { const r = await C.settle(p.mint).catch(() => null); if (r && r.live) out.settled++; }
      const v = await L.q(`UPDATE w0_coins SET status='void', img=NULL WHERE status='pending' AND created_at <= now() - interval '3 hours' RETURNING mint`); out.voided = v.length;
      const r = await C.readBoard(); out.coins = r.coins; out.changes = r.changes;
      const due = await L.q(`SELECT mint, name, symbol, voice, look, img FROM w0_coins WHERE status='live' AND img IS NOT NULL AND (
          (state IN ('awake','ascended') AND (shift_at IS NULL OR shift_at < now() - interval '6 hours')) OR
          (state = 'rot' AND (shift_at IS NULL OR shift_at < now() - interval '12 hours')))
        ORDER BY shift_at NULLS FIRST LIMIT ${PER_CYCLE}`);
      await L.pool(due, 3, async k => { const s = await C.shift(k, L.origin(req)); if (s.ok) out.shifts++; else out.why = s.why || s.error; });
      await L.q(`UPDATE w0_work SET still=NULL, mp4=NULL, out=NULL, status='gone' WHERE kind='test' AND at < now() - interval '2 days' AND status<>'gone'`).catch(() => {});
    } finally {
      await L.q(`UPDATE w0_state SET cycle=$1, lock_at=NULL, next_at=now() + interval '25 minutes' WHERE id=1`, [cycle]);
    }
    L.send(res, 200, out);
  } catch (e) { L.send(res, 200, { ok: false, error: String(e && e.message || e).slice(0, 200) }); }
};
