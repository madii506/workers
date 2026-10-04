// WORKERS crew: who the six bots are, their pictures, and how a piece of their work is drawn (home and company pages).
(function () {
  'use strict';
  const C = window.Core, { esc } = C;
  const BOTS = [
    { k: 'CTO', job: 'runs the crew', art: 34, scene: 27, say: 'I read the job board and hand out the work. Top vote goes first.', what: 'Reads the job board every shift, picks the top-voted job and hands it to the right bot. No jobs up? It writes the plan itself.', tech: 'A small OpenAI model, through Vercel’s AI Gateway.' },
    { k: 'CLIP', job: 'TikToks with Higgsfield', art: 35, scene: 28, say: 'I film the TikToks. Walk-ins, dances, crash zooms. Starring your coin.', what: 'Shoots a vertical TikTok starring your coin’s own picture, writes the caption, then films it. You download it and post it.', tech: 'FLUX for the shot. Higgsfield films when the house’s key is set, Seedance or Wan through the AI Gateway otherwise.' },
    { k: 'YAP', job: 'X posts', art: 36, scene: 29, say: 'I write the posts. Three per job. You hit post.', what: 'Writes three X posts per job in the coin’s voice. Each one has a post button that opens X with it filled in.', tech: 'A small OpenAI model. X doesn’t let a bot post without the coin’s own account, so you post it.' },
    { k: 'MEME', job: 'memes + art', art: 37, scene: 30, say: 'I make the memes. Your coin, in the scene, no text.', what: 'Puts your coin’s own picture into a fresh meme scene, or the one a holder asked for on the job board.', tech: 'FLUX, with your coin’s picture as the reference.' },
    { k: 'DEV', job: 'builds the site', art: 38, scene: 31, say: 'I build the page. Headline, about, the lot.', what: 'Writes and ships the coin’s page on WORKERS: the headline, the tagline, the about and the points. Rebuilds it when holders ask.', tech: 'A small OpenAI model. It never invents a team, partners or numbers.' },
    { k: 'MOD', job: 'answers holders', art: 39, scene: 32, say: 'Ask me anything. Except price. I don’t do price.', what: 'Answers holders’ questions on the company page, any time. Never talks price, never invents facts.', tech: 'A small OpenAI model with the house rules.' },
  ];
  const by = k => BOTS.find(b => b.k === k) || BOTS[0];
  const art = n => '/api/crew?art=' + n + '&v=3';
  const HAT = '<svg class="hat" viewBox="0 0 200 112" aria-hidden="true"><ellipse cx="100" cy="94" rx="98" ry="14" fill="#b23400"/><ellipse cx="100" cy="87" rx="98" ry="14" fill="#ff5c00"/><path d="M27 88 A73 76 0 0 1 173 88 Z" fill="#ff5c00"/><path d="M28 88 Q100 106 172 88" fill="none" stroke="#b23400" stroke-width="5"/><path d="M45 70 A58 60 0 0 1 82 30" fill="none" stroke="#ff9d62" stroke-width="9" stroke-linecap="round"/></svg>';
  const xIntent = t => 'https://x.com/intent/post?text=' + encodeURIComponent(t);
  // one piece of work, drawn as a tile (the floor, the company page)
  function tile(w, i, nw) {
    const b = by(w.bot), o = w.out || {}, href = w.mint ? '/c/' + w.mint : '#';
    const head = `<div class="tt"><img src="${art(b.art)}" alt="">${esc(b.k)}${w.symbol ? `<span>$${esc(w.symbol)}</span>` : ''}</div>`;
    let body = '';
    if (w.bot === 'YAP') body = `<div class="tx">${esc((o.posts || [])[0] || '')}</div>`;
    else if (w.bot === 'DEV') body = `<div class="tx"><b style="font:900 22px/1 var(--d);text-transform:uppercase;color:#fff">${esc(o.headline || '')}</b><br>${esc(o.tagline || '')}</div>`;
    else if (w.bot === 'MEME' && w.still) body = `<div class="mm"><img src="${w.still}" alt="" loading="lazy"></div>`;
    else if (w.bot === 'CLIP' && w.still) body = `<div class="mm v">${w.url ? `<video src="${w.url}" poster="${w.still}" muted playsinline loop autoplay preload="metadata"></video>` : `<img src="${w.still}" alt="" loading="lazy">`}</div>${o.caption ? `<div class="tx" style="padding-top:10px">${esc(o.caption)}</div>` : ''}`;
    else body = `<div class="tx">${esc(o.a || o.scene || '')}</div>`;
    return `<a class="tile${nw ? ' new' : ''}" style="--i:${i || 0}" href="${href}">${head}${body}</a>`;
  }
  // a piece of work in full (the trial shift, the company page)
  function full(w) {
    const o = w.out || {};
    if (w.bot === 'CTO') return `<ol class="plan">${(o.plan || []).map(p => `<li><b>${esc(p.bot)}</b>${esc(p.job)}</li>`).join('')}</ol>`;
    if (w.bot === 'YAP') return (o.posts || []).map(p => `<div class="post">${esc(p)}<div class="pa"><a class="mini" href="${xIntent(p)}" target="_blank" rel="noopener">post on X ↗</a><button class="mini" type="button" data-copy="${esc(p)}">copy</button></div></div>`).join('');
    if (w.bot === 'DEV') return `<div class="site"><div class="url"><i></i><i></i><i></i><span>${esc(location.host)}/c/…</span></div><div class="sx"><h4>${esc(o.headline || '')}</h4><p class="tg">${esc(o.tagline || '')}</p><p>${esc(o.about || '')}</p>${(o.points || []).length ? `<ul>${o.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${o.cta ? `<span class="sc">${esc(o.cta)}</span>` : ''}</div></div>`;
    if (w.bot === 'MOD') return `<div class="qa"><div class="q">${esc(o.q || '')}</div><div class="a">${esc(o.a || '')}</div></div>`;
    if (w.bot === 'MEME') return `<div class="media sq"><img src="${w.still}" alt="a meme by MEME"></div><div class="acts"><a class="mini" href="${w.still}" download="meme.jpg">save ↓</a></div>`;
    if (w.bot === 'CLIP') return `<div class="media v" data-clip="${w.id}">${w.url ? `<video src="${w.url}" poster="${w.still}" muted playsinline loop autoplay></video>` : `<img src="${w.still}" alt="a TikTok shot by CLIP">`}${w.status === 'pending' ? '<span class="tag" data-ft>filming…</span><span class="scan"></span>' : ''}</div>${o.caption ? `<p class="cap">${esc(o.caption)}</p>` : ''}<div class="acts"><a class="mini" href="${w.url || w.still}" download="${w.url ? 'tiktok.mp4' : 'tiktok.jpg'}">${w.url ? 'video ↓' : 'shot ↓'}</a>${o.caption ? `<button class="mini" type="button" data-copy="${esc(o.caption)}">copy caption</button>` : ''}</div>`;
    return '';
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) C.copy(b.getAttribute('data-copy')); });
  // watch a CLIP job until its video is filmed (or the camera gives up)
  async function watchClip(id, onDone) {
    const t0 = Date.now();
    while (Date.now() - t0 < 8 * 60000) {
      await new Promise(r => setTimeout(r, 5000));
      let j = null; try { j = await C.get('/api/crew?w=' + id); } catch {}
      document.querySelectorAll(`[data-clip="${id}"] [data-ft]`).forEach(el => { el.textContent = 'filming · ' + Math.round((Date.now() - t0) / 1000) + 's'; });
      if (j && j.ok && j.status !== 'pending') return onDone(j);
    }
    onDone(null);
  }
  const STATE = { awake: 'on shift', rot: 'slow', dead: 'clocked out', ascended: 'graduated' };
  window.Crew = { BOTS, by, art, HAT, xIntent, tile, full, watchClip, STATE };
})();
