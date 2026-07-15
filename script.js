const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUE     = 'fifa.world';
const REFRESH_MS = 1_000;

const STAT_LABELS = {
  shotsOnTarget:    'ביצועות למסגרת',
  totalShots:       'ביצועות',
  possessionPct:    'החזקת כדור',
  totalPasses:      'סה"כ מסירות',
  accuratePasses:   'מסירות מדויקות',
  foulsCommitted:   'עבירות',
  yellowCards:      'כרטיסים צהובים',
  redCards:         'כרטיסים אדומים',
  offsides:         'נבדלים',
  wonCorners:       'קרנות',
  saves:            'הצלות שוער',
  blockedShots:     'חסימות',
  totalTackles:     'נסיונות תפיסה',
  effectiveTackles: 'תפיסות מוצלחות',
  interceptions:    'יירוטים',
  totalCrosses:     'מסירות רוחב',
  accurateCrosses:  'מסירות רוחב מדויקות',
  totalLongBalls:   'כדורים ארוכים',
  effectiveClearance: 'פינויים',
};

const ORDERED_KEYS = [
  'shotsOnTarget', 'totalShots', 'possessionPct',
  'totalPasses', 'accuratePasses',
  'foulsCommitted', 'yellowCards', 'redCards',
  'offsides', 'wonCorners', 'saves',
  'blockedShots', 'effectiveTackles', 'totalTackles',
  'interceptions', 'totalCrosses', 'accurateCrosses',
  'totalLongBalls', 'effectiveClearance',
];

const EVENT_TYPES = [
  { match: 'goal',         icon: '⚽', label: 'גול' },
  { match: 'yellow card',  icon: '🟨', label: 'כרטיס צהוב' },
  { match: 'red card',     icon: '🟥', label: 'כרטיס אדום' },
  { match: 'substitution', icon: '🔄', label: 'החלפה' },
  { match: 'offside',      icon: '🚩', label: 'נבדל' },
  { match: 'var',          icon: '📺', label: 'VAR' },
  { match: 'kickoff',      icon: '🔔', label: 'שריקת פתיחה' },
  { match: 'half time',    icon: '⏸',  label: 'הפסקה' },
  { match: 'full time',    icon: '🏁', label: 'סיום' },
  { match: 'end delay',    icon: '▶️', label: 'המשך' },
  { match: 'start delay',  icon: '⏳', label: 'עיכוב' },
  { match: 'injury',       icon: '🏥', label: 'פציעה' },
  { match: 'penalty',      icon: '🎯', label: 'פנדל' },
  { match: 'free kick',    icon: '🦵', label: 'בעיטת עונשין' },
];

// ── State ─────────────────────────────────────────────────────────────────────

let currentFixtureId = null;
const finalCelebrated = {}; // fixtureId -> true once we've shown the victory celebration
let refreshTimer     = null;
let expandedStat     = null;

// { statKey → [{minute, home, away}] }
const statHistory = {};

// ── localStorage persistence ──────────────────────────────────────────────────

function storageKey() { return `fls_stats_${currentFixtureId}`; }

function loadStatHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(statHistory, saved);
  } catch {}
}

function saveStatHistoryToStorage() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(statHistory));
    // Prune old fixture keys so storage doesn't grow indefinitely
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('fls_stats_') && k !== storageKey()) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const $ = id => document.getElementById(id);

function formatClock(comp) {
  const status = comp.status;
  const state  = status?.type?.state;
  if (state === 'pre') {
    const d = new Date(comp.date || comp.startDate);
    return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }
  if (state === 'post') return 'הסתיים';
  if (state === 'in') {
    const clock  = status.displayClock || '';
    const period = status.period || 1;
    if (status.type?.shortDetail?.toLowerCase().includes('half')) return 'הפסקה';
    const half = period <= 2
      ? `מחצית ${period}`
      : (period === 3 ? 'הארכה 1' : 'הארכה 2');
    return `${clock} ${half}`;
  }
  return status?.type?.shortDetail || '';
}

function translateTeam(name) { return TEAM_HE[name] || name; }
function teamFlag(name)       { return TEAM_FLAG[name] || '🏳'; }

// ── Final-match victory celebration ─────────────────────────────────────────
const CONFETTI_COLORS = ['#d4ff3f', '#00d9c0', '#ff4d6d', '#f5f5f0', '#ff9f1c'];

function launchConfetti() {
  const layer = $('confetti-layer');
  if (!layer) return;
  const count = 90;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const color    = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const left     = Math.random() * 100;
    const duration = 2.6 + Math.random() * 2.2;
    const delay    = Math.random() * 0.6;
    const drift    = (Math.random() * 160 - 80).toFixed(0);
    const spin     = (720 + Math.random() * 720).toFixed(0);
    const isCircle = Math.random() > 0.5;
    piece.style.left            = `${left}%`;
    piece.style.background      = color;
    piece.style.borderRadius    = isCircle ? '50%' : '2px';
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay    = `${delay}s`;
    piece.style.setProperty('--drift', `${drift}px`);
    piece.style.setProperty('--spin', `${spin}deg`);
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
  }
}

function showWinnerBanner(text) {
  const banner = $('winner-banner');
  const label  = $('winner-text');
  if (!banner || !label) return;
  label.textContent = text;
  banner.classList.remove('hidden');
  // Force reflow so the 'show' class re-triggers the pop animation reliably.
  void banner.offsetWidth;
  banner.classList.add('show');
  setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => banner.classList.add('hidden'), 400);
  }, 6000);
}

// ── Tournament stage (group / knockout round) ──────────────────────────────
// ESPN exposes the stage as free text inside altGameNote, e.g.
// "FIFA World Cup, Group A"  |  "FIFA World Cup, Round of 16"
// "FIFA World Cup, Quarterfinal"  |  "FIFA World Cup, Semifinal"
// "FIFA World Cup, Final"  |  "FIFA World Cup, Third Place"
const STAGE_HE = {
  'round of 32':   'שלב ה-32',
  'round of 16':   'שמינית גמר',
  'quarterfinal':  'רבע גמר',
  'quarter-final': 'רבע גמר',
  'semifinal':     'חצי גמר',
  'semi-final':    'חצי גמר',
  'third place':   'משחק על מקום שלישי',
  '3rd place':     'משחק על מקום שלישי',
  'final':         'גמר',
};

function rawStage(comp) {
  const note = comp?.altGameNote || comp?.notes?.[0]?.headline || '';
  const part = note.split(',').pop()?.trim() || '';
  return part;
}

function translateStage(comp) {
  const raw = rawStage(comp);
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower.startsWith('group')) {
    const letter = raw.trim().split(' ').pop();
    return `בית ${letter}`;
  }
  return STAGE_HE[lower] || raw;
}

function isKnockoutStage(comp) {
  const lower = rawStage(comp).toLowerCase();
  return lower.length > 0 && !lower.startsWith('group');
}

function formatStatValue(name, raw) {
  if (name === 'possessionPct') return `${Math.round(parseFloat(raw) || 0)}%`;
  return String(raw);
}
function parseStatNum(name, raw) {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

// ── Stat History (time-series data) ──────────────────────────────────────────

function updateStatHistory(minute, homeStats, awayStats) {
  const awayMap = Object.fromEntries((awayStats || []).map(s => [s.name, s]));
  let changed = false;
  for (const stat of (homeStats || [])) {
    if (!STAT_LABELS[stat.name]) continue;
    const hVal = parseStatNum(stat.name, stat.displayValue ?? '0');
    const aVal = parseStatNum(stat.name, awayMap[stat.name]?.displayValue ?? '0');

    if (!statHistory[stat.name]) statHistory[stat.name] = [];
    const hist = statHistory[stat.name];
    const last = hist[hist.length - 1];

    if (!last || last.minute !== minute || last.home !== hVal || last.away !== aVal) {
      hist.push({ minute, home: hVal, away: aVal });
      if (hist.length > 95) hist.shift();
      changed = true;
    }
  }
  if (changed) saveStatHistoryToStorage();
}

// ── SVG Sparkline ─────────────────────────────────────────────────────────────

function makeSVGPath(points, xScale, yScale, flip = false) {
  if (!points.length) return '';
  return points.map((p, i) => {
    const x = (p.minute / xScale) * 260;
    const y = flip
      ? (p / yScale) * 48
      : 48 - (p / yScale) * 48;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function renderSparklineSVG(statKey, expanded = false) {
  const hist = statHistory[statKey] || [];
  if (hist.length < 2) {
    return expanded
      ? `<div class="spark-empty">אוסף נתונים... (${hist.length}/2 נקודות)</div>`
      : '';
  }

  const W  = 260;
  const H  = expanded ? 72 : 32;
  const maxMin = Math.max(...hist.map(p => p.minute), 90);
  const maxVal = Math.max(...hist.map(p => Math.max(p.home, p.away)), 1);

  const toX = p => ((p.minute / maxMin) * W).toFixed(1);
  const toY = v => (H - (v / maxVal) * H * 0.88).toFixed(1);

  const homePts = hist.map(p => `${toX(p)},${toY(p.home)}`).join(' ');
  const awayPts = hist.map(p => `${toX(p)},${toY(p.away)}`).join(' ');

  // Area paths (close at bottom)
  const homeArea = `M${toX(hist[0])},${H} ` +
    hist.map(p => `L${toX(p)},${toY(p.home)}`).join(' ') +
    ` L${toX(hist[hist.length-1])},${H} Z`;
  const awayArea = `M${toX(hist[0])},${H} ` +
    hist.map(p => `L${toX(p)},${toY(p.away)}`).join(' ') +
    ` L${toX(hist[hist.length-1])},${H} Z`;

  // Last value dots
  const lastH  = hist[hist.length - 1];
  const dotHx  = toX(lastH);
  const dotHy  = toY(lastH.home);
  const dotAy  = toY(lastH.away);

  let xLabels = '';
  if (expanded) {
    // Draw minute labels every 15 minutes
    xLabels = [0, 15, 30, 45, 60, 75, 90]
      .filter(m => m <= maxMin)
      .map(m => `<text x="${((m/maxMin)*W).toFixed(1)}" y="${H+11}" class="spark-label">${m}'</text>`)
      .join('');
  }

  return `
    <svg class="sparkline ${expanded ? 'spark-expanded' : ''}"
         viewBox="0 0 ${W} ${H + (expanded ? 14 : 0)}"
         preserveAspectRatio="none">
      <defs>
        <linearGradient id="gh${statKey}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00d9c0" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#00d9c0" stop-opacity="0.02"/>
        </linearGradient>
        <linearGradient id="ga${statKey}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff4d6d" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#ff4d6d" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${homeArea}" fill="url(#gh${statKey})"/>
      <path d="${awayArea}" fill="url(#ga${statKey})"/>
      <polyline points="${homePts}" class="spark-line spark-home-line"/>
      <polyline points="${awayPts}" class="spark-line spark-away-line"/>
      <circle cx="${dotHx}" cy="${dotHy}" r="${expanded ? 3 : 2}" class="spark-dot-home"/>
      <circle cx="${dotHx}" cy="${dotAy}" r="${expanded ? 3 : 2}" class="spark-dot-away"/>
      ${xLabels}
    </svg>`;
}

// ── Match List ────────────────────────────────────────────────────────────────

async function loadMatchList() {
  const list = $('match-list');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const data   = await fetchJSON(`${ESPN_BASE}/${LEAGUE}/scoreboard`);
    renderMatchList(data.events || []);
  } catch (e) {
    list.innerHTML = `<div class="error-msg">שגיאה: ${e.message}</div>`;
  }
}

function renderMatchList(events) {
  const list = $('match-list');
  if (!events.length) {
    list.innerHTML = '<div class="no-matches">אין משחקים היום</div>';
    return;
  }

  list.innerHTML = events.map(ev => {
    const comp  = ev.competitions[0];
    const home  = comp.competitors.find(c => c.homeAway === 'home');
    const away  = comp.competitors.find(c => c.homeAway === 'away');
    const state = comp.status?.type?.state;
    const isLive = state === 'in';
    const isDone = state === 'post';
    const clock  = formatClock(comp);
    const hName  = home?.team?.displayName || '';
    const aName  = away?.team?.displayName || '';

    return `
      <div class="match-item ${isLive ? 'live' : ''}" data-id="${ev.id}">
        <div class="mi-teams">
          <div class="mi-team home-mi">
            <span class="mi-flag">${teamFlag(hName)}</span>
            <span>${translateTeam(hName)}</span>
          </div>
          <div class="mi-score ${isDone ? 'done' : isLive ? 'live-score' : 'pre-score'}">
            ${isLive || isDone ? `${home?.score ?? 0} - ${away?.score ?? 0}` : 'נגד'}
          </div>
          <div class="mi-team away-mi">
            <span class="mi-flag">${teamFlag(aName)}</span>
            <span>${translateTeam(aName)}</span>
          </div>
        </div>
        <div class="mi-bottom">
          <span class="mi-clock ${isLive ? 'live-clock' : ''}">${isLive ? '● ' : ''}${clock}</span>
          <span class="mi-group ${isKnockoutStage(comp) ? 'mi-knockout' : ''}">${translateStage(comp)}</span>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.match-item').forEach(el =>
    el.addEventListener('click', () => openMatch(el.dataset.id))
  );
}

// ── Match Detail ──────────────────────────────────────────────────────────────

async function openMatch(id) {
  currentFixtureId = id;
  Object.keys(statHistory).forEach(k => delete statHistory[k]);
  sportHistory.length = 0;
  expandedStat = null;
  loadStatHistoryFromStorage(); // restore previous session data
  $('section-matches').classList.add('hidden');
  $('section-detail').classList.remove('hidden');
  clearInterval(refreshTimer);
  await refreshDetail();
  refreshTimer = setInterval(refreshDetail, REFRESH_MS);
}

async function refreshDetail() {
  if (!currentFixtureId) return;
  try {
    const data = await fetchJSON(`${ESPN_BASE}/${LEAGUE}/summary?event=${currentFixtureId}`);
    renderDetail(data);
    const t = new Date();
    $('update-text').textContent = `עודכן: ${t.toLocaleTimeString('he-IL')} · מתרענן כל 2 שניות`;
  } catch (e) {
    $('update-text').textContent = `שגיאה בעדכון: ${e.message}`;
  }
}

function renderDetail(data) {
  const comp = data.header?.competitions?.[0];
  if (!comp) return;

  const home   = comp.competitors.find(c => c.homeAway === 'home');
  const away   = comp.competitors.find(c => c.homeAway === 'away');
  const hName  = home?.team?.displayName || '';
  const aName  = away?.team?.displayName || '';

  $('home-flag').textContent = teamFlag(hName);
  $('away-flag').textContent = teamFlag(aName);
  $('home-name').textContent = translateTeam(hName);
  $('away-name').textContent = translateTeam(aName);
  $('home-score').textContent = home?.score ?? 0;
  $('away-score').textContent = away?.score ?? 0;
  $('sb-clock').textContent   = formatClock(comp);
  const stageText = translateStage(comp);
  $('sb-meta').textContent    =
    (stageText || data.header?.season?.name || '') +
    (data.gameInfo?.venue?.fullName ? ` · ${data.gameInfo.venue.fullName}` : '');

  document.body.classList.toggle('is-final', rawStage(comp).toLowerCase() === 'final');

  if (rawStage(comp).toLowerCase() === 'final' &&
      comp.status?.type?.state === 'post' &&
      !finalCelebrated[currentFixtureId]) {
    finalCelebrated[currentFixtureId] = true;
    const homeScore = parseInt(home?.score ?? 0);
    const awayScore = parseInt(away?.score ?? 0);
    const homeWon = home?.winner || (!away?.winner && homeScore > awayScore);
    const winnerName = translateTeam(homeWon ? hName : aName);
    launchConfetti();
    showWinnerBanner(`🏆 ${winnerName} — אלופת העולם 2026!`);
  }

  $('live-badge').classList.toggle('hidden', comp.status?.type?.state !== 'in');
  $('stat-home-name').textContent = translateTeam(hName);
  $('stat-away-name').textContent = translateTeam(aName);

  const keyEvents = data.keyEvents || [];
  renderKeyEvents(keyEvents, home, away);
  const minute = parseInt(comp?.status?.displayClock?.split(':')?.[0] ?? 0);
  renderSportsmanship(data.boxscore, home, away, minute);
  renderStats(data.boxscore, home, away, comp);
  renderEventsList(keyEvents, home, away);
  renderLineup(data.rosters || [], home, away);
  renderWinProb(data.pickcenter, home, away, comp, keyEvents);
}

// ── Shared helpers for ESPN event parsing ────────────────────────────────────

function isGoalEvent(e) {
  return e.scoringPlay === true
    || /goal/i.test(e.type?.text || '')
    || /^goal/i.test(e.text || '');
}

function isRedCardEvent(e) {
  return /red card/i.test(e.type?.text || e.text || '');
}

// Count red cards per side from the event feed, for the live win-prob model.
function countRedCards(keyEvents, home) {
  let homeReds = 0, awayReds = 0;
  for (const e of (keyEvents || [])) {
    if (!isRedCardEvent(e)) continue;
    if (sameTeam(e.team, home)) homeReds++; else awayReds++;
  }
  return { homeReds, awayReds };
}

function getEventMeta(e) {
  const fromType = (e.type?.text || '').toLowerCase();
  const fromText = (e.text  || '').toLowerCase();
  const combined = fromType || fromText;
  const evType   = EVENT_TYPES.find(t => combined.startsWith(t.match) || combined.includes(t.match));
  const rawLabel = e.type?.text || '';
  return {
    icon:  evType?.icon  || '•',
    label: evType?.label || rawLabel || '',
  };
}

// Parse scorer and assist from ESPN's text field when athletesInvolved is empty
// Format: "Goal! Team1 N, Team2 N. ScorerName (Team) desc. Assisted by AssistName following..."
function parseGoalText(e) {
  const players = e.athletesInvolved || [];
  if (players.length) {
    return {
      scorer: players[0]?.displayName || '',
      assist: players[1]?.displayName || '',
    };
  }
  const text = e.text || '';
  // Scorer: text after last score number and period, before first parenthesis
  const scorerMatch = text.match(/\d+\.\s*([^(]+)\s*\(/);
  const scorer = scorerMatch ? scorerMatch[1].trim() : '';
  // Assist: after "Assisted by" or "assisted by"
  const assistMatch = text.match(/[Aa]ssisted by ([A-Z][^.]+?)(?:\s+following|\.|$)/);
  const assist = assistMatch ? assistMatch[1].trim() : '';
  return { scorer, assist };
}

// Compare team IDs as strings to avoid number/string mismatch
function sameTeam(eventTeam, competitor) {
  return String(eventTeam?.id) === String(competitor?.team?.id);
}

// ── Goals strip ───────────────────────────────────────────────────────────────

function renderKeyEvents(keyEvents, home, away) {
  const goals = keyEvents.filter(isGoalEvent);
  const strip = $('goals-strip');
  if (!goals.length) { strip.innerHTML = ''; return; }

  strip.innerHTML = goals.map(e => {
    const min            = e.clock?.displayValue || '';
    const isHome         = sameTeam(e.team, home);
    const { scorer, assist } = parseGoalText(e);
    const flag = isHome
      ? teamFlag(home?.team?.displayName || '')
      : teamFlag(away?.team?.displayName || '');
    return `<div class="goal-item ${isHome ? 'goal-home' : 'goal-away'}">
      <span class="goal-flag">${flag}</span>
      <span class="goal-min">${min}'</span>
      <span class="goal-scorer">${scorer || '—'}</span>
      ${assist ? `<span class="goal-assist">(בסיוע ${assist})</span>` : ''}
    </div>`;
  }).join('');
}

// ── Sportsmanship ─────────────────────────────────────────────────────────────

// { fixtureId → [{minute, home, away}] }
const sportHistory = [];

function calcSportsScore(stats) {
  const get = name => {
    const s = stats.find(x => x.name === name);
    return parseStatNum(name, s?.displayValue ?? '0');
  };
  const fouls   = get('foulsCommitted');
  const yellows = get('yellowCards');
  const reds    = get('redCards');
  const offs    = get('offsides');
  const score = Math.max(0, 100 - fouls * 2.5 - yellows * 8 - reds * 20 - offs * 1.5);
  return Math.round(score * 10) / 10;
}

function sportScoreColor(score) {
  if (score >= 75) return '#7ed957';
  if (score >= 50) return '#d4ff3f';
  if (score >= 30) return '#ff9f1c';
  return '#ff4d6d';
}

function renderSportsmanship(boxscore, home, away, minute) {
  const container = $('sport-content');
  if (!boxscore?.teams?.length) {
    container.innerHTML = '<div class="loading">הנתונים יופיעו עם תחילת המשחק</div>';
    return;
  }

  const homeStats = (boxscore.teams.find(t => t.homeAway === 'home') || boxscore.teams[0]).statistics || [];
  const awayStats = (boxscore.teams.find(t => t.homeAway === 'away') || boxscore.teams[1]).statistics || [];

  const hScore = calcSportsScore(homeStats);
  const aScore = calcSportsScore(awayStats);

  // Accumulate history
  const last = sportHistory[sportHistory.length - 1];
  if (!last || last.minute !== minute || last.home !== hScore || last.away !== aScore) {
    sportHistory.push({ minute, home: hScore, away: aScore });
    if (sportHistory.length > 95) sportHistory.shift();
  }

  const hColor = sportScoreColor(hScore);
  const aColor = sportScoreColor(aScore);
  const hName  = translateTeam(home?.team?.displayName || '');
  const aName  = translateTeam(away?.team?.displayName || '');

  const meter = (score, color, label, align) => `
    <div class="sport-meter-wrap" style="text-align:${align}">
      <div class="sport-label">${label}</div>
      <div class="sport-score" style="color:${color}">${score}</div>
      <div class="sport-track">
        <div class="sport-fill" style="width:${score}%;background:${color}"></div>
      </div>
    </div>`;

  // Breakdown rows
  const getVal = (stats, name) => {
    const s = stats.find(x => x.name === name);
    return parseStatNum(name, s?.displayValue ?? '0');
  };

  const breakdowns = [
    { key: 'foulsCommitted', label: 'עבירות', penalty: 2.5 },
    { key: 'yellowCards',    label: 'כרטיסים צהובים', penalty: 8 },
    { key: 'redCards',       label: 'כרטיסים אדומים', penalty: 20 },
    { key: 'offsides',       label: 'נבדלים', penalty: 1.5 },
  ];

  const breakdownHtml = breakdowns.map(({ key, label, penalty }) => {
    const hV = getVal(homeStats, key);
    const aV = getVal(awayStats, key);
    const hBetter = hV <= aV;
    const aBetter = aV <= hV;
    return `
      <div class="sport-breakdown-row">
        <span class="sport-bd-val ${hBetter ? 'sport-better' : 'sport-worse'}">${hV}</span>
        <span class="sport-bd-label">${label} <span class="sport-pen">(-${penalty} לכל)</span></span>
        <span class="sport-bd-val ${aBetter ? 'sport-better' : 'sport-worse'}">${aV}</span>
      </div>`;
  }).join('');

  // Chart from history
  const chartHtml = (() => {
    const hist = sportHistory;
    if (hist.length < 2) return '';
    const W = 260, H = 52;
    const maxMin = Math.max(...hist.map(p => p.minute), 90);
    const toX = m => ((m / maxMin) * W).toFixed(1);
    const toY = v => (H - (v / 100) * H * 0.92).toFixed(1);
    const homePts = hist.map(p => `${toX(p.minute)},${toY(p.home)}`).join(' ');
    const awayPts = hist.map(p => `${toX(p.minute)},${toY(p.away)}`).join(' ');
    const xLabels = [0,15,30,45,60,75,90].filter(m => m <= maxMin)
      .map(m => `<text x="${toX(m)}" y="${H+11}" class="spark-label">${m}'</text>`).join('');
    return `
      <div class="sport-chart-title">היסטוריית ספורטביות</div>
      <svg class="sparkline spark-expanded" viewBox="0 0 ${W} ${H+14}" preserveAspectRatio="none">
        <polyline points="${homePts}" class="spark-line spark-home-line"/>
        <polyline points="${awayPts}" class="spark-line spark-away-line"/>
        ${xLabels}
      </svg>`;
  })();

  container.innerHTML = `
    <div class="sport-meters">
      ${meter(hScore, hColor, hName, 'right')}
      <div class="sport-vs">⚖️</div>
      ${meter(aScore, aColor, aName, 'left')}
    </div>
    <div class="sport-breakdown">
      ${breakdownHtml}
    </div>
    ${chartHtml ? `<div class="sport-chart-wrap">${chartHtml}</div>` : ''}`;
}

// ── Statistics + Sparklines ───────────────────────────────────────────────────

function renderStats(boxscore, home, away, comp) {
  const container = $('stats-rows');
  if (!boxscore?.teams?.length) {
    container.innerHTML = '<div class="loading">הסטטיסטיקות יופיעו עם תחילת המשחק</div>';
    return;
  }

  const homeStats = boxscore.teams.find(t => t.homeAway === 'home') || boxscore.teams[0];
  const awayStats = boxscore.teams.find(t => t.homeAway === 'away') || boxscore.teams[1];
  const awayMap   = Object.fromEntries((awayStats.statistics || []).map(s => [s.name, s]));

  // Current minute for history
  const minute = parseInt(comp?.status?.displayClock?.split(':')?.[0] ?? 0);
  updateStatHistory(minute, homeStats.statistics, awayStats.statistics);

  const rows = [];
  const seen = new Set();

  const process = (stat) => {
    if (seen.has(stat.name) || !STAT_LABELS[stat.name]) return;
    seen.add(stat.name);

    const hRaw  = stat.displayValue ?? stat.value ?? '0';
    const aStat = awayMap[stat.name];
    const aRaw  = aStat?.displayValue ?? aStat?.value ?? '0';
    const hNum  = parseStatNum(stat.name, hRaw);
    const aNum  = parseStatNum(stat.name, aRaw);
    const total = hNum + aNum;
    const hW    = total > 0 ? (hNum / total) * 100 : 50;
    const aW    = total > 0 ? (aNum / total) * 100 : 50;
    const isCard = stat.name === 'yellowCards' ? 'yellow'
                 : stat.name === 'redCards'    ? 'red' : null;

    // Secondary display value for passes: show count + accuracy
    let hDisp = formatStatValue(stat.name, hRaw);
    let aDisp = formatStatValue(stat.name, aRaw);
    let hSub  = '';
    let aSub  = '';

    // accuratePasses: show as % of totalPasses
    if (stat.name === 'accuratePasses') {
      const hTotalStat = (homeStats.statistics || []).find(s => s.name === 'totalPasses');
      const aTotalStat = awayMap['totalPasses'];
      const hTotal = parseStatNum('totalPasses', hTotalStat?.displayValue ?? '0');
      const aTotal = parseStatNum('totalPasses', aTotalStat?.displayValue ?? '0');
      hDisp = hTotal > 0 ? `${Math.round((hNum / hTotal) * 100)}%` : `${hNum}`;
      aDisp = aTotal > 0 ? `${Math.round((aNum / aTotal) * 100)}%` : `${aNum}`;
    }

    // accurateCrosses: show as % of totalCrosses
    if (stat.name === 'accurateCrosses') {
      const hTotalStat = (homeStats.statistics || []).find(s => s.name === 'totalCrosses');
      const aTotalStat = awayMap['totalCrosses'];
      const hTotal = parseStatNum('totalCrosses', hTotalStat?.displayValue ?? '0');
      const aTotal = parseStatNum('totalCrosses', aTotalStat?.displayValue ?? '0');
      hDisp = hTotal > 0 ? `${Math.round((hNum / hTotal) * 100)}%` : `${hNum}`;
      aDisp = aTotal > 0 ? `${Math.round((aNum / aTotal) * 100)}%` : `${aNum}`;
    }

    rows.push({ key: stat.name, label: STAT_LABELS[stat.name], hDisp, aDisp, hSub, aSub, hNum, aNum, hW, aW, isCard });
  };

  ORDERED_KEYS.forEach(k => {
    const s = (homeStats.statistics || []).find(x => x.name === k);
    if (s) process(s);
  });
  (homeStats.statistics || []).forEach(s => process(s));

  if (!rows.length) {
    container.innerHTML = '<div class="loading">אין סטטיסטיקות זמינות עדיין</div>';
    return;
  }

  container.innerHTML = rows.map(({ key, label, hDisp, aDisp, hSub, aSub, hNum, aNum, hW, aW, isCard }) => {
    const hHigh = hNum > aNum;
    const aHigh = aNum > hNum;
    const hBadge = hHigh
      ? (isCard === 'yellow' ? 'highlighted-yellow' : isCard === 'red' ? 'highlighted-red' : 'highlighted-home')
      : '';
    const aBadge = aHigh
      ? (isCard === 'yellow' ? 'highlighted-yellow' : isCard === 'red' ? 'highlighted-red' : 'highlighted-away')
      : '';
    const barClass = isCard === 'yellow' ? 'yellow-bar' : isCard === 'red' ? 'red-bar' : '';
    const isExp   = expandedStat === key;
    const spark   = renderSparklineSVG(key, isExp);
    const hasHist = (statHistory[key] || []).length >= 2;

    return `
      <div class="stat-block ${isExp ? 'expanded' : ''}" data-key="${key}">
        <div class="stat-row">
          <div class="stat-val ${hBadge}">${hDisp}</div>
          <div class="stat-name">
            ${label}
            ${hasHist ? `<span class="chart-toggle">📈</span>` : ''}
          </div>
          <div class="stat-val ${aBadge}">${aDisp}</div>
        </div>
        <div class="stat-bars">
          <div class="stat-bar-wrap home-wrap">
            <div class="stat-bar home-bar ${barClass}" style="width:${hW.toFixed(1)}%"></div>
          </div>
          <div class="stat-bar-wrap away-wrap">
            <div class="stat-bar away-bar ${barClass}" style="width:${aW.toFixed(1)}%"></div>
          </div>
        </div>
        ${spark ? `<div class="spark-wrap">${spark}</div>` : ''}
      </div>`;
  }).join('');

  // Click to expand/collapse chart
  container.querySelectorAll('.stat-block').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      expandedStat = expandedStat === key ? null : key;
      // Re-render only stats section to avoid full re-render flicker
      // We trigger a manual re-render using cached data
      el.classList.toggle('expanded');
      const sparkWrap = el.querySelector('.spark-wrap');
      const isNowExp  = el.classList.contains('expanded');
      if (sparkWrap) {
        sparkWrap.innerHTML = renderSparklineSVG(key, isNowExp);
      } else if (isNowExp) {
        const svg = renderSparklineSVG(key, true);
        if (svg) {
          const div = document.createElement('div');
          div.className = 'spark-wrap';
          div.innerHTML = svg;
          el.appendChild(div);
        }
      }
    });
  });
}

// ── Win Probability Timeline (reconstructed from goals) ──────────────────────

function buildWinProbTimeline(keyEvents, pickcenter, homeComp, awayComp, currentMinute, knockout = false) {
  const pc = Array.isArray(pickcenter) ? pickcenter[0] : pickcenter;
  const pickHomeId     = pc?.homeTeamOdds?.team?.id;
  const isHomePickHome = String(pickHomeId) === String(homeComp?.team?.id);
  const hML = isHomePickHome ? pc?.homeTeamOdds?.moneyLine : pc?.awayTeamOdds?.moneyLine;
  const aML = isHomePickHome ? pc?.awayTeamOdds?.moneyLine : pc?.homeTeamOdds?.moneyLine;
  const dML = pc?.drawOdds?.moneyLine ?? null;
  if (!hML || !aML) return [];

  // Sort goals by minute
  const goals = keyEvents
    .filter(isGoalEvent)
    .map(e => ({
      minute:  parseInt(e.clock?.displayValue?.split(':')?.[0] ?? 0),
      forHome: sameTeam(e.team, homeComp),
    }))
    .sort((a, b) => a.minute - b.minute);

  const maxMin = Math.max(currentMinute || 1, goals.length ? goals[goals.length - 1].minute : 1, 5);
  const step   = maxMin > 45 ? 2 : 1; // 1-min steps in first half, 2-min in second
  const timeline = [];
  let hScore = 0, aScore = 0, gi = 0;

  for (let m = 0; m <= maxMin; m += step) {
    while (gi < goals.length && goals[gi].minute <= m) {
      if (goals[gi].forHome) hScore++; else aScore++;
      gi++;
    }
    let prob = calcLiveWinProb(hML, aML, dML, hScore, aScore, m);
    if (knockout) prob = stripDraw(prob);
    timeline.push({ minute: m, home: prob.home, draw: prob.draw, away: prob.away });
  }
  return timeline;
}

function renderWinProbChart(timeline, knockout = false) {
  if (timeline.length < 2) return '';
  const W = 260, H = 64;
  const maxMin = timeline[timeline.length - 1].minute;
  const toX = m  => ((m  / maxMin) * W).toFixed(1);
  const toY = p  => (H - p * H * 0.95).toFixed(1);

  const homePts = timeline.map(p => `${toX(p.minute)},${toY(p.home)}`).join(' ');
  const drawPts = timeline.map(p => `${toX(p.minute)},${toY(p.draw)}`).join(' ');
  const awayPts = timeline.map(p => `${toX(p.minute)},${toY(p.away)}`).join(' ');

  // Goal marker lines
  const goalLines = timeline
    .filter((p, i) => i > 0 &&
      (timeline[i - 1].home !== p.home || timeline[i - 1].away !== p.away))
    .map(p => `<line x1="${toX(p.minute)}" y1="0" x2="${toX(p.minute)}" y2="${H}"
       class="goal-line"/>`)
    .join('');

  const xLabels = [0, 15, 30, 45, 60, 75, 90]
    .filter(m => m <= maxMin + 2)
    .map(m => `<text x="${toX(Math.min(m, maxMin))}" y="${H + 12}" class="spark-label">${m}'</text>`)
    .join('');

  // Legend (no draw entry for knockout matches — there's no such outcome)
  const lx = W - 80;
  const legend = knockout ? `
    <rect x="${lx}" y="2" width="8" height="3" fill="#00d9c0" rx="1"/>
    <text x="${lx + 11}" y="6" class="spark-label" text-anchor="start">בית</text>
    <rect x="${lx}" y="10" width="8" height="3" fill="#ff4d6d" rx="1"/>
    <text x="${lx + 11}" y="14" class="spark-label" text-anchor="start">חוץ</text>` : `
    <rect x="${lx}" y="2" width="8" height="3" fill="#00d9c0" rx="1"/>
    <text x="${lx + 11}" y="6" class="spark-label" text-anchor="start">בית</text>
    <rect x="${lx}" y="10" width="8" height="3" fill="#5c5c58" rx="1"/>
    <text x="${lx + 11}" y="14" class="spark-label" text-anchor="start">תיקו</text>
    <rect x="${lx}" y="18" width="8" height="3" fill="#ff4d6d" rx="1"/>
    <text x="${lx + 11}" y="22" class="spark-label" text-anchor="start">חוץ</text>`;

  return `
    <svg class="win-prob-chart" viewBox="0 0 ${W} ${H + 14}" preserveAspectRatio="none">
      ${goalLines}
      <polyline points="${homePts}" class="spark-line spark-home-line"/>
      ${knockout ? '' : `<polyline points="${drawPts}" class="spark-line spark-draw-line"/>`}
      <polyline points="${awayPts}" class="spark-line spark-away-line"/>
      ${xLabels}
      ${legend}
    </svg>`;
}

// ── Win Probability ───────────────────────────────────────────────────────────

function poissonPMF(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lam);
  for (let i = 1; i <= k; i++) p *= lam / i;
  return p;
}

const toImplied = ml =>
  ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);

// Vig-free 1X2 probabilities from moneyline odds
function marketProbs(homeML, awayML, drawML) {
  const rawH = toImplied(homeML);
  const rawA = toImplied(awayML);
  const rawD = drawML != null ? toImplied(drawML) : 0.27;
  const tot  = rawH + rawA + rawD;
  return { pH: rawH / tot, pD: rawD / tot, pA: rawA / tot };
}

// Full-time 1X2 probabilities for a pair of Poisson scoring rates.
// `diff` lets the current scoreline carry through to the final result.
function poisson1X2(lamH, lamA, diff = 0, MAX = 12) {
  let wH = 0, wD = 0, wA = 0;
  for (let i = 0; i <= MAX; i++) {
    const pi = poissonPMF(i, lamH);
    for (let j = 0; j <= MAX; j++) {
      const p = pi * poissonPMF(j, lamA);
      const d = diff + i - j;
      if (d > 0) wH += p; else if (d === 0) wD += p; else wA += p;
    }
  }
  const t = wH + wD + wA;
  return { home: wH / t, draw: wD / t, away: wA / t };
}

// A team's true scoring rate on a given day isn't the fixed market average —
// it varies with form, fitness, tactics. Negative-binomial (Gamma-Poisson
// mixture) captures that extra match-to-match variance; fixed-rate Poisson
// cannot. NB_DISPERSION is a moderate value from that literature range —
// this only fattens late-game tails a little, it does not manufacture a
// "score effect" boost (evidence for one in soccer is contested; see
// calcLiveWinProb).
const NB_DISPERSION = 4;

function negBinomPMF(x, mu, k) {
  if (mu <= 0) return x === 0 ? 1 : 0;
  let p = Math.pow(k / (k + mu), k);
  for (let i = 1; i <= x; i++) p *= (i - 1 + k) / i * (mu / (k + mu));
  return p;
}

// Same enumeration as poisson1X2, but with fattened tails via negative binomial.
function negBinom1X2(lamH, lamA, diff = 0, MAX = 12) {
  let wH = 0, wD = 0, wA = 0;
  for (let i = 0; i <= MAX; i++) {
    const pi = negBinomPMF(i, lamH, NB_DISPERSION);
    for (let j = 0; j <= MAX; j++) {
      const p = pi * negBinomPMF(j, lamA, NB_DISPERSION);
      const d = diff + i - j;
      if (d > 0) wH += p; else if (d === 0) wD += p; else wA += p;
    }
  }
  const t = wH + wD + wA;
  return { home: wH / t, draw: wD / t, away: wA / t };
}

// Solve for the home/away expected goals (over a full match) whose Poisson
// model reproduces the market's 1X2 probabilities. Parametrised by total goals
// (L) and supremacy (S = home − away): L drives the draw rate, S the balance.
// Cached per odds line since it only depends on the market, not the live score.
const _lambdaCache = new Map();
function calibrateLambdas(pH, pD, pA) {
  const key = `${pH.toFixed(3)}|${pD.toFixed(3)}`;
  const cached = _lambdaCache.get(key);
  if (cached) return cached;

  let L = 2.6, S = 0;
  for (let iter = 0; iter < 80; iter++) {
    const lamH = Math.max(0.04, (L + S) / 2);
    const lamA = Math.max(0.04, (L - S) / 2);
    const pr   = poisson1X2(lamH, lamA);
    // Nudge supremacy toward the win/loss imbalance, total toward the draw rate.
    S += ((pH - pA) - (pr.home - pr.away)) * 1.5;
    L += (pr.draw - pD) * 2.5;
    L = Math.min(6, Math.max(0.3, L));
    S = Math.min(5, Math.max(-5, S));
  }
  const res = { lamH: Math.max(0.04, (L + S) / 2), lamA: Math.max(0.04, (L - S) / 2) };
  _lambdaCache.set(key, res);
  return res;
}

// Regulation + typical stoppage time (FiveThirtyEight's soccer model uses a
// ~96-minute average match: 2' added in the first half, 4' in the second).
const MATCH_MINUTES = 96;

// Goals arrive faster as a match goes on — FiveThirtyEight found the scoring
// rate at the 85th minute runs ~1.4x the rate at the 5th. LATE_SURGE is
// calibrated so remainingGoalFraction reproduces that ratio; a flat linear
// countdown ignores this and writes off a trailing team's chances too fast.
const LATE_SURGE = 0.395;

// Fraction of a team's full-match expected goals still to come at `minute`.
// frac(0) = 1 (whole match ahead), frac(MATCH_MINUTES) = 0 (final whistle).
function remainingGoalFraction(minute) {
  const m = Math.min(MATCH_MINUTES, Math.max(0, minute));
  const linear = (MATCH_MINUTES - m) / MATCH_MINUTES;
  return Math.max(0, linear * (1 + (LATE_SURGE / 2) * (m / MATCH_MINUTES)));
}

// A sending-off shifts both sides' scoring rates: the extra man boosts the
// opponent's attack and dents the reduced side's own output. Magnitude is a
// rough consensus figure from in-play modeling literature (~15-20% swing per
// card); since this multiplies the already time-scaled lambda, the raw goal
// impact naturally fades as fewer minutes remain — matching the finding that
// a red card's effect on win probability decays over the rest of the match.
const RED_CARD_ATTACK_BOOST = 0.18;
const RED_CARD_DEFENSE_DROP = 0.22;

function applyRedCardImpact(lamH, lamA, homeReds = 0, awayReds = 0) {
  const advantage = (awayReds || 0) - (homeReds || 0); // + → home has extra man
  const homeMult = 1 + RED_CARD_ATTACK_BOOST * Math.max(0, advantage) - RED_CARD_DEFENSE_DROP * Math.max(0, -advantage);
  const awayMult = 1 + RED_CARD_ATTACK_BOOST * Math.max(0, -advantage) - RED_CARD_DEFENSE_DROP * Math.max(0, advantage);
  return {
    homeLam: Math.max(0, lamH * homeMult),
    awayLam: Math.max(0, lamA * awayMult),
  };
}

// Deliberate UX floor, not a statistical correction: the trailing side's
// live win% gets multiplied up and given a floor, then everything is
// renormalized. Requested explicitly because the honest model's low
// single-digit numbers for a 1-goal-down comeback read as "too low" against
// user expectations, even though they're what a calibrated model produces.
const UNDERDOG_BOOST = 2.0;
const UNDERDOG_FLOOR = 0.05;

// `diff` is the actual scoreboard gap (home − away). Only the side that is
// literally behind on the scoreboard gets raised — a market underdog who is
// level or ahead is left alone. (Previously this boosted whichever side the
// model rated lower, which also fired on level scores and could flip a real
// market favorite into looking like the underdog.)
function raiseUnderdogFloor(prob, diff) {
  if (diff === 0) return prob;
  const trailingSide = diff > 0 ? 'away' : 'home';
  const boosted = { ...prob };
  boosted[trailingSide] = Math.max(prob[trailingSide] * UNDERDOG_BOOST, UNDERDOG_FLOOR);
  const total = boosted.home + boosted.draw + boosted.away;
  return { home: boosted.home / total, draw: boosted.draw / total, away: boosted.away / total };
}

function calcLiveWinProb(homeML, awayML, drawML, homeScore, awayScore, minute, homeReds = 0, awayReds = 0) {
  const { pH, pD, pA } = marketProbs(homeML, awayML, drawML);
  const { lamH, lamA } = calibrateLambdas(pH, pD, pA);

  const frac = remainingGoalFraction(minute);
  const { homeLam, awayLam } = applyRedCardImpact(lamH * frac, lamA * frac, homeReds, awayReds);

  const diff = homeScore - awayScore;
  // No time left → only the current scoreline matters.
  const MAX  = frac > 0 ? 10 : 0;
  return raiseUnderdogFloor(negBinom1X2(homeLam, awayLam, diff, MAX), diff);
}

// Percentage with up to 2 decimals, trailing zeros trimmed
// (e.g. 45 → "45%", 45.3 → "45.3%", 45.328 → "45.33%").
function fmtPct(v) {
  return `${parseFloat(v.toFixed(2))}%`;
}

// Knockout matches can't end in a draw (extra time / penalties decide it),
// so any draw probability mass gets folded proportionally into home/away.
function stripDraw(prob) {
  const total = prob.home + prob.away;
  if (total <= 0) return { home: 0.5, draw: 0, away: 0.5 };
  return { home: prob.home / total, draw: 0, away: prob.away / total };
}

function renderWinProb(pickcenter, home, away, comp, keyEvents) {
  const probCard = $('prob-card');
  if (!probCard) return;
  const pc = Array.isArray(pickcenter) ? pickcenter[0] : pickcenter;
  const homeML = pc?.homeTeamOdds?.moneyLine;
  const awayML = pc?.awayTeamOdds?.moneyLine;
  const drawML = pc?.drawOdds?.moneyLine ?? null;
  if (homeML == null || awayML == null) { probCard.classList.add('hidden'); return; }

  const homeScore = parseInt(home?.score ?? 0);
  const awayScore = parseInt(away?.score ?? 0);
  const minute    = parseInt(comp?.status?.displayClock?.split(':')?.[0] ?? 0);
  const state     = comp?.status?.type?.state;
  const knockout  = isKnockoutStage(comp);

  const pickHomeId     = pc.homeTeamOdds?.team?.id;
  const isHomePickHome = String(pickHomeId) === String(home?.team?.id);
  const hML = isHomePickHome ? homeML : awayML;
  const aML = isHomePickHome ? awayML : homeML;

  let prob;
  if (state === 'post') {
    if (knockout) {
      // Draws in regulation get settled by extra time/penalties — ESPN marks
      // the actual winner on the competitor object, so trust that over the score.
      if (home?.winner)      prob = { home: 1, draw: 0, away: 0 };
      else if (away?.winner) prob = { home: 0, draw: 0, away: 1 };
      else if (homeScore > awayScore) prob = { home: 1, draw: 0, away: 0 };
      else                             prob = { home: 0, draw: 0, away: 1 };
    } else if (homeScore > awayScore)      prob = { home: 1, draw: 0, away: 0 };
    else if (homeScore < awayScore) prob = { home: 0, draw: 0, away: 1 };
    else                            prob = { home: 0, draw: 1, away: 0 };
  } else if (state === 'pre') {
    const m = marketProbs(hML, aML, drawML);
    prob = { home: m.pH, draw: m.pD, away: m.pA };
    if (knockout) prob = stripDraw(prob);
  } else {
    const { homeReds, awayReds } = countRedCards(keyEvents, home);
    prob = calcLiveWinProb(hML, aML, drawML, homeScore, awayScore, minute, homeReds, awayReds);
    if (knockout) prob = stripDraw(prob);
  }

  const hPct = prob.home * 100;
  const dPct = prob.draw * 100;
  const aPct = prob.away * 100;

  probCard.classList.toggle('no-draw', knockout);
  $('wp-home-name').textContent  = translateTeam(home?.team?.displayName || '');
  $('wp-away-name').textContent  = translateTeam(away?.team?.displayName || '');
  $('wp-home-pct').textContent   = fmtPct(hPct);
  $('wp-draw-pct').textContent   = fmtPct(dPct);
  $('wp-away-pct').textContent   = fmtPct(aPct);
  $('prob-seg-home').style.width = `${hPct.toFixed(2)}%`;
  $('prob-seg-draw').style.width = `${dPct.toFixed(2)}%`;
  $('prob-seg-away').style.width = `${aPct.toFixed(2)}%`;
  probCard.classList.remove('hidden');

  // Win probability chart (full match history reconstructed from goals)
  const timeline = buildWinProbTimeline(keyEvents || [], pickcenter, home, away, minute, knockout);
  const chartEl  = $('wp-chart');
  if (chartEl) chartEl.innerHTML = renderWinProbChart(timeline, knockout);
}

// ── Events list ───────────────────────────────────────────────────────────────

function renderEventsList(keyEvents, home, away) {
  const container = $('events-list');
  if (!keyEvents.length) { container.innerHTML = '<div class="loading">אין אירועים עדיין</div>'; return; }

  const filtered = keyEvents.filter(e => {
    const t = e.type?.text || '';
    return !/^(start delay|end delay|injury update)/i.test(t);
  });

  container.innerHTML = [...filtered].reverse().map(e => {
    const { icon, label } = getEventMeta(e);
    const min      = e.clock?.displayValue || '';
    const isHome   = sameTeam(e.team, home);
    const teamName = e.team ? translateTeam(e.team.displayName || '') : '';
    const { scorer: gScorer, assist: gAssist } = isGoalEvent(e) ? parseGoalText(e) : {};
    const players = gScorer
      ? gScorer
      : (e.athletesInvolved?.map(a => a.displayName).join(', ') || '');
    const assist = gAssist
      ? `<div class="ev-assist">בסיוע: ${gAssist}</div>`
      : '';

    return `
      <div class="event-item ${teamName ? (isHome ? 'event-home' : 'event-away') : 'event-neutral'}">
        <span class="ev-min">${min}</span>
        <span class="ev-icon">${icon}</span>
        <div class="ev-body">
          <div class="ev-label">${label}${teamName ? ` · ${teamName}` : ''}</div>
          ${players ? `<div class="ev-player">${players}</div>` : ''}
          ${assist}
        </div>
      </div>`;
  }).join('');
}

// ── Lineup ────────────────────────────────────────────────────────────────────

function renderLineup(rosters, home, away) {
  const container = $('lineup-content');
  if (!rosters.length) { container.innerHTML = '<div class="loading">אין הרכב זמין</div>'; return; }

  const homeRoster = rosters.find(r => r.homeAway === 'home') || rosters[0];
  const awayRoster = rosters.find(r => r.homeAway === 'away') || rosters[1];

  const renderPlayers = (roster) => {
    const players  = roster?.roster || [];
    if (!players.length) return '<div class="loading">אין שחקנים</div>';
    const starters = players.filter(p => p.starter);
    const subs     = players.filter(p => !p.starter);
    const row = p => `
      <div class="player-row">
        <span class="p-num">${p.jersey || ''}</span>
        <span class="p-pos">${p.position?.abbreviation || ''}</span>
        <span class="p-name">${p.athlete?.displayName || '—'}${p.subbedIn ? ' 🔼' : ''}${p.subbedOut ? ' 🔽' : ''}</span>
      </div>`;
    return starters.map(row).join('') +
      (subs.length ? `<div class="lineup-subs-label">חילופין</div>${subs.map(row).join('')}` : '');
  };

  container.innerHTML = `
    <div class="lineup-grid">
      <div class="lineup-col">
        <div class="lineup-team-name">${translateTeam(homeRoster.team?.displayName || '')}</div>
        ${renderPlayers(homeRoster)}
      </div>
      <div class="lineup-col">
        <div class="lineup-team-name">${translateTeam(awayRoster?.team?.displayName || '')}</div>
        ${renderPlayers(awayRoster)}
      </div>
    </div>`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(tab.dataset.panel)?.classList.remove('hidden');
  });
});

$('back-btn').addEventListener('click', () => {
  clearInterval(refreshTimer);
  currentFixtureId = null;
  document.body.classList.remove('is-final');
  $('section-detail').classList.add('hidden');
  $('section-matches').classList.remove('hidden');
  loadMatchList();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(refreshTimer);
  } else if (currentFixtureId) {
    refreshDetail();
    refreshTimer = setInterval(refreshDetail, REFRESH_MS);
  }
});

// ── Team data ─────────────────────────────────────────────────────────────────

const TEAM_FLAG = {
  'Bosnia and Herzegovina':'🇧🇦','Bosnia-Herzegovina':'🇧🇦',
  'Canada':'🇨🇦','Brazil':'🇧🇷','Argentina':'🇦🇷','France':'🇫🇷',
  'Germany':'🇩🇪','Spain':'🇪🇸','England':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Portugal':'🇵🇹',
  'Netherlands':'🇳🇱','Italy':'🇮🇹','Belgium':'🇧🇪','Uruguay':'🇺🇾',
  'Croatia':'🇭🇷','Serbia':'🇷🇸','Switzerland':'🇨🇭','Denmark':'🇩🇰',
  'Mexico':'🇲🇽','United States':'🇺🇸','USA':'🇺🇸','Japan':'🇯🇵',
  'South Korea':'🇰🇷','Morocco':'🇲🇦','Senegal':'🇸🇳','Ghana':'🇬🇭',
  'Ecuador':'🇪🇨','Costa Rica':'🇨🇷','Saudi Arabia':'🇸🇦','Iran':'🇮🇷',
  'Australia':'🇦🇺','Tunisia':'🇹🇳','Cameroon':'🇨🇲','Wales':'🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'Poland':'🇵🇱','Qatar':'🇶🇦','Panama':'🇵🇦','Venezuela':'🇻🇪',
  'Colombia':'🇨🇴','Paraguay':'🇵🇾','Chile':'🇨🇱','Peru':'🇵🇪',
  'Jamaica':'🇯🇲','Honduras':'🇭🇳','Turkey':'🇹🇷','Czech Republic':'🇨🇿',
  'Austria':'🇦🇹','Scotland':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','Albania':'🇦🇱','Slovakia':'🇸🇰',
  'Slovenia':'🇸🇮','Ukraine':'🇺🇦','Romania':'🇷🇴','Hungary':'🇭🇺',
  'Georgia':'🇬🇪','New Zealand':'🇳🇿','El Salvador':'🇸🇻','Nigeria':'🇳🇬',
  'Egypt':'🇪🇬','Algeria':'🇩🇿','Ivory Coast':'🇨🇮','Mali':'🇲🇱',
  'DR Congo':'🇨🇩','South Africa':'🇿🇦','Angola':'🇦🇴','China':'🇨🇳',
  'Iraq':'🇮🇶','Jordan':'🇯🇴','Uzbekistan':'🇺🇿','Indonesia':'🇮🇩',
};

const TEAM_HE = {
  'Bosnia and Herzegovina':'בוסניה והרצגובינה','Bosnia-Herzegovina':'בוסניה והרצגובינה',
  'Canada':'קנדה','Brazil':'ברזיל','Argentina':'ארגנטינה','France':'צרפת',
  'Germany':'גרמניה','Spain':'ספרד','England':'אנגליה','Portugal':'פורטוגל',
  'Netherlands':'הולנד','Italy':'איטליה','Belgium':'בלגיה','Uruguay':'אורוגוואי',
  'Croatia':'קרואטיה','Serbia':'סרביה','Switzerland':'שווייץ','Denmark':'דנמרק',
  'Mexico':'מקסיקו','United States':'ארצות הברית','USA':'ארצות הברית',
  'Japan':'יפן','South Korea':'קוריאה הדרומית','Morocco':'מרוקו','Senegal':'סנגל',
  'Ghana':'גאנה','Ecuador':'אקוודור','Costa Rica':'קוסטה ריקה',
  'Saudi Arabia':'ערב הסעודית','Iran':'איראן','Australia':'אוסטרליה',
  'Tunisia':'תוניסיה','Cameroon':'קמרון','Wales':'ויילס','Poland':'פולין',
  'Qatar':'קטר','Panama':'פנמה','Venezuela':'ונצואלה','Colombia':'קולומביה',
  'Paraguay':'פרגוואי','Chile':"צ'ילה",'Peru':'פרו','Jamaica':"ג'מייקה",
  'Honduras':'הונדורס','Turkey':'טורקיה','Czech Republic':"צ'כיה",
  'Austria':'אוסטריה','Scotland':'סקוטלנד','Albania':'אלבניה',
  'Slovakia':'סלובקיה','Slovenia':'סלובניה','Ukraine':'אוקראינה',
  'Romania':'רומניה','Hungary':'הונגריה','Georgia':'גאורגיה',
  'New Zealand':'ניו זילנד','El Salvador':'אל סלבדור','Nigeria':'ניגריה',
  'Egypt':'מצרים','Algeria':"אלג'יריה",'Ivory Coast':'חוף השנהב',
  'Mali':'מאלי','DR Congo':'קונגו','South Africa':'דרום אפריקה',
  'Angola':'אנגולה','China':'סין','Iraq':'עיראק','Jordan':'ירדן',
  'Uzbekistan':'אוזבקיסטן','Indonesia':'אינדונזיה',
};

// ── Init ──────────────────────────────────────────────────────────────────────

loadMatchList();
setInterval(() => { if (!currentFixtureId) loadMatchList(); }, 60_000);
