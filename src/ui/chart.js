// Force vs crusher travel chart (Canvas 2D) with hover crosshair + tooltip.
// Series colours come from CSS custom properties --series-1..8; text, grid
// and surface colours from the theme tokens, read at draw time so the chart
// follows light/dark mode.

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

export class ForceChart {
  /**
   * @param {HTMLElement} wrap  element containing a <canvas> and a tooltip <div>
   */
  constructor(wrap, { onHover } = {}) {
    this.wrap = wrap;
    this.canvas = wrap.querySelector('canvas');
    this.tip = wrap.querySelector('.chart-tip');
    this.series = []; // {id, name, slot, d:[], F:[], live}
    this.hoverX = null;
    this.unit = 'N';
    this.onHover = onHover;
    const ro = new ResizeObserver(() => this.draw());
    ro.observe(wrap);
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => { this.hoverX = null; this.draw(); });
    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._mq.addEventListener?.('change', () => this.draw());
    new MutationObserver(() => this.draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  setUnit(u) { this.unit = u; this.draw(); }

  setSeries(list) { this.series = list; this.draw(); }

  _scale() { return this.unit === 'lbf' ? 0.2248089 : this.unit === 'kgf' ? 0.1019716 : 1; }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }

  _draw() {
    const cv = this.canvas, wrap = this.wrap;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const ink = css(wrap, '--ink'), ink2 = css(wrap, '--ink-2'), line = css(wrap, '--grid'), surf = css(wrap, '--panel');
    const fontData = css(wrap, '--font-data') || 'monospace';
    const sc = this._scale();

    // extents
    let xMax = 10, yMax = 100;
    for (const s of this.series) {
      for (let i = 0; i < s.d.length; i++) {
        if (s.d[i] > xMax) xMax = s.d[i];
        const f = s.F[i] * sc;
        if (f > yMax) yMax = f;
      }
    }
    const xStep = niceStep(xMax, Math.max(3, Math.floor(W / 80)));
    xMax = Math.ceil(xMax / xStep) * xStep;
    const yStep = niceStep(yMax, Math.max(3, Math.floor(H / 50)));
    yMax = Math.ceil((yMax * 1.04) / yStep) * yStep;

    g.font = `11px ${fontData}`;
    const yLabelW = Math.max(g.measureText(String(Math.round(yMax))).width, 24) + 10;
    const L = yLabelW + 18, R = 12, T = 12, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const X = (d) => L + (d / xMax) * pw;
    const Y = (f) => T + ph - (f / yMax) * ph;

    // grid + ticks
    g.strokeStyle = line; g.lineWidth = 1;
    g.fillStyle = ink2;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke();
      g.fillText(String(Math.round(v)), L - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let v = 0; v <= xMax + 1e-9; v += xStep) {
      const x = Math.round(X(v)) + 0.5;
      g.beginPath(); g.moveTo(x, T + ph); g.lineTo(x, T + ph + 4); g.stroke();
      g.fillText(String(+v.toFixed(1)), x, T + ph + 6);
    }
    // axis titles
    g.fillStyle = ink2;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText('crusher travel (mm)', L + pw / 2, H - 2);
    g.save();
    g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2);
    g.textBaseline = 'middle';
    g.fillText(`force (${this.unit})`, 0, 0);
    g.restore();
    // baseline
    g.strokeStyle = ink2; g.beginPath(); g.moveTo(L, T + ph + 0.5); g.lineTo(L + pw, T + ph + 0.5); g.stroke();

    if (!this.series.length || !this.series.some((s) => s.d.length)) {
      g.fillStyle = ink2; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `13px ${css(wrap, '--font-body') || 'sans-serif'}`;
      g.fillText('Press Crush to record a force–travel curve', L + pw / 2, T + ph / 2);
      if (this.tip) this.tip.hidden = true;
      return;
    }

    // series (saved first so the live run draws on top)
    const order = [...this.series].sort((a, b) => (a.live ? 1 : 0) - (b.live ? 1 : 0));
    g.save();
    g.beginPath(); g.rect(L, T - 2, pw, ph + 4); g.clip();
    for (const s of order) {
      if (!s.d.length) continue;
      const col = css(wrap, `--series-${s.slot}`);
      g.strokeStyle = col;
      g.lineWidth = s.live ? 2 : 1.6;
      g.lineJoin = 'round';
      g.globalAlpha = s.dim ? 0.35 : 1;
      g.beginPath();
      const step = Math.max(1, Math.floor(s.d.length / (pw * 1.5)));
      for (let i = 0; i < s.d.length; i += step) {
        const x = X(s.d[i]), y = Y(Math.max(0, s.F[i]) * sc);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // endpoint marker for the live run
      if (s.live) {
        const i = s.d.length - 1;
        g.fillStyle = col;
        g.strokeStyle = surf; g.lineWidth = 2;
        g.beginPath(); g.arc(X(s.d[i]), Y(Math.max(0, s.F[i]) * sc), 4, 0, 2 * Math.PI); g.fill(); g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.restore();

    // hover crosshair + tooltip
    if (this.hoverX !== null && this.hoverX >= L && this.hoverX <= L + pw && this.tip) {
      const d = ((this.hoverX - L) / pw) * xMax;
      g.strokeStyle = ink2; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(Math.round(this.hoverX) + 0.5, T); g.lineTo(Math.round(this.hoverX) + 0.5, T + ph); g.stroke();
      g.setLineDash([]);
      const rows = [];
      for (const s of this.series) {
        if (!s.d.length || d > s.d[s.d.length - 1] + 0.5) continue;
        // nearest sample
        let lo = 0, hi = s.d.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s.d[m] < d) lo = m; else hi = m; }
        const i = Math.abs(s.d[lo] - d) < Math.abs(s.d[hi] - d) ? lo : hi;
        const f = Math.max(0, s.F[i]) * sc;
        const col = css(wrap, `--series-${s.slot}`);
        g.fillStyle = col; g.strokeStyle = surf; g.lineWidth = 2;
        g.beginPath(); g.arc(X(s.d[i]), Y(f), 4, 0, 2 * Math.PI); g.fill(); g.stroke();
        rows.push(`<div class="tip-row"><span class="tip-sw" style="background:${col}"></span><span class="tip-name">${escapeHtml(s.name)}</span><b>${f.toFixed(this.unit === 'N' ? 0 : 1)} ${this.unit}</b></div>`);
      }
      if (rows.length) {
        this.tip.innerHTML = `<div class="tip-head">${d.toFixed(1)} mm travel</div>${rows.join('')}`;
        this.tip.hidden = false;
        const tw = this.tip.offsetWidth;
        const left = this.hoverX + 14 + tw > W ? this.hoverX - 14 - tw : this.hoverX + 14;
        this.tip.style.left = `${Math.max(4, left)}px`;
        this.tip.style.top = `${T + 6}px`;
      } else this.tip.hidden = true;
    } else if (this.tip) this.tip.hidden = true;
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
