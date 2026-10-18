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
    statBrierModel: document.querySelector('[data-stat="brierModel"]'),
    statBrierMarket: document.querySelector('[data-stat="brierMarket"]'),
    statSkill: document.querySelector('[data-stat="brierSkill"]'),
    statEdge: document.querySelector('[data-stat="avgNetEdgeC"]'),
    statPnl: document.querySelector('[data-stat="netPnlPct"]'),
    curve: document.querySelector('[data-equity-curve]'),
    calibration: document.querySelector('[data-calibration]'),
    tableBody: document.querySelector('[data-signal-rows]'),
    pageLabel: document.querySelector('[data-page-label]'),
    prev: document.querySelector('[data-page-prev]'),
    next: document.querySelector('[data-page-next]'),
    empty: document.querySelector('[data-empty-state]'),
    exportCsv: document.querySelector('[data-export-csv]'),
    notice: document.querySelector('[data-no-results]')
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

  function orNa(v, f) { return v == null ? 'n/a' : f(v); }

  function renderStats(data) {
    const st = data.stats;
    const resolved = st.resolvedSignals || 0;
    setText(els.updatedAt, `Updated ${dateFmt.format(new Date(data.generatedAt))}`);
    setText(els.source, data.source === 'supabase' ? 'Live ledger · paper forecasts'
      : data.source === 'local' ? `Local ledger · ${st.totalSignals} forecasts` : 'No published results yet');
    if (els.notice) els.notice.hidden = resolved > 0;
    setText(els.statTotal, `${fmt.format(resolved)} / ${fmt.format(st.totalSignals)}`);
    setText(els.statBrierModel, orNa(st.brierModel, (v) => v.toFixed(3)));
    setText(els.statBrierMarket, orNa(st.brierMarket, (v) => v.toFixed(3)));
    setText(els.statSkill, orNa(st.brierSkill, (v) => (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'));
    setText(els.statEdge, orNa(st.avgNetEdgeC, (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '¢'));
    setText(els.statPnl, orNa(st.netPnlPct, formatPct));
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
    if (!items.some((item) => item.count > 0)) {
      els.calibration.innerHTML = '<div class="chart-empty">Calibration appears once forecasts resolve</div>';
      return;
    }
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

    const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
    const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    els.tableBody.innerHTML = data.signals.map((r) => `
      <tr>
        <td>${dateFmt.format(new Date(r.flagged_at))}</td>
        <td>
          <strong>${esc(r.market_name)}</strong>
          <span>${esc(r.side)} at ${r.entry_price == null ? '—' : Math.round(r.entry_price * 100) + '¢'}</span>
        </td>
        <td>${pct(r.model_prob)}</td>
        <td>${pct(r.market_prob)}</td>
        <td>${r.net_edge_c == null ? '—' : (r.net_edge_c > 0 ? '+' : '') + r.net_edge_c.toFixed(1) + '¢'}</td>
        <td><span class="${statusClass(r.outcome)}">${r.outcome}</span></td>
        <td>${r.brier_model == null ? '—' : r.brier_model.toFixed(3) + ' / ' + r.brier_market.toFixed(3)}</td>
        <td class="${(r.net_pnl_bps || 0) < 0 ? 'negative' : 'positive'}">${r.net_pnl_bps == null ? '—' : formatBps(r.net_pnl_bps)}</td>
        <td><a href="${esc(r.market_url)}" target="_blank" rel="noopener">Verify</a></td>
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
