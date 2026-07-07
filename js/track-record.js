(function () {
  const state = {
    range: '30d',
    page: 1,
    limit: 50
  };

  const els = {
    updatedAt: document.querySelector('[data-updated-at]'),
    source: document.querySelector('[data-source]'),
    statTotal: document.querySelector('[data-stat="totalSignals"]'),
    statWinRate: document.querySelector('[data-stat="winRate"]'),
    statAvgReturn: document.querySelector('[data-stat="avgReturnBps"]'),
    statSharpe: document.querySelector('[data-stat="sharpe"]'),
    statDrawdown: document.querySelector('[data-stat="maxDrawdownPct"]'),
    statPnl: document.querySelector('[data-stat="totalPnlPct"]'),
    curve: document.querySelector('[data-equity-curve]'),
    calibration: document.querySelector('[data-calibration]'),
    tableBody: document.querySelector('[data-signal-rows]'),
    pageLabel: document.querySelector('[data-page-label]'),
    prev: document.querySelector('[data-page-prev]'),
    next: document.querySelector('[data-page-next]'),
    empty: document.querySelector('[data-empty-state]'),
    exportCsv: document.querySelector('[data-export-csv]')
  };

  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  function formatBps(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${fmt.format(value)} bps`;
  }

  function formatPct(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${fmt.format(value)}%`;
  }

  function statusClass(outcome) {
    if (outcome === 'WIN') return 'status-pill status-pill--win';
    if (outcome === 'LOSS') return 'status-pill status-pill--loss';
    if (outcome === 'BREAKEVEN') return 'status-pill';
    return 'status-pill status-pill--open';
  }

  function renderStats(data) {
    setText(els.statTotal, fmt.format(data.stats.totalSignals));
    setText(els.statWinRate, `${fmt.format(data.stats.winRate)}%`);
    setText(els.statAvgReturn, formatBps(data.stats.avgReturnBps));
    setText(els.statSharpe, data.stats.sharpe.toFixed(2));
    setText(els.statDrawdown, formatPct(data.stats.maxDrawdownPct));
    setText(els.statPnl, formatPct(data.stats.totalPnlPct));
    setText(els.updatedAt, `Updated ${dateFmt.format(new Date(data.generatedAt))}`);
    setText(els.source, data.source === 'sample' ? 'Sample data until Supabase is configured' : 'Live database');
  }

  function renderCurve(points) {
    if (!els.curve) return;
    if (!points.length) {
      els.curve.innerHTML = '<div class="chart-empty">No resolved signals yet</div>';
      return;
    }

    const width = 720;
    const height = 240;
    const padding = 20;
    const values = points.map((point) => point.pnl);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const span = max - min || 1;

    const coords = points.map((point, index) => {
      const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((point.pnl - min) / span) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const fillCoords = `${padding},${height - padding} ${coords.join(' ')} ${width - padding},${height - padding}`;
    const latest = points[points.length - 1];

    els.curve.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative P&L curve">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis"></line>
        <polygon points="${fillCoords}" class="chart-fill"></polygon>
        <polyline points="${coords.join(' ')}" class="chart-line"></polyline>
      </svg>
      <div class="chart-caption">
        <span>Cumulative P&L</span>
        <strong>${formatPct(latest.pnl)}</strong>
      </div>
    `;
  }

  function renderCalibration(items) {
    if (!els.calibration) return;
    els.calibration.innerHTML = items.map((item) => {
      const actual = Math.max(0, Math.min(item.actualWinRate, 100));
      const predicted = Math.max(0, Math.min(item.predictedWinRate, 100));
      return `
        <div class="calibration-row">
          <div>
            <strong>${item.tier}</strong>
            <span>${item.count} resolved</span>
          </div>
          <div class="calibration-bars">
            <span style="width:${predicted}%"></span>
            <b style="width:${actual}%"></b>
          </div>
          <div class="calibration-values">
            <span>Pred ${fmt.format(predicted)}%</span>
            <strong>Actual ${fmt.format(actual)}%</strong>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderTable(data) {
    if (!els.tableBody) return;
    els.empty.hidden = data.signals.length > 0;

    els.tableBody.innerHTML = data.signals.map((signal) => `
      <tr>
        <td>${dateFmt.format(new Date(signal.flagged_at))}</td>
        <td>
          <strong>${signal.market_name}</strong>
          <span>${signal.signal_type.replace(/_/g, ' ')}</span>
        </td>
        <td>${signal.edge_score}c</td>
        <td>${fmt.format(signal.confidence)}%</td>
        <td><span class="${statusClass(signal.outcome)}">${signal.outcome}</span></td>
        <td class="${signal.pnl_bps < 0 ? 'negative' : 'positive'}">${formatBps(signal.pnl_bps)}</td>
        <td><a href="${signal.market_url}" target="_blank" rel="noopener">Verify</a></td>
      </tr>
    `).join('');

    setText(els.pageLabel, `Page ${data.pagination.page} of ${data.pagination.totalPages}`);
    els.prev.disabled = data.pagination.page <= 1;
    els.next.disabled = data.pagination.page >= data.pagination.totalPages;
  }

  async function loadTrackRecord() {
    document.body.classList.add('is-loading');
    const params = new URLSearchParams({
      range: state.range,
      page: String(state.page),
      limit: String(state.limit)
    });

    const response = await fetch(`/api/track-record?${params.toString()}`);
    if (!response.ok) throw new Error('Track record request failed');
    const data = await response.json();

    renderStats(data);
    renderCurve(data.stats.equityCurve);
    renderCalibration(data.calibration);
    renderTable(data);
    els.exportCsv.href = `/api/track-record?range=${state.range}&format=csv`;
    document.body.classList.remove('is-loading');
  }

  document.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      state.range = button.dataset.range;
      state.page = 1;
      document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('is-active', item === button));
      loadTrackRecord().catch(showError);
    });
  });

  els.prev?.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1);
    loadTrackRecord().catch(showError);
  });

  els.next?.addEventListener('click', () => {
    state.page += 1;
    loadTrackRecord().catch(showError);
  });

  function showError(error) {
    console.error(error);
    document.body.classList.remove('is-loading');
    if (els.empty) {
      els.empty.hidden = false;
      els.empty.textContent = 'Track record data is unavailable. Check the API configuration and try again.';
    }
  }

  loadTrackRecord().catch(showError);
})();
