const app = document.querySelector('#app');
const visitorId = (() => {
  const key = 'qvm-visitor-id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = (crypto.randomUUID ? crypto.randomUUID() : 'visitor-' + Math.random().toString(36).slice(2));
    localStorage.setItem(key, created);
    return created;
  } catch {
    return 'anonymous';
  }
})();

const state = {
  view: 'dashboard',
  races: [],
  results: [],
  quotes: [],
  snapshots: [],
  positions: [],
  alerts: [],
  health: [],
  watchlist: [],
  notes: [],
  filtersSaved: [],
  integrations: null,
  overview: null,
  decision: null,
  fixtureEvidence: null,
  performance: null,
  settings: {},
  weather: null,
  selectedRace: null,
  replay: null,
  loading: true,
  error: null,
  oddsRefreshing: false,
  racePageSize: 12,
  loaded: {},
  sidebarCollapsed: localStorage.getItem('qvm-sidebar-collapsed') === 'true',
  filters: { day: 'all', venue: 'all', race: 'all', region: 'all', status: 'all', sort: 'off' }
};

const fallbackCandidate = {
  runnerId: 'demo:horse:1',
  runner: 'Alpha Meridian',
  venue: 'Kempton 14:20',
  odds: 3.55,
  probability: .34,
  action: 'ABSTAIN'
};

const pct = (value) => value === null || value === undefined || value === '' ? '—' : Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + '%' : '—';
const money = (value) => value === null || value === undefined || value === '' ? '—' : Number.isFinite(Number(value)) ? '€' + Number(value).toFixed(2) : '—';
const odds = (value) => Number(value) > 1 ? Number(value).toFixed(2) : '—';
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const isoTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toISOString().slice(11, 16) + ' UTC';
};
const field = (object, camel, snake) => object?.[camel] ?? object?.[snake];
const quoteAgeFor = (race, response = {}) => {
  const capturedAt = race?.quoteCapturedAt || response?.quote?.capturedAt;
  if (capturedAt) {
    const captured = Date.parse(capturedAt);
    if (Number.isFinite(captured)) return Math.max(0, Math.floor((Date.now() - captured) / 1000));
  }
  const raw = race?.quoteAgeSeconds ?? response?.runner?.quoteAgeSeconds;
  return raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
};

function icon(name) {
  const paths = {
    eye: '<path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4"/>',
    save: '<path d="M5 4h12l2 2v14H5zM8 4v5h8V4M8 16h8"/>',
    upload: '<path d="M12 16V4M8 8l4-4 4 4M5 14v5h14v-5"/>',
    replay: '<path d="M4 11a8 8 0 1 1 2.3 5.7M4 5v6h6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5M12 17h.01"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
    note: '<path d="M5 4h14v16H5zM8 8h8M8 12h6M8 16h4"/>',
    settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m19 13 1.5 1-2 3-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-4l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-2-3L6.5 13a8 8 0 0 1 0-2L5 10l2-3 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h4l.3 1.8a8 8 0 0 1 1.8 1L18 7l2 3-1.5 1a8 8 0 0 1 0 2Z"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>'
  };
  return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.info) + '</svg>';
}

const status = (label, tone = 'open') => '<span class="status ' + tone + '">' + esc(label) + '</span>';
const sourceState = (configured, ready = 'READY') => configured ? status(ready, 'open') : status('LIMITED', 'soon');

function raceIdFor(race) {
  return field(race, 'providerRaceId', 'provider_race_id') || field(race, 'raceId', 'race_id') || '';
}

function raceHasPaperBet(race) {
  const raceId = raceIdFor(race);
  return Boolean(raceId && state.positions.some((position) => String(field(position, 'raceId', 'race_id')) === String(raceId)));
}

function raceDecisionResponse(race) {
  return race?.paperDecision || state.decision || {};
}

function paperBetControl(runnerId, enabled, raceId = '', placed = false) {
  if (placed) return status('PAPER BET PLACED', 'open');
  if (enabled) return '<button class="primary small" data-place-paper="' + esc(runnerId || fallbackCandidate.runnerId) + '"' + (raceId ? ' data-paper-race="' + esc(raceId) + '"' : '') + ' type="button">' + icon('lock') + ' Paper bet</button>';
  return '<button class="secondary small paper-bet-disabled" type="button" disabled aria-disabled="true" title="Paper betting is blocked until the evidence gates pass">' + icon('lock') + ' Paper bet unavailable</button>';
}

function irishRacingOddsControl(race) {
  const raceId = raceIdFor(race);
  const source = race?.irishRacing || {};
  const captured = source.capturedAt ? 'captured ' + isoTime(source.capturedAt) : 'one-day comparison quote';
  const attribution = source.url
    ? '<a class="source-attribution" href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">Odds source: Irishracing.com</a><span class="subtle">' + esc(captured) + '</span>'
    : '<span class="subtle">Irishracing.com · one-day comparison odds</span>';
  return '<div class="irish-odds-control"><button class="secondary small" data-load-irish-odds="' + esc(raceId) + '" type="button">' + icon('refresh') + ' ' + (source.url ? 'Refresh Irishracing odds' : 'Load Irishracing odds') + '</button>' + attribution + '</div>';
}

function raceDecisionAction(race) {
  const response = raceDecisionResponse(race);
  const decision = response.decision || {};
  const runner = response.runner || {};
  const action = runner.action || decision.status || 'ABSTAIN';
  const raceId = raceIdFor(race);
  const quoteRaceId = field(response.quote, 'raceId', 'race_id');
  const runnerMatches = (race?.runners || []).some((item) => String(field(item, 'providerRunnerId', 'provider_runner_id') || field(item, 'runnerId', 'runner_id')) === String(runner.runnerId));
  const raceMatches = quoteRaceId && raceId && String(quoteRaceId) === String(raceId);
  const hasRaceDecision = Boolean(race?.paperDecision);
  return { enabled: action === 'PAPER_CANDIDATE' && (hasRaceDecision || raceMatches || runnerMatches), runnerId: runner.runnerId || fallbackCandidate.runnerId };
}

function toast(message, error = false) {
  const region = document.querySelector('#statusRegion');
  if (region) region.textContent = message;
  const element = document.createElement('div');
  element.className = 'toast ' + (error ? 'toast-error' : '');
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 3200);
}

async function getJson(path, init = {}) {
  const response = await fetch(path, { ...init, headers: { accept: 'application/json', 'x-qvm-visitor-id': visitorId, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || 'Request failed (' + response.status + ')');
  return body;
}

const coreDataRequests = [
  ['integrations', '/api/qvm/racing/integrations'],
  ['overview', '/api/qvm/racing/overview'],
  ['fixtures', '/api/qvm/racing/fixtures?days=today,tomorrow&regions=gb,ire'],
  ['decision', '/api/qvm/racing/decision'],
  ['positions', '/api/qvm/racing/paper-positions'],
  ['health', '/api/qvm/racing/health'],
  ['alerts', '/api/qvm/racing/alerts']
];
const viewDataRequests = {
  dashboard: [],
  races: [['settings', '/api/qvm/racing/settings'], ['watchlist', '/api/qvm/racing/watchlist'], ['filters', '/api/qvm/racing/filters']],
  results: [['results', '/api/qvm/racing/results']],
  positions: [['settings', '/api/qvm/racing/settings']],
  performance: [['performance', '/api/qvm/racing/performance'], ['settings', '/api/qvm/racing/settings']],
  research: [['results', '/api/qvm/racing/results'], ['snapshots', '/api/qvm/racing/snapshots']],
  agents: [['integrations', '/api/qvm/racing/integrations']],
  settings: [['integrations', '/api/qvm/racing/integrations'], ['settings', '/api/qvm/racing/settings'], ['health', '/api/qvm/racing/health']]
};

async function loadData({ refresh = false, view = state.view } = {}) {
  const shouldLoadCore = refresh || !state.loaded.core;
  state.loading = true;
  state.error = null;
  render();
  const requestMap = new Map();
  if (shouldLoadCore) coreDataRequests.forEach((request) => requestMap.set(request[0], request));
  if (refresh || !state.loaded[view]) (viewDataRequests[view] || []).forEach((request) => requestMap.set(request[0], request));
  const requests = [...requestMap.values()];
  if (!requests.length) {
    state.loading = false;
    render();
    return;
  }
  const responses = await Promise.allSettled(requests.map((request) => getJson(request[1])));
  responses.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const key = requests[index][0];
    const body = result.value;
    if (key === 'fixtures') { state.races = body.fixtures || []; state.fixtureEvidence = body.evidence || null; }
    else if (key === 'positions') state.positions = body.positions || [];
    else if (key === 'health') state.health = body.providers || [];
    else if (key === 'watchlist') state.watchlist = body.watchlist || [];
    else if (key === 'alerts') state.alerts = body.alerts || [];
    else if (key === 'settings') state.settings = body.settings || {};
    else if (key === 'filters') state.filtersSaved = body.filters || [];
    else if (key === 'snapshots') state.snapshots = body.snapshots || [];
    else if (key === 'results') state.results = body.results || [];
    else state[key] = body;
  });
  if (responses.every((result) => result.status === 'rejected')) state.error = 'The hosted data service is unavailable.';
  if (shouldLoadCore && responses.some((result) => result.status === 'fulfilled')) state.loaded.core = true;
  if (responses.some((result) => result.status === 'fulfilled')) state.loaded[view] = true;
  state.loading = false;
  render();
  if (state.races.length && shouldLoadCore) refreshIrishRacingOdds({ auto: true });
}

function setOddsRefreshUi(loading, message) {
  const button = document.querySelector('#refreshOddsBtn');
  if (button) {
    button.disabled = loading;
    button.innerHTML = icon('refresh') + ' ' + (loading ? 'Loading Irishracing odds…' : 'Refresh Irishracing odds');
  }
  const statusElement = document.querySelector('[data-odds-refresh-status]');
  if (statusElement && message !== undefined) statusElement.textContent = message;
}

function autoIrishRacingRace(race) {
  const raceStatus = String(race?.status || '').toUpperCase();
  if (['ABANDONED', 'RESULT', 'FINISHED', 'SETTLED', 'VOID'].includes(raceStatus)) return false;
  const scheduled = Date.parse(race?.scheduledOffAt || race?.scheduled_off_at || '');
  return Boolean(raceIdFor(race) && race?.venue && race?.runners?.length >= 2 && Number.isFinite(scheduled) && scheduled > Date.now());
}

function applyIrishRacingBatch(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const byRaceId = new Map(items.map((item) => [String(item.raceId), item]));
  const loadedIds = new Set(items.map((item) => String(item.raceId)));
  state.races = state.races.map((race) => {
    const item = byRaceId.get(String(raceIdFor(race)));
    if (!item?.quote) return race;
    const quote = item.quote;
    const loadedRace = {
      ...race,
      runners: mergeIrishRacingRunners(race, quote.runners),
      quoteCapturedAt: quote.capturedAt,
      quoteSourceUpdatedAt: quote.sourceUpdatedAt,
      quoteAgeSeconds: quoteAgeFor({ quoteCapturedAt: quote.capturedAt }),
      oddsProvider: quote.provider,
      paperDecision: item.paperDecision,
      irishRacing: { provider: quote.provider, url: item.source?.url, capturedAt: quote.capturedAt, attribution: item.source?.attribution }
    };
    if (state.selectedRace && String(raceIdFor(state.selectedRace)) === String(raceIdFor(race))) state.selectedRace = loadedRace;
    return loadedRace;
  });
  state.quotes = [...items.map((item) => item.quote), ...state.quotes.filter((quote) => !loadedIds.has(String(field(quote, 'raceId', 'race_id'))))];
}

async function refreshIrishRacingOdds({ auto = false } = {}) {
  if (state.oddsRefreshing) return;
  const races = state.races.filter(autoIrishRacingRace).map((race) => ({
    raceId: raceIdFor(race),
    venue: race.venue,
    scheduledOffAt: race.scheduledOffAt || race.scheduled_off_at,
    runners: (race.runners || []).map((runner) => ({
      providerRunnerId: runner.providerRunnerId || runner.provider_runner_id || runner.runnerId,
      number: runner.number,
      horseName: runner.horseName || runner.horse || runner.name,
      modelProbability: runner.modelProbability ?? null,
      status: runner.status
    }))
  }));
  if (!races.length) {
    setOddsRefreshUi(false, 'No upcoming races need Irishracing odds.');
    if (!auto) toast('No upcoming races need Irishracing odds.');
    return;
  }
  state.oddsRefreshing = true;
  setOddsRefreshUi(true, 'Loading Irishracing odds for ' + races.length + ' upcoming races…');
  try {
    const body = await getJson('/api/qvm/racing/irishracing-odds/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ races })
    });
    applyIrishRacingBatch(body);
    render();
    const message = body.loaded + ' of ' + body.requested + ' race odds loaded' + (body.failures?.length ? ' · ' + body.failures.length + ' unavailable' : '') + '.';
    setOddsRefreshUi(false, message);
    if (!auto) toast(body.notice || 'Irishracing.com odds loaded and timestamped.');
  } catch (error) {
    const message = 'Irishracing.com odds unavailable: ' + error.message;
    setOddsRefreshUi(false, message);
    if (!auto) toast(message, true);
  } finally {
    state.oddsRefreshing = false;
    setOddsRefreshUi(false);
  }
}

async function loadWeather() {
  const button = document.querySelector('[data-weather]');
  if (button) {
    button.disabled = true;
    button.innerHTML = icon('refresh') + ' Loading weather…';
  }
  try {
    state.weather = await getJson('/api/qvm/racing/weather?latitude=51.41&longitude=0.11&raceTime=' + encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
    toast(state.weather.fallback ? 'Weather loaded with an explicitly labelled fallback.' : 'Open-Meteo weather evidence loaded for the next decision window.');
  } catch (error) {
    state.weather = { error: error.message };
    toast('Weather unavailable: ' + error.message, true);
  }
  render();
}

function mergeIrishRacingRunners(race, quoteRunners) {
  const existing = race?.runners || [];
  return (quoteRunners || []).map((runner) => {
    const match = existing.find((item) => String(field(item, 'providerRunnerId', 'provider_runner_id') || field(item, 'runnerId', 'runner_id')) === String(runner.runnerId) || (runner.number && String(item.number) === String(runner.number)));
    return {
      ...match,
      ...runner,
      providerRunnerId: runner.runnerId || match?.providerRunnerId || match?.runnerId,
      horseName: runner.horseName || match?.horseName || match?.horse || 'Unnamed runner',
      number: runner.number || match?.number || null
    };
  });
}

async function loadIrishRacingOdds(raceId) {
  const race = state.races.find((item) => String(raceIdFor(item)) === String(raceId));
  if (!race) return toast('That race is no longer in the live fixture list.', true);
  const buttons = [...document.querySelectorAll('[data-load-irish-odds]')].filter((button) => button.dataset.loadIrishOdds === String(raceId));
  buttons.forEach((button) => {
    button.disabled = true;
    button.innerHTML = icon('refresh') + ' Loading Irishracing odds…';
  });
  try {
    const body = await getJson('/api/qvm/racing/irishracing-odds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        raceId: String(raceId),
        venue: race.venue,
        scheduledOffAt: race.scheduledOffAt || race.scheduled_off_at,
        runners: (race.runners || []).map((runner) => ({
          providerRunnerId: runner.providerRunnerId || runner.provider_runner_id || runner.runnerId,
          number: runner.number,
          horseName: runner.horseName || runner.horse || runner.name,
          modelProbability: runner.modelProbability ?? null,
          status: runner.status
        }))
      })
    });
    const quote = { ...body.quote, raceId: String(raceId) };
    let paperDecision = null;
    try { paperDecision = await getJson('/api/qvm/racing/decision?raceId=' + encodeURIComponent(raceId)); } catch { /* quote remains visible even when decision evidence is unavailable */ }
    const loadedRace = {
      ...race,
      runners: mergeIrishRacingRunners(race, quote.runners),
      quoteCapturedAt: quote.capturedAt,
      quoteSourceUpdatedAt: quote.sourceUpdatedAt,
      quoteAgeSeconds: quoteAgeFor({ quoteCapturedAt: quote.capturedAt }),
      oddsProvider: quote.provider,
      irishRacing: { provider: quote.provider, url: body.source?.url, capturedAt: quote.capturedAt, attribution: body.source?.attribution }
    };
    if (paperDecision) loadedRace.paperDecision = paperDecision;
    state.races = state.races.map((item) => String(raceIdFor(item)) === String(raceId) ? loadedRace : item);
    if (state.selectedRace && String(raceIdFor(state.selectedRace)) === String(raceId)) state.selectedRace = loadedRace;
    state.quotes = [quote, ...state.quotes.filter((item) => String(field(item, 'raceId', 'race_id')) !== String(raceId))];
    render();
    toast(body.notice || 'Irishracing.com odds loaded and timestamped.');
  } catch (error) {
    toast('Irishracing.com odds unavailable: ' + error.message, true);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.innerHTML = icon('refresh') + ' ' + (race.irishRacing?.url ? 'Refresh Irishracing odds' : 'Load Irishracing odds');
    });
  }
}

function weatherEvidenceCard() {
  if (!state.weather) return '';
  if (state.weather.error) {
    return '<div class="gate" data-weather-result role="alert"><span class="gate-icon">' + icon('alert') + '</span><div><strong>Weather evidence unavailable</strong><p>' + esc(state.weather.error) + ' Try loading it again before relying on weather-sensitive analysis.</p></div></div>';
  }
  const observation = state.weather.observation || {};
  const value = (raw, suffix = '') => raw === null || raw === undefined || raw === '' ? '—' : esc(String(raw) + suffix);
  const provider = state.weather.provider === 'met.no' ? 'MET Norway' : 'Open-Meteo';
  const fallbackNote = state.weather.fallback ? ' ' + (state.weather.notice || 'Primary weather provider was unavailable; fallback evidence is shown.') : '';
  const timeLabel = state.weather.mode === 'current' ? 'Current observation' : state.weather.mode === 'historical' ? 'Historical observation' : 'Forecast target';
  return '<div class="weather-evidence" data-weather-result role="status"><div class="card-head"><div><p class="eyebrow">Weather evidence</p><strong>' + provider + ' · ' + esc(state.weather.mode || 'forecast') + '</strong></div>' + status('LOADED', 'open') + '</div><div class="evidence-grid"><div><span>Temperature</span><strong>' + value(observation.temperature_2m, ' °C') + '</strong></div><div><span>Humidity</span><strong>' + value(observation.relative_humidity_2m, '%') + '</strong></div><div><span>Precipitation</span><strong>' + value(observation.precipitation, ' mm') + '</strong></div><div><span>Wind</span><strong>' + value(observation.wind_speed_10m, ' km/h') + '</strong></div></div><p class="subtle">' + timeLabel + ': ' + esc(observation.time || state.weather.raceTime || 'time unavailable') + ' · Forecast values are evidence, not a guarantee.' + fallbackNote + '</p></div>';
}

function fixtureDayOf(race) {
  const explicit = String(race?.fixtureDay || '').toLowerCase();
  if (explicit === 'today' || explicit === 'tomorrow') return explicit;
  const date = new Date(race?.scheduledOffAt || race?.scheduled_off_at || '');
  if (Number.isNaN(date.getTime())) return 'other';
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const raceStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const difference = Math.round((raceStart.getTime() - todayStart.getTime()) / 86400000);
  return difference === 0 ? 'today' : difference === 1 ? 'tomorrow' : 'other';
}

function fixtureDayLabel(day) {
  return day === 'today' ? 'Today' : day === 'tomorrow' ? 'Tomorrow' : 'Other day';
}

function raceOptionLabel(race) {
  const off = race?.scheduledOffAt || race?.scheduled_off_at;
  const raceName = race?.raceName || race?.race_name || ('Race ' + (raceIdFor(race) || 'unlabelled'));
  return [race?.venue || 'Unknown venue', off ? isoTime(off).replace(' UTC', '') : null, raceName].filter(Boolean).join(' · ');
}

function matchesRaceFilters(race, options = {}) {
  const filters = state.filters;
  const day = options.day === undefined ? filters.day : options.day;
  const venue = options.venue === undefined ? filters.venue : options.venue;
  const raceId = options.race === undefined ? filters.race : options.race;
  const region = options.region === undefined ? filters.region : options.region;
  const statusValue = options.status === undefined ? filters.status : options.status;
  if (day !== 'all' && fixtureDayOf(race) !== day) return false;
  if (region !== 'all' && String(race.country || '').toLowerCase() !== region) return false;
  if (statusValue !== 'all' && String(race.status || '').toLowerCase() !== statusValue) return false;
  if (options.includeVenue !== false && venue !== 'all' && String(race.venue || '') !== venue) return false;
  if (options.includeRace !== false && raceId !== 'all' && String(raceIdFor(race)) !== String(raceId)) return false;
  return true;
}

function filteredRaces() {
  const filters = state.filters;
  return [...state.races]
    .filter((race) => matchesRaceFilters(race))
    .sort((a, b) => filters.sort === 'venue'
      ? String(a.venue || '').localeCompare(String(b.venue || ''))
      : String(a.scheduledOffAt || a.scheduled_off_at || '').localeCompare(String(b.scheduledOffAt || b.scheduled_off_at || '')));
}

function isWatched(raceId) {
  return state.watchlist.some((item) => String(item.raceId) === String(raceId) && item.active !== false);
}

function header(title, description, actions = '') {
  return '<div class="view-head"><div><p class="eyebrow">Evidence-first workflow</p><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div><div class="view-head-actions">' + actions + (state.view === 'races' ? '<span class="view-count" aria-live="polite">' + filteredRaces().length + ' races shown</span>' : '') + '</div></div>';
}

function decisionCard() {
  const response = state.decision || {};
  const decision = response.decision || {};
  const runner = response.runner || fallbackCandidate;
  const gates = decision.gates || {};
  const reasons = decision.reasons || [];
  const action = runner.action || decision.status || 'ABSTAIN';
  const decisionRaceId = field(response.quote, 'raceId', 'race_id') || '';
  const decisionBetPlaced = Boolean(decisionRaceId && state.positions.some((position) => String(field(position, 'raceId', 'race_id')) === String(decisionRaceId)));
  const candidateClass = action === 'PAPER_CANDIDATE' ? 'open' : 'blocked';
  const gate = (label, pass) => '<span class="gate-chip ' + (pass ? 'pass' : 'fail') + '">' + icon(pass ? 'check' : 'alert') + esc(label) + '</span>';
  return '<section class="card decision-card" aria-labelledby="decision-title">' +
    '<div class="card-head"><div><p class="eyebrow">Server-owned decision</p><h3 id="decision-title">' + esc(runner.runner || runner.horseName || 'No runner selected') + ' <span class="subtle">· ' + esc(runner.venue || 'No fixture') + '</span></h3></div>' + status(action === 'PAPER_CANDIDATE' ? 'PAPER CANDIDATE' : 'ABSTAIN', candidateClass) + '</div>' +
    '<div class="evidence-grid"><div><span>Model probability</span><strong>' + pct(runner.probability ?? decision.modelProbability) + '</strong></div><div><span>No-vig market</span><strong>' + pct(decision.noVigProbability) + '</strong></div><div><span>Fair odds</span><strong>' + odds(decision.fairOdds) + '</strong></div><div><span>Current odds</span><strong>' + odds(runner.odds) + '</strong></div><div><span>After-cost EV</span><strong class="' + (Number(decision.expectedValue) > 0 ? 'good' : 'bad') + '">' + (gates.marketComplete ? pct(decision.expectedValue) : '—') + '</strong></div><div><span>Data quality</span><strong>' + (gates.quality && Number.isFinite(Number(runner.dataQuality)) ? Number(runner.dataQuality).toFixed(0) + '/100' : '—') + '</strong></div></div>' +
    '<div class="gate-row">' + gate(gates.freshQuote ? 'Quote fresh' : 'Quote stale', Boolean(gates.freshQuote)) + gate(gates.quality ? 'Data quality pass' : 'Data quality fail', Boolean(gates.quality)) + gate(gates.marketComplete ? 'Market complete' : 'Market incomplete', Boolean(gates.marketComplete)) + gate(gates.modelScore ? 'Model score ready' : 'Model score missing', Boolean(gates.modelScore)) + gate(gates.raceNotStarted !== false ? 'Race open' : 'Race started', gates.raceNotStarted !== false) + gate(gates.uncertainty ? 'Uncertainty acceptable' : 'Uncertainty high', Boolean(gates.uncertainty)) + '</div>' +
    '<div class="decision-footer"><span>' + esc(reasons.length ? 'No-bet reasons: ' + reasons.join(' · ') : 'All deterministic gates passed after recorded costs.') + '</span><div class="button-row"><button class="secondary small" data-view-target="races">' + icon('eye') + ' Inspect evidence</button>' + paperBetControl(runner.runnerId || fallbackCandidate.runnerId, action === 'PAPER_CANDIDATE', decisionRaceId, decisionBetPlaced) + '</div></div>' +
    '</section>';
}

function raceRow(race) {
  const id = raceIdFor(race);
  const blocked = ['ABANDONED', 'SETTLED'].includes(String(race.status || '').toUpperCase());
  const quoteAge = quoteAgeFor(race);
  return '<div class="race-row"><div><div class="race-title">' + esc(race.venue || 'Unknown venue') + ', ' + esc(race.country || '—') + '</div><div class="race-meta">' + fixtureDayLabel(fixtureDayOf(race)) + ' · ' + isoTime(race.scheduledOffAt || race.scheduled_off_at) + ' · ' + esc(race.going || 'Going unavailable') + ' · ' + (race.fieldSize || race.field_size || 0) + ' runners · source ' + esc(race.provider || 'The Racing API') + '</div></div><div class="race-actions"><span class="freshness">' + (Number.isFinite(quoteAge) ? esc(Math.round(quoteAge) + 's old') : 'Quote age unavailable') + '</span><button class="link-button" data-watch="' + esc(id) + '" aria-pressed="' + String(isWatched(id)) + '">' + icon(isWatched(id) ? 'check' : 'note') + ' ' + (isWatched(id) ? 'Watched' : 'Watch') + '</button><button class="link-button" data-inspect="' + esc(id) + '">' + icon('eye') + ' Inspect evidence</button>' + (raceHasPaperBet(race) ? status('PAPER BET PLACED', 'open') : '') + status(blocked ? 'BLOCKED' : 'FIXTURE LOADED', blocked ? 'blocked' : 'open') + '</div></div>';
}

function alertsCard() {
  if (!state.alerts.length) return '<section class="card"><div class="card-head"><div><p class="eyebrow">Operator queue</p><h3>Alerts</h3></div>' + status('CLEAR', 'open') + '</div><div class="empty">No unacknowledged alerts.</div></section>';
  return '<section class="card"><div class="card-head"><div><p class="eyebrow">Operator queue</p><h3>Alerts</h3></div>' + status(state.alerts.length + ' OPEN', 'soon') + '</div>' + state.alerts.slice(0, 6).map((alert) => '<div class="alert-row"><div class="alert-symbol">' + icon('alert') + '</div><div><b>' + esc(alert.title) + '</b><small>' + esc(alert.message) + '</small></div><button class="secondary small" data-ack="' + esc(alert.id) + '">' + icon('check') + ' Acknowledge</button></div>').join('') + '</section>';
}

function healthCard() {
  const providers = state.health.length ? state.health : [
    { provider: 'the-racing-api', status: state.integrations?.racingApi?.configured ? 'CONFIGURED' : 'LIMITED', message: 'Fixture and result provider' },
    { provider: 'open-meteo', status: 'ON DEMAND', message: 'Forecast and archive weather' },
    { provider: 'openai', status: state.integrations?.openai?.configured ? 'CONFIGURED' : 'LIMITED', message: 'Explanatory assistant' }
  ];
  return '<section class="card"><div class="card-head"><div><p class="eyebrow">Provider health</p><h3>Evidence health</h3></div>' + status('MONITORED', 'open') + '</div>' + providers.slice(0, 6).map((item) => '<div class="health-row"><div><b>' + esc(item.provider) + '</b><small>' + esc(item.message || 'No provider message') + '</small></div>' + status(item.status, item.status === 'HEALTHY' || item.status === 'CONFIGURED' || item.status === 'ON DEMAND' ? 'open' : 'soon') + '</div>').join('') + '<button class="secondary full" data-weather="true" type="button">' + icon('refresh') + ' Load weather evidence</button>' + weatherEvidenceCard() + '</section>';
}

function dashboard() {
  const next = state.races[0];
  const open = state.positions.filter((position) => String(field(position, 'status', 'status') || '').toUpperCase() === 'OPEN');
  return header('Dashboard', 'A focused queue for deciding what deserves attention and what should be ignored.', '<button class="secondary small" data-view-target="races">' + icon('search') + ' Race Finder</button>') +
    (state.loading ? '<div class="loading" role="status">Loading live evidence…</div>' : '') +
    (state.error ? '<div class="gate info" role="alert"><span class="gate-icon">' + icon('alert') + '</span><div><strong>Hosted data needs attention</strong><p>' + esc(state.error) + ' Refresh before making a paper decision.</p></div></div>' : '') +
    '<section class="kpis"><div class="kpi"><span class="kpi-label">Next scheduled off</span><strong class="kpi-value">' + isoTime(next?.scheduledOffAt).replace(' UTC', '') + '</strong><span class="kpi-note">' + esc(next?.venue || 'No live fixture loaded') + '</span></div><div class="kpi"><span class="kpi-label">Live fixtures</span><strong class="kpi-value">' + (state.races.length || '—') + '</strong><span class="kpi-note">The Racing API · ' + (state.integrations?.racingApi?.configured ? 'connected' : 'limited') + '</span></div><div class="kpi"><span class="kpi-label">Open exposure</span><strong class="kpi-value">' + money(open.reduce((sum, position) => sum + Number(position.stake || 0), 0)) + '</strong><span class="kpi-note">' + open.length + ' open paper positions</span></div><div class="kpi"><span class="kpi-label">Model status</span><strong class="kpi-value good">' + esc(state.decision?.modelVersion || '—') + '</strong><span class="kpi-note">Server-owned decision gates</span></div></section>' +
    decisionCard() +
    '<div class="grid-2"><section class="card"><div class="card-head"><div><p class="eyebrow">Priority queue</p><h3>Upcoming races</h3></div><button class="secondary small" data-view-target="races">Open Race Finder</button></div>' + (state.races.slice(0, 6).map(raceRow).join('') || '<div class="empty">No live fixtures are available.</div>') + '</section>' + healthCard() + '</div>' + alertsCard();
}

function filterControls() {
  const option = (value, label, selected) => '<option value="' + esc(value) + '"' + (String(selected) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>';
  const dayBase = state.races.filter((race) => matchesRaceFilters(race, { day: 'all', venue: 'all', race: 'all', includeVenue: false, includeRace: false }));
  const venueBase = state.races.filter((race) => matchesRaceFilters(race, { includeVenue: false, includeRace: false }));
  const raceBase = state.races.filter((race) => matchesRaceFilters(race, { includeRace: false }));
  const uniqueVenues = [...new Map(venueBase.map((race) => [String(race.venue || 'Unknown venue'), race])).values()].sort((a, b) => String(a.venue || '').localeCompare(String(b.venue || '')));
  const uniqueRaces = [...new Map(raceBase.map((race) => [String(raceIdFor(race)), race])).values()].sort((a, b) => String(a.scheduledOffAt || a.scheduled_off_at || '').localeCompare(String(b.scheduledOffAt || b.scheduled_off_at || '')));
  const dayOptions = option('all', 'Today & tomorrow (' + dayBase.length + ')', state.filters.day) + option('today', 'Today (' + dayBase.filter((race) => fixtureDayOf(race) === 'today').length + ')', state.filters.day) + option('tomorrow', 'Tomorrow (' + dayBase.filter((race) => fixtureDayOf(race) === 'tomorrow').length + ')', state.filters.day);
  const venueOptions = option('all', 'All venues (' + venueBase.length + ')', state.filters.venue) + uniqueVenues.map((race) => option(race.venue || 'Unknown venue', race.venue || 'Unknown venue', state.filters.venue)).join('');
  const raceOptions = option('all', 'All races (' + raceBase.length + ')', state.filters.race) + uniqueRaces.map((race) => option(raceIdFor(race), raceOptionLabel(race), state.filters.race)).join('');
  return '<section class="card filter-card" aria-label="Race filters"><label class="filter-field" for="fixtureDayFilter">Day<select id="fixtureDayFilter" data-filter="day">' + dayOptions + '</select></label><label class="filter-field" for="venueFilter">Venue<select id="venueFilter" data-filter="venue">' + venueOptions + '</select></label><label class="filter-field" for="raceFilter">Race<select id="raceFilter" data-filter="race">' + raceOptions + '</select></label><label class="filter-field" for="regionFilter">Region<select id="regionFilter" data-filter="region">' + option('all', 'All regions', state.filters.region) + option('gb', 'Great Britain', state.filters.region) + option('ie', 'Ireland', state.filters.region) + '</select></label><label class="filter-field" for="statusFilter">Status<select id="statusFilter" data-filter="status">' + option('all', 'All statuses', state.filters.status) + option('result', 'Results', state.filters.status) + option('scheduled', 'Scheduled', state.filters.status) + '</select></label><label class="filter-field" for="sortFilter">Sort<select id="sortFilter" data-filter="sort">' + option('off', 'Scheduled off', state.filters.sort) + option('venue', 'Venue', state.filters.sort) + '</select></label><div class="filter-actions"><button class="secondary small" data-save-filter>' + icon('save') + ' Save filter</button><button class="link-button" data-clear-filter>Clear</button></div></section>' + (state.filtersSaved.length ? '<section class="saved-filter-list" aria-label="Saved filters">' + state.filtersSaved.slice(0, 8).map((saved) => '<button class="link-button saved-filter" data-load-filter="' + esc(saved.id) + '">' + icon('search') + ' ' + esc(saved.name) + '</button>').join('') + '</section>' : '');
}

function runnerEvidence(race) {
  const runners = race?.runners || [];
  if (!runners.length) return '<div class="gate info"><span class="gate-icon">' + icon('alert') + '</span><div><strong>No complete runner-level book</strong><p>Current fixture data does not include executable odds for this race. The decision engine abstains until a fresh complete quote snapshot is captured.</p></div></div>';
  const response = raceDecisionResponse(race);
  const selected = response.runner || {};
  return '<div class="runner-grid">' + runners.map((runner) => {
    const runnerId = runner.providerRunnerId || runner.runnerId;
    const isSelected = selected.runnerId && String(selected.runnerId) === String(runnerId);
    return '<article class="runner-card"><strong>' + esc(runner.number || '—') + '</strong><b>' + esc(runner.horseName || runner.horse || runner.name || 'Unnamed runner') + '</b><span>Current odds: ' + odds(runner.odds) + '</span>' + (isSelected ? '<span>Model probability: ' + pct(selected.modelProbability ?? selected.probability) + '</span><span>After-cost EV: ' + pct(response.decision?.expectedValue) + '</span><span>Decision: ' + esc(response.decision?.status || 'ABSTAIN') + '</span>' : '<span>Model probability: —</span><span>Decision: ABSTAIN</span>') + '<span>Trainer: ' + esc(runner.trainer || 'Unavailable') + '</span><span>Jockey: ' + esc(runner.jockey || 'Unavailable') + '</span><small>' + (isSelected ? 'Values come from the server-owned contract captured at ' + esc(isoTime(response.quote?.capturedAt || response.capturedAt)) + '.' : 'This runner has no separate scored decision in the current snapshot.') + '</small></article>';
  }).join('') + '</div>';
}

function raceDetail(race) {
  if (!race) return '';
  const raceId = raceIdFor(race);
  const paperAction = raceDecisionAction(race);
  const paperBetPlaced = raceHasPaperBet(race);
  const quote = state.quotes.find((item) => String(field(item, 'raceId', 'race_id')) === String(raceId)) || null;
  const notes = state.notes.filter((note) => note.raceId === raceId);
  const currentStatus = String(race.status || 'SCHEDULED').toUpperCase();
  const lifecycleOption = (value, label) => '<option value="' + value + '"' + (currentStatus === value ? ' selected' : '') + '>' + label + '</option>';
  return '<section class="card detail-card" aria-labelledby="race-detail-title"><div class="card-head"><div><p class="eyebrow">Evidence detail</p><h3 id="race-detail-title">' + esc(race.venue || 'Unknown venue') + ', ' + esc(race.country || '—') + '</h3></div><div class="button-row">' + status(race.status || 'SCHEDULED', ['ABANDONED', 'RUNNING', 'FINISHED', 'SETTLED', 'VOID'].includes(currentStatus) ? 'blocked' : 'open') + irishRacingOddsControl(race) + paperBetControl(paperAction.runnerId, paperAction.enabled, raceId, paperBetPlaced) + '</div></div><div class="evidence-grid"><div><span>Scheduled off</span><strong>' + isoTime(race.scheduledOffAt || race.scheduled_off_at) + '</strong></div><div><span>Going</span><strong>' + esc(race.going || 'Unavailable') + '</strong></div><div><span>Surface</span><strong>' + esc(race.surface || 'Unavailable') + '</strong></div><div><span>Field</span><strong>' + (race.fieldSize || '—') + '</strong></div><div><span>Quote age</span><strong>' + (Number.isFinite(quoteAgeFor(race, { quote })) ? quoteAgeFor(race, { quote }) + 's' : 'Unavailable') + '</strong></div><div><span>Source</span><strong>' + esc(race.irishRacing ? 'The Racing API + Irishracing.com' : (race.provider || 'The Racing API')) + '</strong></div></div><div class="evidence-mode">' + icon('lock') + ' PAPER ONLY · Every displayed price is evidence, never an order instruction.</div><div class="lifecycle-row"><label for="raceLifecycle">Race lifecycle</label><select id="raceLifecycle" data-lifecycle>' + lifecycleOption('SCHEDULED', 'Scheduled') + lifecycleOption('DELAYED', 'Delayed') + lifecycleOption('RUNNING', 'Running') + lifecycleOption('FINISHED', 'Finished') + lifecycleOption('ABANDONED', 'Abandoned') + lifecycleOption('SETTLED', 'Settled') + lifecycleOption('VOID', 'Void') + '</select><input id="lifecycleReason" data-lifecycle-reason placeholder="Optional status reason" /><button class="secondary small" data-save-lifecycle="' + esc(raceId) + '">' + icon('save') + ' Save state</button></div><div class="provenance-box"><strong>Feature provenance</strong><span>Course, distance, going, field, and quote timestamps are shown with their source. Trainer/jockey form remains unavailable until the provider supplies it.</span></div>' + runnerEvidence(race) + '<div class="note-form"><label for="raceNote">Research note</label><textarea id="raceNote" placeholder="Record a pre-race hypothesis, data caveat, or post-race observation.">' + esc(notes[0]?.note || '') + '</textarea><div class="button-row"><button class="secondary small" data-save-note="' + esc(raceId) + '">' + icon('note') + ' Save note</button><span class="subtle">' + notes.length + ' notes for this race</span></div></div></section>';
}

function raceCard(race) {
  const raceId = raceIdFor(race);
  const activeRunners = (race.runners || []).filter((runner) => !['WITHDRAWN', 'NON_RUNNER', 'NR'].includes(String(runner.status || '').toUpperCase()));
  const marketComplete = activeRunners.length >= 2 && activeRunners.every((runner) => Number(runner.odds) > 1);
  const response = raceDecisionResponse(race);
  const decision = response.decision || {};
  const quoteAge = quoteAgeFor(race, response);
  const maxQuoteAge = Number(state.settings?.maxQuoteAgeSeconds ?? 300);
  const freshQuote = Number.isFinite(quoteAge) && quoteAge <= maxQuoteAge;
  const paperAction = raceDecisionAction(race);
  const paperBetPlaced = raceHasPaperBet(race);
  const decisionMatches = Boolean(race.paperDecision) || paperAction.enabled || (response.quote && String(field(response.quote, 'raceId', 'race_id')) === String(raceId));
  const qualityPass = decisionMatches && Boolean(decision.gates?.quality);
  const uncertaintyPass = decisionMatches && Boolean(decision.gates?.uncertainty);
  const modelPass = decisionMatches && Boolean(decision.gates?.modelScore);
  const raceOpen = decisionMatches ? decision.gates?.raceNotStarted !== false : Date.parse(race.scheduledOffAt || race.scheduled_off_at || '') > Date.now();
  const action = paperBetPlaced ? 'PAPER BET PLACED' : paperAction.enabled ? 'PAPER CANDIDATE' : 'ABSTAIN';
  const tone = paperBetPlaced || paperAction.enabled ? 'open' : 'blocked';
  const gate = (label, pass) => '<span class="gate-chip ' + (pass ? 'pass' : 'fail') + '">' + icon(pass ? 'check' : 'alert') + esc(label) + '</span>';
  const reasons = [
    !freshQuote && 'STALE_OR_MISSING_QUOTE',
    !qualityPass && 'LOW_OR_MISSING_DATA_QUALITY',
    !marketComplete && 'INCOMPLETE_MARKET',
    !modelPass && 'MODEL_SCORE_MISSING',
    !raceOpen && 'RACE_STARTED',
    !uncertaintyPass && 'UNCERTAINTY_NOT_CLEARED'
  ].filter(Boolean);
  return '<article class="card race-card ' + (paperBetPlaced ? 'race-card-bet' : '') + '" aria-labelledby="race-card-' + esc(raceId) + '">' +
    '<div class="card-head"><div><p class="eyebrow">Race Finder</p><h3 id="race-card-' + esc(raceId) + '">' + esc(race.venue || 'Unknown venue') + ', ' + esc(race.country || '—') + '</h3><p class="subtle">' + isoTime(race.scheduledOffAt || race.scheduled_off_at) + ' · ' + esc(race.going || 'Going unavailable') + '</p></div><div class="race-card-status">' + status(action, tone) + '</div></div>' +
    '<div class="evidence-grid"><div><span>Scheduled off</span><strong>' + isoTime(race.scheduledOffAt || race.scheduled_off_at) + '</strong></div><div><span>Going</span><strong>' + esc(race.going || '—') + '</strong></div><div><span>Surface</span><strong>' + esc(race.surface || '—') + '</strong></div><div><span>Field</span><strong>' + (race.fieldSize || race.field_size || activeRunners.length || '—') + '</strong></div><div><span>Quote age</span><strong>' + (Number.isFinite(quoteAge) ? esc(Math.round(quoteAge) + 's') : '—') + '</strong></div><div><span>Source</span><strong>' + esc(race.irishRacing ? 'The Racing API + Irishracing.com' : (race.provider || 'The Racing API')) + '</strong></div></div>' +
    '<div class="gate-row">' + gate(freshQuote ? 'Quote fresh' : 'Quote stale', freshQuote) + gate(qualityPass ? 'Data quality pass' : 'Data quality fail', qualityPass) + gate(marketComplete ? 'Market complete' : 'Market incomplete', marketComplete) + gate(modelPass ? 'Model score ready' : 'Model score missing', modelPass) + gate(raceOpen ? 'Race open' : 'Race started', raceOpen) + gate(uncertaintyPass ? 'Uncertainty acceptable' : 'Uncertainty high', uncertaintyPass) + '</div>' +
    '<div class="decision-footer"><span>' + esc(paperBetPlaced ? 'Paper position recorded for this race.' : reasons.length ? 'No-bet reasons: ' + reasons.join(' · ') : 'All deterministic gates passed after recorded costs.') + '</span><div class="button-row"><button class="secondary small" data-inspect="' + esc(raceId) + '" type="button">' + icon('eye') + ' Inspect evidence</button>' + '<button class="link-button" data-watch="' + esc(raceId) + '" aria-pressed="' + String(isWatched(raceId)) + '">' + icon(isWatched(raceId) ? 'check' : 'note') + ' ' + (isWatched(raceId) ? 'Watched' : 'Watch') + '</button>' + irishRacingOddsControl(race) + paperBetControl(paperAction.runnerId, paperAction.enabled, raceId, paperBetPlaced) + '</div></div>' +
    '</article>';
}

function runnerEvidenceRows(race) {
  const response = raceDecisionResponse(race);
  const selected = response.runner || {};
  return (race.runners || []).map((runner) => {
    const runnerId = runner.providerRunnerId || runner.runnerId;
    const isSelected = selected.runnerId && String(selected.runnerId) === String(runnerId);
    return '<tr><td><span class="horse">' + esc(runner.number || '—') + '. ' + esc(runner.horseName || runner.horse || 'Unnamed') + '</span></td><td>' + (isSelected ? pct(selected.modelProbability ?? selected.probability) : '—') + '</td><td>' + (isSelected ? pct(response.decision?.noVigProbability) : '—') + '</td><td>' + (isSelected ? odds(response.decision?.fairOdds) : '—') + '</td><td>' + odds(runner.odds) + '</td><td>' + (isSelected ? pct(response.decision?.expectedValue) : '—') + '</td><td>' + (isSelected && Number.isFinite(Number(selected.dataQuality)) ? Number(selected.dataQuality).toFixed(0) + '/100' : '—') + '</td><td>' + status(isSelected ? (response.decision?.status || 'ABSTAIN') : 'ABSTAIN', isSelected && response.decision?.status === 'PAPER_CANDIDATE' ? 'open' : 'blocked') + '</td></tr>';
  }).join('');
}

function raceFinder() {
  const races = filteredRaces();
  const visibleRaces = races.slice(0, state.racePageSize);
  const loadMore = races.length > visibleRaces.length ? '<div class="load-more-row"><span class="subtle">Showing ' + visibleRaces.length + ' of ' + races.length + ' loaded races.</span><button class="secondary small" data-load-more-races type="button">' + icon('refresh') + ' Load more races</button></div>' : '';
  return header('Race Finder', 'Choose a day, venue, or race from the loaded fixtures, inspect evidence quality, and only approve paper decisions that pass every gate.') + filterControls() +
    (state.fixtureEvidence?.notice ? '<div class="gate info" role="status"><span class="gate-icon">' + icon('info') + '</span><div><strong>Live odds feed needs attention</strong><p>' + esc(state.fixtureEvidence.notice) + ' Paper bets stay disabled until a complete timestamped odds book is available.</p></div></div>' : '') +
    '<section class="race-card-list" aria-label="Race evidence queue">' + (visibleRaces.map(raceCard).join('') || '<div class="card empty">No races match these filters.</div>') + '</section>' + loadMore +
    (state.selectedRace ? raceDetail(state.selectedRace) : decisionCard()) +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Runner evidence</p><h3>Model versus market</h3></div>' + status('PAPER ONLY', 'soon') + '</div><div class="table-wrap" tabindex="0" aria-label="Runner evidence table"><table class="data-table"><thead><tr><th>Runner</th><th>Model probability</th><th>No-vig market</th><th>Fair odds</th><th>Current odds</th><th>After-cost EV</th><th>Data quality</th><th>Decision</th></tr></thead><tbody>' + (state.selectedRace?.runners?.length ? runnerEvidenceRows(state.selectedRace) : '<tr><td colspan="8"><div class="empty">No runner-level odds snapshot is available. QVM abstains instead of inventing a market.</div></td></tr>') + '</tbody></table></div><p class="table-note">Every displayed comparison comes from the same captured quote and server-owned decision contract.</p></section>';
}

function resultsView() {
  return header('Results', 'Store results separately from live fixtures so historical validation never overwrites pre-race evidence.') +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Historical record</p><h3>Imported and captured results</h3></div>' + status(state.results.length + ' stored', state.results.length ? 'open' : 'soon') + '</div>' +
    (state.results.length ? state.results.slice(0, 100).map((item) => {
      const result = item.result || {};
      const winner = result.winner || result.winning_horse || result.first || 'Winner not normalised';
      return '<div class="result-row"><div><b>' + esc(result.course || result.venue || item.raceId || 'Race result') + '</b><small>' + esc(item.raceId) + ' · captured ' + esc(isoTime(item.capturedAt)) + ' · winner ' + esc(winner) + '</small></div>' + status('ARCHIVED', 'open') + '</div>';
    }).join('') : '<div class="empty">No historical results stored yet. Import a dated result set from the Research view.</div>') + '</section>' +
    '<section class="card"><div class="gate info"><span class="gate-icon">' + icon('info') + '</span><div><strong>Historical validation guard</strong><p>Imported timestamps cannot be in the future. Results remain separate from quotes to prevent look-ahead leakage.</p></div></div></section>';
}

function positionsView() {
  const open = state.positions.filter((position) => String(position.status || '').toUpperCase() === 'OPEN');
  const settings = state.settings || {};
  return header('Paper Positions', 'Every position is paper-only, linked to its evidence snapshot, and settled through the hosted ledger.') +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Hosted ledger</p><h3>Open and settled positions</h3></div>' + status(open.length + ' open', open.length ? 'soon' : 'open') + '</div>' +
    (state.positions.length ? '<div class="list">' + state.positions.map((position) => {
      const id = field(position, 'id', 'id');
      const positionStatus = String(position.status || '').toUpperCase();
      return '<div class="position"><div><b>' + esc(field(position, 'runner', 'runner')) + '</b><small>' + esc(field(position, 'venue', 'venue')) + ' · WIN · ' + odds(position.odds) + ' odds · ' + money(position.stake) + ' stake · ' + esc(positionStatus) + ' · snapshot ' + esc(position.snapshotId || position.snapshot_id || 'unavailable') + '</small></div><div class="position-actions">' + (positionStatus === 'OPEN' ? '<select data-outcome aria-label="Settlement outcome"><option value="WON">Won</option><option value="LOST">Lost</option><option value="VOID">Void</option><option value="NON_RUNNER">Non-runner</option></select><input class="close-odds" data-close-odds inputmode="decimal" placeholder="Close odds" aria-label="Closing odds" /><button class="secondary small" data-settle="' + esc(id) + '">' + icon('check') + ' Settle</button>' : '<span class="pnl ' + (Number(position.pnl) >= 0 ? 'good' : 'bad') + '">' + (Number(position.pnl) >= 0 ? '+' : '') + money(position.pnl) + '</span>') + '</div></div>';
    }).join('') + '</div>' : '<div class="empty">No paper positions yet.<br><span class="subtle">Only approve a candidate after reviewing its evidence.</span></div>') + '</section>' +
    '<section class="card"><h3>Exposure guardrails</h3><div class="risk-grid"><div><span>Bankroll</span><strong>' + money(settings.bankroll) + '</strong></div><div><span>Single stake cap</span><strong>' + pct(settings.maxStakePct) + '</strong></div><div><span>Total exposure cap</span><strong>' + pct(settings.maxTotalExposurePct) + '</strong></div><div><span>Fixture exposure cap</span><strong>' + pct(settings.maxFixtureExposurePct) + '</strong></div></div><div class="setting"><p>Automatic paper trades<small>OFF. Approval remains explicit.</small></p>' + status('OFF', 'soon') + '</div><div class="setting"><p>Live order placement<small>Not available in QVM Racing Workbench.</small></p>' + status('DISABLED', 'blocked') + '</div></section>';
}

function sparkline(series) {
  if (!series?.length) return '<div class="empty">Equity appears after the first settled paper position.</div>';
  const values = series.map((item) => Number(item.equity) || 0);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(max - min, 1);
  return '<div class="sparkline" aria-label="Paper equity curve">' + values.map((value) => '<span class="' + (value < 0 ? 'negative' : '') + '" style="height:' + Math.max(6, Math.round(((value - min) / range) * 100)) + '%" title="' + esc(money(value)) + '"></span>').join('') + '</div>';
}

function performance() {
  const metric = state.performance || {};
  const drift = metric.drift || {};
  const segmentRows = Object.entries(metric.segmentCalibration || {}).map(([segment, summary]) => '<div class="calibration-row"><span>' + esc(segment) + '</span><span>' + Number(summary.count || 0) + ' decisions</span><strong>' + pct(summary.observedRate) + ' observed</strong></div>').join('');
  return header('Performance', 'Measure probability quality and price quality separately from paper P&L.') +
    '<section class="kpis"><div class="kpi"><span class="kpi-label">Settled positions</span><strong class="kpi-value">' + (metric.settledPositions ?? '—') + '</strong><span class="kpi-note">' + esc(metric.sampleStatus || 'Loading sample status') + '</span></div><div class="kpi"><span class="kpi-label">Net paper P&L</span><strong class="kpi-value ' + (Number(metric.netPaperPnl) >= 0 ? 'good' : 'bad') + '">' + money(metric.netPaperPnl) + '</strong><span class="kpi-note">After recorded costs</span></div><div class="kpi"><span class="kpi-label">Brier score</span><strong class="kpi-value">' + (metric.brierScore ?? '—') + '</strong><span class="kpi-note">Lower is better; sample required</span></div><div class="kpi"><span class="kpi-label">Closing-line value</span><strong class="kpi-value">' + pct(metric.closingLineValue) + '</strong><span class="kpi-note">Needs captured near-off prices</span></div></section>' +
    '<div class="grid-2"><section class="card"><div class="card-head"><h3>Paper equity</h3>' + status(metric.sampleStatus || 'INSUFFICIENT DATA', metric.sampleStatus === 'READY' ? 'open' : 'soon') + '</div>' + sparkline(metric.equitySeries) + '<div class="setting"><p>Turnover<small>Settled and open stakes in the hosted ledger.</small></p><strong>' + money(metric.turnover) + '</strong></div><div class="setting"><p>Peak-to-trough drawdown<small>Paper equity decline.</small></p><strong>' + money(metric.drawdown) + '</strong></div></section>' +
    '<section class="card"><h3>Calibration</h3><div class="calibration-list">' + ((metric.calibrationBins || []).map((bin) => '<div class="calibration-row"><span>' + pct(bin.lower) + '–' + pct(bin.upper) + '</span><span>' + bin.count + ' decisions</span><strong>' + pct(bin.observedRate) + ' observed</strong></div>').join('') || '<div class="empty">Calibration begins after settled snapshots are available.</div>') + segmentRows + '</div></section></div>' +
    '<section class="card"><h3>Model and drift diagnostics</h3><div class="setting"><p>Log loss<small>Penalises overconfident misses.</small></p><strong>' + (metric.logLoss ?? '—') + '</strong></div><div class="setting"><p>Average data quality<small>Evidence completeness and freshness.</small></p><strong>' + (metric.averageDataQuality == null ? '—' : Number(metric.averageDataQuality).toFixed(1) + '/100') + '</strong></div><div class="setting"><p>Average slippage<small>Selection odds minus recorded near-off odds.</small></p><strong>' + (Number.isFinite(Number(metric.averageSlippage)) ? Number(metric.averageSlippage).toFixed(2) : '—') + '</strong></div><div class="setting"><p>Drift<small>Current versus baseline calibration sample.</small></p>' + status(drift.status || 'INSUFFICIENT DATA', drift.status === 'STABLE' ? 'open' : 'soon') + '</div><div class="setting"><p>Walk-forward sample<small>Minimum 30 settled decisions before “ready”.</small></p>' + status(metric.sampleStatus || 'INSUFFICIENT DATA', metric.sampleStatus === 'READY' ? 'open' : 'soon') + '</div></section>';
}

function research() {
  const snapshots = state.snapshots || [];
  return header('Research', 'Chronological validation that separates genuine signal from leakage and luck.') +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Validation protocol</p><h3>walk-forward status</h3></div>' + status('LEAKAGE RULE ENFORCED', 'open') + '</div><div class="gate info"><span class="gate-icon">' + icon('info') + '</span><div><strong>Historical sample is still building</strong><p>Results are evaluated in time order. Features must be available before scheduled off; no future result or closing price is used in a pre-race decision.</p></div></div><div class="benchmark-grid"><div><b>Market no-vig</b><small>Primary benchmark</small></div><div><b>Favourite baseline</b><small>Simple challenger</small></div><div><b>QVM model</b><small>racing-logit-v2</small></div><div><b>Ensemble</b><small>Enabled after sample threshold</small></div></div></section>' +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Historical import</p><h3>Bring in dated evidence</h3></div>' + status('NO LIVE ORDERS', 'blocked') + '</div><p class="subtle">Import quotes, results, or race metadata as a JSON array. Quote timestamps must be valid; result timestamps cannot be in the future.</p><div class="import-row"><select id="importKind"><option value="quotes">Quotes</option><option value="results">Results</option><option value="races">Races</option></select><button class="secondary small" data-import>' + icon('upload') + ' Import JSON</button></div><textarea id="importPayload" class="import-textarea" placeholder=\'[{"raceId":"race-1","capturedAt":"2026-09-19T12:00:00Z","runners":[{"runnerId":"runner-1","odds":3.2}]}]\'></textarea><p id="importStatus" class="subtle" aria-live="polite"></p></section>' +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Reproducibility</p><h3>Decision snapshots</h3></div>' + status(snapshots.length + ' recorded', snapshots.length ? 'open' : 'soon') + '</div>' + (snapshots.length ? snapshots.slice(0, 40).map((snapshot) => '<div class="snapshot-row"><div><b>' + esc(snapshot.runner || snapshot.runnerId) + '</b><small>' + esc(snapshot.venue) + ' · ' + esc(snapshot.modelVersion) + ' · ' + esc(snapshot.id) + '</small></div><button class="secondary small" data-replay="' + esc(snapshot.id) + '">' + icon('replay') + ' Replay</button></div>').join('') : '<div class="empty">No server-owned decision snapshots yet.</div>') + (state.replay ? '<div class="replay-box"><strong>Deterministic replay</strong><pre>' + esc(JSON.stringify(state.replay, null, 2)) + '</pre></div>' : '') + '</section>' +
    '<section class="card"><h3>What the app will measure</h3><div class="setting"><p>Probability quality<small>Brier score, log loss, calibration bins.</small></p>' + status('TRACKED', 'open') + '</div><div class="setting"><p>Price quality<small>Selection price versus near-off price and CLV.</small></p>' + status('WAITING FOR SNAPSHOTS', 'soon') + '</div><div class="setting"><p>Market regime<small>Odds-band and race-type bias re-estimated over time.</small></p>' + status('TRACKED', 'open') + '</div></section>';
}

function agents() {
  return header('Agents', 'OpenAI explains evidence; deterministic gates retain control of paper decisions.') +
    '<section class="card ai-panel" data-ai-panel="true" aria-labelledby="ai-panel-title"><div class="ai-panel-head"><div><p class="eyebrow">Live evidence assistant</p><h3 id="ai-panel-title">Ask OpenAI about the current book</h3><p class="ai-panel-description">Each question is sent with fresh fixture data, stored odds snapshots, paper positions, provider health, and risk settings.</p></div>' + sourceState(state.integrations?.openai?.configured, 'HOSTED') + '</div><label for="aiQuestion">Question about live racing evidence</label><div class="ai-row"><textarea id="aiQuestion" rows="3" placeholder="Which current races have complete, fresh odds and why?" ></textarea><button class="primary ai-submit" data-ask-ai="true" type="button">' + icon('search') + ' Ask OpenAI</button></div><p id="aiContextStatus" class="ai-context-status" aria-live="polite">Server evidence is attached when you ask.</p><div class="ai-answer" role="region" aria-label="OpenAI answer"><span class="ai-answer-label">Answer</span><p id="aiAnswer" aria-live="polite" aria-atomic="true">Ask a question to analyse the current evidence. The assistant is paper-only and cannot submit wagers.</p></div></section>' +
    '<section class="card agent-stack"><div class="agent"><div><b>OpenAI assistant</b><small>Summarises fixtures, freshness, model output and uncertainty.</small></div>' + sourceState(state.integrations?.openai?.configured, 'HOSTED') + '</div><div class="agent"><div><b>Decision engine</b><small>Calculates fair price, post-cost EV, and abstention reasons.</small></div>' + status('READY', 'open') + '</div><div class="agent"><div><b>Safety auditor</b><small>Vetoes stale, incomplete, unsupported, or live actions.</small></div>' + status('READY', 'open') + '</div></section>';
}

function settings() {
  const s = state.settings || {};
  const input = (key, label, value, suffix = '') => '<label class="setting-field">' + esc(label) + '<div class="setting-input-wrap"><input class="setting-input" data-setting="' + esc(key) + '" data-percent="' + (suffix === '%' ? 'true' : 'false') + '" type="number" step="0.1" value="' + esc(value) + '" />' + (suffix ? '<span>' + esc(suffix) + '</span>' : '') + '</div></label>';
  return header('Settings', 'Provider connections, freshness policy, and explicit safety boundaries.') +
    '<section class="card"><div class="setting"><p>Fixture provider<small>The Racing API supplies current racecards and results.</small></p>' + sourceState(state.integrations?.racingApi?.configured, 'CONNECTED') + '</div><div class="setting"><p>Weather provider<small>Open-Meteo is requested on demand and cached to protect quota.</small></p>' + status('ON DEMAND', 'open') + '</div><div class="setting"><p>OpenAI model<small>Server-side explanatory assistant.</small></p><strong>' + esc(state.integrations?.openai?.configured ? 'gpt-5.6-luna · medium' : 'NOT CONFIGURED') + '</strong></div><div class="setting"><p>Freshness policy<small>300s distant · 60s 10–30m · 30s 2–10m · 10s near-off.</small></p>' + status('ENFORCED', 'open') + '</div></section>' +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Risk controls</p><h3>Paper exposure settings</h3></div><button class="primary small" data-save-settings>' + icon('save') + ' Save settings</button></div><div class="risk-edit">' + input('bankroll', 'Bankroll', Number(s.bankroll ?? 1000).toFixed(2), '€') + input('maxStakePct', 'Single stake cap', (Number(s.maxStakePct ?? .1) * 100).toFixed(1), '%') + input('maxTotalExposurePct', 'Total exposure cap', (Number(s.maxTotalExposurePct ?? .3) * 100).toFixed(1), '%') + input('maxFixtureExposurePct', 'Fixture exposure cap', (Number(s.maxFixtureExposurePct ?? .1) * 100).toFixed(1), '%') + input('modelWeight', 'Model weight', (Number(s.modelWeight ?? .5) * 100).toFixed(1), '%') + input('minDataQuality', 'Minimum data quality', Number(s.minDataQuality ?? 70).toFixed(0), '/100') + input('maxQuoteAgeSeconds', 'Maximum quote age', Number(s.maxQuoteAgeSeconds ?? 300).toFixed(0), 's') + '</div><p id="settingsStatus" class="subtle" aria-live="polite"></p></section>' +
    '<section class="card"><div class="card-head"><div><p class="eyebrow">Provider health</p><h3>Recent checks</h3></div>' + status('MONITORED', 'open') + '</div>' + (state.health.map((item) => '<div class="health-row"><div><b>' + esc(item.provider) + '</b><small>' + esc(item.message || '') + ' · ' + esc(item.checkedAt || '') + '</small></div>' + status(item.status, item.status === 'HEALTHY' ? 'open' : 'soon') + '</div>').join('') || '<div class="empty">Provider checks appear after the first hosted request.</div>') + '</section>';
}

function render() {
  const pages = { dashboard, races: raceFinder, results: resultsView, positions: positionsView, performance, research, agents, settings };
  app.innerHTML = (pages[state.view] || dashboard)();
  const shell = document.querySelector('.app-shell');
  if (shell) shell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const toggle = document.querySelector('#sidebarToggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    toggle.setAttribute('aria-label', state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.title = state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
  }
  const mobileToggle = document.querySelector('#mobileSidebarToggle');
  if (mobileToggle) {
    mobileToggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    mobileToggle.setAttribute('aria-label', state.sidebarCollapsed ? 'Open navigation' : 'Close navigation');
    mobileToggle.title = state.sidebarCollapsed ? 'Open navigation' : 'Close navigation';
  }
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  const clock = document.querySelector('#clock');
  if (clock) clock.textContent = new Date().toISOString().slice(11, 19);
}

async function toggleWatchlist(raceId) {
  try {
    await getJson('/api/qvm/racing/watchlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raceId, active: !isWatched(raceId) }) });
    const body = await getJson('/api/qvm/racing/watchlist');
    state.watchlist = body.watchlist || [];
    render();
    toast(isWatched(raceId) ? 'Race added to watchlist.' : 'Race removed from watchlist.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveLifecycle(raceId) {
  const statusValue = document.querySelector('[data-lifecycle]')?.value;
  const reason = document.querySelector('[data-lifecycle-reason]')?.value.trim();
  try {
    await getJson('/api/qvm/racing/lifecycle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raceId, status: statusValue, reason }) });
    if (state.selectedRace) state.selectedRace = { ...state.selectedRace, status: statusValue, lifecycle: { status: statusValue, reason } };
    render();
    toast('Race lifecycle state saved.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function inspectRace(id) {
  state.selectedRace = state.races.find((race) => String(field(race, 'providerRaceId', 'provider_race_id') || field(race, 'raceId', 'race_id')) === String(id)) || null;
  state.view = 'races';
  render();
  if (!id) return;
  try {
    const body = await getJson('/api/qvm/racing/quotes?raceId=' + encodeURIComponent(id));
    state.quotes = body.snapshots || [];
    const notes = await getJson('/api/qvm/racing/notes?raceId=' + encodeURIComponent(id));
    state.notes = notes.notes || [];
    render();
  } catch (error) {
    toast('Evidence detail unavailable: ' + error.message, true);
  }
}

async function createPaperPosition(runnerId, raceId) {
  try {
    const body = await getJson('/api/qvm/racing/paper-positions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runnerId: runnerId || fallbackCandidate.runnerId, raceId: raceId || undefined }) });
    state.view = 'positions';
    await loadData({ refresh: true, view: 'positions' });
    toast('Paper position recorded with snapshot ' + (body.snapshotId || '—') + '.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function settlePosition(button) {
  const container = button.closest('.position-actions');
  const outcome = container?.querySelector('[data-outcome]')?.value || 'WON';
  const closeOdds = container?.querySelector('[data-close-odds]')?.value;
  try {
    await getJson('/api/qvm/racing/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ positionId: button.dataset.settle, outcome, closeOdds }) });
    await loadData({ refresh: true, view: state.view });
    toast('Paper settlement recorded online.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function askOpenAI() {
  const input = document.querySelector('#aiQuestion');
  const answer = document.querySelector('#aiAnswer');
  const contextStatus = document.querySelector('#aiContextStatus');
  const button = document.querySelector('[data-ask-ai]');
  const message = input?.value.trim();
  if (!message || !answer) {
    if (answer) {
      answer.dataset.state = 'error';
      answer.textContent = 'Enter a question before asking OpenAI.';
    }
    input?.focus();
    return;
  }
  if (button) {
    button.disabled = true;
    button.innerHTML = icon('refresh') + ' Asking OpenAI…';
  }
  input.disabled = true;
  answer.dataset.state = 'loading';
  answer.setAttribute('aria-busy', 'true');
  answer.textContent = 'OpenAI is reviewing the evidence…';
  try {
    const body = await getJson('/api/qvm/racing/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    answer.dataset.state = body.answer ? 'success' : 'error';
    answer.textContent = body.answer || 'No explanation was returned.';
    if (contextStatus && body.context) {
      contextStatus.textContent = body.context.evidenceError
        ? 'Live context warning: ' + body.context.evidenceError
        : 'Context loaded: ' + body.context.liveFixtureCount + ' live fixtures · ' + body.context.storedQuoteCount + ' stored quote snapshots · ' + body.context.openPaperPositionCount + ' open paper positions.';
    }
  } catch (error) {
    answer.dataset.state = 'error';
    answer.textContent = 'OpenAI unavailable: ' + (error.message || 'The hosted assistant could not respond.');
  } finally {
    answer.removeAttribute('aria-busy');
    input.disabled = false;
    if (button) {
      button.disabled = false;
      button.innerHTML = icon('search') + ' Ask OpenAI';
    }
  }
}

async function saveNote(raceId) {
  const note = document.querySelector('#raceNote')?.value.trim();
  if (!note) return toast('Add a note before saving.', true);
  try {
    await getJson('/api/qvm/racing/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raceId, note }) });
    await inspectRace(raceId);
    toast('Research note saved.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveFilter() {
  const name = window.prompt('Name this filter', 'My race filter');
  if (!name) return;
  try {
    await getJson('/api/qvm/racing/filters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, filter: state.filters }) });
    await loadData({ refresh: true, view: state.view });
    toast('Filter saved.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function importData() {
  const statusElement = document.querySelector('#importStatus');
  const kind = document.querySelector('#importKind')?.value;
  const payloadText = document.querySelector('#importPayload')?.value.trim();
  if (!payloadText) return toast('Paste a JSON array to import.', true);
  let records;
  try {
    records = JSON.parse(payloadText);
  } catch {
    if (statusElement) statusElement.textContent = 'Invalid JSON. Correct the payload and try again.';
    return;
  }
  try {
    const body = await getJson('/api/qvm/racing/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, records }) });
    if (statusElement) statusElement.textContent = body.accepted + ' accepted · ' + body.rejected + ' rejected' + (body.errors?.length ? ' · ' + body.errors.join(', ') : '');
    await loadData({ refresh: true, view: state.view });
    toast('Import job completed.');
  } catch (error) {
    if (statusElement) statusElement.textContent = error.message;
    toast(error.message, true);
  }
}

async function replaySnapshot(id) {
  try {
    state.replay = await getJson('/api/qvm/racing/replay?snapshotId=' + encodeURIComponent(id));
    render();
    toast('Snapshot replayed deterministically.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function acknowledgeAlert(id) {
  try {
    await getJson('/api/qvm/racing/alerts/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    state.alerts = state.alerts.filter((alert) => alert.id !== id);
    render();
    toast('Alert acknowledged.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveSettings() {
  const values = {};
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const number = Number(input.value);
    if (!Number.isFinite(number)) return;
    values[input.dataset.setting] = input.dataset.percent === 'true' ? number / 100 : number;
  });
  const statusElement = document.querySelector('#settingsStatus');
  try {
    const body = await getJson('/api/qvm/racing/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
    state.settings = body.settings || state.settings;
    if (statusElement) statusElement.textContent = 'Settings saved at ' + new Date().toISOString();
    toast('Risk settings saved.');
  } catch (error) {
    if (statusElement) statusElement.textContent = error.message;
    toast(error.message, true);
  }
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('.nav-item');
  const target = event.target.closest('[data-view-target]');
  const inspect = event.target.closest('[data-inspect]');
  const place = event.target.closest('[data-place-paper]');
  const loadIrishOdds = event.target.closest('[data-load-irish-odds]');
  const settle = event.target.closest('[data-settle]');
  const sidebarToggle = event.target.closest('#sidebarToggle, #mobileSidebarToggle');
  if (sidebarToggle) {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem('qvm-sidebar-collapsed', String(state.sidebarCollapsed));
    render();
    return;
  }
  if (nav) {
    state.view = nav.dataset.view;
    state.selectedRace = null;
    if (window.matchMedia('(max-width: 900px)').matches) {
      state.sidebarCollapsed = true;
      localStorage.setItem('qvm-sidebar-collapsed', 'true');
    }
    render();
    loadData({ view: state.view });
    return;
  }
  if (target) {
    state.view = target.dataset.viewTarget;
    render();
    loadData({ view: state.view });
    return;
  }
  if (inspect) {
    inspectRace(inspect.dataset.inspect);
    return;
  }
  const watch = event.target.closest('[data-watch]');
  if (watch) {
    toggleWatchlist(watch.dataset.watch);
    return;
  }
  const lifecycle = event.target.closest('[data-save-lifecycle]');
  if (lifecycle) {
    saveLifecycle(lifecycle.dataset.saveLifecycle);
    return;
  }
  if (place) {
    createPaperPosition(place.dataset.placePaper, place.dataset.paperRace);
    return;
  }
  if (loadIrishOdds) {
    loadIrishRacingOdds(loadIrishOdds.dataset.loadIrishOdds);
    return;
  }
  if (settle) {
    settlePosition(settle);
    return;
  }
  if (event.target.closest('#refreshBtn')) {
    loadData({ refresh: true });
    toast('Refreshing hosted race evidence and Irishracing odds…');
    return;
  }
  if (event.target.closest('#refreshOddsBtn')) {
    refreshIrishRacingOdds();
    return;
  }
  if (event.target.closest('[data-load-more-races]')) {
    state.racePageSize += 12;
    render();
    return;
  }
  if (event.target.closest('[data-weather]')) {
    loadWeather();
    return;
  }
  if (event.target.closest('[data-ask-ai]')) {
    askOpenAI();
    return;
  }
  const saveFilterButton = event.target.closest('[data-save-filter]');
  if (saveFilterButton) {
    saveFilter();
    return;
  }
  if (event.target.closest('[data-clear-filter]')) {
    state.filters = { day: 'all', venue: 'all', race: 'all', region: 'all', status: 'all', sort: 'off' };
    render();
    return;
  }
  const loadFilterButton = event.target.closest('[data-load-filter]');
  if (loadFilterButton) {
    const saved = state.filtersSaved.find((item) => item.id === loadFilterButton.dataset.loadFilter);
    if (saved?.filter) state.filters = { ...state.filters, ...saved.filter };
    render();
    return;
  }
  const saveNoteButton = event.target.closest('[data-save-note]');
  if (saveNoteButton) {
    saveNote(saveNoteButton.dataset.saveNote);
    return;
  }
  const importButton = event.target.closest('[data-import]');
  if (importButton) {
    importData();
    return;
  }
  const replayButton = event.target.closest('[data-replay]');
  if (replayButton) {
    replaySnapshot(replayButton.dataset.replay);
    return;
  }
  const ackButton = event.target.closest('[data-ack]');
  if (ackButton) {
    acknowledgeAlert(ackButton.dataset.ack);
    return;
  }
  if (event.target.closest('[data-save-settings]')) saveSettings();
});

document.addEventListener('change', (event) => {
  const filter = event.target.closest('[data-filter]');
  if (!filter) return;
  const key = filter.dataset.filter;
  state.filters[key] = filter.value;
  state.racePageSize = 12;
  if (['day', 'region', 'status'].includes(key)) {
    state.filters.venue = 'all';
    state.filters.race = 'all';
  }
  if (key === 'venue') state.filters.race = 'all';
  render();
});

setInterval(() => {
  const clock = document.querySelector('#clock');
  if (clock) clock.textContent = new Date().toISOString().slice(11, 19);
}, 1000);

render();
loadData();
