// GET /api/ping  is everything WORKERS needs answering? The database, the AI Gateway token, the house wallet, Higgsfield.
const L = require('./_lib');
module.exports = async (req, res) => {
  L.setOidc(req);
  const out = { ok: true, db: L.dbReady(), ai: !!L.gatewayToken(), open: !!L.STUDIO, models: L.VID_MODELS, hf: L.HF };
  if (out.db) { try { await L.ready(); const s = (await L.q('SELECT vids, vids_day, shots, shots_day, talk, talk_day FROM w0_state WHERE id=1'))[0]; out.today = s; } catch (e) { out.db = false; out.why = String(e && e.message).slice(0, 120); } }
  L.send(res, 200, out);
};
