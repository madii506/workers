// WORKERS home: the wordmark with the crew around it, the org chart, the trial shift (a real shift before launch), the
// launch, the floor (work the crews shipped), the companies, payroll, questions. Nothing here is made up: before the first
// company opens, the floor and the list say so.
(function () {
  'use strict';
  const C = window.Core, X = window.Cross, L = window.Live, W = window.Crew;
  const { $, $$, esc } = C;
  const calm = C.calm;
  const st = { image: null, look: null, busy: false, born: null, open: null, board: null, sort: 'new' };
  const status = (el, t, bad) => { el.textContent = t || ''; el.classList.toggle('bad', !!bad); };

  // ---------- page one: the wordmark letter by letter, the hard hat drops onto its W, the crew stands around it ----------
  $('#mark').innerHTML = [...'WORKERS'].map((ch, i) => i === 0 ? `<span class="w" style="--i:${i}">${ch}${W.HAT}</span>` : `<span style="--i:${i}">${ch}</span>`).join('');
  $('#bots').innerHTML = W.BOTS.map(b => `<div class="bot b-${b.k}"><div class="c" tabindex="0"><span class="say">${esc(b.say)}</span><div class="fl"><div class="ph"><img src="${W.art(b.art)}" alt="${b.k}, ${esc(b.job)}" draggable="false"></div></div><b>${b.k}</b><small>${esc(b.job)}</small></div></div>`).join('');
  if (!calm && matchMedia('(pointer:fine)').matches) {
    const bots = $$('.bot'), hero = $('.hero'); let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    hero.addEventListener('mousemove', e => { const r = hero.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - .5; ty = (e.clientY - r.top) / r.height - .5; if (!raf) raf = requestAnimationFrame(step); });
    function step() { cx += (tx - cx) * .08; cy += (ty - cy) * .08; bots.forEach((b, i) => { const d = (i % 3 + 1) * 7; b.style.translate = `${(-cx * d).toFixed(2)}px ${(-cy * d).toFixed(2)}px`; }); raf = Math.abs(tx - cx) + Math.abs(ty - cy) > .001 ? requestAnimationFrame(step) : 0; }
  }

  // ---------- the tape: the shift log when there is one, the crew's jobs before that ----------
  function tape(log) {
    const items = (log && log.length ? log.slice(0, 14).map(l => `<span>${esc(l.text)} <b>· ${C.ago(new Date(l.at))}</b></span>`) : W.BOTS.map(b => `<span><b>${b.k}</b> ${esc(b.job)}</span>`));
    const el = $('#tape'); el.innerHTML = items.join('') + items.join('');
    el.style.setProperty('--dur', Math.max(30, items.length * 6) + 's');
  }
  tape(null);

  // ---------- 01 the crew: an org chart, CTO on top ----------
  const node = b => `<div class="node" data-bot="${b.k}" tabindex="0" role="button" aria-label="${b.k}: ${esc(b.job)}"><div class="art"><img src="${W.art(b.art)}" alt="" loading="lazy"></div><b>${b.k}</b><span class="jb">${esc(b.job)}</span><p>${esc(b.what)}</p><span class="more">on the job →</span></div>`;
  $('#org').innerHTML = `<svg class="lines" aria-hidden="true"></svg><div class="lead">${node(W.BOTS[0])}</div><div class="row5">${W.BOTS.slice(1).map(node).join('')}</div>`;
  function lines() {
    const org = $('#org'), svg = org.querySelector('svg'), R = org.getBoundingClientRect();
    if (getComputedStyle(svg).display === 'none') return;
    const lead = org.querySelector('.lead .node').getBoundingClientRect(), kids = $$('.row5 .node', org).map(n => n.getBoundingClientRect());
    const sx = lead.left + lead.width / 2 - R.left, sy = lead.bottom - R.top + 4, by = kids[0].top - R.top - 30, rr = 18;
    let d = '', dots = '';
    kids.forEach(k => { const x = k.left + k.width / 2 - R.left, ey = k.top - R.top - 2; const dir = Math.sign(x - sx);
      d += dir === 0 ? `M${sx},${sy} V${ey} ` : `M${sx},${sy} V${by - rr} Q${sx},${by} ${sx + dir * rr},${by} H${x - dir * rr} Q${x},${by} ${x},${by + rr} V${ey} `;
      dots += `<circle cx="${x}" cy="${ey}" r="4.5"/>`; });
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    svg.innerHTML = `<path d="${d}"/>${dots}<circle cx="${sx}" cy="${sy}" r="4.5"/>`;
    const p = svg.querySelector('path'); try { p.style.setProperty('--len', Math.ceil(p.getTotalLength())); } catch {}
  }
  addEventListener('load', lines); addEventListener('resize', () => { clearTimeout(lines.t); lines.t = setTimeout(lines, 120); });
  $$('#org img').forEach(i => i.addEventListener('load', lines, { once: true })); setTimeout(lines, 60);
  if ('IntersectionObserver' in window && !calm) { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { lines(); e.target.classList.add('shown'); io.disconnect(); } }), { rootMargin: '0px 0px -15% 0px' }); io.observe($('#org')); }
  else $('#org').classList.add('shown');
  document.addEventListener('click', e => {
    const n = e.target.closest('[data-bot]'); if (!n) return; const b = W.by(n.dataset.bot);
    C.sheet(b.k + ' · ' + b.job, `<img class="sheetimg" src="${W.art(b.scene)}" alt="${b.k} on the job"><p><b>What it ships.</b> ${esc(b.what)}</p><p><b>How.</b> ${esc(b.tech)}</p><div class="acts" style="margin-top:14px"><a class="btn sm" href="#trial" data-close>try the crew</a></div>`);
    const a = $('#sheetBody [data-close]'); if (a) a.addEventListener('click', () => C.closeSheet());
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.node')) { e.preventDefault(); e.target.click(); } });

  // ---------- 02 the trial shift ----------
  const ORDER = ['CTO', 'YAP', 'DEV', 'MOD', 'MEME', 'CLIP'];
  $('#board6').innerHTML = ORDER.map(k => { const b = W.by(k); return `<article class="job${k === 'DEV' || k === 'CLIP' ? ' wide' : ''}" id="j-${k}"><div class="jh"><img src="${W.art(b.art)}" alt=""><div><b>${k}</b><small>${esc(b.job)}</small></div><span class="chip"><i></i><em>waiting</em></span></div><div class="jb2"><p class="idle">${esc(b.say)}</p></div></article>`; }).join('');
  const card = k => $('#j-' + k);
  function setJob(k, mode, html, label) {
    const c = card(k); c.classList.remove('work', 'shipped', 'paused'); if (mode) c.classList.add(mode);
    c.querySelector('.chip em').textContent = label || ({ work: 'on it', shipped: 'shipped', paused: 'paused' }[mode] || 'waiting');
    if (html != null) c.querySelector('.jb2').innerHTML = html;
  }
  const working = k => setJob(k, 'work', k === 'MEME' ? '<div class="media sq skel"></div>' : k === 'CLIP' ? '<div class="media v skel"></div>' : '<div class="skel" style="height:22px"></div><div class="skel" style="height:22px;width:80%"></div><div class="skel" style="height:22px;width:60%"></div>');
  const drop = $('#drop'), picIn = $('#pic'), picNote = $('#picNote'), nm = $('#nm'), tk = $('#tk'), line = $('#line'), deskStatus = $('#deskStatus'), clockBtn = $('#clockBtn');
  picIn.addEventListener('change', () => {
    const f = picIn.files && picIn.files[0]; if (!f) return;
    if (f.size > 12e6) { picNote.textContent = 'too big'; return; }
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const s = Math.min(im.width, im.height), cv = document.createElement('canvas'); cv.width = cv.height = 768;
      const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 768, 768); x.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 768, 768);
      st.image = cv.toDataURL('image/jpeg', .9); st.look = null; URL.revokeObjectURL(url);
      drop.classList.add('has'); let p = drop.querySelector('img.pv'); if (!p) { p = document.createElement('img'); p.className = 'pv'; p.alt = ''; drop.prepend(p); } p.src = st.image;
      recap(); refreshGo();
    };
    im.onerror = () => { picNote.textContent = 'that file didn’t open'; URL.revokeObjectURL(url); };
    im.src = url;
  });
  let tickerTouched = false;
  nm.addEventListener('input', () => { if (!tickerTouched) tk.value = nm.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10); recap(); refreshGo(); });
  tk.addEventListener('input', () => { tickerTouched = !!tk.value; tk.value = tk.value.replace(/[^A-Za-z0-9$]/g, '').toUpperCase(); recap(); refreshGo(); });
  line.addEventListener('input', () => { recap(); refreshGo(); });
  const draft = () => ({ name: nm.value.trim(), symbol: tk.value.trim().replace(/^\$/, ''), line: line.value.trim() });
  $('#deskForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (st.busy) return;
    const d = draft();
    if (!d.name) return status(deskStatus, 'Give it a name first.', true);
    if (d.line.length < 8) return status(deskStatus, 'Write the one line: what the coin is.', true);
    st.busy = true; clockBtn.disabled = true; clockBtn.textContent = 'crew on shift…';
    status(deskStatus, st.image ? 'The crew clocked in. Words first, then the pictures.' : 'The crew clocked in. Add a picture and MEME and CLIP join too.');
    ['CTO', 'YAP', 'DEV', 'MOD'].forEach(working);
    if (st.image) { working('MEME'); working('CLIP'); } else { setJob('MEME', 'paused', '<p class="idle">MEME needs your coin’s picture. Add one and clock in again.</p>', 'needs a picture'); setJob('CLIP', 'paused', '<p class="idle">CLIP needs your coin’s picture too.</p>', 'needs a picture'); }
    const scroll = () => { if (innerWidth < 980) card('CTO').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }); };
    scroll();
    const jobs = [];
    jobs.push(C.post('/api/crew', { draft: d, image: st.image, desk: true }).then(r => {
      if (!r || !r.ok) { ['CTO', 'YAP', 'DEV', 'MOD'].forEach(k => setJob(k, 'paused', `<p class="idle">${esc((r && r.error) || 'The crew didn’t answer. Try again.')}</p>`)); return; }
      if (r.look) st.look = r.look;
      ['CTO', 'YAP', 'DEV', 'MOD'].forEach((k, i) => setTimeout(() => { const w = r[k]; if (w && w.ok) setJob(k, 'shipped', W.full(w)); else setJob(k, 'paused', `<p class="idle">${esc((w && w.error) || 'Nothing this time.')}</p>`); }, calm ? 0 : i * 260));
    }).catch(() => ['CTO', 'YAP', 'DEV', 'MOD'].forEach(k => setJob(k, 'paused', '<p class="idle">The crew didn’t answer. Try again.</p>'))));
    if (st.image) for (const k of ['MEME', 'CLIP']) {
      jobs.push(C.post('/api/crew', { draft: d, image: st.image, look: st.look, bot: k }).then(r => {
        if (!r || !r.ok) return setJob(k, 'paused', `<p class="idle">${esc((r && r.error) || 'Nothing this time.')}</p>`);
        if (k === 'CLIP' && r.filming) {
          setJob(k, 'work', W.full(r), 'filming');
          W.watchClip(r.id, j => { if (j && j.status === 'done') setJob(k, 'shipped', W.full(j)); else setJob(k, 'shipped', W.full({ ...r, status: 'still' }) + '<p class="cap">The video didn’t come out this time. The shot and caption are yours.</p>', 'shot shipped'); });
        } else setJob(k, 'shipped', W.full(r) + (k === 'CLIP' && r.note ? `<p class="cap">${esc(r.note)}</p>` : ''), k === 'CLIP' && r.note ? 'shot shipped' : 'shipped');
      }).catch(() => setJob(k, 'paused', '<p class="idle">Nothing this time. Try again.</p>')));
    }
    await Promise.allSettled(jobs);
    st.busy = false; clockBtn.disabled = false; clockBtn.textContent = 'clock in again';
    status(deskStatus, 'Shift done. Like the crew? Launch it below and they keep working.');
  });

  // ---------- 03 launch ----------
  const xh = $('#xh'), goBtn = $('#goBtn'), goStatus = $('#goStatus'), goProg = $('#goProg'), goRes = $('#goRes');
  const handle = () => xh.value.trim().replace(/^@/, '');
  const clip32 = s => { s = s.trim(); while (new TextEncoder().encode(s).length > 32) s = s.slice(0, -1); return s; };
  function recap() {
    const d = draft(), r = $('#recap');
    const ph = r.querySelector('img, .ph0'); if (st.image) { if (ph.tagName !== 'IMG') { const i = document.createElement('img'); i.alt = ''; ph.replaceWith(i); } r.querySelector('img').src = st.image; }
    $('#rcName').textContent = d.name ? `${d.name}${d.symbol ? ' · $' + d.symbol : ''}` : 'your company';
    $('#rcLine').textContent = d.line || 'Fill in the trial shift first: picture, name, one line.';
  }
  function splitShow() {
    const me = C.S.me || '\u0000you', H = '\u0000house';
    $('#split').innerHTML = X.sharesOf(me, H).map(r => `<div class="${r.address === me ? 'me' : ''}"><dt>${r.address === me ? 'you' : 'payroll · the crew'}</dt><dd>${r.bps / 100}%</dd></div>`).join('');
  }
  function refreshGo() {
    if (st.busyGo) return;
    if (st.open === false) { goBtn.disabled = true; goBtn.textContent = 'Launching opens soon'; return; }
    if (st.born) { goBtn.disabled = true; goBtn.textContent = 'launched ✓'; return; }
    goBtn.disabled = false; goBtn.textContent = C.S.me ? 'launch it' : 'Connect wallet to launch';
  }
  const buy = X.buyBox($('#buyBox'));
  C.onWallet(() => { splitShow(); refreshGo(); });
  async function firstShift(mint) {
    const box = $('#firstShift'); if (!box) return;
    box.innerHTML = '<p class="status">The crew is on its first shift: DEV builds the page, YAP writes the launch posts, MEME makes the first meme…</p>';
    let r = null; try { r = await C.post('/api/crew', { mint }); } catch {}
    if (!r || !r.ok) { box.innerHTML = `<p class="status">${esc((r && r.error) || 'The first shift comes with the next cycle.')}</p>`; return; }
    box.innerHTML = `<p class="ok">First shift done.</p>`;
  }
  goBtn.addEventListener('click', async () => {
    if (st.busyGo || st.born || st.open === false) return;
    if (!C.S.me) { await C.connect(); refreshGo(); return; }
    const d = draft(), name = clip32(d.name), symbol = d.symbol.toUpperCase();
    if (!st.image) return status(goStatus, 'Add your coin’s picture in the trial shift.', true);
    if (!name) return status(goStatus, 'Give it a name in the trial shift.', true);
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return status(goStatus, 'The ticker is 1–10 letters or numbers.', true);
    if (d.line.length < 8) return status(goStatus, 'Write the one line in the trial shift.', true);
    if (handle() && !/^[A-Za-z0-9_]{1,15}$/.test(handle())) return status(goStatus, 'That X handle doesn’t look right.', true);
    if (buy.over()) return status(goStatus, 'Up to 5 SOL in the first buy.', true);
    st.busyGo = true; goBtn.disabled = true; goBtn.textContent = 'launching…'; status(goStatus, ''); goRes.hidden = true;
    try {
      const r = await X.run({ name, symbol, line: d.line, x: handle(), image: st.image, devBuy: buy.lamports(), onStep: i => X.steps(goProg, i) });
      X.steps(goProg, 99, true);
      const live = r.settle && r.settle.live; st.born = r.mint;
      goRes.hidden = false;
      goRes.innerHTML = `<p class="ok">$${esc(symbol)} is ${live ? 'open for business. The crew clocked in.' : 'on pump.fun.'}</p>${r.buyNote ? `<p class="status">${esc(r.buyNote)}</p>` : ''}<div id="firstShift"></div><div class="acts"><a class="btn" href="/c/${r.mint}">its company page →</a><a class="btn line" href="https://pump.fun/coin/${r.mint}" target="_blank" rel="noopener">pump.fun ↗</a><a class="btn line" href="${C.solscan('tx', r.sig)}" target="_blank" rel="noopener">solscan ↗</a></div>`;
      C.toast('$' + symbol + ' is live.'); loadBoard(r.mint);
      if (live) firstShift(r.mint);
    } catch (e) {
      status(goStatus, C.human(e), true);
      if (e && e.mint) { goRes.hidden = false; goRes.innerHTML = `<div class="acts"><a class="btn" href="/c/${e.mint}">finish it on its page →</a></div>`; }
    } finally { st.busyGo = false; refreshGo(); }
  });

  // ---------- 04 the floor + 05 companies ----------
  const seen = new Set();
  function renderFloor() {
    const ws = ((st.board && st.board.work) || []).filter(w => w.bot !== 'MOD'), el = $('#floorGrid');
    if (!ws.length) { el.style.columns = 'auto'; el.innerHTML = `<div class="none"><img src="${W.art(33)}" alt="">${st.board && st.board.offline ? '<b>the records are offline</b>The floor fills in when they’re back.' : '<b>the floor is quiet</b>The first company’s crew ships here the minute it opens.'}</div>`; return; }
    el.style.columns = ''; let n = 0;
    el.innerHTML = ws.map(w => { const nw = !seen.has(w.id); seen.add(w.id); return W.tile(w, nw ? n++ : 0, nw); }).join('');
  }
  function renderCos(hit) {
    const ks = ((st.board && st.board.coins) || []).slice(), el = $('#coList'), sol = st.board && st.board.solUsd;
    if (st.sort === 'heavy') ks.sort((x, y) => (y.mcap_sol || 0) - (x.mcap_sol || 0) || y.slot - x.slot); else ks.sort((x, y) => y.slot - x.slot);
    if (!ks.length) { el.innerHTML = `<div class="none"><b>no companies yet</b>The first one on the list could be yours.</div>`; return; }
    el.innerHTML = ks.slice(0, 200).map(k => {
      const mc = k.mcap_sol != null ? (sol ? C.usd(k.mcap_sol * sol) : k.mcap_sol.toFixed(1) + ' SOL') : '—';
      return `<a class="co${k.mint === hit ? ' hit' : ''}" data-m="${k.mint}" href="/c/${k.mint}"><img src="/i/${k.mint}" alt="" loading="lazy"><span><b>$${esc(k.symbol)}</b><small>${esc(k.name)} · ${k.shifts || 0} jobs shipped</small></span><span class="st ${esc(k.state)}"><i></i>${esc(W.STATE[k.state] || k.state)}</span><span class="v">${mc}</span></a>`;
    }).join('');
  }
  $('#sorts').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.sort = b.dataset.s; $$('#sorts button').forEach(x => x.classList.toggle('on', x === b)); renderCos(); });
  if (L) { L.births(false); L.on('trade', t => { const c = document.querySelector(`.co[data-m="${t.mint}"]`); if (!c) return; c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); }); }
  async function loadBoard(hit) {
    let j = null; try { j = await C.get('/api/board'); } catch {}
    if (!j || !j.ok) { if (!st.board) { st.board = { offline: true }; renderFloor(); $('#coList').innerHTML = `<div class="none"><b>the records didn’t answer</b><button class="btn line sm" type="button" id="retryBoard">try again ↻</button></div>`; const r = $('#retryBoard'); if (r) r.onclick = () => loadBoard(); } return; }
    const first = !st.board || st.board.offline; st.board = j; if (j.open != null) st.open = j.open; refreshGo(); renderCos(hit); renderFloor();
    if (first || (j.log || []).length) tape(j.log);
    if (L) L.watch((j.coins || []).slice(0, 200).map(k => k.mint));
  }

  // ---------- 06 payroll: anyone can push waiting fees out ----------
  $('#payBtn').addEventListener('click', async () => {
    const el = $('#payStatus'); status(el, 'Building the payout…');
    try { const r = await X.feed(null); if (!r) return status(el, 'Connect a wallet to send it.'); status(el, 'Paid out ' + C.sol(r.waiting) + ' to its split.'); C.toast('Fees paid out.'); }
    catch (e) { status(el, C.human(e), true); }
  });

  splitShow(); refreshGo(); recap(); loadBoard();
  setInterval(() => { if (!document.hidden && !st.busyGo) loadBoard(); }, 20000);
  if (L) L.start();
})();
