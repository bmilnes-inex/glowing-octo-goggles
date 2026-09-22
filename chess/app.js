/* Blunderboard
   Head-to-head chess.com record between two friends, with commentary.
   No backend: the browser pulls both players' games from chess.com's public API,
   keeps a local cache, and computes everything on the phone. */
(() => {
'use strict';

const API = 'https://api.chess.com/pub';
const K = { cfg: 'bb.cfg.v1', arch: 'bb.arch.v1:', prof: 'bb.prof.v1:', shuffle: 'bb.shuffle' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const NTH_NAMES = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' };
const REASON = {
  checkmated: 'checkmate', resigned: 'resignation', timeout: 'running out the clock', abandoned: 'abandonment',
  lose: 'a loss', agreed: 'agreement', repetition: 'repetition', stalemate: 'stalemate',
  insufficient: 'insufficient material', '50move': 'the fifty-move rule', timevsinsufficient: 'timeout vs insufficient material'
};
const REASON_SHORT = {
  checkmated: 'Checkmate', resigned: 'Resignation', timeout: 'On time', abandoned: 'Abandoned', lose: 'Loss'
};

// ---------- small helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((sod(b) - sod(a)) / 864e5);
const sameDay = (a, b) => !!a && !!b && sod(a).getTime() === sod(b).getTime();
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const fmtLong = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShort = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtMonth = (d) => d.toLocaleDateString(undefined, { month: 'short' });
const fmtTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(2000, 0, 1, h, m); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const other = (k) => (k === 'p1' ? 'p2' : 'p1');
const lsGet = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: run without cache */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
const hashCode = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
  }
}

// ---------- config ----------
const DEFAULT_CFG = { p1: { user: '', name: '' }, p2: { user: '', name: '' }, since: '', day: 3, nth: -1, time: '19:00' };

function normalizeCfg(c) {
  const dayRaw = c.day === null || c.day === undefined || c.day === '' ? 3 : +c.day;
  const day = Number.isInteger(dayRaw) && dayRaw >= 0 && dayRaw <= 6 ? dayRaw : 3;
  const nth = [1, 2, 3, 4, -1].includes(+c.nth) ? +c.nth : -1;
  const user = (u) => String(u || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  const name = (n, u) => String(n || '').trim().slice(0, 24) || u;
  const p1u = user(c.p1 && c.p1.user), p2u = user(c.p2 && c.p2.user);
  return {
    p1: { user: p1u, name: name(c.p1 && c.p1.name, p1u) },
    p2: { user: p2u, name: name(c.p2 && c.p2.name, p2u) },
    since: /^\d{4}-\d{2}$/.test(c.since || '') ? c.since : '',
    day, nth,
    time: /^\d{2}:\d{2}$/.test(c.time || '') ? c.time : '19:00'
  };
}
function cfgFromHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  const q = new URLSearchParams(h);
  if (!q.get('u1') || !q.get('u2')) return null;
  return normalizeCfg({
    p1: { user: q.get('u1'), name: q.get('n1') }, p2: { user: q.get('u2'), name: q.get('n2') },
    since: q.get('since'), day: q.get('day'), nth: q.get('nth'), time: q.get('time')
  });
}
function hashFromCfg(c) {
  const q = new URLSearchParams({ u1: c.p1.user, n1: c.p1.name, u2: c.p2.user, n2: c.p2.name, day: c.day, nth: c.nth, time: c.time });
  if (c.since) q.set('since', c.since);
  return '#' + q.toString();
}
const shareUrl = (c) => location.origin + location.pathname + hashFromCfg(c);
const cfgReady = (c) => !!(c && c.p1.user && c.p2.user && c.p1.user !== c.p2.user);

// ---------- schedule: "last Wednesday of the month" and friends ----------
function nthWeekday(year, month, weekday, nth) {
  if (nth === -1) {
    const last = new Date(year, month + 1, 0);
    const back = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - back);
  }
  const first = new Date(year, month, 1);
  const fwd = (weekday - first.getDay() + 7) % 7;
  const day = 1 + fwd + (nth - 1) * 7;
  if (day > new Date(year, month + 1, 0).getDate()) return null;
  return new Date(year, month, day);
}
function nextGameNight(cfg, now) {
  const today = sod(now);
  for (let i = 0; i < 4; i++) {
    const d = nthWeekday(today.getFullYear(), today.getMonth() + i, cfg.day, cfg.nth);
    if (d && d >= today) return d;
  }
  return null;
}
function prevGameNight(cfg, now) {
  const today = sod(now);
  for (let i = 0; i < 4; i++) {
    const d = nthWeekday(today.getFullYear(), today.getMonth() - i, cfg.day, cfg.nth);
    if (d && d < today) return d;
  }
  return null;
}
function isGameNight(date, cfg) {
  const d = nthWeekday(date.getFullYear(), date.getMonth(), cfg.day, cfg.nth);
  return sameDay(d, date);
}
const ruleText = (cfg) => `${NTH_NAMES[cfg.nth]} ${DAY_NAMES[cfg.day]} of the month`;

function icsFor(cfg, next) {
  const [h, m] = cfg.time.split(':').map(Number);
  const start = new Date(next.getFullYear(), next.getMonth(), next.getDate(), h, m);
  const end = new Date(start.getTime() + 2 * 3600e3);
  const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const byday = `${cfg.nth}${ICS_DAY[cfg.day]}`;
  const text = (s) => s.replace(/[\;,]/g, (c) => '\\' + c);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Blunderboard//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:blunderboard-${cfg.p1.user}-${cfg.p2.user}@blunderboard.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `RRULE:FREQ=MONTHLY;BYDAY=${byday}`,
    `SUMMARY:${text(`Chess night: ${cfg.p1.name} vs ${cfg.p2.name}`)}`,
    `DESCRIPTION:${text(`Current record, commentary and receipts: ${shareUrl(cfg)}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Chess night', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}
function gcalUrl(cfg, next) {
  const [h, m] = cfg.time.split(':').map(Number);
  const start = new Date(next.getFullYear(), next.getMonth(), next.getDate(), h, m);
  const end = new Date(start.getTime() + 2 * 3600e3);
  const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: `Chess night: ${cfg.p1.name} vs ${cfg.p2.name}`,
    dates: `${f(start)}/${f(end)}`, recur: `RRULE:FREQ=MONTHLY;BYDAY=${cfg.nth}${ICS_DAY[cfg.day]}`,
    details: `Current record and commentary: ${shareUrl(cfg)}`
  });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

// ---------- chess.com public API ----------
async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const e = new Error(r.status === 404 ? 'not found' : `chess.com replied ${r.status}`);
    e.status = r.status; throw e;
  }
  return r.json();
}
async function mapLimit(items, limit, fn, onEach) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); if (onEach) onEach(idx); }
  }));
  return out;
}
async function fetchProfile(user, force) {
  const key = K.prof + user; const c = lsGet(key);
  if (c && !force && Date.now() - c.at < 3600e3) return c.data;
  let p;
  try { p = await getJSON(`${API}/player/${user}`); }
  catch (e) { if (e.status === 404) { const err = new Error(`chess.com has no player called "${user}".`); err.code = 'nouser'; throw err; } throw e; }
  const s = await getJSON(`${API}/player/${user}/stats`).catch(() => ({}));
  const rating = (k) => (s[k] && s[k].last && Number.isFinite(s[k].last.rating) ? s[k].last.rating : null);
  const data = {
    user, username: p.username || user, avatar: p.avatar || '', chessTitle: p.title || '', joined: p.joined || null, url: p.url || `https://www.chess.com/member/${user}`,
    ratings: { rapid: rating('chess_rapid'), blitz: rating('chess_blitz'), bullet: rating('chess_bullet'), daily: rating('chess_daily') }
  };
  lsSet(key, { at: Date.now(), data });
  return data;
}
function countMoves(pgn) {
  if (!pgn) return 0;
  const body = pgn.split(/\n\s*\n/).pop() || '';
  let max = 0; const re = /(?:^|\s)(\d+)\.(?!\.)/g; let m;
  while ((m = re.exec(body))) max = Math.max(max, +m[1]);
  return max;
}
function openingName(pgn) {
  const m = /\[ECOUrl "[^"]*\/openings\/([^"]+)"\]/.exec(pgn || '');
  if (!m) return '';
  let s = ''; try { s = decodeURIComponent(m[1]); } catch { s = m[1]; }
  return s.replace(/-\d.*$/, '').replace(/-/g, ' ').trim().slice(0, 48);
}
function slim(g) {
  return {
    url: g.url || '', end: g.end_time || 0, tc: g.time_class || 'unknown', rules: g.rules || 'chess', rated: !!g.rated,
    w: { u: String(g.white && g.white.username || '').toLowerCase(), r: g.white && g.white.rating, res: g.white && g.white.result },
    b: { u: String(g.black && g.black.username || '').toLowerCase(), r: g.black && g.black.rating, res: g.black && g.black.result },
    moves: countMoves(g.pgn), opening: openingName(g.pgn)
  };
}
/* force: 0 = use cache, 1 = re-pull the current month, 2 = re-pull everything */
async function fetchGames(cfg, force, onProgress) {
  const u1 = cfg.p1.user, u2 = cfg.p2.user;
  let archives;
  try { ({ archives = [] } = await getJSON(`${API}/player/${u1}/games/archives`)); }
  catch (e) { if (e.status === 404) { const err = new Error(`chess.com has no player called "${u1}".`); err.code = 'nouser'; throw err; } throw e; }
  const now = new Date();
  const cur = `${now.getFullYear()}/${pad(now.getMonth() + 1)}`;
  const urls = archives.filter((u) => { const m = /(\d{4})\/(\d{2})$/.exec(u); return m && (!cfg.since || `${m[1]}-${m[2]}` >= cfg.since); });
  let done = 0; if (onProgress) onProgress(0, urls.length);
  const chunks = await mapLimit(urls, 4, async (url) => {
    const key = `${K.arch}${u1}:${u2}:${url.slice(-7)}`;
    const c = lsGet(key); const isCur = url.endsWith(cur);
    if (c && force < 2 && (c.complete || (isCur && force === 0 && Date.now() - c.at < 5 * 60e3))) return c.games;
    const data = await getJSON(url);
    const games = (data.games || []).filter((g) => {
      const a = String(g.white && g.white.username || '').toLowerCase(), b = String(g.black && g.black.username || '').toLowerCase();
      return (a === u1 && b === u2) || (a === u2 && b === u1);
    }).map(slim);
    lsSet(key, { at: Date.now(), complete: !isCur, games });
    return games;
  }, () => onProgress && onProgress(++done, urls.length));
  return chunks.flat().sort((a, b) => a.end - b.end);
}
function clearGameCache() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(K.arch) || k.startsWith(K.prof)).forEach(lsDel); } catch { /* ignore */ }
}

// ---------- stats ----------
function newSide() {
  return { wins: 0, losses: 0, draws: 0, longest: 0, lastWin: null, white: { w: 0, l: 0, d: 0 }, black: { w: 0, l: 0, d: 0 }, winsBy: {}, lossesBy: {}, fastestWin: null, drought: null };
}
function compute(all, cfg, now) {
  const u1 = cfg.p1.user;
  const games = all.filter((g) => g.rules === 'chess');
  const S = {
    games, total: games.length, variantsSkipped: all.length - games.length, draws: 0,
    p1: newSide(), p2: newSide(), form: [], first: null, last: null, streak: { who: null, n: 0 }, belt: null,
    gameNights: { n: 0, p1: 0, p2: 0, d: 0 }, byClass: {}, openings: {}, monthMap: {}, months: [], longestGame: null
  };
  let run = { who: null, n: 0 };
  for (const g of games) {
    const p1White = g.w.u === u1;
    const me = p1White ? g.w : g.b, them = p1White ? g.b : g.w;
    let winner, reason;
    if (me.res === 'win') { winner = 'p1'; reason = them.res; }
    else if (them.res === 'win') { winner = 'p2'; reason = me.res; }
    else { winner = 'd'; reason = me.res; }
    g.winner = winner; g.reason = reason; g.p1White = p1White;
    g.ratings = { p1: me.r, p2: them.r };
    const d = new Date(g.end * 1000);
    if (winner === 'd') {
      S.draws++; S.p1.draws++; S.p2.draws++;
      S.p1[p1White ? 'white' : 'black'].d++; S.p2[p1White ? 'black' : 'white'].d++;
    } else {
      const W = S[winner], L = S[other(winner)];
      const winnerWhite = (winner === 'p1') === p1White;
      W.wins++; L.losses++;
      W[winnerWhite ? 'white' : 'black'].w++; L[winnerWhite ? 'black' : 'white'].l++;
      W.winsBy[reason] = (W.winsBy[reason] || 0) + 1; L.lossesBy[reason] = (L.lossesBy[reason] || 0) + 1;
      W.lastWin = g;
      if (g.moves > 0 && (!W.fastestWin || g.moves < W.fastestWin.moves)) W.fastestWin = g;
      if (run.who === winner) run.n++; else run = { who: winner, n: 1 };
      W.longest = Math.max(W.longest, run.n);
      if (!S.belt || S.belt.holder !== winner) S.belt = { holder: winner, since: g.end, defenses: 0, takenFrom: S.belt ? S.belt.holder : null };
      else S.belt.defenses++;
    }
    if (g.opening) { const o = (S.openings[g.opening] = S.openings[g.opening] || { name: g.opening, n: 0, p1: 0, p2: 0, d: 0 }); o.n++; o[winner]++; }
    if (!S.longestGame || g.moves > S.longestGame.moves) S.longestGame = g;
    if (isGameNight(d, cfg)) { S.gameNights.n++; S.gameNights[winner]++; }
    const tc = (S.byClass[g.tc] = S.byClass[g.tc] || { n: 0, p1: 0, p2: 0, d: 0 }); tc.n++; tc[winner]++;
    const mk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const mo = (S.monthMap[mk] = S.monthMap[mk] || { key: mk, n: 0, p1: 0, p2: 0, d: 0 }); mo.n++; mo[winner]++;
  }
  S.streak = run;
  S.first = games[0] || null; S.last = games[games.length - 1] || null;
  S.form = games.slice(-10).map((g) => g.winner);
  S.lead = S.p1.wins > S.p2.wins ? 'p1' : S.p2.wins > S.p1.wins ? 'p2' : null;
  S.trail = S.lead ? other(S.lead) : null;
  S.margin = Math.abs(S.p1.wins - S.p2.wins);
  for (const k of ['p1', 'p2']) {
    S[k].drought = S[k].lastWin ? daysBetween(new Date(S[k].lastWin.end * 1000), now) : S.first ? daysBetween(new Date(S.first.end * 1000), now) : null;
  }
  if (S.belt) S.belt.days = daysBetween(new Date(S.belt.since * 1000), now);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    S.months.push(Object.assign({ label: fmtMonth(d) }, S.monthMap[k] || { key: k, n: 0, p1: 0, p2: 0, d: 0 }));
  }
  S.mainClass = (Object.entries(S.byClass).sort((a, b) => b[1].n - a[1].n)[0] || ['rapid'])[0];
  S.topOpening = Object.values(S.openings).sort((a, b) => b.n - a.n)[0] || null;
  return S;
}
function topKey(obj) { return Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || null; }

// ---------- titles and commentary ----------
function titles(S) {
  if (!S.total) return { p1: 'Untested', p2: 'Untested' };
  if (!S.lead) return { p1: 'Co-leader (allegedly)', p2: 'Co-leader (allegedly)' };
  const m = S.margin;
  const lead = m >= 10 ? 'Reigning Tyrant' : m >= 5 ? 'Reigning Champion' : m >= 2 ? 'Current Champ' : 'Barely Ahead';
  const trail = m >= 10 ? 'Rating Donor' : m >= 5 ? 'Rebuilding Year' : m >= 2 ? 'Perpetual Challenger' : 'Due For One';
  const t = {}; t[S.lead] = lead; t[S.trail] = trail; return t;
}
function commentary(S, cfg, P, now) {
  const N = { p1: cfg.p1.name, p2: cfg.p2.name };
  const lines = []; const add = (w, t) => lines.push({ w, t });
  const next = nextGameNight(cfg, now); const tonight = sameDay(next, now);
  const nightWord = tonight ? 'tonight' : next ? `on ${fmtLong(next)}` : 'next time';
  if (!S.total) {
    add(1, `${N.p1} and ${N.p2} have not played a single game. The rivalry exists purely in theory.`);
    add(1, `Zero games. Both undefeated. Both also winless. Fix that ${nightWord}.`);
    return lines;
  }
  const L = S.lead ? N[S.lead] : null, T = S.trail ? N[S.trail] : null;
  const score = S.lead ? `${S[S.lead].wins}-${S[S.trail].wins}` : `${S.p1.wins}-${S.p2.wins}`;
  const decisive = S.p1.wins + S.p2.wins;

  if (!S.lead) {
    add(3, `Dead even at ${score}. Somebody has to blink ${nightWord}.`);
    add(2, `${N.p1} and ${N.p2} are tied. Equal parts skill, or equal parts blundering. The record does not specify.`);
  } else {
    const gap = S.margin, share = pct(S[S.lead].wins, decisive);
    if (gap >= 10) add(4, `${L} leads ${score}. At this point ${T} is less an opponent and more a rating donor.`);
    else if (gap >= 5) add(4, `${L} is up ${score}. ${T} calls it a rebuilding year. It has been several years.`);
    else if (gap >= 2) add(3, `${L} leads ${score}. Comfortable, but not comfortable enough to stop checking this page.`);
    else add(3, `${L} leads by one. One. ${T} is a single decent game away from ruining everything.`);
    if (share >= 70 && decisive >= 5) add(3, `${L} wins ${share}% of the decisive games. ${T} wins the other ${100 - share}%, mostly by accident.`);
    if (gap >= 3) add(2, `${T} needs ${plural(gap, 'straight win')} just to be tied. Pack a lunch.`);
  }
  if (S.streak.n >= 3) add(5, `${N[S.streak.who]} has won ${S.streak.n} straight. ${N[other(S.streak.who)]} is no longer losing games so much as attending them.`);
  else if (S.streak.n === 2) add(2, `${N[S.streak.who]} has taken two in a row. Calling it a streak is generous. Calling it a pattern is worrying.`);

  for (const k of ['p1', 'p2']) {
    const s = S[k], name = N[k], oname = N[other(k)];
    if (s.drought != null && s.drought >= 90 && s.losses > 0) add(4, `${name} has not won in ${s.drought} days. Entire seasons of television have come and gone.`);
    else if (s.drought != null && s.drought >= 30 && s.losses > 0) add(3, `${name} has not won in ${s.drought} days. Milk lasts longer.`);
    if (!s.wins && s.losses >= 2) add(4, `${name}: ${s.losses} games, zero wins. Undefeated in a very specific sense.`);
    const to = s.lossesBy.timeout || 0;
    if (to >= 2) add(3, `${name} has lost ${to} games on the clock. The clock remains undefeated.`);
    const rs = s.lossesBy.resigned || 0;
    if (s.losses >= 3 && rs / s.losses >= 0.6) add(2, `${name} resigns ${pct(rs, s.losses)}% of losses. Knows when it's over, at least. Usually around move twenty.`);
    const cm = s.lossesBy.checkmated || 0;
    if (cm >= 3) add(2, `${name} has been checkmated ${cm} times. Not flagged, not resigned. Checkmated. In full.`);
    const ab = s.lossesBy.abandoned || 0;
    if (ab >= 1) add(2, `${name} has abandoned ${plural(ab, 'game')}. Some call it a connection issue. The record calls it a loss.`);
    if (s.fastestWin && s.fastestWin.moves <= 25 && s.fastestWin.moves > 0) add(2, `${name}'s fastest win took ${s.fastestWin.moves} moves. ${oname} had barely finished castling.`);
    const wt = s.white.w + s.white.l, bt = s.black.w + s.black.l;
    if (wt >= 4 && bt >= 4) {
      const wp = pct(s.white.w, wt), bp = pct(s.black.w, bt);
      if (wp - bp >= 30) add(2, `${name} as White: ${s.white.w}-${s.white.l}. As Black: ${s.black.w}-${s.black.l}. Perhaps insist on White. Every time.`);
      if (bp - wp >= 30) add(2, `${name} wins ${bp}% with Black and ${wp}% with White. Moving first appears to be the problem.`);
    }
  }
  if (S.draws >= 3) add(2, `${S.draws} draws between you. Cowardice or chess? The record does not specify.`);
  if (S.longestGame && S.longestGame.moves >= 60) {
    const w = S.longestGame.winner;
    add(1, w === 'd' ? `Your longest game ran ${S.longestGame.moves} moves and ended in a draw. Nobody won. Everybody lost an evening.`
      : `Your longest game ran ${S.longestGame.moves} moves. ${N[w]} won it. ${N[other(w)]} may simply have fallen asleep.`);
  }
  if (P && P.p1 && P.p2) {
    const r1 = P.p1.ratings[S.mainClass], r2 = P.p2.ratings[S.mainClass];
    if (r1 != null && r2 != null && Math.abs(r1 - r2) >= 100) {
      const hi = r1 > r2 ? 'p1' : 'p2', lo = other(hi), gap = Math.abs(r1 - r2);
      add(2, `${N[hi]} is rated ${gap} points higher in ${S.mainClass}. Chess.com's algorithm has picked a side.`);
      if (S.lead === lo) add(4, `${N[lo]} is rated lower and still leads ${score}. Either ratings lie, or ${N[hi]} plays worse against people they know.`);
    }
  }
  if (S.belt && S.belt.defenses >= 3) add(3, `${N[S.belt.holder]} has held the belt for ${S.belt.days} days and ${S.belt.defenses} defenses. ${N[other(S.belt.holder)]} keeps knocking. Nobody answers.`);
  if (S.belt && S.belt.defenses === 0 && S.belt.takenFrom) add(2, `${N[S.belt.holder]} just took the belt off ${N[S.belt.takenFrom]}. New management. Same building.`);
  const gn = S.gameNights;
  if (gn.n >= 3 && gn.p1 !== gn.p2) {
    const w = gn.p1 > gn.p2 ? 'p1' : 'p2';
    add(2, `On game nights specifically, it's ${gn[w]}-${gn[other(w)]} ${N[w]}. The rest of the month is where ${N[other(w)]} pads the stats.`);
  }
  if (S.topOpening && S.topOpening.n >= 3) {
    const o = S.topOpening, w = o.p1 > o.p2 ? 'p1' : o.p2 > o.p1 ? 'p2' : null;
    if (w) add(2, `You have played the ${o.name} ${o.n} times. ${N[w]} is ${o[w]}-${o[other(w)]} in it. ${N[other(w)]} keeps coming back for more.`);
  }
  if (tonight) add(6, `Game night is tonight. ${T || N.p2}, this is your chance. Statistically it is not much of a chance, but it is one.`);
  if (S.last) {
    const ago = daysBetween(new Date(S.last.end * 1000), now);
    if (S.last.winner !== 'd' && ago <= 3) add(3, `${N[S.last.winner]} won the last game by ${REASON[S.last.reason] || 'means unknown'}. ${N[other(S.last.winner)]} has had ${plural(ago, 'day')} to think about it.`);
    if (ago >= 45) add(2, `Last game: ${plural(ago, 'day')} ago. ${T || N.p1} has been avoiding this rematch with real commitment.`);
  }
  return lines;
}
function pickLine(lines, seed) {
  const total = lines.reduce((a, l) => a + l.w, 0);
  let r = seed % total;
  for (const l of lines) { if (r < l.w) return l.t; r -= l.w; }
  return lines[lines.length - 1].t;
}
function headlineFor(S, cfg, P, now, shuffle) {
  const lines = commentary(S, cfg, P, now);
  const daySeed = Math.floor(now.getTime() / 864e5) * 131;
  return pickLine(lines, hashCode(`${daySeed}:${shuffle}:${S.total}:${S.p1.wins}:${S.p2.wins}`));
}

// ---------- rendering ----------
const state = { view: 'boot', cfg: null, S: null, P: null, error: null, progress: null, syncedAt: null, shuffle: lsGet(K.shuffle) || 0, installPrompt: null, refreshing: false };

function render() {
  const app = $('#app');
  const views = { setup: renderSetup, loading: renderLoading, board: renderBoard, error: renderError };
  app.innerHTML = (views[state.view] || renderLoading)();
}
function topBar(showActions) {
  return `<header class="top">
    <div class="brand"><img class="logo" src="icons/icon.svg" alt=""> Blunderboard</div>
    ${showActions ? `<div class="actions">
      <button class="icon ${state.refreshing ? 'spin' : ''}" data-act="refresh" title="Refresh from chess.com" aria-label="Refresh">↻</button>
      <button class="icon" data-act="settings" title="Settings" aria-label="Settings">⚙</button>
    </div>` : ''}
  </header>`;
}
function renderLoading() {
  const p = state.progress; const pc = p && p.total ? Math.round((100 * p.done) / p.total) : 8;
  const lines = ['Reading the archives…', 'Counting the blunders…', 'Reviewing the receipts…', 'Consulting the clock…', 'Weighing the excuses…'];
  const msg = p && p.total ? `Digging through ${plural(p.total, 'month')} of history (${p.done}/${p.total})` : lines[Math.floor(Date.now() / 1400) % lines.length];
  return `${topBar(false)}<div class="loading"><div class="piece">♞</div><h1>Pulling the record</h1><p class="status">${esc(msg)}</p><div class="progress"><div style="width:${pc}%"></div></div></div>`;
}
function renderError() {
  return `${topBar(true)}<div class="card"><h2>Something went sideways</h2><p class="error">${esc(state.error)}</p>
    <div class="row"><button class="primary" data-act="retry">Try again</button><button data-act="settings">Check settings</button></div></div>`;
}
function fieldPlayer(k, cfg) {
  return `<div class="pair ${k}"><h3 class="${k}">${k === 'p1' ? 'You' : 'Your rival'}</h3>
    <div class="two">
      <div class="field"><label for="${k}u">chess.com username</label><input id="${k}u" name="${k}u" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="username" value="${esc(cfg[k].user)}" required></div>
      <div class="field"><label for="${k}n">Display name</label><input id="${k}n" name="${k}n" placeholder="Nickname" value="${esc(cfg[k].name === cfg[k].user ? '' : cfg[k].name)}" maxlength="24"></div>
    </div></div>`;
}
function renderSetup() {
  const cfg = state.cfg || DEFAULT_CFG; const editing = cfgReady(state.cfg) && state.S;
  const nthOpts = [[-1, 'Last'], [1, 'First'], [2, 'Second'], [3, 'Third'], [4, 'Fourth']];
  return `${topBar(false)}<div class="setup">
    <h1>${editing ? 'Settings' : 'Set up the rivalry'}</h1>
    <p class="lede">${editing ? 'Change names, the schedule, or how far back to count.' : 'Two chess.com usernames. That is the whole setup. Games between you are pulled straight from chess.com, so nobody has to keep score by hand.'}</p>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    <form id="setup" class="fields" autocomplete="off">
      ${fieldPlayer('p1', cfg)}
      ${fieldPlayer('p2', cfg)}
      <div class="field"><label>Game night</label>
        <div class="three">
          <select name="nth">${nthOpts.map(([v, l]) => `<option value="${v}" ${cfg.nth === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select name="day">${DAY_NAMES.map((d, i) => `<option value="${i}" ${cfg.day === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
          <input type="time" name="time" value="${esc(cfg.time)}">
        </div>
        <p class="hint">Default is the last Wednesday of the month at 7:00 PM. Only games played on that day count toward the game-night record.</p>
      </div>
      <div class="field"><label for="since">Count games since (optional)</label><input id="since" type="month" name="since" value="${esc(cfg.since)}">
        <p class="hint">Leave blank to count every game you two have ever played on chess.com.</p></div>
      <div class="row">
        <button type="submit" class="primary">${editing ? 'Save' : 'Build the board'}</button>
        ${editing ? `<button type="button" data-act="cancel">Cancel</button>` : ''}
      </div>
    </form>
    ${editing ? `<div class="sharebox"><b>Link for ${esc(cfg.p2.name)}</b><br><span class="muted">Text this to your rival. It opens the same board, already set up, ready to add to a home screen.</span><br><br><code class="tiny">${esc(shareUrl(cfg))}</code>
      <div class="row" style="margin-top:10px"><button data-act="copy-link">Copy link</button><button class="ghost" data-act="resync">Full resync</button><button class="ghost" data-act="reset">Reset everything</button></div></div>` : ''}
  </div>`;
}
function playerCard(k, cfg, S, P, T) {
  const p = P && P[k]; const leader = S.lead === k; const name = cfg[k].name;
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const avatar = p && p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : `<div class="avatar">${esc(initial)}</div>`;
  return `<div class="player ${k} ${leader ? 'leader' : ''}">
    <div class="avatar-wrap">${leader ? '<div class="crown" aria-label="Leader">👑</div>' : ''}${avatar}</div>
    <div class="name" title="${esc(cfg[k].user)}">${esc(name)}</div>
    <div class="title">${esc(T[k])}</div>
    <div class="score" data-count="${S[k].wins}">${S[k].wins}</div>
  </div>`;
}
function tug(S, cfg) {
  const dec = S.p1.wins + S.p2.wins; const x = dec ? (100 * S.p1.wins) / dec : 50;
  return `<div class="tug" aria-label="Share of wins">
    <div class="bar"><div class="fill ${x >= 100 ? 'full' : ''}" style="width:${x}%"></div><div class="knot" style="left:${x}%">${S.lead ? '👑' : '🤝'}</div></div>
    <div class="labels"><span class="p1">${esc(cfg.p1.name)} ${Math.round(x)}%</span><span class="p2">${100 - Math.round(x)}% ${esc(cfg.p2.name)}</span></div>
  </div>`;
}
function nextCard(cfg, now) {
  const next = nextGameNight(cfg, now); if (!next) return '';
  const prev = prevGameNight(cfg, now); const tonight = sameDay(next, now);
  const inDays = daysBetween(now, next);
  const span = prev ? daysBetween(prev, next) : 30; const pc = tonight ? 100 : Math.max(4, Math.min(100, 100 - (100 * inDays) / span));
  return `<section class="card next ${tonight ? 'tonight' : ''}">
    <div class="ring" style="--pct:${pc}"><div>${tonight ? '<span>♟</span><small>tonight</small>' : `<span>${inDays}</span><small>${inDays === 1 ? 'day' : 'days'}</small>`}</div></div>
    <div>
      <h2>Next game night</h2>
      <div class="when">${tonight ? 'Tonight' : esc(fmtLong(next))}</div>
      <div class="rule">${esc(ruleText(cfg))}${cfg.time ? ` · ${esc(fmtTime(cfg.time))}` : ''}</div>
      <div class="row"><button data-act="ics">Add to calendar</button><a href="${esc(gcalUrl(cfg, next))}" target="_blank" rel="noopener"><button class="ghost">Google Calendar</button></a></div>
    </div>
  </section>`;
}
function droughtSign(S, cfg) {
  if (!S.total) return '';
  const k = S.p1.drought > S.p2.drought ? 'p1' : S.p2.drought > S.p1.drought ? 'p2' : (S.trail || null);
  if (!k || S[k].drought == null || S[k].drought < 1) return '';
  const s = S[k];
  const sub = s.lastWin ? `Last win: ${fmtShort(new Date(s.lastWin.end * 1000))} · Longest streak: ${s.longest}` : 'Has never won. Not once.';
  return `<section class="sign" aria-label="Days without a win"><div class="label">Days since ${esc(cfg[k].name)} last won a game</div><div class="num">${s.drought}</div><div class="sub">${esc(sub)}</div></section>`;
}
function formCard(S, cfg) {
  const N = { p1: cfg.p1.name, p2: cfg.p2.name };
  const pips = S.form.map((w) => `<div class="pip ${w}" title="${w === 'd' ? 'Draw' : N[w] + ' won'}">${w === 'd' ? '½' : w === 'p1' ? esc(N.p1.charAt(0).toUpperCase()) : esc(N.p2.charAt(0).toUpperCase())}</div>`);
  while (pips.length < 10) pips.unshift('<div class="pip empty"></div>');
  const st = S.streak.n >= 2 ? `<div class="streak ${S.streak.who}">${esc(N[S.streak.who])} is on a ${S.streak.n}-game streak <span class="flames">${'🔥'.repeat(Math.min(S.streak.n, 6))}</span></div>`
    : S.streak.n === 1 ? `<div class="streak muted">${esc(N[S.streak.who])} won the last one. A streak of one is a start.</div>` : '';
  return `<section class="card"><h2>Recent form</h2><div class="pips">${pips.join('')}</div>${st}</section>`;
}
function beltCard(S, cfg) {
  if (!S.belt) return '';
  const N = { p1: cfg.p1.name, p2: cfg.p2.name }; const b = S.belt;
  const since = fmtShort(new Date(b.since * 1000));
  return `<section class="card belt"><div class="trophy">🏆</div><div>
    <h2>The belt</h2>
    <div class="holder ${b.holder}">${esc(N[b.holder])} holds it</div>
    <div class="stats">Held ${plural(b.days, 'day')} · ${plural(b.defenses, 'successful defense')} · ${b.takenFrom ? `taken from ${esc(N[b.takenFrom])} on ${since}` : `claimed ${since}`}</div>
    <p class="tiny muted" style="margin-top:6px">The belt changes hands with every decisive game. Draws are polite. They do not move the belt.</p>
  </div></section>`;
}
function recordBook(S, cfg, P) {
  const N = { p1: cfg.p1.name, p2: cfg.p2.name };
  const tiles = [];
  const tile = (k, v, s) => tiles.push(`<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`);
  const split = (a, b) => `<span class="p1">${a}</span><span class="muted sep">·</span><span class="p2">${b}</span>`;
  tile('Games played', S.total, S.first ? `since ${esc(fmtShort(new Date(S.first.end * 1000)))}` : '');
  tile('Draws', S.draws, S.total ? `${pct(S.draws, S.total)}% of games` : '');
  tile('Longest streak', split(S.p1.longest, S.p2.longest), `${esc(N.p1)} · ${esc(N.p2)}`);
  tile('Game night record', split(S.gameNights.p1, S.gameNights.p2), `${plural(S.gameNights.n, 'game')} on ${esc(ruleText(cfg)).replace(' of the month', 's')}${S.gameNights.d ? `, ${S.gameNights.d} drawn` : ''}`);
  for (const k of ['p1', 'p2']) {
    const s = S[k]; const top = topKey(s.winsBy);
    tile(`${esc(N[k])} wins by`, top ? esc(REASON_SHORT[top[0]] || top[0]) : '—', top ? `${top[1]} of ${plural(s.wins, 'win')}` : 'no wins yet');
  }
  for (const k of ['p1', 'p2']) {
    const s = S[k];
    tile(`${esc(N[k])} by color`, `<span class="split">♔ ${s.white.w}-${s.white.l}-${s.white.d} <span class="muted">·</span> ♚ ${s.black.w}-${s.black.l}-${s.black.d}</span>`, 'white · black, W-L-D');
  }
  for (const k of ['p1', 'p2']) {
    const f = S[k].fastestWin;
    tile(`${esc(N[k])} fastest win`, f ? `${f.moves} moves` : '—', f ? `${esc(REASON[f.reason] || '')} · ${esc(fmtShort(new Date(f.end * 1000)))}` : 'still waiting');
  }
  if (P && P.p1 && P.p2) {
    const r1 = P.p1.ratings[S.mainClass], r2 = P.p2.ratings[S.mainClass];
    tile(`${esc(S.mainClass)} rating`, split(r1 ?? '—', r2 ?? '—'), 'chess.com, current');
  }
  if (S.longestGame && S.longestGame.moves) tile('Longest game', `${S.longestGame.moves} moves`, S.longestGame.winner === 'd' ? 'a draw, naturally' : `${esc(N[S.longestGame.winner])} outlasted`);
  if (S.topOpening) tile('Most played opening', esc(S.topOpening.name), `${plural(S.topOpening.n, 'game')} · ${split(S.topOpening.p1, S.topOpening.p2)}`);
  const classes = Object.entries(S.byClass).sort((a, b) => b[1].n - a[1].n);
  if (classes.length > 1) tile('By time control', classes.map(([c, v]) => `<div class="small">${esc(c)}: ${split(v.p1, v.p2)}</div>`).join(''), '');
  return `<section class="card"><h2>Record book</h2><div class="grid">${tiles.join('')}</div>${S.variantsSkipped ? `<p class="tiny muted" style="margin-top:10px">${plural(S.variantsSkipped, 'variant game')} (Chess960, bughouse and the like) excluded from the count.</p>` : ''}</section>`;
}
function monthsCard(S, cfg) {
  const N = { p1: cfg.p1.name, p2: cfg.p2.name };
  const cells = S.months.map((m) => {
    const w = !m.n ? '' : m.p1 > m.p2 ? 'p1' : m.p2 > m.p1 ? 'p2' : 'd';
    const t = m.n ? `${m.label}: ${N.p1} ${m.p1}, ${N.p2} ${m.p2}${m.d ? `, ${m.d} drawn` : ''}` : `${m.label}: no games`;
    return `<div class="month" title="${esc(t)}"><div class="cell ${w}">${m.n ? `${m.p1}-${m.p2}` : ''}</div><div class="lbl">${esc(m.label)}</div></div>`;
  });
  return `<section class="card"><h2>Month by month</h2><div class="months">${cells.join('')}</div><p class="tiny muted" style="margin-top:10px">Each month goes to whoever won more games in it. Grey means a split month, which pleases nobody.</p></section>`;
}
function recentCard(S, cfg) {
  if (!S.total) return '';
  const N = { p1: cfg.p1.name, p2: cfg.p2.name };
  const items = S.games.slice(-8).reverse().map((g) => {
    const d = new Date(g.end * 1000);
    const what = g.winner === 'd' ? `Draw by ${REASON[g.reason] || 'agreement'}` : `${esc(N[g.winner])} won by ${REASON[g.reason] || 'means unknown'}`;
    const meta = `${esc(fmtShort(d))} · ${esc(g.tc)} · ${g.moves ? plural(g.moves, 'move') : ''}${g.p1White ? ` · ${esc(N.p1)} white` : ` · ${esc(N.p2)} white`}${isGameNight(d, cfg) ? ' · game night' : ''}`;
    return `<li><div class="dot ${g.winner}"></div><div><div class="what">${what}</div><div class="meta">${meta}</div></div>${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener">Replay</a>` : ''}</li>`;
  });
  return `<section class="card"><h2>Recent games</h2><ul class="games">${items.join('')}</ul></section>`;
}
function footer(cfg) {
  const synced = state.syncedAt ? new Date(state.syncedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';
  let tip = '';
  if (!standalone()) {
    tip = isIOS()
      ? `<div class="tip"><b>Put it on your Home Screen:</b> tap the Share button in Safari, then <b>Add to Home Screen</b>. It opens like an app, no browser bar.</div>`
      : state.installPrompt
        ? `<div class="tip row between"><span><b>Install as an app</b> on this phone.</span><button class="primary" data-act="install">Install</button></div>`
        : `<div class="tip"><b>Put it on your Home Screen:</b> in your browser menu choose <b>Add to Home screen</b> or <b>Install app</b>.</div>`;
  }
  return `<footer>
    <div>Synced ${esc(synced)} · Games from the chess.com public API · Commentary is not responsible for hurt feelings.</div>
    <div class="row center"><button data-act="copy-link">Copy link for ${esc(cfg.p2.name)}</button><button class="ghost" data-act="settings">Settings</button></div>
    ${tip}
  </footer>`;
}
function renderBoard() {
  const { cfg, S, P } = state; const now = new Date(); const T = titles(S);
  const head = headlineFor(S, cfg, P, now, state.shuffle);
  return `${topBar(true)}<main>
    <section class="card hero">
      <div class="players">${playerCard('p1', cfg, S, P, T)}<div class="vs">VS</div>${playerCard('p2', cfg, S, P, T)}</div>
      ${S.draws ? `<div class="draws-line">${plural(S.draws, 'draw')} · ${plural(S.total, 'game')} total</div>` : `<div class="draws-line">${plural(S.total, 'game')} total</div>`}
      ${tug(S, cfg)}
      <p class="headline" id="headline">${esc(head)}</p>
      <div class="row center"><button data-act="another">Another one</button><button class="primary" data-act="share-talk">Send it</button></div>
    </section>
    ${nextCard(cfg, now)}
    ${droughtSign(S, cfg)}
    ${formCard(S, cfg)}
    ${beltCard(S, cfg)}
    ${recordBook(S, cfg, P)}
    ${monthsCard(S, cfg)}
    ${recentCard(S, cfg)}
    ${footer(cfg)}
  </main>`;
}

// ---------- data flow ----------
let loadSeq = 0;
async function load(force) {
  const cfg = state.cfg;
  if (!cfgReady(cfg)) { state.view = 'setup'; return render(); }
  const seq = ++loadSeq; // a newer load (or a failed one) makes this one's callbacks stale
  const stale = () => seq !== loadSeq;
  const hadBoard = state.view === 'board' && state.S;
  if (!hadBoard) { state.view = 'loading'; state.progress = null; render(); }
  state.refreshing = true; if (hadBoard) render();
  try {
    const [games, p1, p2] = await Promise.all([
      fetchGames(cfg, force || 0, (done, total) => { if (!hadBoard && !stale() && state.view === 'loading') { state.progress = { done, total }; render(); } }),
      fetchProfile(cfg.p1.user, force === 2), fetchProfile(cfg.p2.user, force === 2)
    ]);
    if (stale()) return;
    state.S = compute(games, cfg, new Date());
    state.P = { p1, p2 };
    state.syncedAt = Date.now();
    state.error = null; state.view = 'board';
  } catch (e) {
    if (stale()) return;
    loadSeq++; // stop any progress callbacks still trickling in from the other requests
    console.error(e);
    if (e.code === 'nouser') { state.error = e.message; state.view = 'setup'; }
    else if (hadBoard) { toast('Could not reach chess.com. Showing the last sync.'); }
    else { state.error = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Could not reach chess.com. Check your connection and try again.' : e.message; state.view = 'error'; }
  } finally {
    if (!stale() || state.view !== 'loading') { state.refreshing = false; render(); }
  }
}
function saveFromForm(form) {
  const f = new FormData(form);
  const cfg = normalizeCfg({
    p1: { user: f.get('p1u'), name: f.get('p1n') }, p2: { user: f.get('p2u'), name: f.get('p2n') },
    since: f.get('since'), day: f.get('day'), nth: f.get('nth'), time: f.get('time')
  });
  if (!cfg.p1.user || !cfg.p2.user) { state.error = 'Both chess.com usernames are needed.'; return render(); }
  if (cfg.p1.user === cfg.p2.user) { state.error = 'Playing yourself does not count. Two different usernames, please.'; return render(); }
  const changedPlayers = !state.cfg || state.cfg.p1.user !== cfg.p1.user || state.cfg.p2.user !== cfg.p2.user || state.cfg.since !== cfg.since;
  state.cfg = cfg; lsSet(K.cfg, cfg); state.error = null;
  history.replaceState(null, '', location.pathname + hashFromCfg(cfg));
  if (changedPlayers) { state.S = null; state.view = 'loading'; }
  load(0);
}
function downloadIcs() {
  const next = nextGameNight(state.cfg, new Date()); if (!next) return;
  const blob = new Blob([icsFor(state.cfg, next)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'chess-night.ics';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Calendar file ready. It repeats monthly.');
}
async function shareTalk() {
  const { cfg, S } = state; const head = $('#headline') ? $('#headline').textContent : '';
  const text = `${head}\n\n${cfg.p1.name} ${S.p1.wins} – ${S.p2.wins} ${cfg.p2.name}${S.draws ? ` (${S.draws} drawn)` : ''}\n${shareUrl(cfg)}`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  toast((await copyText(text)) ? 'Copied. Go ruin someone’s afternoon.' : 'Could not copy on this browser.');
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'refresh') { if (!state.refreshing) load(1); }
  else if (act === 'retry') load(0);
  else if (act === 'settings') { state.error = null; state.view = 'setup'; render(); }
  else if (act === 'cancel') { state.error = null; state.view = state.S ? 'board' : 'setup'; render(); }
  else if (act === 'another') {
    state.shuffle = (state.shuffle + 1) % 100000; lsSet(K.shuffle, state.shuffle);
    const h = $('#headline'); if (h) { h.textContent = headlineFor(state.S, state.cfg, state.P, new Date(), state.shuffle); h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); }
  }
  else if (act === 'share-talk') shareTalk();
  else if (act === 'copy-link') toast((await copyText(shareUrl(state.cfg))) ? `Link copied. Send it to ${state.cfg.p2.name}.` : 'Could not copy on this browser.');
  else if (act === 'ics') downloadIcs();
  else if (act === 'install' && state.installPrompt) { state.installPrompt.prompt(); state.installPrompt = null; render(); }
  else if (act === 'resync') { clearGameCache(); state.S = null; state.view = 'loading'; load(2); }
  else if (act === 'reset') {
    if (!confirm('Forget both players and every cached game on this device?')) return;
    clearGameCache(); lsDel(K.cfg); lsDel(K.shuffle);
    state.cfg = Object.assign({}, DEFAULT_CFG); state.S = null; state.P = null; state.error = null;
    history.replaceState(null, '', location.pathname); state.view = 'setup'; render();
  }
});
document.addEventListener('submit', (e) => { if (e.target.id === 'setup') { e.preventDefault(); saveFromForm(e.target); } });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; if (state.view === 'board') render(); });
window.addEventListener('hashchange', () => { const c = cfgFromHash(); if (c && cfgReady(c)) { state.cfg = c; lsSet(K.cfg, c); state.S = null; load(0); } });
document.addEventListener('visibilitychange', () => {
  // Coming back to the app after a while: quietly refresh the current month.
  if (document.visibilityState === 'visible' && state.view === 'board' && state.syncedAt && Date.now() - state.syncedAt > 10 * 60e3) load(0);
});

// ---------- boot ----------
(function boot() {
  const fromHash = cfgFromHash();
  const stored = lsGet(K.cfg);
  state.cfg = fromHash && cfgReady(fromHash) ? fromHash : stored ? normalizeCfg(stored) : Object.assign({}, DEFAULT_CFG);
  if (fromHash && cfgReady(fromHash)) lsSet(K.cfg, fromHash);
  if (cfgReady(state.cfg) && !location.hash) history.replaceState(null, '', location.pathname + hashFromCfg(state.cfg));
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  load(0);
})();
})();
