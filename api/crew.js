// GET  /api/crew?art=N   the house's pictures of the crew (made once with FLUX and kept)
// GET  /api/crew?w=N     one piece of work: what it is, and its video once filmed
// GET  /api/crew?s=N     its picture (JPEG)      GET /api/crew?v=N  its video (MP4, byte ranges)
// POST /api/crew {draft:{name,symbol,line}, image?, desk:true}   the trial shift's desk work, all at once: CTO's plan,
//      YAP's posts, DEV's page and MOD's first answer. Free, a few an hour.
// POST /api/crew {draft, image, look?, bot:'MEME'|'CLIP'}       the trial shift's picture work
// POST /api/crew {mint}   a freshly launched coin's first shift (once)
const L = require('./_lib');
const C = require('./_crew');
async function picture(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 3e6) return null;
  return require('sharp')(buf, { animated: false, limitInputPixels: 40e6 }).resize(768, 768, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
const IMM = 'public, max-age=86400, s-maxage=31536000, immutable';
async function serveMp4(req, res, id) {
  const r = await L.q(`SELECT mp4 FROM wkr_work WHERE id=$1 AND status='done' AND mp4 IS NOT NULL`, [id]);
  if (!r.length) { res.statusCode = 404; return res.end(); }
  const buf = Buffer.from(r[0].mp4), size = buf.length, range = String(req.headers.range || '');
  res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', IMM);
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const a = m[1] === '' ? size - Number(m[2]) : Number(m[1]), z = m[2] === '' || m[1] === '' ? size - 1 : Math.min(size - 1, Number(m[2]));
    if (a < 0 || a >= size || z < a) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + size); return res.end(); }
    res.statusCode = 206; res.setHeader('Content-Range', `bytes ${a}-${z}/${size}`); res.setHeader('Content-Length', z - a + 1); return res.end(buf.subarray(a, z + 1));
  }
  res.statusCode = 200; res.setHeader('Content-Length', size); return res.end(buf);
}
// a crew portrait on black, cut out: the black around the bot becomes transparent (flood-filled from the edges, so the
// bot's own dark face screen stays), with a soft edge
async function cutout(buf) {
  const sharp = require('sharp');
  const { data, info } = await sharp(buf).trim({ background: '#000000', threshold: 42 }).extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#000000' })
    .resize({ height: 900, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h, mx = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) mx[i] = Math.max(data[j], data[j + 1], data[j + 2]);
  const bg = new Uint8Array(n), stack = new Int32Array(n); let sp = 0;
  const push = i => { if (!bg[i] && mx[i] < 46) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) { const i = stack[--sp], x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  const out = Buffer.alloc(n * 4);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) { out[k] = data[j]; out[k + 1] = data[j + 1]; out[k + 2] = data[j + 2]; out[k + 3] = bg[i] ? Math.min(255, Math.max(0, (mx[i] - 14) * 8)) : 255; }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 84, alphaQuality: 90 }).toBuffer();
}
function jpeg(res, buf, cache) { res.statusCode = 200; res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', cache); return res.end(Buffer.from(buf)); }
function draftOf(d) {
  const k = { name: L.clean(d && d.name, 32) || 'this coin', symbol: (L.clean(d && d.symbol, 10).replace(/^\$/, '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'COIN'), voice: L.clean(d && d.line, 300) };
  if (k.voice.length < 8) return { error: 'Write the one line first: what the coin is.' };
  if (L.BANNED.test(k.name + ' ' + k.symbol + ' ' + k.voice)) return { error: 'That pitch breaks the house rules. Try another.' };
  return { k };
}
module.exports = async (req, res) => {
  L.setOidc(req);
  const qy = L.query(req);
  try {
    if (req.method === 'GET' && qy.art) {
      const n = Number(qy.art);
      if (!(n >= 27 && n <= 39)) { res.statusCode = 404; return res.end(); }
      let r = [];
      if (L.dbReady()) r = await L.q('SELECT img FROM t0_brand WHERE n=$1', [100 + n]).catch(() => []);
      if (!r.length) { res.statusCode = 302; res.setHeader('Location', '/assets/img/b' + n + (n >= 34 ? '.webp' : '.jpg')); res.setHeader('Cache-Control', 'public, max-age=300'); return res.end(); }
      if (n < 34) return jpeg(res, r[0].img, IMM);
      const cut = await cutout(Buffer.from(r[0].img)).catch(() => null);
      if (!cut) return jpeg(res, r[0].img, IMM);
      res.statusCode = 200; res.setHeader('Content-Type', 'image/webp'); res.setHeader('Cache-Control', IMM); return res.end(cut);
    }
    if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'WORKERS’ records are offline. Try again shortly.' });
    await L.ready();
    if (req.method === 'GET') {
      if (qy.v && /^\d{1,12}$/.test(String(qy.v))) return serveMp4(req, res, String(qy.v));
      if (qy.s && /^\d{1,12}$/.test(String(qy.s))) {
        const r = await L.q('SELECT still FROM wkr_work WHERE id=$1 AND still IS NOT NULL', [String(qy.s)]);
        if (!r.length) { res.statusCode = 404; return res.end(); }
        return jpeg(res, r[0].still, IMM);
      }
      const id = String(qy.w || '');
      if (!/^\d{1,12}$/.test(id)) return L.send(res, 200, { ok: false, error: 'No such work.' });
      let v = (await L.q(`SELECT id, mint, kind, bot, brief, out, model, op, status, polled_at, at, (still IS NOT NULL) AS has_still, (mp4 IS NOT NULL) AS has_mp4 FROM wkr_work WHERE id=$1`, [id]))[0];
      if (!v) return L.send(res, 200, { ok: false, error: 'No such work.' });
      v = await C.poll(v);
      return L.send(res, 200, { ok: true, ...C.view(v) });
    }
    if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
    const b = await L.body(req, 4.2 * 1024 * 1024);
    if (b.tooBig) return L.send(res, 200, { ok: false, error: 'That picture is too big. Try a smaller one.' });
    const site = L.origin(req);
    if (b.draft) {
      const d = draftOf(b.draft); if (d.error) return L.send(res, 200, { ok: false, error: d.error });
      const k = d.k;
      const pic = b.image ? await picture(b.image).catch(() => null) : null;
      await L.q(`UPDATE wkr_work SET still=NULL, mp4=NULL, out=NULL, status='gone' WHERE kind='test' AND at < now() - interval '2 days' AND status<>'gone'`).catch(() => {});
      if (b.desk) {
        if (L.limited('desk:' + L.ip(req), 6, 3600000)) return L.send(res, 200, { ok: false, error: 'Six trial shifts an hour. Launch it and the crew keeps working on its own.' });
        k.look = pic ? await C.describe(pic) : null;
        const [plan, posts, page, ans] = await Promise.all([
          C.work({ k, bot: 'CTO', kind: 'test' }), C.work({ k, bot: 'YAP', kind: 'test' }), C.work({ k, bot: 'DEV', kind: 'test' }),
          C.work({ k, bot: 'MOD', brief: `What is $${k.symbol}, in one breath?`, kind: 'test' }),
        ]);
        return L.send(res, 200, { ok: true, look: k.look, CTO: plan, YAP: posts, DEV: page, MOD: ans });
      }
      const bot = String(b.bot || '');
      if (bot !== 'MEME' && bot !== 'CLIP') return L.send(res, 200, { ok: false, error: 'No such bot.' });
      if (!pic) return L.send(res, 200, { ok: false, error: 'Add the coin’s picture first (PNG, JPG, WebP or GIF).' });
      if (L.limited('pic:' + bot + ':' + L.ip(req), 4, 3600000)) return L.send(res, 200, { ok: false, error: `Four trial ${bot === 'MEME' ? 'memes' : 'TikToks'} an hour. Launch it and the crew keeps going.` });
      k.look = L.clean(b.look, 300) || null;
      return L.send(res, 200, await C.work({ k, bot, kind: 'test', refB64: pic.toString('base64'), site }));
    }
    const mint = String(b.mint || '');
    if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That isn’t a token address.' });
    if (L.limited('first:' + mint, 2, 600000)) return L.send(res, 200, { ok: false, error: 'The crew is already on it.' });
    const k = (await L.q(`SELECT mint, name, symbol, voice, look, img, status FROM wkr_coins WHERE mint=$1`, [mint]))[0];
    if (!k || k.status !== 'live') return L.send(res, 200, { ok: false, error: 'It isn’t launched yet.' });
    const any = await L.q(`SELECT id FROM wkr_work WHERE mint=$1 LIMIT 1`, [mint]);
    if (any.length) return L.send(res, 200, { ok: true, already: true });
    L.send(res, 200, await C.first(k, site));
  } catch (e) { L.send(res, 200, { ok: false, error: 'The crew didn’t answer. Try again.', why: String(e && e.message).slice(0, 160) }); }
};
