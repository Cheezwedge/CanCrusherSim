// Can Crush Lab - UI controller.
import { CAN_PRESETS } from '../physics/canGeometry.js';
import { createSimChannel } from '../sim/client.js';
import { ForceChart, escapeHtml } from './chart.js';
import { REFERENCE_RUNS } from './referenceRuns.js';
import { STRATEGIES, UI_DEFAULTS, uiToParams } from '../sim/strategies.js';

const $ = (id) => document.getElementById(id);
const PLATEN_LABEL = { convex: 'curved (bulging)', concave: 'curved (dished)', roof: 'roof-V', valley: 'valley-V', tilt: 'tilted', hinge: 'hinged' };
const N2LBF = 0.2248089, N2KGF = 0.1019716;

// ---------------------------------------------------------------------------
// state
const ui = { ...UI_DEFAULTS, unit: 'N', ratio: 6, handF: 150, color: 'paint' };
const fmtUnit = (n) => (ui.unit === 'lbf' ? n * N2LBF : ui.unit === 'kgf' ? n * N2KGF : n);
const fmtForce = (n, withUnit = true) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = fmtUnit(n);
  const s = ui.unit === 'N' ? Math.round(v).toLocaleString() : v.toFixed(v < 100 ? 1 : 0);
  return withUnit ? `${s}<small>${ui.unit}</small>` : s;
};

// ---------------------------------------------------------------------------
// controls
const RANGE_FMT = {
  wall: (v) => `${(+v).toFixed(3)} mm`, imperf: (v) => `${(+v).toFixed(2)} mm`, dent: (v) => (+v === 0 ? 'none' : `${(+v).toFixed(2)} mm`),
  dentH: (v) => `${v}% up`, tilt: (v) => `${v}°`, plateW: (v) => `${v} mm`, plateL: (v) => `${v} mm`, barD: (v) => `Ø${v} mm`,
  barL: (v) => `${v} mm`, punchD: (v) => `Ø${v} mm`, edgeR: (v) => `${(+v).toFixed(1)} mm`, yaw: (v) => `${v}°`,
  plateT: (v) => `${v} mm`, punchH: (v) => `${v} mm`, platenGap: (v) => `${v} mm`,
  offX: (v) => `${v} mm`, offZ: (v) => `${v} mm`, mu: (v) => `μ ${(+v).toFixed(2)}`, gap: (v) => `${v} mm`,
  ratio: (v) => `${(+v).toFixed(1)} : 1`, handF: (v) => `${v} N`,
};

function initControls() {
  const sel = $('canPreset');
  for (const [k, p] of Object.entries(CAN_PRESETS)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = p.label; sel.appendChild(o);
  }
  sel.value = ui.canPreset;
  sel.addEventListener('change', () => {
    ui.canPreset = sel.value;
    ui.wall = CAN_PRESETS[sel.value].wall;
    $('wall').value = ui.wall; showOut('wall');
    setupChanged();
  });
  for (const id of Object.keys(RANGE_FMT)) {
    const el = $(id);
    if (!el) continue;
    el.value = ui[id];
    showOut(id);
    el.addEventListener('input', () => {
      ui[id] = +el.value;
      showOut(id);
      if (id === 'tilt') { syncTiltButtons(); drawOrientation(); }
      if (id === 'ratio' || id === 'handF') { renderLever(); renderCompare(); return; }
      if (id === 'dent') $('dentOpts').hidden = ui.dent === 0;
      setupChanged();
    });
  }
  $('dentOpts').hidden = ui.dent === 0;
  $('dentFace').value = ui.dentFace;
  $('dentFace').addEventListener('change', (e) => { ui.dentFace = e.target.value; setupChanged(); });
  $('seed').value = ui.seed;
  $('seed').addEventListener('change', (e) => { ui.seed = Math.max(1, Math.round(+e.target.value || 1)); e.target.value = ui.seed; setupChanged(); });
  $('platen').checked = !!ui.platen;
  $('platenOpts').hidden = !ui.platen;
  $('platen').addEventListener('change', (e) => { ui.platen = e.target.checked; $('platenOpts').hidden = !ui.platen; setupChanged(); });
  $('platenShape').value = ui.platenShape;
  $('platenShape').addEventListener('change', (e) => { ui.platenShape = e.target.value; setupChanged(); });
  $('rod').value = String(ui.rod);
  $('rod').addEventListener('change', (e) => { ui.rod = +e.target.value; setupChanged(); });
  $('res').value = ui.res;
  $('res').addEventListener('change', (e) => { ui.res = e.target.value; setupChanged(); });

  document.querySelectorAll('[data-tilt]').forEach((b) => b.addEventListener('click', () => {
    const t = +b.dataset.tilt;
    const wasSide = ui.tilt > 45;
    ui.tilt = t; $('tilt').value = t; showOut('tilt');
    if ((t > 45) !== wasSide) { ui.gap = t > 45 ? 12 : 25; $('gap').value = ui.gap; showOut('gap'); }
    syncTiltButtons(); drawOrientation(); setupChanged();
  }));
  document.querySelectorAll('#toolSeg [data-tool]').forEach((b) => b.addEventListener('click', () => {
    ui.tool = b.dataset.tool; syncTool(); setupChanged();
  }));
  document.querySelectorAll('#unitSeg [data-unit]').forEach((b) => b.addEventListener('click', () => {
    ui.unit = b.dataset.unit; syncSeg('#unitSeg', 'unit', ui.unit);
    chart.setUnit(ui.unit); renderTiles(); renderLever(); renderCompare(); renderHud();
  }));
  document.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
    ui.color = b.dataset.color; syncSeg('.viewbar', 'color', ui.color);
    view && view.setColorMode(ui.color);
    $('strainLegend').hidden = ui.color !== 'strain';
  }));
  $('cutBtn').addEventListener('click', () => {
    const on = $('cutBtn').getAttribute('aria-pressed') !== 'true';
    $('cutBtn').setAttribute('aria-pressed', String(on));
    $('cutBtn').textContent = on ? 'Show whole can' : 'Cut away';
    view && view.setCutaway(on);
  });
  $('viewBtn').addEventListener('click', () => view && view.resetView());
  $('crushBtn').addEventListener('click', startRun);
  $('pauseBtn').addEventListener('click', togglePause);
  $('resetBtn').addEventListener('click', resetRun);
  $('saveBtn').addEventListener('click', saveCurrent);
  $('sweepBtn').addEventListener('click', runSweep);
  $('clearBtn').addEventListener('click', () => { saved = saved.filter((r) => r.reference); persist(); assignSlots(); renderCompare(); updateChart(); });
  syncTool(); syncTiltButtons(); drawOrientation();
  syncSeg('#unitSeg', 'unit', ui.unit); syncSeg('.viewbar', 'color', ui.color);
}

function showOut(id) {
  const o = $(id + 'Out');
  if (o) o.textContent = RANGE_FMT[id](ui[id]);
}
function syncSeg(scope, key, val) {
  document.querySelectorAll(`${scope} [data-${key}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[key] === String(val))));
}
function syncTool() {
  syncSeg('#toolSeg', 'tool', ui.tool);
  document.querySelectorAll('.tool-dims').forEach((d) => { d.hidden = d.dataset.for !== ui.tool; });
}
function syncTiltButtons() {
  document.querySelectorAll('[data-tilt]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.tilt === ui.tilt)));
}
function drawOrientation() {
  const g = $('orientCan');
  const t = ui.tilt * Math.PI / 180;
  // can of half-height 20, half-width 11 resting on y = 64
  const hy = 20 * Math.cos(t) + 11 * Math.sin(t);
  g.setAttribute('transform', `translate(36 ${64 - hy}) rotate(${ui.tilt})`);
}

// ---------------------------------------------------------------------------
// parameters for the physics
function buildParams(over = {}) {
  return uiToParams({ ...ui, ...over });
}

export function describeParams(p) {
  const dir = p.tiltDeg <= 2 ? 'Top-down' : p.tiltDeg >= 88 ? 'Side' : `Tilted ${p.tiltDeg}°`;
  const t = p.tool;
  const tool = t.type === 'plate'
    ? (t.width >= 0.07 && t.length >= 0.07 ? 'full plate' : `plate ${Math.round(t.width * 1000)}×${Math.round(t.length * 1000)}`)
    : t.type === 'bar' ? `Ø${Math.round(t.diameter * 1000)} bar` : `Ø${Math.round(t.diameter * 1000)} punch`;
  const extras = [];
  if (t.type === 'plate' && t.thickness && Math.abs(t.thickness - 0.02) > 1e-4) extras.push(`${Math.round(t.thickness * 1000)} mm thick`);
  if (t.type === 'punch' && t.height && Math.abs(t.height - 0.03) > 1e-4) extras.push(`${Math.round(t.height * 1000)} mm tall`);
  if (p.dent && p.dent.depth > 0) extras.push(`${p.dent.depth} mm dent`);
  if (t.yawDeg) extras.push(`rotated ${t.yawDeg}°`);
  if (t.ramDiameter === 0) extras.push('no centre rod');
  if (p.secondPress && p.secondPress.enabled) extras.push(`then ${p.secondPress.shape && p.secondPress.shape !== 'flat' ? PLATEN_LABEL[p.secondPress.shape] || p.secondPress.shape : 'flat'} platen to ${Math.round(p.secondPress.finalGap * 1000)} mm`);
  if (t.offsetX || t.offsetZ) extras.push('off-centre');
  return `${dir}, ${tool}${extras.length ? ' · ' + extras.join(', ') : ''}`;
}

// ---------------------------------------------------------------------------
// 3D view + chart
let view = null;
const chart = new ForceChart($('chartWrap'));
chart.setUnit(ui.unit);

async function initView() {
  try {
    const mod = await import('./scene3d.js');
    view = new mod.CrushView($('viewport'));
    $('strainRamp').style.background = mod.strainRampCss();
    $('strainMax').textContent = `${Math.round(mod.STRAIN_MAX * 100)}%+`;
    applyStageColor();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', applyStageColor);
    new MutationObserver(applyStageColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (err) {
    console.error(err);
    $('glError').hidden = false;
  }
}
function applyStageColor() {
  if (!view) return;
  const c = getComputedStyle(document.querySelector('.chamber')).getPropertyValue('--stage').trim();
  view.setBackground(c || '#cfd6db');
}

// ---------------------------------------------------------------------------
// simulation channel (main run + preview)
let chan = null;
let runId = 0;
let current = null;   // {id, params, name, d, F, summary, live, state}
let lastLive = null;
let pendingAck = false;

async function ensureChannel() {
  if (!chan) chan = await createSimChannel(onSimMessage);
  return chan;
}

let previewTimer = null;
function setupChanged() {
  if (current && (current.state === 'running' || current.state === 'paused')) return; // keep the running test
  clearTimeout(previewTimer);
  previewTimer = setTimeout(preview, 180);
}

async function preview() {
  const c = await ensureChannel();
  runId++;
  current = { id: runId, params: buildParams(), d: [], F: [], state: 'preview', live: true };
  current.name = describeParams(current.params);
  c.post({ type: 'preview', id: runId, params: current.params });
  lastLive = null;
  renderTiles(); renderHud(); updateChart();
  setStatus('idle', 'Ready');
  $('saveBtn').disabled = true;
}

async function startRun() {
  const c = await ensureChannel();
  runId++;
  current = { id: runId, params: buildParams(), d: [], F: [], state: 'running', live: true, t0: performance.now() };
  current.name = describeParams(current.params);
  lastLive = null;
  c.post({ type: 'start', id: runId, params: current.params });
  setStatus('running', 'Crushing…');
  $('pauseBtn').disabled = false; $('pauseBtn').textContent = 'Pause';
  $('saveBtn').disabled = true;
  renderTiles(); updateChart();
}

function togglePause() {
  if (!current || !chan) return;
  if (current.state === 'running') {
    chan.post({ type: 'pause' }); current.state = 'paused';
    $('pauseBtn').textContent = 'Resume'; setStatus('paused', 'Paused');
  } else if (current.state === 'paused') {
    chan.post({ type: 'resume' }); current.state = 'running';
    $('pauseBtn').textContent = 'Pause'; setStatus('running', 'Crushing…');
  }
}

function resetRun() {
  if (chan) chan.post({ type: 'stop' });
  current = null;
  $('pauseBtn').disabled = true; $('pauseBtn').textContent = 'Pause';
  preview();
}

function onSimMessage(m) {
  if (!current || m.id !== current.id) return;
  switch (m.type) {
    case 'init': {
      current.info = m.info;
      current.can = m.can;
      if (view) {
        view.setCan(m.mesh, m.can, m.info);
        view.setTool(m.tool, { x: m.tool.x, y: m.tool.y, z: m.tool.z });
        view.setAux(null);
      }
      $('canMeta').textContent = `${m.info.canMass.toFixed(1)} g · ${Math.round(m.info.volume)} mL`;
      $('simInfo').textContent = `${m.info.nodes.toLocaleString()} nodes · ${m.info.triangles.toLocaleString()} shell elements · time step ${(m.info.dt * 1e6).toFixed(1)} µs`;
      $('hudHeight').textContent = `can height ${m.info.initialHeight.toFixed(1)} mm`;
      break;
    }
    case 'frame': {
      appendHist(m.hist);
      lastLive = m.live;
      if (view) {
        if (m.tool) view.setTool(m.tool, { x: m.tool.x, y: m.tool.y, z: m.tool.z });
        view.updateCan(m.positions, m.strain); view.setToolY(m.live.toolY, m.live.toolPhi); view.setAux(m.live.aux);
      }
      setStatus('running', phaseText(m.live));
      renderHud(); renderTiles(); updateChart();
      if (!pendingAck) {
        pendingAck = true;
        requestAnimationFrame(() => { pendingAck = false; if (current && current.id === m.id && current.state === 'running') chan.post({ type: 'ack' }); });
      }
      break;
    }
    case 'done': {
      current.d = Array.from(m.history.d); current.F = Array.from(m.history.F); current.s = Array.from(m.history.s || []);
      current.summary = m.summary;
      current.state = 'done';
      lastLive = m.live;
      if (view && m.positions) {
        if (m.tool && m.live.stages > 1) view.setTool(m.tool, { x: m.tool.x, y: m.tool.y, z: m.tool.z });
        view.updateCan(m.positions, m.strain); view.liftTool(m.live.toolY, 70); view.setAux(null);
      }
      const secs = (performance.now() - current.t0) / 1000;
      const reason = m.summary.stopReason === 'force limit' ? ' (stopped at the 9 kN force limit)' : '';
      setStatus('done', `Done in ${secs.toFixed(0)} s${reason}`);
      $('simInfo').textContent += ` · ${m.summary.steps.toLocaleString()} steps`;
      $('pauseBtn').disabled = true;
      $('saveBtn').disabled = false;
      renderHud(); renderTiles(); renderLever(); updateChart();
      break;
    }
    case 'error':
      setStatus('error', 'Simulation error');
      $('simInfo').textContent = m.message;
      break;
    default: break;
  }
}

function appendHist(h) {
  current.s = current.s || [];
  for (let i = 0; i < h.d.length; i++) { current.d.push(h.d[i]); current.F.push(h.F[i]); current.s.push(h.s ? h.s[i] : 0); }
}

function phaseText(L) {
  if (L.phase === 'dent-in' || L.phase === 'dent-out') return `Pressing the dent… ${L.aux ? Math.round(L.aux.dentForce) + ' N' : ''}`;
  const two = L.stages > 1;
  const who = two ? (L.stage === 0 ? 'Press 1' : 'Platen') : '';
  if (L.phase === 'release') return two ? `${who}: retracting…` : 'Backing off…';
  return two ? `${who}: crushing…` : 'Crushing…';
}

function setStatus(state, text) {
  const s = $('status');
  s.dataset.state = state;
  s.textContent = text;
}

// ---------------------------------------------------------------------------
// analysis of a curve (mirrors CrushScenario.summary for live display)
function smooth(a, w) {
  const n = a.length, out = new Array(n);
  let sum = 0, lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    const L = Math.max(0, i - w), R = Math.min(n - 1, i + w);
    while (hi < R) sum += a[++hi];
    while (lo < L) sum -= a[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}
function analyse(d, F) {
  const n = d.length;
  if (!n) return null;
  const sm = smooth(F, 5);
  let initial = null;
  for (let i = 1; i < n; i++) {
    if (sm[i] < sm[i - 1]) continue;
    let j = i + 1, mn = sm[i];
    while (j < n && sm[j] <= sm[i]) { mn = Math.min(mn, sm[j]); if (mn < 0.85 * sm[i]) break; j++; }
    if (j < n && mn < 0.85 * sm[i] && sm[i] > 20) { initial = { F: sm[i], d: d[i] }; break; }
  }
  let pk = 0, work = 0;
  for (let i = 0; i < n; i++) if (sm[i] > sm[pk]) pk = i;
  for (let i = 1; i < n; i++) work += 0.5 * (F[i] + F[i - 1]) * (d[i] - d[i - 1]) / 1000;
  const travel = d[n - 1];
  return { initialPeak: initial ? initial.F : null, initialPeakAt: initial ? initial.d : null, peakForce: sm[pk], peakAt: d[pk], work, travel, meanForce: travel > 0 ? work / (travel / 1000) : 0 };
}

// ---------------------------------------------------------------------------
// rendering of numbers
function renderHud() {
  const L = lastLive;
  const f = L ? Math.max(0, L.force) : 0;
  $('hudForce').innerHTML = fmtForce(f);
  $('hudForceAlt').textContent = ui.unit === 'N'
    ? `${(f * N2LBF).toFixed(0)} lbf · ${(f * N2KGF).toFixed(0)} kgf`
    : `${Math.round(f)} N`;
  $('hudTravel').innerHTML = `${(L ? L.travel : 0).toFixed(1)}<small>mm</small>`;
  if (L) $('hudHeight').textContent = `can height ${L.height.toFixed(1)} mm`;
  $('hudProg').style.width = `${((L ? L.progress : 0) * 100).toFixed(1)}%`;
}

function currentStats() {
  if (!current || !current.d.length) return null;
  const a = analyse(current.d, current.F);
  const s = current.summary;
  return {
    ...a,
    finalHeight: s ? s.finalHeight * 1000 : lastLive ? lastLive.height : null,
    initialHeight: current.info ? current.info.initialHeight : null,
    volumeReduction: s ? s.volumeReduction : null,
    springBack: s ? s.springBack * 1000 : null,
    done: !!s,
    stages: s ? s.stages : null,
  };
}

function stagePeak(k) {
  if (!current || !current.s) return null;
  let mx = null;
  for (let i = 0; i < current.F.length; i++) if (current.s[i] === k && (mx === null || current.F[i] > mx)) mx = current.F[i];
  return mx;
}

function renderTiles() {
  const st = currentStats();
  const set = (id, html, sub) => { $(id).innerHTML = html; if (sub !== undefined) $(id + 'S').innerHTML = sub; };
  if (!st) {
    for (const id of ['tStart', 'tPeak', 'tMean', 'tWork', 'tHeight', 'tVol']) $(id).textContent = '—';
    $('tStartS').textContent = 'first buckle'; $('tPeakS').innerHTML = '&nbsp;'; $('tMeanS').textContent = 'over the stroke';
    $('tWorkS').innerHTML = '&nbsp;'; $('tHeightS').innerHTML = '&nbsp;'; $('tVolS').innerHTML = '&nbsp;';
    return;
  }
  const alt = (n) => ui.unit === 'N' ? `${(n * N2LBF).toFixed(0)} lbf · ${(n * N2KGF).toFixed(0)} kgf` : `${Math.round(n)} N`;
  if (st.initialPeak) set('tStart', fmtForce(st.initialPeak), `${alt(st.initialPeak)} · ${st.initialPeakAt.toFixed(1)} mm`);
  else set('tStart', st.done ? fmtForce(st.peakForce) : '—', st.done ? 'no sharp buckle; rises steadily' : 'waiting for the first buckle');
  set('tPeak', fmtForce(st.peakForce), `${alt(st.peakForce)} · ${st.peakAt.toFixed(0)} mm`);
  set('tMean', fmtForce(st.meanForce), `over ${st.travel.toFixed(0)} mm of travel`);
  set('tWork', `${st.work.toFixed(1)}<small>J</small>`, `≈ lifting ${(st.work / 9.81).toFixed(1)} kg by 1 m`);
  if (st.finalHeight !== null && st.initialHeight) set('tHeight', `${st.finalHeight.toFixed(0)}<small>mm</small>`, `from ${st.initialHeight.toFixed(0)} mm tall`);
  if (st.volumeReduction !== null) set('tVol', `${(st.volumeReduction * 100).toFixed(0)}<small>%</small>`, st.springBack !== null ? `spring-back ${st.springBack.toFixed(1)} mm` : '&nbsp;');
  else set('tVol', '—', 'shown when finished');
  // two-press runs: retraction of press 1 and the platen
  const two = current && current.params && current.params.secondPress && current.params.secondPress.enabled;
  $('tileRetract').hidden = !two; $('tilePlaten').hidden = !two;
  if (two) {
    const p1 = st.stages ? st.stages[0] : null;
    if (p1) {
      const stuck = p1.snagged || p1.pullForce > 20;
      set('tPull', fmtForce(p1.pullForce), stuck ? (p1.snagged ? 'snags: metal folded over the crusher' : 'drags metal on the way out') : 'retracts cleanly');
      $('tPull').className = 'v ' + (stuck ? 'bad' : 'ok');
    } else { set('tPull', '—', 'measured when press 1 backs off'); $('tPull').className = 'v'; }
    const p1peak = stagePeak(0), p2peak = stagePeak(1);
    if (p1peak !== null) set('tPeak', fmtForce(Math.max(p1peak, 0)), `press 1 only · ${alt(p1peak)}`);
    if (p2peak !== null) {
      const p2 = st.stages ? st.stages[1] : null;
      set('tPlaten', fmtForce(p2peak), p2 && p2.heightAfter ? `can ends up ${(p2.heightAfter * 1000).toFixed(0)} mm thick` : alt(p2peak));
    } else set('tPlaten', '—', 'after press 1 retracts');
  }
}

function leverFor(peak, travel) {
  const r = ui.ratio;
  return { hand: peak / r, travel: (travel * r) / 10, need: peak / ui.handF };
}

function renderLever() {
  const st = currentStats() || (saved.find((r) => r.reference) && saved.find((r) => r.reference).stats);
  if (!st) { $('lvHand').textContent = '—'; $('lvTravel').textContent = '—'; $('lvNeed').textContent = '—'; return; }
  const peak = st.initialPeak ? Math.max(st.initialPeak, st.peakForce) : st.peakForce;
  const lv = leverFor(peak, st.travel);
  $('lvHand').innerHTML = fmtForce(lv.hand);
  $('lvTravel').innerHTML = `${lv.travel.toFixed(0)}<small>cm</small>`;
  $('lvNeed').innerHTML = `${Math.max(1, lv.need).toFixed(1)}<small>: 1</small>`;
  const src = currentStats() ? 'this run' : 'the reference top-down crush';
  $('lvNote').textContent = `Based on the peak force of ${src} (${Math.round(peak)} N). Lever ratio = handle length ÷ distance from the pivot to the can. A lever lowers the force but not the energy: your hand travels farther by the same ratio.`;
}

// ---------------------------------------------------------------------------
// comparison runs
let saved = [];
const STORE_KEY = 'canCrushLab.saved.v1';
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved.filter((r) => !r.reference).map((r) => ({ ...r, slot: undefined }))));
  } catch (_) { /* storage unavailable */ }
}
function loadSaved() {
  const refs = REFERENCE_RUNS.map((r, i) => ({ ...r, id: 'ref' + i, reference: true, hidden: false }));
  let mine = [];
  try { mine = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (_) { mine = []; }
  saved = [...refs, ...mine];
  assignSlots();
}
function assignSlots() {
  let next = 2;
  for (const r of saved) {
    if (r.hidden) { r.slot = 0; continue; }
    r.slot = next <= 8 ? next++ : 0;
  }
}
function downsample(d, F, max = 500) {
  const step = Math.max(1, Math.ceil(d.length / max));
  const dd = [], ff = [];
  for (let i = 0; i < d.length; i += step) { dd.push(+d[i].toFixed(2)); ff.push(Math.round(F[i] * 10) / 10); }
  return { d: dd, F: ff };
}
function recordFrom(name, params, d, F, summary, extra = {}) {
  const a = analyse(d, F);
  const ds = downsample(d, F);
  return {
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, res: params.resolution, params,
    d: ds.d, F: ds.F,
    stats: {
      ...a, finalHeight: summary.finalHeight * 1000, initialHeight: summary.initialHeight * 1000, volumeReduction: summary.volumeReduction,
      ...(summary.stages && summary.stages.length > 1 ? {
        press1Peak: summary.stages[0].peakForce, pullForce: summary.stages[0].pullForce, snagged: summary.stages[0].snagged,
        platenPeak: summary.stages[1].peakForce,
      } : {}),
    },
    ...extra,
  };
}
function saveCurrent() {
  if (!current || !current.summary) return;
  saved.push(recordFrom(current.name, current.params, current.d, current.F, current.summary));
  assignSlots(); persist(); renderCompare(); updateChart();
  $('saveBtn').disabled = true;
}

function renderCompare() {
  const tb = document.querySelector('#cmpTable tbody');
  const rows = saved.filter((r) => r.stats || r.pending);
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="8" class="name"><p class="empty">No runs yet. Finish a crush and press "Add this run", or run all 6 strategies.</p></td></tr>`; return; }
  const done = rows.filter((r) => r.stats);
  const startOf = (r) => r.stats.initialPeak || r.stats.peakForce;
  const minStart = Math.min(...done.map(startOf));
  const minWork = Math.min(...done.map((r) => r.stats.work));
  tb.innerHTML = rows.map((r) => {
    const sw = r.slot ? `<span class="sw" style="background:var(--series-${r.slot})"></span> ` : '';
    const sub = r.pending
      ? `<span class="sub">running… ${Math.round((r.progress || 0) * 100)}%</span>`
      : `<span class="sub">${r.reference ? 'reference · ' : ''}${r.res} mesh${r.stats && r.stats.finalHeight ? ` · ends ${Math.round(r.stats.finalHeight)} mm tall` : ''}${r.stats && r.stats.press1Peak !== undefined ? ` · press 1 ${Math.round(r.stats.press1Peak)} N, pull-out ${Math.round(r.stats.pullForce)} N${r.stats.snagged || r.stats.pullForce > 20 ? ' (snags)' : ' (clean)'}, platen ${Math.round(r.stats.platenPeak)} N` : ''}</span>`;
    if (!r.stats) return `<tr><td class="name">${sw}${escapeHtml(r.name)}${sub}</td><td colspan="7"></td></tr>`;
    const s = r.stats;
    const chips = [];
    if (done.length > 1 && startOf(r) === minStart) chips.push('<span class="chip">easiest start</span>');
    if (done.length > 1 && s.work === minWork) chips.push('<span class="chip">least energy</span>');
    const peak = Math.max(s.peakForce, s.initialPeak || 0);
    return `<tr class="${r.hidden ? 'dim' : ''}">
      <td class="name">${sw}${escapeHtml(r.name)}${chips.join('')}${sub}</td>
      <td>${fmtForce(startOf(r), false)}</td>
      <td>${fmtForce(peak, false)}</td>
      <td>${fmtForce(s.meanForce, false)}</td>
      <td>${s.work.toFixed(1)} J</td>
      <td>${s.finalHeight ? Math.round(s.finalHeight) + ' mm' : '—'}</td>
      <td>${fmtForce(peak / ui.ratio, false)}</td>
      <td><button class="icon-btn" data-act="toggle" data-id="${r.id}" title="${r.hidden ? 'Show' : 'Hide'} curve" aria-label="${r.hidden ? 'Show' : 'Hide'} curve">${r.hidden ? '◌' : '●'}</button>${r.reference ? '' : `<button class="icon-btn" data-act="del" data-id="${r.id}" title="Remove" aria-label="Remove run">✕</button>`}</td>
    </tr>`;
  }).join('');
  const unit = ui.unit;
  const ths = document.querySelectorAll('#cmpTable thead th');
  ths[1].textContent = `Start (${unit})`; ths[2].textContent = `Peak (${unit})`; ths[3].textContent = `Average (${unit})`;
  ths[6].textContent = `Hand @ ${ui.ratio}:1 (${unit})`;
}
document.querySelector('#cmpTable tbody').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const r = saved.find((x) => x.id === b.dataset.id);
  if (!r) return;
  if (b.dataset.act === 'toggle') r.hidden = !r.hidden;
  if (b.dataset.act === 'del') saved = saved.filter((x) => x !== r);
  assignSlots(); persist(); renderCompare(); updateChart();
});

function updateChart() {
  const list = [];
  for (const r of saved) if (r.slot && r.d && r.d.length) list.push({ name: r.name, slot: r.slot, d: r.d, F: r.F });
  if (current && current.d.length) list.push({ name: 'This run: ' + current.name, slot: 1, d: current.d, F: current.F, live: true });
  chart.setSeries(list);
  $('legend').innerHTML = list.length >= 2
    ? list.map((s) => `<span><i class="sw" style="background:var(--series-${s.slot})"></i>${escapeHtml(s.name)}</span>`).join('')
    : '';
}

// ---------------------------------------------------------------------------
// strategy sweep: six standard ways to crush the current can, in parallel workers
let sweeping = false;
async function runSweep() {
  if (sweeping) return;
  sweeping = true;
  $('sweepBtn').disabled = true;
  $('sweepBtn').textContent = 'Running strategies…';
  const jobs = STRATEGIES.map((s) => {
    const params = buildParams({ ...s.over, offX: 0, offZ: 0, yaw: 0 });
    const rec = { id: 'sw' + Math.random().toString(36).slice(2, 8), name: s.name, res: params.resolution, params, pending: true, progress: 0, d: [], F: [] };
    saved.push(rec);
    return rec;
  });
  assignSlots(); renderCompare();
  const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await new Promise(async (resolve) => {
        let ch;
        const id = 1;
        ch = await createSimChannel((m) => {
          if (m.type === 'progress') { job.progress = m.live.progress; renderCompare(); }
          if (m.type === 'done') {
            Object.assign(job, recordFrom(job.name, job.params, m.history.d, m.history.F, m.summary, { id: job.id }));
            job.pending = false;
            ch.terminate(); resolve();
          }
          if (m.type === 'error') { job.pending = false; job.name += ' (failed)'; ch.terminate(); resolve(); }
        });
        ch.post({ type: 'start', id, params: job.params, headless: true });
      });
      persist(); assignSlots(); renderCompare(); updateChart();
    }
  };
  await Promise.all(Array.from({ length: cores }, worker));
  sweeping = false;
  $('sweepBtn').disabled = false;
  $('sweepBtn').textContent = 'Run 6 strategies';
}

// ---------------------------------------------------------------------------
loadSaved();
initControls();
renderCompare();
renderLever();
updateChart();
initView().then(() => preview());
