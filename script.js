const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUE    = 'fifa.world';
const REFRESH_MS = 2_000;

// Exact stat keys returned by the ESPN API
const STAT_LABELS = {
  shotsOnTarget:    'ביצועות למסגרת',
  totalShots:       'ביצועות',
  possessionPct:    'החזקת כדור',
  foulsCommitted:   'עבירות',
  yellowCards:      'כרטיסים צהובים',
  redCards:         'כרטיסים אדומים',
  offsides:         'נבדלים',
  wonCorners:       'קרנות',
  saves:            'הצלות שוער',
  blockedShots:     'חסימות',
  totalPass:        'מסירות',
  accuratePass:     'מסירות מדויקות',
  bigChances:       'הזדמנויות גדולות',
  bigChanceMissed:  'הזדמנויות שהוחמצו',
  tackles:          'תפיסות',
  interceptions:    'יירוטים',
  dribbles:         'דריבלים',
};

// Icon for each event type keyword
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

let currentFixtureId = null;
let refreshTimer     = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function translateTeam(name) {
  return TEAM_HE[name] || name;
}

function formatStatValue(name, raw) {
  if (name === 'possessionPct') return `${Math.round(parseFloat(raw) || 0)}%`;
  return String(raw);
}

function parseStatNum(name, raw) {
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

// ── Match List ────────────────────────────────────────────────────────────────

async function loadMatchList() {
  const list = $('match-list');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const data   = await fetchJSON(`${ESPN_BASE}/${LEAGUE}/scoreboard`);
    const events = data.events || [];
    renderMatchList(events);
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

    return `
      <div class="match-item ${isLive ? 'live' : ''}" data-id="${ev.id}">
        <div class="mi-teams">
          <div class="mi-team home-mi">
            <img src="${home?.team?.logo || ''}" class="mi-logo" onerror="this.style.display='none'" />
            <span>${translateTeam(home?.team?.displayName || '')}</span>
          </div>
          <div class="mi-score ${isDone ? 'done' : isLive ? 'live-score' : 'pre-score'}">
            ${isLive || isDone
              ? `${home?.score ?? 0} - ${away?.score ?? 0}`
              : 'נגד'}
          </div>
          <div class="mi-team away-mi">
            <img src="${away?.team?.logo || ''}" class="mi-logo" onerror="this.style.display='none'" />
            <span>${translateTeam(away?.team?.displayName || '')}</span>
          </div>
        </div>
        <div class="mi-bottom">
          <span class="mi-clock ${isLive ? 'live-clock' : ''}">${isLive ? '● ' : ''}${clock}</span>
          <span class="mi-group">${comp.groups?.shortName || ev.season?.slug || ''}</span>
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
  $('section-matches').classList.add('hidden');
  $('section-detail').classList.remove('hidden');
  clearInterval(refreshTimer);
  await refreshDetail();
  refreshTimer = setInterval(refreshDetail, REFRESH_MS);
}

async function refreshDetail() {
  if (!currentFixtureId) return;
  try {
    const data = await fetchJSON(
      `${ESPN_BASE}/${LEAGUE}/summary?event=${currentFixtureId}`
    );
    renderDetail(data);
    const t = new Date();
    $('update-text').textContent =
      `עודכן: ${t.toLocaleTimeString('he-IL')} · מתרענן כל 2 שניות`;
  } catch (e) {
    $('update-text').textContent = `שגיאה בעדכון: ${e.message}`;
  }
}

function renderDetail(data) {
  const comp = data.header?.competitions?.[0];
  if (!comp) return;

  const home = comp.competitors.find(c => c.homeAway === 'home');
  const away = comp.competitors.find(c => c.homeAway === 'away');

  // Scoreboard
  $('home-logo').src  = home?.team?.logo || '';
  $('away-logo').src  = away?.team?.logo || '';
  $('home-name').textContent = translateTeam(home?.team?.displayName || '');
  $('away-name').textContent = translateTeam(away?.team?.displayName || '');
  $('home-score').textContent = home?.score ?? 0;
  $('away-score').textContent = away?.score ?? 0;
  $('sb-clock').textContent = formatClock(comp);
  $('sb-meta').textContent =
    (data.header?.season?.name || '') + (data.gameInfo?.venue?.fullName
      ? ` · ${data.gameInfo.venue.fullName}` : '');

  const isLive = comp.status?.type?.state === 'in';
  $('live-badge').classList.toggle('hidden', !isLive);

  // Stat logos
  $('stat-home-logo').src = home?.team?.logo || '';
  $('stat-away-logo').src = away?.team?.logo || '';

  renderKeyEvents(data.keyEvents || [], home, away);
  renderStats(data.boxscore, home, away);
  renderEventsList(data.keyEvents || [], home, away);
  renderLineup(data.rosters || [], home, away);
  renderWinProb(data.pickcenter, home, away, comp);
}

// ── Goals Strip (scoreboard) ──────────────────────────────────────────────────

function renderKeyEvents(keyEvents, home, away) {
  const goals = keyEvents.filter(e =>
    /goal/i.test(e.type?.text || e.text || '') || e.scoringPlay
  );
  const strip = $('goals-strip');
  if (!goals.length) { strip.innerHTML = ''; return; }

  strip.innerHTML = goals.map(e => {
    const min    = e.clock?.displayValue || '';
    const isHome = e.team?.id === home?.team?.id;
    const side   = isHome ? translateTeam(home?.team?.displayName || '') : translateTeam(away?.team?.displayName || '');
    const scorer = e.athletesInvolved?.map(a => a.displayName).join(', ') || e.text || '';
    return `<div class="goal-item ${isHome ? 'goal-home' : 'goal-away'}">
      ⚽ <strong>${min}</strong> ${scorer} <span class="goal-team">(${side})</span>
    </div>`;
  }).join('');
}

// ── Statistics ────────────────────────────────────────────────────────────────

function renderStats(boxscore, home, away) {
  const container = $('stats-rows');
  if (!boxscore?.teams?.length) {
    container.innerHTML = '<div class="loading">הסטטיסטיקות יופיעו עם תחילת המשחק</div>';
    return;
  }

  // ESPN returns away team first sometimes – use homeAway field
  const homeStats = boxscore.teams.find(t => t.homeAway === 'home') || boxscore.teams[0];
  const awayStats = boxscore.teams.find(t => t.homeAway === 'away') || boxscore.teams[1];

  const awayMap = Object.fromEntries(
    (awayStats.statistics || []).map(s => [s.name, s])
  );

  const rows = [];
  const seen = new Set();

  const ORDERED_KEYS = [
    'shotsOnTarget', 'totalShots', 'possessionPct',
    'totalPass', 'accuratePass',
    'foulsCommitted', 'yellowCards', 'redCards',
    'offsides', 'wonCorners', 'saves',
    'blockedShots', 'tackles', 'interceptions',
    'bigChances', 'bigChanceMissed', 'dribbles',
  ];

  const process = (stat) => {
    if (seen.has(stat.name) || !STAT_LABELS[stat.name]) return;
    seen.add(stat.name);

    const label    = STAT_LABELS[stat.name];
    const hRaw     = stat.displayValue ?? stat.value ?? '0';
    const aStat    = awayMap[stat.name];
    const aRaw     = aStat?.displayValue ?? aStat?.value ?? '0';

    const hDisp = formatStatValue(stat.name, hRaw);
    const aDisp = formatStatValue(stat.name, aRaw);
    const hNum  = parseStatNum(stat.name, hRaw);
    const aNum  = parseStatNum(stat.name, aRaw);
    const total = hNum + aNum;
    const hW    = total > 0 ? (hNum / total) * 100 : 50;
    const aW    = total > 0 ? (aNum / total) * 100 : 50;

    const isCard = stat.name === 'yellowCards' ? 'yellow'
                 : stat.name === 'redCards'    ? 'red'
                 : null;

    rows.push({ label, hDisp, aDisp, hNum, aNum, hW, aW, isCard });
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

  container.innerHTML = rows.map(({ label, hDisp, aDisp, hNum, aNum, hW, aW, isCard }) => {
    const hHigh = hNum > aNum;
    const aHigh = aNum > hNum;
    const barClass = isCard === 'yellow' ? 'yellow-bar' : isCard === 'red' ? 'red-bar' : '';
    return `
      <div class="stat-row">
        <div class="stat-val ${hHigh ? 'highlighted' : ''}">${hDisp}</div>
        <div class="stat-name">${label}</div>
        <div class="stat-val ${aHigh ? 'highlighted' : ''}">${aDisp}</div>
      </div>
      <div class="stat-bars">
        <div class="stat-bar-wrap home-wrap">
          <div class="stat-bar home-bar ${barClass}" style="width:${hW.toFixed(1)}%"></div>
        </div>
        <div class="stat-bar-wrap away-wrap">
          <div class="stat-bar away-bar ${barClass}" style="width:${aW.toFixed(1)}%"></div>
        </div>
      </div>`;
  }).join('');
}

// ── Win Probability (Poisson model from moneyline + live game state) ──────────

function poissonPMF(k, lam) {
  if (lam === 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lam);
  for (let i = 1; i <= k; i++) p *= lam / i;
  return p;
}

function calcLiveWinProb(homeML, awayML, drawML, homeScore, awayScore, minute) {
  // Convert American moneyline → implied probability
  const toImplied = ml => ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);

  const rawH = toImplied(homeML);
  const rawA = toImplied(awayML);
  const rawD = drawML != null ? toImplied(drawML) : 0.27;
  const total = rawH + rawA + rawD;
  const pH = rawH / total;
  const pA = rawA / total;

  // Estimate pre-match xG per team from relative strength
  const GOALS_PER_GAME = 2.7;
  const ratio = Math.sqrt(pH / pA);
  const xgHome = GOALS_PER_GAME * ratio / (ratio + 1 / ratio);
  const xgAway = GOALS_PER_GAME - xgHome;

  // Scale to remaining time
  const remaining = Math.max(0, 90 - minute);
  const lamH = xgHome * remaining / 90;
  const lamA = xgAway * remaining / 90;

  // Integrate over all possible remaining-goal combinations
  const MAX = 10;
  const diff = homeScore - awayScore;
  let wH = 0, wD = 0, wA = 0;

  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPMF(i, lamH) * poissonPMF(j, lamA);
      const d = diff + i - j;
      if (d > 0) wH += p;
      else if (d === 0) wD += p;
      else wA += p;
    }
  }

  const t = wH + wD + wA;
  return { home: wH / t, draw: wD / t, away: wA / t };
}

function renderWinProb(pickcenter, home, away, comp) {
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

  // pickcenter homeTeamOdds maps to ESPN's "home" competitor (same id)
  // Detect which competitor ESPN's pickcenter considers home
  const pickHomeId = pc.homeTeamOdds?.team?.id;
  const isHomePickHome = pickHomeId === home?.team?.id;

  const hML = isHomePickHome ? homeML : awayML;
  const aML = isHomePickHome ? awayML : homeML;
  const hScore = homeScore;
  const aScore = awayScore;

  let prob;
  if (state === 'post') {
    // Game over – winner = 100%
    if (hScore > aScore)      prob = { home: 1, draw: 0, away: 0 };
    else if (hScore < aScore) prob = { home: 0, draw: 0, away: 1 };
    else                      prob = { home: 0, draw: 1, away: 0 };
  } else if (state === 'pre') {
    // Pre-match – use raw normalized odds
    const rH = hML > 0 ? 100/(hML+100) : Math.abs(hML)/(Math.abs(hML)+100);
    const rA = aML > 0 ? 100/(aML+100) : Math.abs(aML)/(Math.abs(aML)+100);
    const rD = drawML ? (drawML > 0 ? 100/(drawML+100) : Math.abs(drawML)/(Math.abs(drawML)+100)) : 0.27;
    const t  = rH + rA + rD;
    prob = { home: rH/t, draw: rD/t, away: rA/t };
  } else {
    prob = calcLiveWinProb(hML, aML, drawML, hScore, aScore, minute);
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
}

// ── Events List ───────────────────────────────────────────────────────────────

function renderEventsList(keyEvents, home, away) {
  const container = $('events-list');
  if (!keyEvents.length) {
    container.innerHTML = '<div class="loading">אין אירועים עדיין</div>';
    return;
  }

  const filtered = keyEvents.filter(e => {
    const t = (e.type?.text || e.text || '').toLowerCase();
    return !/^(start delay|end delay|injury update)/i.test(e.type?.text || '');
  });

  container.innerHTML = [...filtered].reverse().map(e => {
    const typeText = (e.type?.text || '').toLowerCase();
    const evType   = EVENT_TYPES.find(t => typeText.includes(t.match));
    const icon     = evType?.icon  || '•';
    const label    = evType?.label || e.type?.text || '';
    const min      = e.clock?.displayValue || '';
    const isHome   = e.team?.id === home?.team?.id;
    const teamName = e.team ? translateTeam(e.team.displayName || '') : '';
    const players  = e.athletesInvolved?.map(a => a.displayName).join(', ') || '';

    // Build Hebrew assist note if applicable
    const assistPlayer = e.athletesInvolved?.length > 1
      ? e.athletesInvolved[1].displayName : null;
    const assistText = assistPlayer && label === 'גול'
      ? `<div class="ev-assist">בסיוע: ${assistPlayer}</div>` : '';

    return `
      <div class="event-item ${teamName ? (isHome ? 'event-home' : 'event-away') : 'event-neutral'}">
        <span class="ev-min">${min}</span>
        <span class="ev-icon">${icon}</span>
        <div class="ev-body">
          <div class="ev-label">${label}${teamName ? ` · ${teamName}` : ''}</div>
          ${players ? `<div class="ev-player">${players}</div>` : ''}
          ${assistText}
        </div>
      </div>`;
  }).join('');
}

// ── Lineup ────────────────────────────────────────────────────────────────────

function renderLineup(rosters, home, away) {
  const container = $('lineup-content');
  if (!rosters.length) {
    container.innerHTML = '<div class="loading">אין הרכב זמין</div>';
    return;
  }

  const homeRoster = rosters.find(r => r.homeAway === 'home') || rosters[0];
  const awayRoster = rosters.find(r => r.homeAway === 'away') || rosters[1];

  const renderPlayers = (roster) => {
    const players = roster?.roster || [];
    if (!players.length) return '<div class="loading">אין שחקנים</div>';

    const starters = players.filter(p => p.starter);
    const subs     = players.filter(p => !p.starter);

    const playerRow = p => {
      const name     = p.athlete?.displayName || p.athlete?.shortName || '—';
      const pos      = p.position?.abbreviation || '';
      const num      = p.jersey || '';
      const subIn    = p.subbedIn  ? ' 🔼' : '';
      const subOut   = p.subbedOut ? ' 🔽' : '';
      return `
        <div class="player-row">
          <span class="p-num">${num}</span>
          <span class="p-pos">${pos}</span>
          <span class="p-name">${name}${subIn}${subOut}</span>
        </div>`;
    };

    return `
      ${starters.map(playerRow).join('')}
      ${subs.length ? `<div class="lineup-subs-label">חילופין</div>${subs.map(playerRow).join('')}` : ''}`;
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

// ── Back ──────────────────────────────────────────────────────────────────────

$('back-btn').addEventListener('click', () => {
  clearInterval(refreshTimer);
  currentFixtureId = null;
  $('section-detail').classList.add('hidden');
  $('section-matches').classList.remove('hidden');
  loadMatchList();
});

// ── Visibility-aware polling ──────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(refreshTimer);
  } else if (currentFixtureId) {
    refreshDetail();
    refreshTimer = setInterval(refreshDetail, REFRESH_MS);
  }
});

// ── Team translations ─────────────────────────────────────────────────────────

const TEAM_HE = {
  'Bosnia and Herzegovina': 'בוסניה והרצגובינה',
  'Bosnia-Herzegovina':     'בוסניה והרצגובינה',
  'Canada':          'קנדה',
  'Brazil':          'ברזיל',
  'Argentina':       'ארגנטינה',
  'France':          'צרפת',
  'Germany':         'גרמניה',
  'Spain':           'ספרד',
  'England':         'אנגליה',
  'Portugal':        'פורטוגל',
  'Netherlands':     'הולנד',
  'Italy':           'איטליה',
  'Belgium':         'בלגיה',
  'Uruguay':         'אורוגוואי',
  'Croatia':         'קרואטיה',
  'Serbia':          'סרביה',
  'Switzerland':     'שווייץ',
  'Denmark':         'דנמרק',
  'Mexico':          'מקסיקו',
  'United States':   'ארצות הברית',
  'USA':             'ארצות הברית',
  'Japan':           'יפן',
  'South Korea':     'קוריאה הדרומית',
  'Morocco':         'מרוקו',
  'Senegal':         'סנגל',
  'Ghana':           'גאנה',
  'Ecuador':         'אקוודור',
  'Costa Rica':      'קוסטה ריקה',
  'Saudi Arabia':    'ערב הסעודית',
  'Iran':            'איראן',
  'Australia':       'אוסטרליה',
  'Tunisia':         'תוניסיה',
  'Cameroon':        'קמרון',
  'Wales':           'ויילס',
  'Poland':          'פולין',
  'Qatar':           'קטר',
  'Panama':          'פנמה',
  'Venezuela':       'ונצואלה',
  'Colombia':        'קולומביה',
  'Paraguay':        'פרגוואי',
  'Chile':           "צ'ילה",
  'Peru':            'פרו',
  'Jamaica':         "ג'מייקה",
  'Honduras':        'הונדורס',
  'Turkey':          'טורקיה',
  'Czech Republic':  "צ'כיה",
  'Austria':         'אוסטריה',
  'Scotland':        'סקוטלנד',
  'Albania':         'אלבניה',
  'Slovakia':        'סלובקיה',
  'Slovenia':        'סלובניה',
  'Ukraine':         'אוקראינה',
  'Romania':         'רומניה',
  'Hungary':         'הונגריה',
  'Georgia':         'גאורגיה',
  'New Zealand':     'ניו זילנד',
  'El Salvador':     'אל סלבדור',
  'Guatemala':       'גואטמלה',
  'Cuba':            'קובה',
  'Haiti':           'האיטי',
  'Trinidad and Tobago': 'טרינידד וטובגו',
  'Nigeria':         'ניגריה',
  'Egypt':           'מצרים',
  'Algeria':         'אלג\'יריה',
  'Ivory Coast':     "חוף השנהב",
  'Mali':            'מאלי',
  'DR Congo':        'קונגו',
  'South Africa':    'דרום אפריקה',
  'Angola':          'אנגולה',
  'Tanzania':        'טנזניה',
  'Comoros':         'קומורו',
  'China':           'סין',
  'Iraq':            'עיראק',
  'Jordan':          'ירדן',
  'Uzbekistan':      'אוזבקיסטן',
  'Indonesia':       'אינדונזיה',
};

// ── Init ──────────────────────────────────────────────────────────────────────

loadMatchList();
setInterval(() => { if (!currentFixtureId) loadMatchList(); }, 60_000);
