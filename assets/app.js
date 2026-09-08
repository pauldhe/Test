/* Market dashboard.
 *
 * Reads the JSON bundle produced by scripts/build_data.py:
 *   data/index.json              metadata, date axis, per-series summary
 *   data/series/<category>.json  full value arrays, fetched on first use
 *
 * No build step and no external dependencies; charts are drawn on canvas.
 */
'use strict';

const MAX_PICKED = 8;

// Categorical palette; readable on both the light and dark grounds.
const PALETTE = ['#2563eb', '#e8590c', '#0d9488', '#c2255c', '#7048e8',
                 '#0891b2', '#a16207', '#4d7c0f'];

const state = {
  index: null,
  byId: new Map(),
  values: new Map(),      // series id -> number|null[]
  loaded: new Set(),      // category keys already fetched
  cats: new Set(),        // overview category filter (empty = all)
  query: '',
  hideEmpty: true,
  sort: { key: 'notation', dir: 1 },
  picked: [],
  hidden: new Set(),      // legend toggles
  range: 3650,
  rebase: false,
  curveCountry: null,
  curveCompare: true,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ───────────────────────── formatting ───────────────────────── */

function fmtValue(v, unit) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (unit === 'idx' || unit === 'k' || unit === 'bn') {
    return v.toLocaleString('ko-KR', { maximumFractionDigits: abs >= 1000 ? 0 : 2 });
  }
  if (abs >= 1000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return v.toFixed(abs >= 100 ? 2 : 3);
}

/** The build decides the convention per series (bp / absolute / percent) and
 *  ships the label with it; this only formats the magnitude. */
function fmtChange(v, mode, suffix) {
  if (v === null || v === undefined || !Number.isFinite(v)) return { text: '–', cls: 'muted' };
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  const sign = v > 0 ? '+' : '';
  const digits = mode === 'bp' ? 1 : Math.abs(v) >= 100 ? 0 : 2;
  return { text: `${sign}${v.toFixed(digits)}${suffix ?? (mode === 'bp' ? 'bp' : '%')}`, cls };
}

const fmtDate = (iso) => iso ? iso.slice(2).replace(/-/g, '.') : '–';

/* ───────────────────────── data loading ───────────────────────── */

async function loadIndex() {
  const res = await fetch('data/index.json');
  if (!res.ok) throw new Error(`data/index.json ${res.status}`);
  state.index = await res.json();
  state.index.series.forEach((s) => state.byId.set(s.id, s));
}

async function ensureCategory(cat) {
  if (state.loaded.has(cat)) return;
  const res = await fetch(`data/series/${encodeURIComponent(cat)}.json`);
  if (!res.ok) throw new Error(`data/series/${cat}.json ${res.status}`);
  const payload = await res.json();
  for (const [id, values] of Object.entries(payload)) state.values.set(id, values);
  state.loaded.add(cat);
}

const ensureSeries = (ids) =>
  Promise.all([...new Set(ids.map((id) => state.byId.get(id)?.cat).filter(Boolean))]
    .map(ensureCategory));

/* ───────────────────────── canvas helpers ───────────────────────── */

function prepare(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.parentElement.clientWidth || 800;
  const height = Number(canvas.getAttribute('height')) || 400;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Axis ticks on 1/2/5×10^n boundaries. */
function niceTicks(min, max, target = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min -= 0.5; max += 0.5; }
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}

function tickLabel(v) {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

/* ───────────────────────── sparkline ───────────────────────── */

function drawSparkline(canvas, points) {
  const clean = points.filter((p) => p !== null && Number.isFinite(p));
  if (clean.length < 2) return;
  const { ctx, width, height } = prepare(canvas);
  const pad = 2;
  const min = Math.min(...clean), max = Math.max(...clean);
  const span = max - min || 1;
  const x = (i) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);

  ctx.beginPath();
  let started = false;
  points.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    started ? ctx.lineTo(x(i), y(v)) : (ctx.moveTo(x(i), y(v)), started = true);
  });
  const rising = clean[clean.length - 1] >= clean[0];
  ctx.strokeStyle = rising ? css('--up') : css('--down');
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

/* ───────────────────────── overview ───────────────────────── */

function visibleSeries() {
  const query = state.query.trim().toLowerCase();
  return state.index.series.filter((s) => {
    if (state.cats.size && !state.cats.has(s.cat)) return false;
    if (state.hideEmpty && s.summary.n === 0) return false;
    if (query && !(`${s.notation} ${s.ticker} ${s.id}`.toLowerCase().includes(query))) return false;
    return true;
  });
}

function sortValue(s, key) {
  if (key === 'notation') return s.notation;
  if (key === 'last') return s.summary.last;
  if (key === 'n') return s.summary.n;
  return s.summary.changes?.[key];
}

function renderOverview() {
  const rows = visibleSeries();
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const av = sortValue(a, key), bv = sortValue(b, key);
    if (av === null || av === undefined) return 1;          // nulls always last
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return av.localeCompare(bv, 'ko') * dir;
    return (av - bv) * dir;
  });

  $('#ov-empty').hidden = rows.length > 0;
  const body = $('#ov-body');
  body.textContent = '';

  const frag = document.createDocumentFragment();
  for (const s of rows) {
    const tr = document.createElement('tr');
    if (state.picked.includes(s.id)) tr.className = 'picked';

    const pick = document.createElement('td');
    pick.className = 'left';
    const btn = document.createElement('button');
    btn.className = 'pick-btn';
    btn.type = 'button';
    btn.textContent = state.picked.includes(s.id) ? '✓' : '+';
    btn.setAttribute('aria-pressed', String(state.picked.includes(s.id)));
    btn.title = '차트에 추가';
    btn.addEventListener('click', () => togglePick(s.id));
    pick.append(btn);
    tr.append(pick);

    const name = document.createElement('td');
    name.className = 'left';
    const label = document.createElement('div');
    label.className = 'name';
    label.textContent = s.notation;
    if (s.cat === 'Macro') {
      const tag = document.createElement('span');
      tag.className = 'tag step';
      tag.textContent = '발표시 갱신';
      tag.title = '지표 발표일에만 값이 바뀝니다. 일간 변화율은 의미가 없습니다.';
      label.append(tag);
    }
    if (s.dupeOf) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '중복';
      tag.title = `${state.byId.get(s.dupeOf)?.notation ?? s.dupeOf}와(과) 값이 완전히 같습니다.`;
      label.append(tag);
    }
    const ticker = document.createElement('div');
    ticker.className = 'ticker';
    ticker.textContent = s.ticker;
    name.append(label, ticker);
    tr.append(name);

    const last = document.createElement('td');
    last.textContent = fmtValue(s.summary.last, s.unit);
    if (s.summary.last === null) last.className = 'muted';
    tr.append(last);

    for (const win of ['1d', '1w', '1m', '3m', 'ytd', '1y']) {
      const td = document.createElement('td');
      const { text, cls } = fmtChange(s.summary.changes?.[win], s.summary.mode, s.summary.suffix);
      td.textContent = text;
      td.className = cls;
      tr.append(td);
    }

    const spark = document.createElement('td');
    spark.className = 'left';
    if (s.summary.spark?.length) {
      const canvas = document.createElement('canvas');
      canvas.className = 'spark';
      canvas.style.width = '88px';
      canvas.setAttribute('height', '22');
      spark.append(canvas);
      requestAnimationFrame(() => drawSparkline(canvas, s.summary.spark));
    }
    tr.append(spark);

    const n = document.createElement('td');
    n.className = s.summary.n ? '' : 'muted';
    n.textContent = s.summary.n.toLocaleString('ko-KR');
    tr.append(n);

    frag.append(tr);
  }
  body.append(frag);

  $$('#ov-table thead th[data-sort]').forEach((th) => {
    const mark = th.querySelector('.dir');
    if (mark) mark.remove();
    if (th.dataset.sort === key) {
      const span = document.createElement('span');
      span.className = 'dir';
      span.textContent = dir === 1 ? '▲' : '▼';
      th.append(span);
    }
  });
}

/* ───────────────────────── selection ───────────────────────── */

async function togglePick(id) {
  const at = state.picked.indexOf(id);
  if (at >= 0) {
    state.picked.splice(at, 1);
  } else {
    if (state.picked.length >= MAX_PICKED) {
      state.picked.shift();
    }
    state.picked.push(id);
    await ensureSeries([id]);
  }
  state.hidden.delete(id);
  renderOverview();
  renderPicker();
  renderChart();
}

function renderPicker() {
  const query = $('#pick-search').value.trim().toLowerCase();
  const list = state.index.series
    .filter((s) => s.summary.n > 0)
    .filter((s) => !query || `${s.notation} ${s.ticker}`.toLowerCase().includes(query))
    .slice(0, 400);

  const box = $('#picker');
  box.textContent = '';
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'row' + (state.picked.includes(s.id) ? ' on' : '');
    row.addEventListener('click', () => togglePick(s.id));

    const cat = document.createElement('span');
    cat.className = 'cat';
    cat.textContent = state.index.categories.find((c) => c.key === s.cat)?.label ?? s.cat;

    const name = document.createElement('span');
    name.textContent = s.notation;

    const tk = document.createElement('span');
    tk.className = 'tk';
    tk.textContent = s.ticker;

    row.append(cat, name);
    if (s.dupeOf) {
      const dupe = document.createElement('span');
      dupe.className = 'tag';
      dupe.textContent = '중복';
      dupe.title = `${state.byId.get(s.dupeOf)?.notation ?? s.dupeOf}와(과) 값이 완전히 같습니다.`;
      row.append(dupe);
    }
    row.append(tk);
    frag.append(row);
  }
  box.append(frag);
  $('#pick-count').textContent = `${state.picked.length}개 선택 · 최대 ${MAX_PICKED}개`;
}

/* ───────────────────────── main chart ───────────────────────── */

const chartGeom = { plot: null, series: [], slice: null };

function sliceRange() {
  const dates = state.index.dates;
  if (!state.range) return { from: 0, to: dates.length - 1 };
  const end = new Date(dates[dates.length - 1]);
  const start = new Date(end);
  start.setDate(start.getDate() - state.range);
  const iso = start.toISOString().slice(0, 10);
  let from = dates.findIndex((d) => d >= iso);
  if (from < 0) from = 0;
  return { from, to: dates.length - 1 };
}

function renderChart() {
  const canvas = $('#main-chart');
  const active = state.picked.filter((id) => !state.hidden.has(id));
  const has = state.picked.length > 0;

  $('#chart-empty').hidden = has;
  canvas.style.display = has ? 'block' : 'none';
  renderLegend();
  if (!has) return;

  const dates = state.index.dates;
  const { from, to } = sliceRange();
  chartGeom.slice = { from, to };

  // Rebasing puts series of different magnitudes on one axis: each is divided
  // by its own first observation in view. Without it a 4% yield and a 7,400
  // index level cannot share a scale.
  const drawn = [];
  state.picked.forEach((id, i) => {
    const raw = state.values.get(id);
    if (!raw) return;
    const meta = state.byId.get(id);
    const colour = PALETTE[i % PALETTE.length];
    if (state.hidden.has(id)) { drawn.push({ id, meta, colour, points: null }); return; }

    let base = null;
    if (state.rebase) {
      for (let k = from; k <= to; k++) {
        if (raw[k] !== null && Number.isFinite(raw[k]) && raw[k] !== 0) { base = raw[k]; break; }
      }
    }
    const points = new Array(to - from + 1);
    for (let k = from; k <= to; k++) {
      const v = raw[k];
      points[k - from] = (v === null || !Number.isFinite(v)) ? null
        : (state.rebase && base ? (v / base) * 100 : v);
    }
    drawn.push({ id, meta, colour, points });
  });

  chartGeom.series = drawn;
  const visible = drawn.filter((d) => d.points);
  drawLineChart(canvas, visible, dates, from, to);
  updateScaleHint(visible);
}

/** Warn when one axis cannot honestly carry every selected series.
 *
 * The test is whether a series' own range collapses into a sliver of the shared
 * axis -- a 4.6% yield next to a 1,467 FX rate becomes a flat line on the floor.
 * Comparing magnitudes instead would misfire on perfectly comparable series:
 * three 10-year government yields differ ~20x at the median (Japan near zero,
 * the US near 5) yet share an axis perfectly well. What matters is the span
 * each series actually occupies. */
function updateScaleHint(series) {
  const hint = $('#scale-hint');
  if (!hint) return;
  if (state.rebase || series.length < 2) { hint.hidden = true; return; }

  const spans = series.map((s) => {
    const finite = s.points.filter((v) => v !== null && Number.isFinite(v));
    return finite.length ? { min: Math.min(...finite), max: Math.max(...finite) } : null;
  }).filter(Boolean);
  if (spans.length < 2) { hint.hidden = true; return; }

  const axisMin = Math.min(...spans.map((s) => s.min));
  const axisMax = Math.max(...spans.map((s) => s.max));
  const axis = axisMax - axisMin;
  if (!(axis > 0)) { hint.hidden = true; return; }

  const smallest = Math.min(...spans.map((s) => (s.max - s.min) / axis));
  hint.hidden = smallest >= 0.08;
  if (!hint.hidden) {
    hint.textContent =
      `선택한 지표 중 일부가 세로축의 ${(smallest * 100).toFixed(1)}%만 차지해 사실상 직선으로 보입니다. ` +
      '“기준시점 100으로 환산”을 켜면 함께 비교할 수 있습니다.';
  }
}

function drawLineChart(canvas, series, dates, from, to) {
  const { ctx, width, height } = prepare(canvas);
  const pad = { top: 14, right: 16, bottom: 26, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  let min = Infinity, max = -Infinity;
  for (const s of series) {
    for (const v of s.points) {
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (min === max) { min -= 1; max += 1; }
  const padY = (max - min) * 0.06;
  min -= padY; max += padY;

  const n = to - from + 1;
  const x = (i) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;
  chartGeom.plot = { pad, plotW, plotH, min, max, n, x, y, width, height };

  const gridColour = css('--grid');
  const inkFaint = css('--ink-faint');

  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.strokeStyle = gridColour;
  ctx.lineWidth = 1;
  ctx.fillStyle = inkFaint;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of niceTicks(min, max)) {
    const py = Math.round(y(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(pad.left + plotW, py);
    ctx.stroke();
    ctx.fillText(tickLabel(t), pad.left - 8, py);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const ticks = Math.max(2, Math.min(8, Math.floor(plotW / 90)));
  for (let k = 0; k <= ticks; k++) {
    const i = Math.round((k / ticks) * (n - 1));
    const px = Math.round(x(i)) + 0.5;
    ctx.strokeStyle = gridColour;
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, pad.top + plotH);
    ctx.stroke();
    const iso = dates[from + i];
    ctx.fillStyle = inkFaint;
    ctx.fillText(n > 400 ? iso.slice(0, 7) : iso.slice(2), px, pad.top + plotH + 7);
  }

  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  for (const s of series) {
    ctx.strokeStyle = s.colour;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.points.length; i++) {
      const v = s.points[i];
      if (v === null) { started = false; continue; }
      const px = x(i), py = y(v);
      started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), started = true);
    }
    ctx.stroke();
  }
}

function renderLegend() {
  const box = $('#chart-legend');
  box.textContent = '';
  state.picked.forEach((id, i) => {
    const meta = state.byId.get(id);
    if (!meta) return;
    const off = state.hidden.has(id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = off ? 'off' : '';
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = PALETTE[i % PALETTE.length];
    const nm = document.createElement('span');
    nm.textContent = meta.notation;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = '제거';
    x.addEventListener('click', (e) => { e.stopPropagation(); togglePick(id); });
    btn.append(sw, nm, x);
    btn.addEventListener('click', () => {
      state.hidden.has(id) ? state.hidden.delete(id) : state.hidden.add(id);
      renderChart();
    });
    box.append(btn);
  });
}

function chartHover(event) {
  const tip = $('#chart-tip');
  const geom = chartGeom.plot;
  if (!geom || !chartGeom.series.length) return;
  const canvas = $('#main-chart');
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  if (mx < geom.pad.left || mx > geom.pad.left + geom.plotW) { tip.classList.remove('on'); return; }

  const i = Math.round(((mx - geom.pad.left) / geom.plotW) * (geom.n - 1));
  const { from } = chartGeom.slice;
  const iso = state.index.dates[from + i];

  renderChart();
  const ctx = canvas.getContext('2d');
  const px = Math.round(geom.x(i)) + 0.5;
  ctx.save();
  ctx.strokeStyle = css('--border-strong');
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(px, geom.pad.top);
  ctx.lineTo(px, geom.pad.top + geom.plotH);
  ctx.stroke();
  ctx.restore();

  const rows = [];
  for (const s of chartGeom.series) {
    if (!s.points) continue;
    const v = s.points[i];
    if (v === null || v === undefined) continue;
    rows.push({ colour: s.colour, name: s.meta.notation, unit: s.meta.unit, value: v });
    ctx.beginPath();
    ctx.arc(px, geom.y(v), 3, 0, Math.PI * 2);
    ctx.fillStyle = s.colour;
    ctx.fill();
  }

  tip.textContent = '';
  const head = document.createElement('div');
  head.className = 't-date';
  head.textContent = iso + (state.rebase ? '  (기준=100)' : '');
  tip.append(head);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 't-row';
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = r.colour;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = r.name;
    const vl = document.createElement('span');
    vl.className = 'vl';
    vl.textContent = state.rebase ? r.value.toFixed(1) : fmtValue(r.value, r.unit);
    row.append(sw, nm, vl);
    tip.append(row);
  }
  tip.classList.add('on');
  const left = Math.min(mx + 16, rect.width - tip.offsetWidth - 8);
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, event.clientY - rect.top - tip.offsetHeight / 2)}px`;
}

/* ───────────────────────── yield curve ───────────────────────── */

function curvePoints(country) {
  return state.index.series
    .filter((s) => s.curve && s.curve.country === country && s.summary.n > 0)
    .sort((a, b) => a.curve.tenor - b.curve.tenor);
}

function curveDateOptions() {
  const dates = state.index.dates;
  const options = [];
  for (let i = dates.length - 1; i >= 0; i -= 21) options.push(dates[i]);
  return options.slice(0, 120);
}

async function renderCurve() {
  const country = state.curveCountry;
  const points = curvePoints(country);
  $('#curve-empty').hidden = points.length >= 2;
  $('#curve-chart').style.display = points.length >= 2 ? 'block' : 'none';
  if (points.length < 2) { $('#curve-legend').textContent = ''; return; }

  await ensureSeries(points.map((s) => s.id));

  const dates = state.index.dates;
  const anchor = $('#curve-date').value || dates[dates.length - 1];
  let ai = dates.indexOf(anchor);
  if (ai < 0) ai = dates.length - 1;

  const wanted = [{ label: dates[ai], index: ai }];
  if (state.curveCompare) {
    for (const [years, tag] of [[1, '1년 전'], [3, '3년 전']]) {
      const d = new Date(dates[ai]);
      d.setFullYear(d.getFullYear() - years);
      const iso = d.toISOString().slice(0, 10);
      let j = -1;
      for (let k = ai; k >= 0; k--) { if (dates[k] <= iso) { j = k; break; } }
      if (j >= 0) wanted.push({ label: `${dates[j]} (${tag})`, index: j });
    }
  }

  const curves = wanted.map((w, i) => ({
    label: w.label,
    colour: PALETTE[i % PALETTE.length],
    points: points.map((s) => {
      const raw = state.values.get(s.id);
      let v = null;
      for (let k = w.index; k >= 0 && k > w.index - 10; k--) {
        if (raw && raw[k] !== null && Number.isFinite(raw[k])) { v = raw[k]; break; }
      }
      return { tenor: s.curve.tenor, value: v, name: s.notation };
    }).filter((p) => p.value !== null),
  })).filter((c) => c.points.length >= 2);

  drawCurveChart($('#curve-chart'), curves);

  const legend = $('#curve-legend');
  legend.textContent = '';
  for (const c of curves) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = c.colour;
    const nm = document.createElement('span');
    nm.textContent = c.label;
    btn.append(sw, nm);
    legend.append(btn);
  }
}

const curveGeom = { plot: null, curves: [] };

function drawCurveChart(canvas, curves) {
  const { ctx, width, height } = prepare(canvas);
  const pad = { top: 16, right: 18, bottom: 30, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const all = curves.flatMap((c) => c.points);
  let min = Math.min(...all.map((p) => p.value));
  let max = Math.max(...all.map((p) => p.value));
  if (min === max) { min -= 0.5; max += 0.5; }
  const padY = (max - min) * 0.1;
  min -= padY; max += padY;

  // Tenors are spaced by sqrt(years): the short end carries most of the curve's
  // shape and would otherwise be crushed against the axis.
  const tenors = [...new Set(all.map((p) => p.tenor))].sort((a, b) => a - b);
  const tmin = Math.sqrt(tenors[0]), tmax = Math.sqrt(tenors[tenors.length - 1]);
  const x = (t) => pad.left + ((Math.sqrt(t) - tmin) / (tmax - tmin || 1)) * plotW;
  const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;
  curveGeom.plot = { pad, plotW, plotH, x, y, tenors };
  curveGeom.curves = curves;

  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.strokeStyle = css('--grid');
  ctx.fillStyle = css('--ink-faint');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of niceTicks(min, max)) {
    const py = Math.round(y(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(pad.left + plotW, py);
    ctx.stroke();
    ctx.fillText(t.toFixed(2), pad.left - 8, py);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of tenors) {
    const px = Math.round(x(t)) + 0.5;
    ctx.strokeStyle = css('--grid');
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, pad.top + plotH);
    ctx.stroke();
    ctx.fillStyle = css('--ink-faint');
    ctx.fillText(t < 1 ? `${Math.round(t * 12)}M` : `${t % 1 ? t : t.toFixed(0)}Y`, px, pad.top + plotH + 8);
  }

  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const c of curves) {
    ctx.strokeStyle = c.colour;
    ctx.beginPath();
    c.points.forEach((p, i) => (i ? ctx.lineTo(x(p.tenor), y(p.value)) : ctx.moveTo(x(p.tenor), y(p.value))));
    ctx.stroke();
    ctx.fillStyle = c.colour;
    for (const p of c.points) {
      ctx.beginPath();
      ctx.arc(x(p.tenor), y(p.value), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function curveHover(event) {
  const tip = $('#curve-tip');
  const geom = curveGeom.plot;
  if (!geom || !curveGeom.curves.length) return;
  const rect = $('#curve-chart').getBoundingClientRect();
  const mx = event.clientX - rect.left;
  let best = null, bestDist = Infinity;
  for (const t of geom.tenors) {
    const d = Math.abs(geom.x(t) - mx);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  if (best === null || bestDist > 40) { tip.classList.remove('on'); return; }

  tip.textContent = '';
  const head = document.createElement('div');
  head.className = 't-date';
  head.textContent = best < 1 ? `${Math.round(best * 12)}개월` : `${best}년`;
  tip.append(head);
  for (const c of curveGeom.curves) {
    const p = c.points.find((q) => q.tenor === best);
    if (!p) continue;
    const row = document.createElement('div');
    row.className = 't-row';
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = c.colour;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = c.label;
    const vl = document.createElement('span');
    vl.className = 'vl';
    vl.textContent = `${p.value.toFixed(3)}%`;
    row.append(sw, nm, vl);
    tip.append(row);
  }
  tip.classList.add('on');
  tip.style.left = `${Math.max(8, Math.min(mx + 16, rect.width - tip.offsetWidth - 8))}px`;
  tip.style.top = `${Math.max(8, event.clientY - rect.top - tip.offsetHeight / 2)}px`;
}

/* ───────────────────────── quality view ───────────────────────── */

function renderQuality() {
  const { totals, dates, series } = state.index;
  const grid = totals.series * totals.dates;
  const stats = [
    ['수록 지표', totals.series.toLocaleString('ko-KR'), `${state.index.categories.length}개 분류`],
    ['영업일', totals.dates.toLocaleString('ko-KR'), `${dates[0]} ~ ${dates[dates.length - 1]}`],
    ['관측치', totals.observations.toLocaleString('ko-KR'), `격자 대비 ${(100 * totals.observations / grid).toFixed(1)}%`],
    ['결측', (grid - totals.observations).toLocaleString('ko-KR'), '#N/A N/A · #VALUE!'],
    ['데이터 없는 지표', String(totals.empty.length), totals.empty.join(', ') || '없음'],
  ];
  const box = $('#q-stats');
  box.textContent = '';
  for (const [k, v, s] of stats) {
    const el = document.createElement('div');
    el.className = 'stat';
    const kk = document.createElement('div'); kk.className = 'k'; kk.textContent = k;
    const vv = document.createElement('div'); vv.className = 'v'; vv.textContent = v;
    const ss = document.createElement('div'); ss.className = 's'; ss.textContent = s;
    el.append(kk, vv, ss);
    box.append(el);
  }

  const low = series
    .map((s) => ({ s, pct: 100 * s.summary.n / totals.dates }))
    .filter((r) => r.pct < 40)
    .sort((a, b) => a.pct - b.pct);

  const body = $('#q-body');
  body.textContent = '';
  for (const { s, pct } of low) {
    const tr = document.createElement('tr');
    for (const [text, cls] of [
      [s.notation, 'left'], [s.ticker, 'left'],
      [s.summary.n.toLocaleString('ko-KR'), ''], [`${pct.toFixed(1)}%`, ''],
      [s.summary.firstDate ?? '–', 'left'], [s.summary.lastDate ?? '–', 'left'],
    ]) {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }

  const stale = state.index.diagnostics?.staleTail;
  $('#q-notes').innerHTML = `
    <h3>결측 처리</h3>
    <p>원본 워크북은 결측값을 빈 셀이 아니라 <code>#N/A N/A</code>, <code>#VALUE!</code> 오류 문자열로
    기록합니다. 빌드 단계에서 모두 <code>null</code>로 변환되며, 차트에서는 선이 끊어져 표시됩니다.</p>

    <h3>매크로 지표의 일간 변화</h3>
    <p><span class="tag step">발표시 갱신</span> 표시가 붙은 <b>매크로</b> 지표는 영업일마다 값이 있지만
    실제로는 지표 발표일에만 변합니다. 최근 500영업일 기준 <code>한국_GDP_real_yoy</code>는 8회,
    <code>미국_실업률</code>은 15회만 값이 바뀐 반면 시장금리인 <code>미국_10y</code>는 469회 변했습니다.
    따라서 매크로 지표의 일간 변동성·상관계수는 해석하지 마십시오.</p>

    <h3>기준일 스냅샷</h3>
    ${stale?.suspect ? `<p>마지막 행 <b>${stale.lastDate}</b>은 직전 영업일 <b>${stale.previousDate}</b>과
    값이 <b>${(stale.identicalRate * 100).toFixed(0)}%</b> 동일합니다. 최근 정상 수준은
    ${(stale.baselineRate * 100).toFixed(0)}%로, 장 마감 전에 추출된 스냅샷으로 보입니다.
    <b>1일 변화 열은 신뢰하지 마십시오.</b></p>` : '<p>마지막 행에서 이상 징후는 발견되지 않았습니다.</p>'}

    <h3>중복·오표기</h3>
    <ul>
      <li><code>미국_IRS_5y1y</code>는 원본에서 두 열에 동일 티커·동일 값으로 중복 수록되어 있습니다.</li>
      <li><code>미국_하이일드_10년_일드</code>는 실제로 10년 계열이 아니라
          <code>미국_하이일드_일드</code>와 같은 <code>LF98YW</code> 지수입니다.</li>
      <li><code>호주_BEI_10y</code>가 두 번 나오는데, 티커가 <code>ADGGBE05</code>인 쪽은
          실제로는 <b>5년</b> 계열입니다.</li>
      <li>신용등급 <code>AA+</code>·<code>AA-</code>는 별도 계열로 유지됩니다.</li>
    </ul>

    <h3>변화 표기</h3>
    <p>지표 성격에 따라 세 가지로 나눠 표시합니다.</p>
    <ul>
      <li><b>bp</b> — 금리·스프레드·CDS. 예: <code>미국_10y +23.9bp</code></li>
      <li><b>%p</b> — 매크로 지표의 절대 변화(%포인트). GDP 성장률이 −13.8%에서 7.9%로
          바뀐 것은 <code>+21.7%p</code>이지 2,170bp가 아닙니다.
          지수 포인트(<code>pt</code>)·고용자수(<code>k</code>)도 같은 방식입니다.</li>
      <li><b>%</b> — 지수·환율·ETF 등 레벨 지표의 변화율</li>
    </ul>
    <p>금리의 퍼센트 변화율은 의미가 없으므로 어떤 경우에도 계산하지 않습니다.</p>`;
}

/* ───────────────────────── banners & chrome ───────────────────────── */

function renderBanners() {
  const box = $('#banners');
  box.textContent = '';
  const add = (html) => {
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML = `<span class="glyph">⚠</span><span>${html}</span>`;
    box.append(el);
  };

  if (state.index.demo) {
    add('<b>데모 데이터입니다.</b> 합성 난수로 만든 값이며 실제 시장 데이터가 아닙니다. ' +
        '실제 데이터로 보려면 private <code>Data</code> 저장소의 워크북으로 다시 빌드하십시오.');
  }
  const stale = state.index.diagnostics?.staleTail;
  if (stale?.suspect) {
    add(`마지막 행 <b>${stale.lastDate}</b>이 직전 영업일과 ` +
        `<b>${(stale.identicalRate * 100).toFixed(0)}%</b> 동일합니다 ` +
        `(최근 정상 수준 ${(stale.baselineRate * 100).toFixed(0)}%). ` +
        '장 마감 전 스냅샷으로 보이므로 <b>1일 변화</b>는 참고만 하십시오.');
  }
  if (state.index.totals.empty.length) {
    add(`데이터가 전혀 없는 지표: <b>${state.index.totals.empty.join(', ')}</b>. ` +
        '원본 추출에서 값이 반환되지 않았습니다.');
  }
}

function switchView(name) {
  $$('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === name)));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  if (name === 'chart') renderChart();
  if (name === 'curve') renderCurve();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('dash-theme', theme); } catch { /* private mode */ }
  renderOverview();
  renderChart();
  if (!$('#view-curve').hidden) renderCurve();
}

/* ───────────────────────── wiring ───────────────────────── */

function wire() {
  $$('nav.tabs button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  const chips = $('#cat-chips');
  const allChip = document.createElement('button');
  allChip.className = 'chip';
  allChip.type = 'button';
  allChip.textContent = '전체';
  allChip.setAttribute('aria-pressed', 'true');
  allChip.addEventListener('click', () => {
    state.cats.clear();
    syncChips();
    renderOverview();
  });
  chips.append(allChip);

  for (const c of state.index.categories) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.dataset.cat = c.key;
    chip.innerHTML = `${c.label}<span class="n">${c.count}</span>`;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      state.cats.has(c.key) ? state.cats.delete(c.key) : state.cats.add(c.key);
      syncChips();
      renderOverview();
    });
    chips.append(chip);
  }

  function syncChips() {
    allChip.setAttribute('aria-pressed', String(state.cats.size === 0));
    $$('#cat-chips .chip[data-cat]').forEach((chip) =>
      chip.setAttribute('aria-pressed', String(state.cats.has(chip.dataset.cat))));
  }

  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderOverview(); });
  $('#hide-empty').addEventListener('change', (e) => { state.hideEmpty = e.target.checked; renderOverview(); });

  $$('#ov-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      // Names read best A→Z; numbers read best largest-first.
      state.sort = state.sort.key === key
        ? { key, dir: -state.sort.dir }
        : { key, dir: key === 'notation' ? 1 : -1 };
      renderOverview();
    });
  });

  $('#pick-search').addEventListener('input', renderPicker);
  $('#pick-clear').addEventListener('click', () => {
    state.picked = [];
    state.hidden.clear();
    renderOverview();
    renderPicker();
    renderChart();
  });

  $$('#range-seg button').forEach((b) => b.addEventListener('click', () => {
    state.range = Number(b.dataset.range);
    $$('#range-seg button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    renderChart();
  }));
  $('#rebase').addEventListener('change', (e) => { state.rebase = e.target.checked; renderChart(); });

  const chart = $('#main-chart');
  chart.addEventListener('mousemove', chartHover);
  chart.addEventListener('mouseleave', () => { $('#chart-tip').classList.remove('on'); renderChart(); });

  const countries = [...new Set(state.index.series.filter((s) => s.curve).map((s) => s.curve.country))];
  state.curveCountry = countries[0] ?? null;
  const cbox = $('#curve-countries');
  for (const country of countries) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.type = 'button';
    chip.textContent = country;
    chip.setAttribute('aria-pressed', String(country === state.curveCountry));
    chip.addEventListener('click', () => {
      state.curveCountry = country;
      $$('#curve-countries .chip').forEach((o) =>
        o.setAttribute('aria-pressed', String(o.textContent === country)));
      renderCurve();
    });
    cbox.append(chip);
  }

  const dateSelect = $('#curve-date');
  for (const iso of curveDateOptions()) {
    const option = document.createElement('option');
    option.value = iso;
    option.textContent = iso;
    dateSelect.append(option);
  }
  dateSelect.addEventListener('change', renderCurve);
  $('#curve-compare').addEventListener('change', (e) => {
    state.curveCompare = e.target.checked;
    renderCurve();
  });

  const curve = $('#curve-chart');
  curve.addEventListener('mousemove', curveHover);
  curve.addEventListener('mouseleave', () => $('#curve-tip').classList.remove('on'));

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderChart();
      if (!$('#view-curve').hidden) renderCurve();
      renderOverview();
    }, 120);
  });
}

async function main() {
  try { applyThemeFromStorage(); } catch { /* ignore */ }
  try {
    await loadIndex();
  } catch (err) {
    $('#subtitle').textContent = '';
    $('#banners').innerHTML =
      '<div class="banner"><span class="glyph">⚠</span><span>' +
      '<b>데이터를 불러오지 못했습니다.</b> <code>python scripts/build_data.py</code>로 ' +
      '<code>data/</code>를 생성한 뒤, <code>python -m http.server</code>로 실행하십시오. ' +
      `<br><code>${String(err)}</code></span></div>`;
    return;
  }

  const { totals, dates, categories } = state.index;
  $('#subtitle').textContent =
    `${totals.series}개 지표 · ${categories.length}개 분류 · ${totals.observations.toLocaleString('ko-KR')}건`;
  $('#asof').innerHTML = `기준일 <b>${dates[dates.length - 1]}</b> · ${dates[0]} 이후`;

  renderBanners();
  wire();
  renderOverview();
  renderPicker();
  renderQuality();

  // A few representative series so the chart tab is not empty on first visit.
  // Seeded with three comparable government yields: mixing a yield and an FX
  // level on one axis flattens the yield into the baseline.
  const seeds = ['미국_10y', '한국_10y', '일본_10y'].filter((id) => state.byId.has(id));
  if (seeds.length) {
    await ensureSeries(seeds);
    state.picked = seeds;
    renderOverview();
    renderPicker();
    renderChart();
  }
}

function applyThemeFromStorage() {
  let saved = null;
  try { saved = localStorage.getItem('dash-theme'); } catch { /* private mode */ }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved ?? (prefersDark ? 'dark' : 'light');
}

main();
