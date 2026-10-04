// POST /api/settle {mint}  after a cross confirms, the page asks: is the child on Solana with its split locked, exactly
// as recorded? If so it is born now, and both parents start healing. Anyone may call it; it acts once per child.
const L = require('./_lib');
const X = require("./_crew");
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return L.send(res, 204, {});
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'WORKERS’ records are offline.' });
  const b = req.method === 'POST' ? await L.body(req, 4096) : L.query(req);
  const mint = String(b.mint || '');
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a coin address.' });
  if (L.limited('settle:' + L.ip(req), 40, 600000)) return L.send(res, 200, { ok: false, error: 'Too many checks. Wait a minute.' });
  try { await L.ready(); L.send(res, 200, await X.settle(mint)); }
  catch (e) { L.send(res, 200, { ok: false, error: 'The check didn’t finish. It happens by itself at the next cycle.' }); }
};
