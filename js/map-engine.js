/* ═══════════════════════════════════════════════════════════
   NEXXORE TERMINAL v4 — MAP ENGINE (Lazy-loaded layers)
   Loads layers on demand, conflict escalation index, oil flows
   ═══════════════════════════════════════════════════════════ */

const MapEngine = {
  map: null,
  layersLoaded: {},
  markers: { conflicts: [], quakes: [], shipping: [], chokepoints: [], weather: [], sanctions: [], energy: [], oilFlows: [] },
  layerVisible: { conflicts: true, quakes: true, shipping: true, chokepoints: true, weather: true, sanctions: true, energy: true, oilFlows: false },

  init(containerId) {
    this.map = L.map(containerId, {
      center: [20, 30], zoom: 2, zoomControl: false, scrollWheelZoom: true,
      attributionControl: false, minZoom: 1, maxZoom: 8,
      preferCanvas: true // Use Canvas renderer — much faster than SVG for many markers
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      updateWhenIdle: true,
      updateWhenZooming: false,
    }).addTo(this.map);
    // Only load conflicts + chokepoints initially (most important)
    this.loadLayer('conflicts');
    this.loadLayer('chokepoints');
    // Defer rest
    requestIdleCallback(() => {
      this.loadLayer('shipping');
      this.loadLayer('sanctions');
      this.loadLayer('energy');
      this.loadLayer('weather');
      this.loadQuakes();
    });
    return this.map;
  },

  loadLayer(name) {
    if (this.layersLoaded[name]) return;
    this.layersLoaded[name] = true;
    switch (name) {
      case 'conflicts': this._addConflicts(); break;
      case 'shipping': this._addShipping(); break;
      case 'chokepoints': this._addChokepoints(); break;
      case 'sanctions': this._addSanctions(); break;
      case 'energy': this._addEnergy(); break;
      case 'weather': this._addWeather(); break;
      case 'oilFlows': this._addOilFlows(); break;
    }
  },

  toggleLayer(name, btn) {
    this.layerVisible[name] = !this.layerVisible[name];
    if (btn) btn.classList.toggle('active', this.layerVisible[name]);
    if (!this.layersLoaded[name] && this.layerVisible[name]) {
      this.loadLayer(name);
      return;
    }
    this.markers[name].forEach(m => {
      if (this.layerVisible[name]) m.addTo(this.map);
      else this.map.removeLayer(m);
    });
  },

  flyTo(region) {
    const regions = {
      GLOBAL: [20, 10, 2], AMERICAS: [15, -80, 3], EUROPE: [50, 10, 4],
      ASIA: [30, 100, 3], INDIA: [22, 78, 5], MENA: [25, 45, 4]
    };
    if (regions[region]) this.map.flyTo([regions[region][0], regions[region][1]], regions[region][2]);
  },

  getStats() {
    return {
      conflicts: this.markers.conflicts.filter(m => m instanceof L.Marker).length,
      shipping: this.markers.shipping.filter(m => m instanceof L.Polyline && !(m instanceof L.Polygon)).length,
      quakes: this.markers.quakes.length
    };
  },

  // ── CONFLICT ZONES with ESCALATION INDEX ──
  _addConflicts() {
    const zones = [
      { lat: 48.5, lng: 35.5, name: 'Ukraine-Russia War', escalation: 88, detail: 'Active frontline — Energy & grain disruption. Oil ↑, sanctions boost crypto adoption', impact: 'HIGH', radius: 180000, trend: '↑' },
      { lat: 31.4, lng: 34.4, name: 'Gaza Conflict', escalation: 82, detail: 'Red Sea rerouted. Houthi attacks. +15 days transit via Cape', impact: 'HIGH', radius: 120000, trend: '→' },
      { lat: 23.0, lng: 57.0, name: 'Yemen / Houthi', escalation: 78, detail: 'Red Sea & Gulf of Aden attacks. Insurance 10x. Oil price driver', impact: 'HIGH', radius: 120000, trend: '↑' },
      { lat: 15.5, lng: 32.5, name: 'Sudan Civil War', escalation: 65, detail: '2nd largest displacement. Gold mining disruption', impact: 'MED', radius: 150000, trend: '→' },
      { lat: 19.8, lng: 96.2, name: 'Myanmar Military', escalation: 45, detail: 'Civil unrest, jade & gem trade disruption', impact: 'LOW', radius: 100000, trend: '↓' },
      { lat: 23.5, lng: 120.5, name: 'Taiwan Strait', escalation: 72, detail: '50% container ships transit. Escalation = supply chain collapse', impact: 'HIGH', radius: 150000, trend: '↑' },
      { lat: 38.5, lng: 128.0, name: 'Korean Peninsula', escalation: 55, detail: 'DPRK missile tests. Regional risk premium', impact: 'MED', radius: 80000, trend: '→' },
      { lat: 33.3, lng: 44.3, name: 'Iraq Militia', escalation: 60, detail: 'Iran-backed militia attacks. Oil infrastructure risk', impact: 'MED', radius: 100000, trend: '↑' },
      { lat: 13.0, lng: 122.0, name: 'South China Sea', escalation: 68, detail: 'PH-China maritime disputes. Shipping lane risk', impact: 'MED', radius: 200000, trend: '↑' },
      { lat: 9.0, lng: 38.7, name: 'Ethiopia Regional', escalation: 40, detail: 'Tigray aftermath, Amhara insurgency', impact: 'LOW', radius: 100000, trend: '↓' },
    ];

    zones.forEach(z => {
      const circle = L.circle([z.lat, z.lng], {
        radius: z.radius, color: 'rgba(255,61,90,.6)', fillColor: 'rgba(255,61,90,.15)',
        fillOpacity: .3, weight: 1, dashArray: '4 4'
      });
      const escColor = z.escalation > 75 ? '#FF3D5A' : z.escalation > 50 ? '#f0b429' : '#64748b';
      const icon = L.divIcon({
        className: '', iconSize: [8, 8], iconAnchor: [4, 4],
        html: `<div style="width:8px;height:8px;background:var(--red);border-radius:50%;box-shadow:0 0 12px var(--red),0 0 24px rgba(255,61,90,.3);animation:pulse 2s infinite"></div>`
      });
      const marker = L.marker([z.lat, z.lng], { icon }).bindPopup(
        `<div style="max-width:220px">
          <span style="color:var(--red);font-weight:700">⚠ ${z.name}</span>
          <div style="display:flex;gap:4px;margin:3px 0;align-items:center">
            <span style="font-size:7px;color:var(--t4)">ESCALATION:</span>
            <div style="flex:1;height:3px;background:#1a1a32;border-radius:2px;overflow:hidden">
              <div style="width:${z.escalation}%;height:100%;background:${escColor};border-radius:2px"></div>
            </div>
            <span style="font-size:8px;font-weight:700;color:${escColor}">${z.escalation}/100 ${z.trend}</span>
          </div>
          <span style="font-size:8px;color:var(--t3)">${z.detail}</span><br>
          <span style="font-size:7px;font-weight:700;color:${z.impact === 'HIGH' ? 'var(--red)' : 'var(--amber)'}">MARKET IMPACT: ${z.impact}</span>
        </div>`
      );
      circle.addTo(this.map); marker.addTo(this.map);
      this.markers.conflicts.push(circle, marker);
    });
  },

  // ── SHIPPING LANES ──
  _addShipping() {
    const routes = [
      { name: 'Asia-Europe (Suez)', color: '#00C8FF', weight: 2, opacity: .4,
        points: [[1.3, 103.8], [5.5, 80.2], [12.5, 53.0], [14.5, 42.0], [30.0, 32.5], [31.3, 32.3], [35.0, 28.0], [37.5, 15.0], [36.0, 0.0], [35.9, -5.7], [51.5, 1.0]],
        vol: '12% global trade', detail: '65% of Asia-Europe trade. Suez transit' },
      { name: 'Asia-Europe (Cape)', color: '#FF8C00', weight: 1.5, opacity: .3, dash: '6 4',
        points: [[1.3, 103.8], [0, 80], [-5, 60], [-15, 45], [-34, 18], [-34.5, 18.5], [-34, 0], [-20, -10], [0, -10], [20, -15], [35, -5], [48, 0], [51.5, 1.0]],
        vol: 'Suez alt +15d', detail: 'Alternative when Suez disrupted. +$1M fuel/vessel' },
      { name: 'Trans-Pacific', color: '#00E87A', weight: 2, opacity: .4,
        points: [[22.3, 114.2], [25, 130], [35, 150], [37, 170], [35, -170], [35, -155], [34, -140], [34, -118]],
        vol: '$1.2T/yr', detail: 'China-US decoupling risk' },
      { name: 'Persian Gulf Oil', color: '#FF3D5A', weight: 2.5, opacity: .5,
        points: [[26.2, 56.3], [24, 58], [22, 62], [18, 57], [14, 50], [12.6, 43.3]],
        vol: '21M bbl/day', detail: '21% global oil via Hormuz' },
      { name: 'Malacca Strait', color: '#f0b429', weight: 2, opacity: .5,
        points: [[1.3, 103.8], [2.5, 101.5], [4, 100], [6, 98], [8, 96]],
        vol: '25% trade', detail: '60% China oil imports' },
      { name: 'Panama Canal', color: '#8b5cf6', weight: 2, opacity: .4,
        points: [[9.0, -79.5], [9.3, -79.9], [10, -80], [12, -82], [15, -85], [20, -86], [25, -82], [30, -78]],
        vol: '5% trade', detail: 'Drought: 24/day (norm 36-40)' },
      { name: 'North Sea / Baltic', color: '#00C8FF', weight: 1.5, opacity: .3,
        points: [[51.5, 1.0], [54, 4], [56, 8], [57, 12], [59, 18], [60, 25]],
        vol: 'EU energy', detail: 'Russian oil sanctions rerouting' },
      { name: 'Indian Ocean', color: '#ff6b9d', weight: 1.5, opacity: .35,
        points: [[19, 72.8], [15, 68], [10, 60], [8, 52], [12.6, 43.3]],
        vol: 'India crude', detail: '85% import dependent. INR/Nifty impact' },
    ];

    routes.forEach(r => {
      const line = L.polyline(r.points.map(p => [p[0], p[1]]), {
        color: r.color, weight: r.weight, opacity: r.opacity,
        dashArray: r.dash || '', smoothFactor: 2
      }).bindPopup(`<div style="max-width:180px"><span style="color:${r.color};font-weight:700">🚢 ${r.name}</span><br><span style="font-size:7px;color:var(--cyan)">${r.vol}</span><br><span style="font-size:8px;color:var(--t3)">${r.detail}</span></div>`);
      line.addTo(this.map);
      this.markers.shipping.push(line);
      // Ship marker at midpoint
      if (r.points.length > 2) {
        const mid = r.points[Math.floor(r.points.length / 2)];
        const shipIcon = L.divIcon({ className: '', html: `<div style="font-size:10px;filter:drop-shadow(0 0 4px ${r.color})">🚢</div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
        const ship = L.marker([mid[0], mid[1]], { icon: shipIcon }).bindPopup(`<span style="color:${r.color}">${r.name}</span>`);
        ship.addTo(this.map);
        this.markers.shipping.push(ship);
      }
    });
  },

  // ── CHOKEPOINTS ──
  _addChokepoints() {
    const cps = [
      { lat: 30.0, lng: 32.5, name: 'Suez Canal', status: '⚠ DISRUPTED', color: 'var(--red)', detail: '12% global trade. Houthi attacks. Insurance +1000%' },
      { lat: 26.5, lng: 56.3, name: 'Strait of Hormuz', status: '⚠ ELEVATED', color: 'var(--amber)', detail: '21% global oil. Iran closure = oil doubles' },
      { lat: 1.3, lng: 103.8, name: 'Malacca Strait', status: '● OPERATIONAL', color: 'var(--green)', detail: '25% global trade. China lifeline' },
      { lat: 9.0, lng: -79.5, name: 'Panama Canal', status: '⚠ RESTRICTED', color: 'var(--amber)', detail: '5% trade. Drought: 24/day' },
      { lat: 12.6, lng: 43.3, name: 'Bab el-Mandeb', status: '🔴 HIGH RISK', color: 'var(--red)', detail: '4.8M bbl/day. Houthi attacks' },
      { lat: -34.5, lng: 18.5, name: 'Cape of Good Hope', status: '● HEAVY TRAFFIC', color: 'var(--amber)', detail: 'Suez alt. +15 days. 2x traffic' },
      { lat: 61.0, lng: 28.0, name: 'Danish Straits', status: '⚠ MONITORING', color: 'var(--amber)', detail: 'Russian shadow fleet transits' },
      { lat: 41.2, lng: 29.0, name: 'Turkish Straits', status: '● OPERATIONAL', color: 'var(--green)', detail: 'Black Sea grain/oil' },
    ];
    cps.forEach(cp => {
      const icon = L.divIcon({
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
        html: `<div style="width:14px;height:14px;border:2px solid ${cp.color};border-radius:50%;background:rgba(6,6,16,.8);display:flex;align-items:center;justify-content:center;font-size:7px;box-shadow:0 0 8px ${cp.color}">⚓</div>`
      });
      const m = L.marker([cp.lat, cp.lng], { icon }).bindPopup(
        `<div style="max-width:200px"><span style="color:${cp.color};font-weight:700">⚓ ${cp.name}</span><br><span style="font-size:8px;color:var(--t3)">${cp.detail}</span><br><span style="font-size:7px;font-weight:700;color:${cp.color}">${cp.status}</span></div>`
      );
      m.addTo(this.map);
      this.markers.chokepoints.push(m);
    });
  },

  // ── SANCTIONS ──
  _addSanctions() {
    const zones = [
      { lat: 55.7, lng: 37.6, name: 'Russia', detail: 'SWIFT disconnect, oil cap $60. Shadow fleet via India. Crypto for evasion' },
      { lat: 35.7, lng: 51.4, name: 'Iran', detail: 'Oil embargo, SWIFT off. Dark fleet to China' },
      { lat: 39.0, lng: 125.7, name: 'North Korea', detail: 'Full embargo. $1.7B crypto stolen (Lazarus)' },
      { lat: 22.5, lng: 114.1, name: 'China (Tech)', detail: 'Chip controls (ASML). De-dollarization. CBDC' },
      { lat: 23.7, lng: 53.8, name: 'UAE (Monitor)', detail: 'Russian money flows. Dubai crypto hub. AML' },
    ];
    zones.forEach(z => {
      const icon = L.divIcon({
        className: '', iconSize: [10, 10], iconAnchor: [5, 5],
        html: `<div style="width:10px;height:10px;background:rgba(139,92,246,.4);border:1.5px solid var(--violet);border-radius:2px;box-shadow:0 0 6px var(--violet)"></div>`
      });
      const m = L.marker([z.lat, z.lng], { icon }).bindPopup(
        `<div style="max-width:200px"><span style="color:var(--violet);font-weight:700">🚫 ${z.name}</span><br><span style="font-size:8px;color:var(--t3)">${z.detail}</span></div>`
      );
      m.addTo(this.map);
      this.markers.sanctions.push(m);
    });
  },

  // ── ENERGY HUBS ──
  _addEnergy() {
    const hubs = [
      { lat: 26.3, lng: 50.2, name: 'Saudi (Ghawar)', detail: '5M bbl/day. OPEC+ swing' },
      { lat: 29.3, lng: 48.0, name: 'Kuwait/Iraq Oil', detail: '4M bbl/day' },
      { lat: 25.3, lng: 51.5, name: 'Qatar LNG', detail: 'Largest LNG exporter' },
      { lat: 61.5, lng: 73.3, name: 'W. Siberia Oil', detail: 'Russia main. Sanctions rerouting' },
      { lat: 29.7, lng: -95.3, name: 'Houston', detail: 'US shale. WTI benchmark' },
      { lat: 51.9, lng: 4.5, name: 'Rotterdam', detail: 'EU refining. TTF gas' },
      { lat: 1.3, lng: 103.8, name: 'Singapore', detail: 'Asian bunkering & crypto hub' },
      { lat: 19.0, lng: 72.8, name: 'Mumbai (Jamnagar)', detail: 'Largest refinery. Russian crude' },
    ];
    hubs.forEach(h => {
      const icon = L.divIcon({
        className: '', iconSize: [7, 7], iconAnchor: [3.5, 3.5],
        html: `<div style="width:7px;height:7px;background:var(--green);border-radius:50%;box-shadow:0 0 6px var(--green);opacity:.7"></div>`
      });
      const m = L.marker([h.lat, h.lng], { icon }).bindPopup(
        `<div style="max-width:180px"><span style="color:var(--green);font-weight:700">⚡ ${h.name}</span><br><span style="font-size:8px;color:var(--t3)">${h.detail}</span></div>`
      );
      m.addTo(this.map);
      this.markers.energy.push(m);
    });
  },

  // ── WEATHER ──
  _addWeather() {
    const evs = [
      { lat: 26.0, lng: -80.0, name: '🌀 Atlantic Storm', detail: 'Gulf oil platform shutdowns' },
      { lat: 35.0, lng: 139.0, name: '🌊 W. Pacific Typhoon', detail: 'Japan/Taiwan shipping disruption' },
      { lat: 22.5, lng: 88.3, name: '🌧️ Bangladesh Flooding', detail: 'Garment supply. Bay shipping' },
      { lat: -8.5, lng: 115.3, name: '🌋 Indonesia Volcanic', detail: 'Nickel/palm oil supply' },
      { lat: 36.0, lng: -120.0, name: '🔥 California Wildfires', detail: 'Power grid. Agriculture' },
    ];
    evs.forEach(ev => {
      const icon = L.divIcon({
        className: '', iconSize: [8, 8], iconAnchor: [4, 4],
        html: `<div style="width:8px;height:8px;background:var(--amber);border-radius:50%;box-shadow:0 0 6px var(--amber);opacity:.8"></div>`
      });
      const m = L.marker([ev.lat, ev.lng], { icon }).bindPopup(
        `<div style="max-width:180px"><b>${ev.name}</b><br><span style="font-size:8px;color:var(--t3)">${ev.detail}</span></div>`
      );
      m.addTo(this.map);
      this.markers.weather.push(m);
    });
  },

  // ── OIL FLOW OVERLAYS ──
  _addOilFlows() {
    const flows = [
      { from: [26.5, 56.3], to: [22, 70], name: 'Hormuz → India', vol: '4.2M bbl/day', color: '#FF8C00' },
      { from: [26.5, 56.3], to: [30, 120], name: 'Hormuz → China', vol: '3.8M bbl/day', color: '#FF8C00' },
      { from: [61.5, 73.3], to: [22, 78], name: 'Russia → India', vol: '1.8M bbl/day', color: '#8b5cf6' },
      { from: [29.7, -95.3], to: [50, 0], name: 'US → Europe', vol: '2.1M bbl/day', color: '#00C8FF' },
      { from: [26.3, 50.2], to: [35, 139], name: 'Saudi → Japan', vol: '2.5M bbl/day', color: '#00E87A' },
    ];
    flows.forEach(f => {
      const line = L.polyline([f.from, f.to], {
        color: f.color, weight: 3, opacity: 0.6, dashArray: '8 6', smoothFactor: 2
      }).bindPopup(`<span style="color:${f.color};font-weight:700">🛢 ${f.name}</span><br><span style="font-size:8px">${f.vol}</span>`);
      line.addTo(this.map);
      this.markers.oilFlows.push(line);
    });
  },

  // ── EARTHQUAKES (live USGS) ──
  async loadQuakes() {
    try {
      const fetchFn = () => fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson').then(r => r.json());
      const d = window.NxCache ? await NxCache.fetch('quakes', 300000, fetchFn) : await fetchFn();
      const features = d?.features || [];
      features.forEach(f => {
        const [lng, lat] = f.geometry.coordinates;
        const mag = f.properties.mag;
        const m = L.circleMarker([lat, lng], {
          radius: Math.max(3, mag * 2), color: '#ff8c00', fillColor: '#ff8c00',
          fillOpacity: .3, weight: 1
        }).bindPopup(`<b>M${mag} Earthquake</b><br>${f.properties.place}`);
        m.addTo(this.map);
        this.markers.quakes.push(m);
      });
    } catch (e) { /* silent */ }
  }
};

if (typeof window !== 'undefined') window.MapEngine = MapEngine;
