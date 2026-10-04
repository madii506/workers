// WORKERS company page: the coin, the page DEV built for it, its crew, the job board (post a job, vote), MOD's desk, the
// work the crew shipped, the shift log and payroll. Read from WORKERS' records; nothing is made up.
(function () {
  'use strict';
  const C = window.Core, X = window.Cross, L = window.Live, W = window.Crew;
  const { $, $$, esc } = C;
  const mint = (location.pathname.match(/\/c\/([1-9A-HJ-NP-Za-km-z]{32,44})/) || [])[1] || new URLSearchParams(location.search).get('m');
  const app = $('#app');
  const st = { k: null, work: [], jobs: [], log: [], bot: 'ANY', voted: new Set(C.store.get('wk-votes') || []), sol: null };
  const status = (el, t, bad) => { if (!el) return; el.textContent = t || ''; el.classList.toggle('bad', !!bad); };
  const left = ms => { const h = Math.floor(ms / 36e5), m = Math.max(0, Math.round((ms % 36e5) / 6e4)); return h ? `${h}h ${m}m` : `${m}m`; };
  function nextShift(k) {
    if (k.state === 'dead') return 'clocked out';
    const gap = (k.state === 'rot' ? 12 : 6) * 36e5, at = k.shift_at ? new Date(k.shift_at).getTime() + gap : null;
    if (!at) return 'first shift soon'; const d = at - Date.now(); return d <= 0 ? 'next shift: due' : 'next shift in ' + left(d);
  }
  if (!mint) { app.innerHTML = `<section class="co-hero"><div class="wrap"><div class="none"><b>no company here</b><a class="btn sm" href="/">back to WORKERS</a></div></div></section>`; return; }

  function shell(k) {
    document.title = '$' + k.symbol + ' · WORKERS';
    const site = k.site || null, live = k.status === 'live';
    app.innerHTML = `
    <section class="co-hero"><div class="wrap">
      <div class="cohead reveal"><img src="/i/${k.mint}" alt="$${esc(k.symbol)}"><div><h1>$${esc(k.symbol)}</h1><div class="nm">${esc(k.name)} <span class="st ${esc(k.state)}" id="stChip"><i></i>${esc(live ? (W.STATE[k.state] || k.state) : 'not open yet')}</span></div></div></div>
      <div class="links reveal">${live ? `<a class="btn sm" href="https://pump.fun/coin/${k.mint}" target="_blank" rel="noopener">buy on pump.fun ↗</a><a class="btn line sm" href="https://dexscreener.com/solana/${k.mint}" target="_blank" rel="noopener">chart ↗</a>` : ''}${k.xhandle ? `<a class="btn line sm" href="https://x.com/${esc(k.xhandle)}" target="_blank" rel="noopener">X ↗</a>` : ''}<span class="ca"><span>${C.short(k.mint, 6)}</span><button type="button" id="caBtn">copy CA</button></span></div>
      ${live ? '' : `<div class="panel" style="margin-top:20px"><h3>almost open</h3><p class="status" id="finStatus">Its token is on pump.fun, but its split isn’t locked yet. The wallet that launched it can finish with one more signature.</p><div class="acts"><button class="btn sm" id="finBtn" type="button">finish it</button></div></div>`}
      <div class="built">
        <div class="reveal">${site ? `<div class="site"><div class="url"><i></i><i></i><i></i><span>built by DEV</span></div><div class="sx"><h4>${esc(site.headline)}</h4><p class="tg">${esc(site.tagline || '')}</p><p>${esc(site.about || '')}</p>${(site.points || []).length ? `<ul>${site.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div></div>` : `<div class="site"><div class="url"><i></i><i></i><i></i><span>DEV is on it</span></div><div class="sx"><h4>$${esc(k.symbol)}</h4><p class="tg">${esc(k.voice)}</p><p>DEV builds this page on the crew’s first shift.</p></div></div>`}</div>
        <div class="panel reveal" id="pay"><h3>payroll <small>locked at launch</small></h3><dl class="split" style="margin-top:12px">${(k.shares || []).map(s => `<div class="${s.address === k.payer ? 'me' : ''}"><dt>${s.address === k.payer ? 'the launcher' : 'payroll · the crew'}</dt><dd>${s.bps / 100}%</dd></div>`).join('')}</dl>
          <p class="status" id="vault">${k.vault_lamports > 0 ? C.sol(k.vault_lamports) + ' waiting to be paid out.' : 'Nothing waiting to be paid out right now.'}</p><div class="acts"><button class="btn line sm" id="feedBtn" type="button">pay out the fees</button></div></div>
      </div>
      <div class="crewrow stg">${W.BOTS.map(b => `<div class="cm"><img src="${W.art(b.art)}" alt=""><b>${b.k}</b><small>${esc(b.job)}</small></div>`).join('')}</div>
      <p class="status" id="nextShift" style="text-align:center;margin-top:14px">${live ? esc(nextShift(k)) : ''}</p>
    </div></section>
    <section class="sec" id="board"><div class="wrap"><div class="cols2">
      <div class="panel"><h3>job board <small>top vote goes next</small></h3>
        <div class="botpick" id="botpick">${['ANY', 'YAP', 'MEME', 'CLIP', 'DEV'].map(b => `<button type="button" data-b="${b}" class="${b === 'ANY' ? 'on' : ''}">${b === 'ANY' ? 'any bot' : b}</button>`).join('')}</div>
        <form class="jrow" id="jobForm" autocomplete="off"><input class="in" id="jobText" maxlength="140" placeholder="a meme of $${esc(k.symbol)} clocking in at 9am"><button class="btn sm" type="submit">post job</button></form>
        <p class="status" id="jobStatus"></p><ul class="jobs" id="jobs"></ul></div>
      <div class="panel" id="desk"><h3>ask MOD <small>never talks price</small></h3>
        <div class="qa" id="qa" style="margin-top:12px"><div class="a">Hey. I’m MOD. Ask me anything about $${esc(k.symbol)}.</div></div>
        <form class="ask" id="askForm" autocomplete="off"><input class="in" id="askText" maxlength="240" placeholder="what is this coin?"><button class="btn sm" type="submit">ask</button></form>
        <p class="status" id="askStatus"></p>
        <h3 style="margin-top:22px">shift log</h3><ul class="log" id="log"></ul></div>
    </div></div></section>
    <section class="sec" id="shipped"><div class="wrap"><p class="eye">shipped</p><h2 class="h2">The crew’s <em>work.</em></h2><div class="floor" id="workGrid"></div></div></section>`;
    $('#caBtn').onclick = () => C.copy(k.mint);
    $('#feedBtn').onclick = async () => { const el = $('#vault'); status(el, 'Building the payout…'); try { const r = await X.feed(k.mint); if (!r) return status(el, 'Connect a wallet to send it.'); status(el, 'Paid out ' + C.sol(r.waiting) + ' to the split.'); C.toast('Fees paid out.'); } catch (e) { status(el, C.human(e), true); } };
    const fin = $('#finBtn'); if (fin) fin.onclick = async () => { const el = $('#finStatus'); if (!C.S.me) { await C.connect(); if (!C.S.me) return; } status(el, 'Building it…'); try { await X.route(k.mint); status(el, 'Done. The company is open.'); setTimeout(() => location.reload(), 1200); } catch (e) { status(el, C.human(e), true); } };
    $('#botpick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.bot = b.dataset.b; $$('#botpick button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#jobForm').addEventListener('submit', async e => {
      e.preventDefault(); const el = $('#jobStatus'), t = $('#jobText').value.trim();
      if (t.length < 8) return status(el, 'Describe the job in a few words.', true);
      status(el, 'Posting…');
      const r = await C.post('/api/job', { mint: k.mint, bot: st.bot, text: t }).catch(() => null);
      if (!r || !r.ok) return status(el, (r && r.error) || 'It didn’t post. Try again.', true);
      $('#jobText').value = ''; status(el, 'Posted. Votes decide which job CTO takes next.'); st.voted.add(String(r.job.id)); C.store.set('wk-votes', [...st.voted].slice(-300)); loadJobs();
    });
    $('#jobs').addEventListener('click', async e => {
      const b = e.target.closest('.vote'); if (!b || b.classList.contains('on')) return; const id = b.dataset.id;
      b.classList.add('on'); const r = await C.post('/api/job', { vote: id }).catch(() => null);
      if (r && r.ok) { b.querySelector('b').textContent = r.votes; st.voted.add(id); C.store.set('wk-votes', [...st.voted].slice(-300)); }
      else { if (!(r && /already/.test(r.error || ''))) b.classList.remove('on'); C.toast((r && r.error) || 'The vote didn’t count. Try again.'); }
    });
    $('#askForm').addEventListener('submit', async e => {
      e.preventDefault(); const el = $('#askStatus'), q = $('#askText').value.trim(), qa = $('#qa');
      if (q.length < 3) return status(el, 'Ask MOD something.', true);
      qa.insertAdjacentHTML('beforeend', `<div class="q">${esc(q)}</div>`); $('#askText').value = ''; status(el, 'MOD is typing…');
      const r = await C.post('/api/job', { mint: k.mint, ask: q }).catch(() => null);
      status(el, ''); qa.insertAdjacentHTML('beforeend', `<div class="a">${esc(r && r.ok ? r.a : (r && r.error) || 'MOD didn’t answer. Try again.')}</div>`);
      qa.lastElementChild.scrollIntoView({ block: 'nearest', behavior: C.calm ? 'auto' : 'smooth' });
    });
    C.reveal(app);
  }
  function renderJobs() {
    const el = $('#jobs'); if (!el) return;
    if (!st.jobs.length) { el.innerHTML = `<li style="grid-template-columns:1fr"><p style="color:var(--mut)">No jobs up yet. Post the first one: CTO takes the top vote every shift.</p></li>`; return; }
    el.innerHTML = st.jobs.map(j => `<li class="${j.status === 'taken' ? 'taken' : ''}"><span class="bt">${esc(j.bot === 'ANY' ? 'ANY' : j.bot)}</span><p>${esc(j.text)}${j.status === 'taken' ? ' <small style="color:var(--or)">· on it now</small>' : ''}</p><button class="vote${st.voted.has(String(j.id)) ? ' on' : ''}" type="button" data-id="${j.id}" aria-label="Vote"><b>${j.votes}</b><span>▲</span></button></li>`).join('');
  }
  function renderWork() {
    const el = $('#workGrid'); if (!el) return;
    const ws = st.work.filter(w => w.bot !== 'MOD');
    if (!ws.length) { el.style.columns = 'auto'; el.innerHTML = `<div class="none"><img src="${W.art(33)}" alt=""><b>nothing shipped yet</b>The crew’s first shift lands here.</div>`; return; }
    el.style.columns = '';
    el.innerHTML = ws.map(w => `<div class="tile" style="cursor:default"><div class="tt"><img src="${W.art(W.by(w.bot).art)}" alt="">${w.bot}<span>${C.ago(new Date(w.at))}</span></div><div style="padding:0 12px 14px;display:grid;gap:10px">${w.brief && w.bot !== 'DEV' ? `<small style="color:var(--mut)">job: ${esc(w.brief)}</small>` : ''}${W.full({ ...w, symbol: st.k.symbol })}</div></div>`).join('');
    ws.filter(w => w.bot === 'CLIP' && w.status === 'pending').forEach(w => W.watchClip(w.id, j => { if (j && j.status === 'done') load(); }));
  }
  function renderLog() {
    const el = $('#log'); if (!el) return;
    el.innerHTML = st.log.length ? st.log.map(l => `<li><time>${C.ago(new Date(l.at))}</time><span>${esc(l.text)}</span></li>`).join('') : `<li><span style="color:var(--mut)">Nothing logged yet.</span></li>`;
  }
  async function loadJobs() { const j = await C.get('/api/job?mint=' + mint).catch(() => null); if (j && j.ok) { st.jobs = j.open || []; renderJobs(); } }
  async function load() {
    let j = null; try { j = await C.get('/api/kid?mint=' + mint); } catch {}
    if (!j || !j.ok) { if (!st.k) app.innerHTML = `<section class="co-hero"><div class="wrap"><div class="none"><b>${j && j.missing ? 'no company here' : 'the records didn’t answer'}</b>${esc((j && j.error) || '')}<div class="acts" style="justify-content:center;margin-top:14px"><a class="btn sm" href="/">back to WORKERS</a></div></div></div></section>`; return; }
    const firstTime = !st.k; st.k = j.coin; st.work = j.work || []; st.jobs = j.jobs || []; st.log = j.log || [];
    if (firstTime) shell(st.k); else { const n = $('#nextShift'); if (n && st.k.status === 'live') n.textContent = nextShift(st.k); }
    renderJobs(); renderWork(); renderLog();
    if (firstTime && L && st.k.status === 'live') { L.births(false); L.watch([mint]); L.on('trade', t => { if (t.mint !== mint) return; const c = $('#stChip'); if (c) { c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); } }); L.start(); }
  }
  load();
  setInterval(() => { if (!document.hidden) load(); }, 25000);
})();
