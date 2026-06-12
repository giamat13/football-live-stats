const ESPN_BASE  = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUE     = 'fifa.world';
const REFRESH_MS = 1_000;

const STAT_LABELS = {
  shotsOnTarget:   'ביצועות למסגרת',
  totalShots:      'ביצועות',
  possessionPct:   'החזקת כדור',
  foulsCommitted:  'עבירות',
  yellowCards:     'כרטיסים צהובים',
  redCards:        'כרטיסים אדומים',
  offsides:        'נבדלים',
  wonCorners:      'קרנות',
  saves:           'הצלות שוער',
  blockedShots:    'חסימות',
  totalPass:       'מסירות',
  accuratePass:    'מסירות מדויקות',
  bigChances:      'הזדמנויות גדולות',
  bigChanceMissed: 'הזדמנויות שהוחמצו',
  tackles:         'תפיסות',
  interceptions:   'יירוטים',
  dribbles:        'דריבלים',
};

const ORDERED_KEYS = [
  'shotsOnTarget', 'totalShots', 'possessionPct',
  'totalPass', 'accuratePass',
  'foulsCommitted', 'yellowCards', 'redCards',
  'offsides', 'wonCorners', 'saves',
  'blockedShots', 'tackles', 'interceptions',
  'bigChances', 'bigChanceMissed', 'dribbles',
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
          <stop offset="0%" stop-color="#5b7fe8" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#5b7fe8" stop-opacity="0.02"/>
        </linearGradient>
        <linearGradient id="ga${statKey}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e85b5b" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#e85b5b" stop-opacity="0.02"/>
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
          <span class="mi-group">${comp.groups?.shortName || ''}</span>
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
  $('sb-meta').textContent    =
    (data.header?.season?.name || '') +
    (data.gameInfo?.venue?.fullName ? ` · ${data.gameInfo.venue.fullName}` : '');

  $('live-badge').classList.toggle('hidden', comp.status?.type?.state !== 'in');
  $('stat-home-name').textContent = translateTeam(hName);
  $('stat-away-name').textContent = translateTeam(aName);

  const keyEvents = data.keyEvents || [];
  renderKeyEvents(keyEvents, home, away);
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

    // accuratePass shown as separate row with % format only
    if (stat.name === 'accuratePass') {
      const hTotal = parseStatNum('totalPass',
        (homeStats.statistics || []).find(s => s.name === 'totalPass')?.displayValue ?? '0');
      const aTotal = parseStatNum('totalPass',
        awayMap['totalPass']?.displayValue ?? '0');
      hDisp = hTotal > 0 ? `${Math.round((hNum / hTotal) * 100)}%` : '0%';
      aDisp = aTotal > 0 ? `${Math.round((aNum / aTotal) * 100)}%` : '0%';
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

function buildWinProbTimeline(keyEvents, pickcenter, homeComp, awayComp, currentMinute) {
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
    const prob = calcLiveWinProb(hML, aML, dML, hScore, aScore, m);
    timeline.push({ minute: m, home: prob.home, draw: prob.draw, away: prob.away });
  }
  return timeline;
}

function renderWinProbChart(timeline) {
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

  // Legend
  const lx = W - 80;
  const legend = `
    <rect x="${lx}" y="2" width="8" height="3" fill="#5b7fe8" rx="1"/>
    <text x="${lx + 11}" y="6" class="spark-label" text-anchor="start">בית</text>
    <rect x="${lx}" y="10" width="8" height="3" fill="#7a7fa8" rx="1"/>
    <text x="${lx + 11}" y="14" class="spark-label" text-anchor="start">תיקו</text>
    <rect x="${lx}" y="18" width="8" height="3" fill="#e85b5b" rx="1"/>
    <text x="${lx + 11}" y="22" class="spark-label" text-anchor="start">חוץ</text>`;

  return `
    <svg class="win-prob-chart" viewBox="0 0 ${W} ${H + 14}" preserveAspectRatio="none">
      ${goalLines}
      <polyline points="${homePts}" class="spark-line spark-home-line"/>
      <polyline points="${drawPts}" class="spark-line spark-draw-line"/>
      <polyline points="${awayPts}" class="spark-line spark-away-line"/>
      ${xLabels}
      ${legend}
    </svg>`;
}

// ── Win Probability ───────────────────────────────────────────────────────────

function poissonPMF(k, lam) {
  if (lam === 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lam);
  for (let i = 1; i <= k; i++) p *= lam / i;
  return p;
}

function calcLiveWinProb(homeML, awayML, drawML, homeScore, awayScore, minute) {
  const toImplied = ml => ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
  const rawH = toImplied(homeML);
  const rawA = toImplied(awayML);
  const rawD = drawML != null ? toImplied(drawML) : 0.27;
  const tot  = rawH + rawA + rawD;
  const pH   = rawH / tot;
  const pA   = rawA / tot;

  const ratio  = Math.sqrt(pH / pA);
  const xgHome = 2.7 * ratio / (ratio + 1 / ratio);
  const xgAway = 2.7 - xgHome;

  const rem  = Math.max(0, 90 - minute);
  const lamH = xgHome * rem / 90;
  const lamA = xgAway * rem / 90;

  const MAX = 10;
  const diff = homeScore - awayScore;
  let wH = 0, wD = 0, wA = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPMF(i, lamH) * poissonPMF(j, lamA);
      const d = diff + i - j;
      if (d > 0) wH += p; else if (d === 0) wD += p; else wA += p;
    }
  }
  const t = wH + wD + wA;
  return { home: wH / t, draw: wD / t, away: wA / t };
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

  const pickHomeId     = pc.homeTeamOdds?.team?.id;
  const isHomePickHome = String(pickHomeId) === String(home?.team?.id);
  const hML = isHomePickHome ? homeML : awayML;
  const aML = isHomePickHome ? awayML : homeML;

  let prob;
  if (state === 'post') {
    if (homeScore > awayScore)      prob = { home: 1, draw: 0, away: 0 };
    else if (homeScore < awayScore) prob = { home: 0, draw: 0, away: 1 };
    else                            prob = { home: 0, draw: 1, away: 0 };
  } else if (state === 'pre') {
    const rH = toImpliedSimple(hML), rA = toImpliedSimple(aML), rD = drawML ? toImpliedSimple(drawML) : 0.27;
    const t  = rH + rA + rD;
    prob = { home: rH/t, draw: rD/t, away: rA/t };
  } else {
    prob = calcLiveWinProb(hML, aML, drawML, homeScore, awayScore, minute);
  }

  const hPct = Math.round(prob.home * 100);
  const dPct = Math.round(prob.draw * 100);
  const aPct = 100 - hPct - dPct;

  $('wp-home-name').textContent  = translateTeam(home?.team?.displayName || '');
  $('wp-away-name').textContent  = translateTeam(away?.team?.displayName || '');
  $('wp-home-pct').textContent   = `${hPct}%`;
  $('wp-draw-pct').textContent   = `${dPct}%`;
  $('wp-away-pct').textContent   = `${aPct}%`;
  $('prob-seg-home').style.width = `${hPct}%`;
  $('prob-seg-draw').style.width = `${dPct}%`;
  $('prob-seg-away').style.width = `${aPct}%`;
  probCard.classList.remove('hidden');

  // Win probability chart (full match history reconstructed from goals)
  const timeline = buildWinProbTimeline(keyEvents || [], pickcenter, home, away, minute);
  const chartEl  = $('wp-chart');
  if (chartEl) chartEl.innerHTML = renderWinProbChart(timeline);
}

function toImpliedSimple(ml) {
  return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
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
