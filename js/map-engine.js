/* ═══════════════════════════════════════════════════════════
   NEXXORE TERMINAL v5 — GLOBAL INTELLIGENCE MAP ENGINE
   Full-spectrum geopolitical & trade intelligence platform
   20 layers: conflicts, shipping, chokepoints, sanctions, energy,
   weather, oilFlows, quakes, military, tradeCorridors, lngTerminals,
   grainRoutes, semiconductors, rareEarths, pipelines, submarineCables,
   disputedZones, ftaZones, nuclearFacilities, navalFleets
   ═══════════════════════════════════════════════════════════ */

const MapEngine = {
  map: null,
  layersLoaded: {},
  markers: {
    conflicts: [], quakes: [], shipping: [], chokepoints: [], weather: [],
    sanctions: [], energy: [], oilFlows: [],
    military: [], tradeCorridors: [], lngTerminals: [], grainRoutes: [],
    semiconductors: [], rareEarths: [], pipelines: [], submarineCables: [],
    disputedZones: [], ftaZones: [], nuclearFacilities: [], navalFleets: []
  },
  layerVisible: {
    conflicts: true, quakes: true, shipping: true, chokepoints: true, weather: true,
    sanctions: true, energy: true, oilFlows: false,
    military: false, tradeCorridors: false, lngTerminals: false, grainRoutes: false,
    semiconductors: false, rareEarths: false, pipelines: false, submarineCables: false,
    disputedZones: false, ftaZones: false, nuclearFacilities: false, navalFleets: false
  },

  init(containerId) {
    this.map = L.map(containerId, {
      center: [20, 30], zoom: 2, zoomControl: false, scrollWheelZoom: true,
      attributionControl: false, minZoom: 1, maxZoom: 8,
      preferCanvas: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      updateWhenIdle: true, updateWhenZooming: false
    }).addTo(this.map);
    this.loadLayer('conflicts');
    this.loadLayer('chokepoints');
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
    const fn = '_add' + name.charAt(0).toUpperCase() + name.slice(1);
    if (typeof this[fn] === 'function') this[fn]();
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
      quakes: this.markers.quakes.length,
      military: this.markers.military.length,
      corridors: this.markers.tradeCorridors.filter(m => m instanceof L.Polyline).length,
      pipelines: this.markers.pipelines.filter(m => m instanceof L.Polyline).length,
      cables: this.markers.submarineCables.filter(m => m instanceof L.Polyline).length,
      naval: this.markers.navalFleets.length,
      lngTerminals: this.markers.lngTerminals.length,
      semiconductors: this.markers.semiconductors.length,
      rareEarths: this.markers.rareEarths.length,
      nuclear: this.markers.nuclearFacilities.length,
      disputed: this.markers.disputedZones.length,
      fta: this.markers.ftaZones.length,
      grain: this.markers.grainRoutes.filter(m => m instanceof L.Polyline).length,
    };
  },

  _route(pts, opts, popup, store) {
    const line = L.polyline(pts, opts).bindPopup(popup);
    line.addTo(this.map); store.push(line);
    if (pts.length > 2 && opts._emoji) {
      const mid = pts[Math.floor(pts.length / 2)];
      const icon = L.divIcon({ className: '', html: '<div style="font-size:10px;filter:drop-shadow(0 0 4px '+opts.color+')">'+opts._emoji+'</div>', iconSize: [14,14], iconAnchor: [7,7] });
      const m = L.marker(mid, { icon }).bindPopup(popup);
      m.addTo(this.map); store.push(m);
    }
  },

  _dot(lat, lng, color, size, popup, store, glow) {
    const icon = L.divIcon({
      className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
      html: '<div style="width:'+size+'px;height:'+size+'px;background:'+color+';border-radius:50%;box-shadow:0 0 '+(glow||6)+'px '+color+';opacity:.85"></div>'
    });
    const m = L.marker([lat, lng], { icon }).bindPopup(popup);
    m.addTo(this.map); store.push(m);
    return m;
  },

  _addConflicts() {
    var zones = [
      { lat:48.5, lng:35.5, name:'Ukraine-Russia War', esc:88, detail:'Active frontline — Energy & grain disruption. Oil up, sanctions boost crypto adoption', impact:'HIGH', radius:180000, trend:'up' },
      { lat:31.4, lng:34.4, name:'Gaza Conflict', esc:82, detail:'Red Sea rerouted. Houthi attacks. +15 days transit via Cape', impact:'HIGH', radius:120000, trend:'r' },
      { lat:23.0, lng:57.0, name:'Yemen / Houthi', esc:78, detail:'Red Sea & Gulf of Aden attacks. Insurance 10x. Oil price driver', impact:'HIGH', radius:120000, trend:'up' },
      { lat:15.5, lng:32.5, name:'Sudan Civil War', esc:65, detail:'2nd largest displacement. Gold mining disruption', impact:'MED', radius:150000, trend:'r' },
      { lat:19.8, lng:96.2, name:'Myanmar Military', esc:45, detail:'Civil unrest, jade & gem trade disruption', impact:'LOW', radius:100000, trend:'dn' },
      { lat:23.5, lng:120.5, name:'Taiwan Strait', esc:72, detail:'50% container ships transit. Escalation = supply chain collapse', impact:'HIGH', radius:150000, trend:'up' },
      { lat:38.5, lng:128.0, name:'Korean Peninsula', esc:55, detail:'DPRK missile tests. Regional risk premium', impact:'MED', radius:80000, trend:'r' },
      { lat:33.3, lng:44.3, name:'Iraq Militia', esc:60, detail:'Iran-backed militia attacks. Oil infrastructure risk', impact:'MED', radius:100000, trend:'up' },
      { lat:13.0, lng:122.0, name:'South China Sea', esc:68, detail:'PH-China maritime disputes. Shipping lane risk', impact:'MED', radius:200000, trend:'up' },
      { lat:9.0, lng:38.7, name:'Ethiopia Regional', esc:40, detail:'Tigray aftermath, Amhara insurgency', impact:'LOW', radius:100000, trend:'dn' },
      { lat:36.2, lng:43.1, name:'Syria Instability', esc:52, detail:'Post-conflict zones. Iran-Israel proxy theater', impact:'MED', radius:80000, trend:'r' },
      { lat:4.0, lng:72.0, name:'Indian Ocean Piracy', esc:35, detail:'Somali piracy resurgence near Indian shipping', impact:'LOW', radius:250000, trend:'up' },
    ];
    zones.forEach(function(z) {
      var circle = L.circle([z.lat, z.lng], {
        radius: z.radius, color:'rgba(255,61,90,.6)', fillColor:'rgba(255,61,90,.15)',
        fillOpacity:.3, weight:1, dashArray:'4 4'
      });
      var escColor = z.esc > 75 ? '#FF3D5A' : z.esc > 50 ? '#f0b429' : '#64748b';
      var trendSym = z.trend==='up'?'↑':z.trend==='dn'?'↓':'→';
      var icon = L.divIcon({
        className:'', iconSize:[8,8], iconAnchor:[4,4],
        html:'<div style="width:8px;height:8px;background:var(--red);border-radius:50%;box-shadow:0 0 12px var(--red),0 0 24px rgba(255,61,90,.3);animation:pulse 2s infinite"></div>'
      });
      var marker = L.marker([z.lat, z.lng], { icon: icon }).bindPopup(
        '<div style="max-width:220px"><span style="color:var(--red);font-weight:700">⚠ '+z.name+'</span><div style="display:flex;gap:4px;margin:3px 0;align-items:center"><span style="font-size:7px;color:var(--t4)">ESCALATION:</span><div style="flex:1;height:3px;background:#1a1a32;border-radius:2px;overflow:hidden"><div style="width:'+z.esc+'%;height:100%;background:'+escColor+';border-radius:2px"></div></div><span style="font-size:8px;font-weight:700;color:'+escColor+'">'+z.esc+'/100 '+trendSym+'</span></div><span style="font-size:8px;color:var(--t3)">'+z.detail+'</span><br><span style="font-size:7px;font-weight:700;color:'+(z.impact==='HIGH'?'var(--red)':'var(--amber)')+'">MARKET IMPACT: '+z.impact+'</span></div>'
      );
      circle.addTo(this.map); marker.addTo(this.map);
      this.markers.conflicts.push(circle, marker);
    }.bind(this));
  },

  _addShipping() {
    var routes = [
      { name:'Asia-Europe (Suez)', color:'#00C8FF', weight:2, opacity:.4,
        points:[[1.3,103.8],[5.5,80.2],[12.5,53],[14.5,42],[30,32.5],[31.3,32.3],[35,28],[37.5,15],[36,0],[35.9,-5.7],[51.5,1]],
        vol:'12% global trade', detail:'65% of Asia-Europe trade. Suez transit' },
      { name:'Asia-Europe (Cape)', color:'#FF8C00', weight:1.5, opacity:.3, dash:'6 4',
        points:[[1.3,103.8],[0,80],[-5,60],[-15,45],[-34,18],[-34.5,18.5],[-34,0],[-20,-10],[0,-10],[20,-15],[35,-5],[48,0],[51.5,1]],
        vol:'Suez alt +15d', detail:'Alternative when Suez disrupted. +$1M fuel/vessel' },
      { name:'Trans-Pacific', color:'#00E87A', weight:2, opacity:.4,
        points:[[22.3,114.2],[25,130],[35,150],[37,170],[35,-170],[35,-155],[34,-140],[34,-118]],
        vol:'$1.2T/yr', detail:'China-US decoupling risk' },
      { name:'Persian Gulf Oil', color:'#FF3D5A', weight:2.5, opacity:.5,
        points:[[26.2,56.3],[24,58],[22,62],[18,57],[14,50],[12.6,43.3]],
        vol:'21M bbl/day', detail:'21% global oil via Hormuz' },
      { name:'Malacca Strait', color:'#f0b429', weight:2, opacity:.5,
        points:[[1.3,103.8],[2.5,101.5],[4,100],[6,98],[8,96]],
        vol:'25% trade', detail:'60% China oil imports' },
      { name:'Panama Canal', color:'#8b5cf6', weight:2, opacity:.4,
        points:[[9,-79.5],[9.3,-79.9],[10,-80],[12,-82],[15,-85],[20,-86],[25,-82],[30,-78]],
        vol:'5% trade', detail:'Drought: 24/day (norm 36-40)' },
      { name:'North Sea / Baltic', color:'#00C8FF', weight:1.5, opacity:.3,
        points:[[51.5,1],[54,4],[56,8],[57,12],[59,18],[60,25]],
        vol:'EU energy', detail:'Russian oil sanctions rerouting' },
      { name:'Indian Ocean', color:'#ff6b9d', weight:1.5, opacity:.35,
        points:[[19,72.8],[15,68],[10,60],[8,52],[12.6,43.3]],
        vol:'India crude', detail:'85% import dependent. INR/Nifty impact' },
    ];
    var self = this;
    routes.forEach(function(r) {
      self._route(r.points, { color:r.color, weight:r.weight, opacity:r.opacity, dashArray:r.dash||'', smoothFactor:2, _emoji:'🚢' },
        '<div style="max-width:180px"><span style="color:'+r.color+';font-weight:700">🚢 '+r.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+r.vol+'</span><br><span style="font-size:8px;color:var(--t3)">'+r.detail+'</span></div>',
        self.markers.shipping);
    });
  },

  _addChokepoints() {
    var cps = [
      { lat:30, lng:32.5, name:'Suez Canal', status:'⚠ DISRUPTED', color:'var(--red)', detail:'12% global trade. Houthi attacks. Insurance +1000%' },
      { lat:26.5, lng:56.3, name:'Strait of Hormuz', status:'⚠ ELEVATED', color:'var(--amber)', detail:'21% global oil. Iran closure = oil doubles' },
      { lat:1.3, lng:103.8, name:'Malacca Strait', status:'● OPERATIONAL', color:'var(--green)', detail:'25% global trade. China lifeline' },
      { lat:9, lng:-79.5, name:'Panama Canal', status:'⚠ RESTRICTED', color:'var(--amber)', detail:'5% trade. Drought: 24/day' },
      { lat:12.6, lng:43.3, name:'Bab el-Mandeb', status:'🔴 HIGH RISK', color:'var(--red)', detail:'4.8M bbl/day. Houthi attacks' },
      { lat:-34.5, lng:18.5, name:'Cape of Good Hope', status:'● HEAVY TRAFFIC', color:'var(--amber)', detail:'Suez alt. +15 days. 2x traffic' },
      { lat:61, lng:28, name:'Danish Straits', status:'⚠ MONITORING', color:'var(--amber)', detail:'Russian shadow fleet transits' },
      { lat:41.2, lng:29, name:'Turkish Straits', status:'● OPERATIONAL', color:'var(--green)', detail:'Black Sea grain/oil' },
    ];
    var self = this;
    cps.forEach(function(cp) {
      var icon = L.divIcon({
        className:'', iconSize:[14,14], iconAnchor:[7,7],
        html:'<div style="width:14px;height:14px;border:2px solid '+cp.color+';border-radius:50%;background:rgba(6,6,16,.8);display:flex;align-items:center;justify-content:center;font-size:7px;box-shadow:0 0 8px '+cp.color+'">⚓</div>'
      });
      var m = L.marker([cp.lat, cp.lng], { icon: icon }).bindPopup(
        '<div style="max-width:200px"><span style="color:'+cp.color+';font-weight:700">⚓ '+cp.name+'</span><br><span style="font-size:8px;color:var(--t3)">'+cp.detail+'</span><br><span style="font-size:7px;font-weight:700;color:'+cp.color+'">'+cp.status+'</span></div>'
      );
      m.addTo(self.map); self.markers.chokepoints.push(m);
    });
  },

  _addSanctions() {
    var zones = [
      { lat:55.7, lng:37.6, name:'Russia', detail:'SWIFT disconnect, oil cap $60. Shadow fleet via India. Crypto for evasion', severity:'FULL' },
      { lat:35.7, lng:51.4, name:'Iran', detail:'Oil embargo, SWIFT off. Dark fleet to China. Enrichment sanctions', severity:'FULL' },
      { lat:39, lng:125.7, name:'North Korea', detail:'Full embargo. $1.7B crypto stolen (Lazarus). Missile program funding', severity:'FULL' },
      { lat:22.5, lng:114.1, name:'China (Tech)', detail:'Chip controls (ASML, Nvidia). De-dollarization push. CBDC rollout', severity:'SECTORAL' },
      { lat:23.7, lng:53.8, name:'UAE (Monitor)', detail:'Russian money flows. Dubai crypto hub. AML enforcement', severity:'WATCH' },
      { lat:23.8, lng:90.4, name:'Myanmar (Junta)', detail:'Military sanctions. Jade/ruby trade. Banking restrictions', severity:'PARTIAL' },
      { lat:15.5, lng:44, name:'Yemen (Houthis)', detail:'Designated terror org. Arms embargo. Maritime interdiction', severity:'PARTIAL' },
      { lat:-4.3, lng:15.3, name:'Congo (Minerals)', detail:'Conflict minerals. EU Due Diligence. Cobalt/Coltan', severity:'WATCH' },
    ];
    var self = this;
    zones.forEach(function(z) {
      var icon = L.divIcon({
        className:'', iconSize:[10,10], iconAnchor:[5,5],
        html:'<div style="width:10px;height:10px;background:rgba(139,92,246,.4);border:1.5px solid var(--violet);border-radius:2px;box-shadow:0 0 6px var(--violet)"></div>'
      });
      var m = L.marker([z.lat, z.lng], { icon: icon }).bindPopup(
        '<div style="max-width:200px"><span style="color:var(--violet);font-weight:700">🚫 '+z.name+'</span><br><span style="font-size:7px;color:'+(z.severity==='FULL'?'var(--red)':z.severity==='SECTORAL'?'var(--violet)':'var(--t3)')+';font-weight:600">SEVERITY: '+z.severity+'</span><br><span style="font-size:8px;color:var(--t3)">'+z.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.sanctions.push(m);
    });
  },

  _addEnergy() {
    var hubs = [
      { lat:26.3, lng:50.2, name:'Saudi (Ghawar)', detail:'5M bbl/day. OPEC+ swing producer' },
      { lat:29.3, lng:48, name:'Kuwait/Iraq Oil', detail:'4M bbl/day. Basra terminal' },
      { lat:25.3, lng:51.5, name:'Qatar LNG', detail:'Largest LNG exporter. North Field expansion' },
      { lat:61.5, lng:73.3, name:'W. Siberia Oil', detail:'Russia main. Sanctions rerouting via India' },
      { lat:29.7, lng:-95.3, name:'Houston', detail:'US shale. WTI benchmark. Permian Basin' },
      { lat:51.9, lng:4.5, name:'Rotterdam', detail:'EU refining. TTF gas benchmark' },
      { lat:1.3, lng:103.8, name:'Singapore', detail:'Asian bunkering & refined products hub' },
      { lat:19, lng:72.8, name:'Mumbai (Jamnagar)', detail:'World largest refinery. Russian crude imports' },
      { lat:-23.5, lng:-46.6, name:'Brazil Pre-Salt', detail:'Petrobras deepwater. 3M+ bbl/day' },
      { lat:56.1, lng:10.2, name:'North Sea', detail:'Brent benchmark. Declining production' },
    ];
    var self = this;
    hubs.forEach(function(h) {
      self._dot(h.lat, h.lng, 'var(--green)', 7,
        '<div style="max-width:180px"><span style="color:var(--green);font-weight:700">⚡ '+h.name+'</span><br><span style="font-size:8px;color:var(--t3)">'+h.detail+'</span></div>',
        self.markers.energy);
    });
  },

  _addWeather() {
    var evs = [
      { lat:26, lng:-80, name:'Atlantic Storm', detail:'Gulf oil platform shutdowns' },
      { lat:35, lng:139, name:'W. Pacific Typhoon', detail:'Japan/Taiwan shipping disruption' },
      { lat:22.5, lng:88.3, name:'Bangladesh Flooding', detail:'Garment supply. Bay shipping' },
      { lat:-8.5, lng:115.3, name:'Indonesia Volcanic', detail:'Nickel/palm oil supply' },
      { lat:36, lng:-120, name:'California Wildfires', detail:'Power grid. Agriculture' },
    ];
    var self = this;
    evs.forEach(function(ev) {
      self._dot(ev.lat, ev.lng, 'var(--amber)', 8,
        '<div style="max-width:180px"><b>'+ev.name+'</b><br><span style="font-size:8px;color:var(--t3)">'+ev.detail+'</span></div>',
        self.markers.weather);
    });
  },

  _addOilFlows() {
    var flows = [
      { from:[26.5,56.3], to:[22,70], name:'Hormuz → India', vol:'4.2M bbl/day', color:'#FF8C00' },
      { from:[26.5,56.3], to:[30,120], name:'Hormuz → China', vol:'3.8M bbl/day', color:'#FF8C00' },
      { from:[61.5,73.3], to:[22,78], name:'Russia → India', vol:'1.8M bbl/day', color:'#8b5cf6' },
      { from:[29.7,-95.3], to:[50,0], name:'US → Europe', vol:'2.1M bbl/day', color:'#00C8FF' },
      { from:[26.3,50.2], to:[35,139], name:'Saudi → Japan', vol:'2.5M bbl/day', color:'#00E87A' },
      { from:[6,-2], to:[30,-82], name:'W. Africa → US Gulf', vol:'1.1M bbl/day', color:'#ff6b9d' },
      { from:[-23.5,-46.6], to:[30,120], name:'Brazil → China', vol:'0.9M bbl/day', color:'#f0b429' },
    ];
    var self = this;
    flows.forEach(function(f) {
      var line = L.polyline([f.from, f.to], {
        color:f.color, weight:3, opacity:0.6, dashArray:'8 6', smoothFactor:2
      }).bindPopup('<span style="color:'+f.color+';font-weight:700">🛢 '+f.name+'</span><br><span style="font-size:8px">'+f.vol+'</span>');
      line.addTo(self.map); self.markers.oilFlows.push(line);
    });
  },

  _addMilitary() {
    var bases = [
      { lat:25.3, lng:51.6, name:'US — Al Udeid (Qatar)', type:'AIR/CENTCOM', detail:'CENTCOM forward HQ. 10K personnel. Gulf air ops', flag:'US' },
      { lat:26.2, lng:50.6, name:'US — NSA Bahrain', type:'NAVAL', detail:'5th Fleet HQ. Persian Gulf patrol', flag:'US' },
      { lat:35.4, lng:140, name:'US — Yokosuka (Japan)', type:'NAVAL', detail:'7th Fleet HQ. Carrier strike group', flag:'US' },
      { lat:36.3, lng:127, name:'US — Camp Humphreys (Korea)', type:'ARMY/AIR', detail:'Largest overseas base. 28K troops. THAAD', flag:'US' },
      { lat:49, lng:11.5, name:'US — Ramstein (Germany)', type:'AIR/NATO', detail:'EUCOM air ops. Ukraine logistics hub', flag:'US' },
      { lat:11.5, lng:43.1, name:'US — Camp Lemonnier (Djibouti)', type:'SPEC OPS', detail:'Africa ops. Red Sea/Gulf of Aden ISR', flag:'US' },
      { lat:-7.3, lng:72.4, name:'US — Diego Garcia', type:'NAVAL/AIR', detail:'Indian Ocean staging. B-2 capable', flag:'US' },
      { lat:13.5, lng:144.8, name:'US — Guam', type:'AIR/NAVAL', detail:'Pacific pivot. Bomber presence. THAAD', flag:'US' },
      { lat:18.2, lng:109.5, name:'CN — Yulin Naval (Hainan)', type:'NAVAL/SUB', detail:'SSBN base. Underground pens. SCS control', flag:'CN' },
      { lat:11.8, lng:43.1, name:'CN — Djibouti Base', type:'LOGISTICS', detail:'First overseas base. PLA Navy support', flag:'CN' },
      { lat:10.7, lng:112.8, name:'CN — Fiery Cross Reef (SCS)', type:'AIR/NAVAL', detail:'Militarized artificial island. 3km runway', flag:'CN' },
      { lat:39.1, lng:117.2, name:'CN — Tianjin Fleet HQ', type:'NAVAL', detail:'N. Sea Fleet. Yellow Sea defense', flag:'CN' },
      { lat:24.5, lng:118.1, name:'CN — Fujian (Taiwan-facing)', type:'MISSILE/AIR', detail:'PLA rocket force. Taiwan contingency', flag:'CN' },
      { lat:34.8, lng:32.5, name:'RU — Tartus (Syria)', type:'NAVAL', detail:'Mediterranean naval base. Power projection', flag:'RU' },
      { lat:44.6, lng:33.5, name:'RU — Sevastopol (Crimea)', type:'NAVAL', detail:'Black Sea Fleet HQ. Under attack', flag:'RU' },
      { lat:69, lng:33.1, name:'RU — Severomorsk', type:'NAVAL/SUB', detail:'Northern Fleet. SSBN. Arctic patrol', flag:'RU' },
      { lat:53, lng:158.6, name:'RU — Petropavlovsk', type:'NAVAL/SUB', detail:'Pacific SSBN base. Borei-class', flag:'RU' },
      { lat:8.3, lng:73, name:'IN — INS Jatayu (Minicoy)', type:'NAVAL', detail:'Indian Ocean surveillance. Lakshadweep', flag:'IN' },
      { lat:11.7, lng:92.7, name:'IN — Port Blair (A&N)', type:'TRI-SERVICE', detail:'Andaman & Nicobar Command. Malacca watch', flag:'IN' },
      { lat:17.7, lng:83.3, name:'IN — Visakhapatnam', type:'NAVAL/SUB', detail:'Eastern Naval Command. SSBN base', flag:'IN' },
      { lat:36.1, lng:-5.4, name:'UK — Gibraltar', type:'NAVAL', detail:'Mediterranean chokepoint. NATO', flag:'UK' },
      { lat:35.1, lng:33.9, name:'UK — Akrotiri (Cyprus)', type:'AIR/ISR', detail:'Eastern Med ISR. SIGINT', flag:'UK' },
      { lat:11.6, lng:43, name:'FR — Djibouti', type:'ARMY/AIR', detail:'French Africa force HQ. 1500 personnel', flag:'FR' },
    ];
    var self = this;
    bases.forEach(function(b) {
      var tc = b.flag==='US'?'#3b82f6':b.flag==='CN'?'#ef4444':b.flag==='RU'?'#f97316':b.flag==='IN'?'#22c55e':'#a78bfa';
      var icon = L.divIcon({
        className:'', iconSize:[12,12], iconAnchor:[6,6],
        html:'<div style="width:12px;height:12px;border:1.5px solid '+tc+';background:rgba(6,6,16,.85);border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:6px;color:'+tc+';box-shadow:0 0 6px '+tc+';font-weight:700">★</div>'
      });
      var m = L.marker([b.lat, b.lng], { icon: icon }).bindPopup(
        '<div style="max-width:220px"><span style="color:'+tc+';font-weight:700">'+b.name+'</span><br><span style="font-size:7px;color:var(--cyan);font-weight:600">'+b.type+'</span><br><span style="font-size:8px;color:var(--t3)">'+b.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.military.push(m);
    });
  },

  _addTradeCorridors() {
    var corridors = [
      { name:'Belt & Road — Maritime Silk Road', color:'#ef4444', weight:2.5, opacity:.45,
        points:[[31.2,121.5],[22.3,114.2],[1.3,103.8],[6,80],[10,60],[12.6,43.3],[30,32.5],[37,15],[43.8,7.7]],
        detail:'$1T+ investment. 150+ countries. China global trade network', vol:'40% global trade', emoji:'🇨🇳' },
      { name:'Belt & Road — Land Bridge', color:'#ef4444', weight:2, opacity:.35, dash:'6 4',
        points:[[39.9,116.4],[47,86],[41.3,69.3],[41,44.8],[41.7,44.8],[41,29],[48.1,11.6],[52.5,13.4]],
        detail:'China-Europe rail freight. 15 days vs 45 sea. Kazakhstan corridor', vol:'$750B/yr', emoji:'🚂' },
      { name:'IMEC (India-Middle East-Europe)', color:'#22c55e', weight:2.5, opacity:.5,
        points:[[19,72.8],[25,56],[26.5,50],[30,35],[32,34.8],[31.3,32.3],[37,15],[38.7,-9.1]],
        detail:'US/India/EU counter to BRI. Rail + sea + data. Saudi-Israel normalization driver', vol:'$6T trade zone', emoji:'🇮🇳' },
      { name:'CPEC (China-Pakistan)', color:'#f97316', weight:2, opacity:.4,
        points:[[39.5,76],[36.2,74],[35.9,72],[33.7,73],[30.4,66.9],[25,66.9]],
        detail:'$62B investment. Gwadar port. Strategic access to Arabian Sea', vol:'$62B corridor', emoji:'🛤' },
      { name:'INSTC (India-Russia via Iran)', color:'#8b5cf6', weight:1.8, opacity:.35, dash:'4 4',
        points:[[19,72.8],[22,60],[28,53],[35.7,51.4],[40,50],[42,47],[55.7,37.6]],
        detail:'North-South Transport Corridor. India-Iran-Russia. Sanctions bypass', vol:'$170B target', emoji:'🚂' },
      { name:'Trans-African Highway', color:'#f0b429', weight:1.5, opacity:.3, dash:'6 4',
        points:[[36.8,10.2],[9,38.7],[0,32.6],[-1.3,36.8],[-6.8,39.3],[-15.4,28.3],[-25.7,28.2],[-33.9,18.4]],
        detail:'Cairo-Cape Town. AfCFTA integration. Resource extraction corridors', vol:'$3.4T AfCFTA', emoji:'🌍' },
      { name:'Arctic Northern Sea Route', color:'#00C8FF', weight:1.8, opacity:.35, dash:'4 6',
        points:[[70,30],[72,50],[73,80],[72,110],[70,140],[68,170],[65,-170],[60,-160]],
        detail:'Russia-controlled. 40% shorter Asia-Europe. Climate-enabled. LNG carriers', vol:'35M tons/yr', emoji:'❄️' },
    ];
    var self = this;
    corridors.forEach(function(c) {
      self._route(c.points, { color:c.color, weight:c.weight, opacity:c.opacity, dashArray:c.dash||'', smoothFactor:2, _emoji:c.emoji },
        '<div style="max-width:220px"><span style="color:'+c.color+';font-weight:700">🛤 '+c.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+c.vol+'</span><br><span style="font-size:8px;color:var(--t3)">'+c.detail+'</span></div>',
        self.markers.tradeCorridors);
    });
  },

  _addLngTerminals() {
    var terminals = [
      { lat:25.4, lng:51.5, name:'Ras Laffan (Qatar)', cap:'77 MTPA', detail:'World largest LNG facility. North Field expansion to 126 MTPA', status:'EXPANDING' },
      { lat:29.8, lng:-93.3, name:'Sabine Pass (US)', cap:'30 MTPA', detail:'Cheniere Energy. US #1 LNG export terminal', status:'OPERATIONAL' },
      { lat:-19.8, lng:34.8, name:'Mozambique LNG', cap:'12.9 MTPA', detail:'TotalEnergies. Insurgency risk. Delayed', status:'UNDER THREAT' },
      { lat:-20, lng:148.2, name:'Curtis Island (AUS)', cap:'25 MTPA', detail:'QLD coal seam gas. APLNG+GLNG+QCLNG', status:'OPERATIONAL' },
      { lat:61.2, lng:72.5, name:'Yamal LNG (Russia)', cap:'17.4 MTPA', detail:'Arctic LNG. Novatek. Sanctioned but operational via NSR', status:'SANCTIONED' },
      { lat:71, lng:73, name:'Arctic LNG 2 (Russia)', cap:'19.8 MTPA', detail:'Under construction. Western sanctions. Chinese financing', status:'DELAYED' },
      { lat:35.4, lng:139.6, name:'Sodegaura (Japan)', cap:'Import Hub', detail:'Japan #1 LNG buyer. 97% energy imported', status:'IMPORTING' },
      { lat:37, lng:126.6, name:'Incheon (S. Korea)', cap:'Import Hub', detail:'#2 global LNG importer', status:'IMPORTING' },
      { lat:22.5, lng:114.1, name:'Shenzhen (China)', cap:'Import Hub', detail:'Rapid LNG import growth. Diversifying from piped gas', status:'EXPANDING' },
      { lat:20, lng:73, name:'Hazira (India)', cap:'5 MTPA', detail:'Shell/Total JV. Gujarat LNG gateway', status:'OPERATIONAL' },
      { lat:42.7, lng:141, name:'Sakhalin LNG (Russia)', cap:'9.6 MTPA', detail:'Japan/Russia JV. Geopolitical sensitivity', status:'OPERATIONAL' },
      { lat:4.6, lng:114.3, name:'Brunei LNG', cap:'6.7 MTPA', detail:'One of oldest. Shell operated. Asia supply', status:'OPERATIONAL' },
    ];
    var self = this;
    terminals.forEach(function(t) {
      var sc = t.status==='SANCTIONED'||t.status==='UNDER THREAT'?'var(--red)':t.status==='EXPANDING'?'var(--cyan)':t.status==='DELAYED'?'var(--amber)':'var(--green)';
      var icon = L.divIcon({
        className:'', iconSize:[10,10], iconAnchor:[5,5],
        html:'<div style="width:10px;height:10px;border:1.5px solid '+sc+';border-radius:50%;background:rgba(6,6,16,.85);display:flex;align-items:center;justify-content:center;font-size:6px;box-shadow:0 0 5px '+sc+'">L</div>'
      });
      var m = L.marker([t.lat, t.lng], { icon: icon }).bindPopup(
        '<div style="max-width:200px"><span style="color:'+sc+';font-weight:700">🔥 '+t.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+t.cap+'</span><br><span style="font-size:7px;font-weight:600;color:'+sc+'">'+t.status+'</span><br><span style="font-size:8px;color:var(--t3)">'+t.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.lngTerminals.push(m);
    });
  },

  _addGrainRoutes() {
    var routes = [
      { name:'Black Sea Grain (Ukraine)', color:'#f0b429', weight:2, opacity:.45,
        points:[[46.5,31.5],[43.5,30],[41.2,29],[37,27],[36.5,22],[37.5,15]],
        detail:'10% global wheat. War-disrupted. Price shock driver', vol:'50MT/yr at risk' },
      { name:'US Gulf → Global', color:'#3b82f6', weight:2, opacity:.4,
        points:[[29.9,-90],[26,-85],[20,-80],[15,-60],[5,-30],[0,-10],[36,-5]],
        detail:'US #1 grain exporter. Mississippi River logistics', vol:'80MT/yr corn+soy' },
      { name:'Argentina → Asia', color:'#22c55e', weight:1.8, opacity:.35,
        points:[[-34.6,-58.4],[-38,-55],[-40,-40],[-35,0],[-20,40],[-10,70],[1.3,103.8],[22.3,114.2]],
        detail:'Soybean & corn. Parana River drought risk', vol:'35MT/yr soy' },
      { name:'Australia → Asia', color:'#8b5cf6', weight:1.8, opacity:.35,
        points:[[-34,151],[-25,140],[-15,130],[-8,115],[1.3,103.8],[22.3,114.2]],
        detail:'Wheat & barley to China/SE Asia. Drought cycles', vol:'25MT/yr wheat' },
      { name:'Brazil → China', color:'#00E87A', weight:1.8, opacity:.4,
        points:[[-23.5,-46.6],[-30,-40],[-25,-20],[-15,10],[-5,40],[5,65],[1.3,103.8],[22.3,114.2]],
        detail:'World largest soy exporter. Amazon deforestation link', vol:'100MT/yr soy' },
      { name:'India Grain Exports', color:'#f97316', weight:1.5, opacity:.3,
        points:[[19,72.8],[15,60],[10,50],[12.6,43.3],[14,42]],
        detail:'Wheat/rice ban risk. Food security vs trade. G20 pressure', vol:'Variable (bans)' },
    ];
    var self = this;
    routes.forEach(function(r) {
      self._route(r.points, { color:r.color, weight:r.weight, opacity:r.opacity, smoothFactor:2, _emoji:'🌾' },
        '<div style="max-width:200px"><span style="color:'+r.color+';font-weight:700">🌾 '+r.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+r.vol+'</span><br><span style="font-size:8px;color:var(--t3)">'+r.detail+'</span></div>',
        self.markers.grainRoutes);
    });
  },

  _addSemiconductors() {
    var nodes = [
      { lat:24.8, lng:121, name:'TSMC (Taiwan)', detail:'60% global foundry. 3nm/5nm monopoly. #1 geopolitical risk to tech', role:'FABRICATION', risk:'EXTREME' },
      { lat:37.4, lng:127, name:'Samsung Foundry (Korea)', detail:'2nd largest. NAND/DRAM dominant. HBM for AI', role:'FABRICATION', risk:'HIGH' },
      { lat:52.2, lng:5.5, name:'ASML (Netherlands)', detail:'ONLY EUV lithography maker. $380M/machine. China export ban', role:'EQUIPMENT', risk:'CRITICAL' },
      { lat:37.4, lng:-121.9, name:'Nvidia/AMD/Intel (US)', detail:'GPU design. AI chip dominance. China export controls', role:'DESIGN', risk:'MED' },
      { lat:33.4, lng:-112, name:'TSMC Arizona (US)', detail:'$40B fab. US CHIPS Act. Operational 2025+', role:'NEW FAB', risk:'LOW' },
      { lat:35.7, lng:139.7, name:'Tokyo Electron (Japan)', detail:'#2 chip equipment. Deposition/etch tools', role:'EQUIPMENT', risk:'MED' },
      { lat:23, lng:120.2, name:'ASE Group (Taiwan)', detail:'Largest chip packaging. Advanced packaging for AI', role:'PACKAGING', risk:'HIGH' },
      { lat:52.7, lng:13.3, name:'Intel Magdeburg (Germany)', detail:'EUR30B megafab. EU Chips Act. 2027 target', role:'NEW FAB', risk:'LOW' },
      { lat:22.3, lng:114.2, name:'SMIC (China)', detail:'China largest. 7nm achieved. Under US sanctions', role:'FABRICATION', risk:'SANCTIONED' },
      { lat:12.9, lng:77.6, name:'India Semiconductor (Bangalore)', detail:'Tata + Micron fabs. $10B+ investment. 2026+', role:'NEW FAB', risk:'LOW' },
    ];
    var self = this;
    nodes.forEach(function(n) {
      var rc = n.risk==='EXTREME'?'#FF3D5A':n.risk==='CRITICAL'?'#ef4444':n.risk==='HIGH'?'#f0b429':n.risk==='SANCTIONED'?'#8b5cf6':'#22c55e';
      var icon = L.divIcon({
        className:'', iconSize:[12,12], iconAnchor:[6,6],
        html:'<div style="width:12px;height:12px;border:1.5px solid '+rc+';border-radius:2px;background:rgba(6,6,16,.85);display:flex;align-items:center;justify-content:center;font-size:7px;color:'+rc+';box-shadow:0 0 6px '+rc+';font-weight:700">⬡</div>'
      });
      var m = L.marker([n.lat, n.lng], { icon: icon }).bindPopup(
        '<div style="max-width:220px"><span style="color:'+rc+';font-weight:700">🔬 '+n.name+'</span><br><span style="font-size:7px;color:var(--cyan);font-weight:600">'+n.role+'</span> · <span style="font-size:7px;color:'+rc+';font-weight:600">RISK: '+n.risk+'</span><br><span style="font-size:8px;color:var(--t3)">'+n.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.semiconductors.push(m);
    });
  },

  _addRareEarths() {
    var sites = [
      { lat:40.5, lng:110, name:'Bayan Obo (China)', detail:'60% global rare earth mining. Neodymium, cerium, lanthanum', role:'MINE', share:'60%' },
      { lat:23, lng:113, name:'Jiangxi (China)', detail:'Ion-adsorption clay. Heavy rare earths. Dysprosium monopoly', role:'PROCESSING', share:'90% processing' },
      { lat:-29.2, lng:19, name:'Steenkampskraal (S. Africa)', detail:'Monazite ore. Western diversification effort', role:'MINE', share:'<1%' },
      { lat:-33.8, lng:121.9, name:'Mt Weld (Australia)', detail:'Lynas Corp. Largest non-China REE mine', role:'MINE', share:'7%' },
      { lat:62, lng:-46, name:'Kvanefjeld (Greenland)', detail:'Massive deposit. Political controversy. Denmark/China tensions', role:'PROSPECT', share:'Undeveloped' },
      { lat:35, lng:-115, name:'Mountain Pass (US)', detail:'MP Materials. Only US rare earth mine. Processing in China', role:'MINE', share:'15% raw' },
      { lat:-4.3, lng:15.3, name:'Congo (Cobalt)', detail:'70% global cobalt. Conflict minerals. EV battery critical', role:'MINE', share:'70% cobalt' },
      { lat:-8.5, lng:25.5, name:'DRC Copper Belt', detail:'Copper + cobalt. Artisanal mining. Human rights concerns', role:'MINE', share:'Critical' },
      { lat:37, lng:127, name:'Korea Battery Hub', detail:'LG, Samsung SDI, SK. Cathode/anode processing', role:'PROCESSING', share:'Battery leader' },
      { lat:-21, lng:-44, name:'Brazil Niobium', detail:'90%+ global niobium. CBMM. Steel alloys critical', role:'MINE', share:'92% niobium' },
    ];
    var self = this;
    sites.forEach(function(s) {
      var rc = s.role==='MINE'?'var(--gold)':s.role==='PROCESSING'?'var(--orange)':'var(--t3)';
      var icon = L.divIcon({
        className:'', iconSize:[9,9], iconAnchor:[4.5,4.5],
        html:'<div style="width:9px;height:9px;background:'+rc+';clip-path:polygon(50% 0,100% 100%,0 100%);box-shadow:0 0 5px '+rc+';opacity:.85"></div>'
      });
      var m = L.marker([s.lat, s.lng], { icon: icon }).bindPopup(
        '<div style="max-width:210px"><span style="color:'+rc+';font-weight:700">⛏ '+s.name+'</span><br><span style="font-size:7px;color:var(--cyan);font-weight:600">'+s.role+'</span> · <span style="font-size:7px;color:var(--amber)">'+s.share+'</span><br><span style="font-size:8px;color:var(--t3)">'+s.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.rareEarths.push(m);
    });
  },

  _addPipelines() {
    var pipes = [
      { name:'Nord Stream (Sabotaged)', color:'#ef4444', weight:2, opacity:.5, dash:'4 4',
        points:[[60,30],[58,20],[55.5,12],[54.5,13.4]],
        detail:'Russia to Germany gas. Blown up Sep 2022. EU energy crisis catalyst', status:'DESTROYED', vol:'55 bcm/yr' },
      { name:'TurkStream', color:'#f97316', weight:2, opacity:.45,
        points:[[44.5,37],[43,31.5],[42,29],[41,28]],
        detail:'Russia to Turkey to EU gas. Alternative to Ukraine transit', status:'OPERATIONAL', vol:'31.5 bcm/yr' },
      { name:'Druzhba (Friendship) Oil', color:'#8b5cf6', weight:1.8, opacity:.35,
        points:[[54,48],[52,40],[51,36],[50,30],[52,21],[52,14.5]],
        detail:'Russia to EU oil. Largest oil pipeline network. Partially sanctioned', status:'PARTIAL', vol:'1.2M bbl/day' },
      { name:'TAPI Pipeline', color:'#22c55e', weight:1.5, opacity:.3, dash:'6 4',
        points:[[36,62],[35,64],[33.5,66],[30.5,67],[27,68],[25.5,68.3]],
        detail:'Turkmenistan-Afghanistan-Pakistan-India. Stalled. Taliban risk', status:'STALLED', vol:'33 bcm/yr planned' },
      { name:'East-West Pipeline (India)', color:'#3b82f6', weight:1.5, opacity:.4,
        points:[[21,73],[22,78],[23,83],[22,88]],
        detail:'Reliance KG Basin. Domestic gas supply. Energy security', status:'OPERATIONAL', vol:'Domestic' },
      { name:'Trans-Anatolian (TANAP)', color:'#00C8FF', weight:1.8, opacity:.4,
        points:[[40,50],[40,44],[39,40],[39.5,32],[40,27]],
        detail:'Azerbaijan to Turkey to EU. Caspian gas. Russia alternative', status:'OPERATIONAL', vol:'16 bcm/yr' },
      { name:'Power of Siberia (China)', color:'#ef4444', weight:2, opacity:.4,
        points:[[56,120],[52,128],[48,130],[45,132],[43,130],[40,122]],
        detail:'Russia to China gas. 38 bcm/yr. Geopolitical pivot to Asia', status:'OPERATIONAL', vol:'38 bcm/yr' },
      { name:'East Africa Crude Pipeline', color:'#f0b429', weight:1.5, opacity:.3, dash:'4 4',
        points:[[1.5,30.5],[0,32],[-2,34],[-5,36],[-6,39.2]],
        detail:'Uganda to Tanzania. TotalEnergies. Environmental controversy', status:'CONSTRUCTION', vol:'216K bbl/day' },
    ];
    var self = this;
    pipes.forEach(function(p) {
      var sc = p.status==='DESTROYED'?'var(--red)':p.status==='STALLED'?'var(--amber)':p.status==='OPERATIONAL'?'var(--green)':'var(--cyan)';
      var line = L.polyline(p.points, {
        color:p.color, weight:p.weight, opacity:p.opacity, dashArray:p.dash||'', smoothFactor:2
      }).bindPopup(
        '<div style="max-width:210px"><span style="color:'+p.color+';font-weight:700">🔵 '+p.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+p.vol+'</span> · <span style="font-size:7px;color:'+sc+';font-weight:600">'+p.status+'</span><br><span style="font-size:8px;color:var(--t3)">'+p.detail+'</span></div>'
      );
      line.addTo(self.map); self.markers.pipelines.push(line);
    });
  },

  _addSubmarineCables() {
    var cables = [
      { name:'SEA-ME-WE 6', color:'#00C8FF', weight:1.5, opacity:.35,
        points:[[1.3,103.8],[6,80],[12.6,43.3],[30,32.5],[36.8,10.2],[37,-9.1],[50.8,-1.1]],
        detail:'21,000km. SE Asia to Middle East to W Europe. Google-backed. $600M', cap:'100+ Tbps' },
      { name:'PEACE Cable (China)', color:'#ef4444', weight:1.5, opacity:.3,
        points:[[31.2,121.5],[22.3,114.2],[1.3,103.8],[5,73],[12.6,43.3],[30,32.5],[36.5,3]],
        detail:'Pakistan & East Africa Connecting Europe. China digital BRI', cap:'96 Tbps' },
      { name:'MAREA (US-Spain)', color:'#3b82f6', weight:2, opacity:.4,
        points:[[39,-74],[38,-40],[37,-9.1]],
        detail:'Microsoft/Facebook. 6,600km. Highest capacity trans-Atlantic', cap:'200+ Tbps' },
      { name:'Equiano (Google)', color:'#22c55e', weight:1.5, opacity:.35,
        points:[[50.8,-1.1],[38,-9.1],[15,-17],[6,-2],[-6,12],[-22,14],[-33.9,18.4]],
        detail:'Europe to West Africa to South Africa. 12,000km. Digital Africa', cap:'144 Tbps' },
      { name:'JUPITER (Trans-Pacific)', color:'#8b5cf6', weight:1.5, opacity:.35,
        points:[[34,-118],[34,-140],[35,-160],[35,175],[35,155],[35,140]],
        detail:'US-Japan-Philippines. Amazon/Meta/Google. Critical Pacific link', cap:'350+ Tbps' },
      { name:'India-Europe Xpress (IEX)', color:'#f97316', weight:1.5, opacity:.3,
        points:[[19,72.8],[15,60],[12.6,43.3],[30,32.5],[36.5,3],[50.8,-1.1]],
        detail:'Reliance Jio route. India to Middle East to Europe. Avoiding Red Sea risk', cap:'100+ Tbps' },
      { name:'Arctic Connect', color:'#00C8FF', weight:1.2, opacity:.25, dash:'4 4',
        points:[[60,25],[67,30],[70,50],[72,80],[72,120],[70,150],[62,170],[58,-170],[55,-160]],
        detail:'Finland to Japan via Arctic. Cinia/Far North Digital. Shortest Asia-Europe digital route', cap:'Planned 200 Tbps' },
    ];
    var self = this;
    cables.forEach(function(c) {
      var line = L.polyline(c.points, {
        color:c.color, weight:c.weight, opacity:c.opacity, dashArray:c.dash||'', smoothFactor:2
      }).bindPopup(
        '<div style="max-width:200px"><span style="color:'+c.color+';font-weight:700">🔌 '+c.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+c.cap+'</span><br><span style="font-size:8px;color:var(--t3)">'+c.detail+'</span></div>'
      );
      line.addTo(self.map); self.markers.submarineCables.push(line);
    });
  },

  _addDisputedZones() {
    var zones = [
      { lat:12, lng:114, name:'South China Sea (Nine-Dash Line)', radius:600000, detail:'$5.3T trade transit. China vs PH/VN/MY/TW. Artificial islands. Oil/gas reserves', border:'#ef4444' },
      { lat:30, lng:125, name:'East China Sea (Senkaku/Diaoyu)', radius:200000, detail:'Japan vs China. Oil/gas. ADIZ overlap. US alliance trigger', border:'#f0b429' },
      { lat:80, lng:0, name:'Arctic Claims', radius:800000, detail:'Russia/Canada/Norway/US/Denmark. Oil/gas/minerals. Northern Sea Route', border:'#00C8FF' },
      { lat:32.5, lng:48, name:'Shatt al-Arab (Iran-Iraq)', radius:100000, detail:'Waterway dispute. Oil terminal access. Historical trigger', border:'#8b5cf6' },
      { lat:25, lng:68.5, name:'Sir Creek (India-Pakistan)', radius:80000, detail:'Gujarat-Sindh maritime border. Fishing + hydrocarbon rights', border:'#22c55e' },
      { lat:-53, lng:-60, name:'Falklands/Malvinas', radius:200000, detail:'UK vs Argentina. Oil exploration. Southern Atlantic control', border:'#3b82f6' },
      { lat:28, lng:34, name:'Red Sea EEZ Disputes', radius:150000, detail:'Egypt/Saudi/Sudan maritime boundaries. Oil exploration rights', border:'#ff6b9d' },
    ];
    var self = this;
    zones.forEach(function(z) {
      var circle = L.circle([z.lat, z.lng], {
        radius:z.radius, color:z.border, fillColor:z.border,
        fillOpacity:.1, weight:1.5, dashArray:'8 4'
      }).bindPopup(
        '<div style="max-width:210px"><span style="color:'+z.border+';font-weight:700">⚔ '+z.name+'</span><br><span style="font-size:8px;color:var(--t3)">'+z.detail+'</span></div>'
      );
      circle.addTo(self.map); self.markers.disputedZones.push(circle);
    });
  },

  _addFtaZones() {
    var zones = [
      { lat:8, lng:110, name:'RCEP', detail:'15 nations. 30% global GDP. Largest trade bloc. China-led', border:'#ef4444', gdp:'$26.2T' },
      { lat:45, lng:-100, name:'USMCA', detail:'US-Mexico-Canada. $1.4T trilateral. Nearshoring boom', border:'#3b82f6', gdp:'$29T' },
      { lat:50, lng:10, name:'EU Single Market', detail:'27 nations. Deepest integration. Regulatory superpower', border:'#22c55e', gdp:'$18.3T' },
      { lat:-5, lng:20, name:'AfCFTA', detail:'54 nations. $3.4T. Africa free trade. Intra-African trade boost', border:'#f0b429', gdp:'$3.4T' },
      { lat:-20, lng:170, name:'CPTPP', detail:'11 nations. Trans-Pacific. UK joined. China applied', border:'#8b5cf6', gdp:'$13.5T' },
      { lat:20, lng:78, name:'India Bilateral FTAs', detail:'India-UAE CEPA, India-Australia. $2T+ target. Services focus', border:'#FF8C00', gdp:'$3.7T' },
    ];
    var self = this;
    zones.forEach(function(z) {
      var circle = L.circle([z.lat, z.lng], {
        radius:2500000, color:z.border, fillColor:z.border,
        fillOpacity:.08, weight:1, dashArray:'12 4'
      }).bindPopup(
        '<div style="max-width:200px"><span style="color:'+z.border+';font-weight:700">🤝 '+z.name+'</span><br><span style="font-size:7px;color:var(--cyan)">'+z.gdp+' GDP</span><br><span style="font-size:8px;color:var(--t3)">'+z.detail+'</span></div>'
      );
      circle.addTo(self.map); self.markers.ftaZones.push(circle);
    });
  },

  _addNuclearFacilities() {
    var facilities = [
      { lat:32.7, lng:51.7, name:'Natanz (Iran)', detail:'Uranium enrichment. Underground. IAEA monitored. Stuxnet target', type:'ENRICHMENT', risk:'HIGH' },
      { lat:32.2, lng:52.5, name:'Isfahan (Iran)', detail:'Uranium conversion. Nuclear fuel processing', type:'CONVERSION', risk:'HIGH' },
      { lat:40, lng:129.1, name:'Yongbyon (N. Korea)', detail:'Plutonium production. Nuclear weapons program', type:'WEAPONS', risk:'EXTREME' },
      { lat:51.4, lng:30.1, name:'Chernobyl (Ukraine)', detail:'Exclusion zone. Russian forces occupied Feb 2022', type:'DECOMMISSIONED', risk:'MED' },
      { lat:47.3, lng:34.6, name:'Zaporizhzhia (Ukraine)', detail:'Europe largest nuclear plant. Active conflict zone. IAEA alarm', type:'POWER (AT RISK)', risk:'EXTREME' },
      { lat:37, lng:127, name:'Korea Nuclear Complex', detail:'24 reactors. Major energy source. N. Korea proximity', type:'POWER', risk:'MED' },
      { lat:19.8, lng:73.3, name:'Tarapur (India)', detail:'India first nuclear plant. Safeguarded. Thorium program', type:'POWER', risk:'LOW' },
      { lat:31, lng:35.2, name:'Dimona (Israel)', detail:'Undeclared nuclear weapons program. IAEA non-member', type:'WEAPONS (ALLEGED)', risk:'HIGH' },
      { lat:25.4, lng:55.2, name:'Barakah (UAE)', detail:'First Arab nuclear plant. Korean-built. 4 APR-1400 reactors', type:'POWER', risk:'LOW' },
      { lat:51.2, lng:0.2, name:'Hinkley Point C (UK)', detail:'New European Pressurized Reactor. EDF. Major UK energy project', type:'UNDER CONSTRUCTION', risk:'LOW' },
    ];
    var self = this;
    facilities.forEach(function(f) {
      var rc = f.risk==='EXTREME'?'#FF3D5A':f.risk==='HIGH'?'#f0b429':f.risk==='MED'?'#8b5cf6':'#22c55e';
      var icon = L.divIcon({
        className:'', iconSize:[10,10], iconAnchor:[5,5],
        html:'<div style="width:10px;height:10px;background:rgba(6,6,16,.85);border:1.5px solid '+rc+';border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6px;color:'+rc+';box-shadow:0 0 8px '+rc+'">☢</div>'
      });
      var m = L.marker([f.lat, f.lng], { icon: icon }).bindPopup(
        '<div style="max-width:210px"><span style="color:'+rc+';font-weight:700">☢ '+f.name+'</span><br><span style="font-size:7px;color:var(--cyan);font-weight:600">'+f.type+'</span> · <span style="font-size:7px;color:'+rc+';font-weight:600">RISK: '+f.risk+'</span><br><span style="font-size:8px;color:var(--t3)">'+f.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.nuclearFacilities.push(m);
    });
  },

  _addNavalFleets() {
    var fleets = [
      { lat:26, lng:52, name:'US CSG-5 (Carrier Strike)', detail:'USS Abraham Lincoln. Persian Gulf patrol. Iran deterrence', type:'CARRIER', flag:'US' },
      { lat:35, lng:140, name:'US 7th Fleet Forward', detail:'USS Ronald Reagan. Indo-Pacific. Taiwan contingency', type:'CARRIER', flag:'US' },
      { lat:36, lng:15, name:'US 6th Fleet (Med)', detail:'Mediterranean presence. Libya/Syria ops. NATO', type:'AMPHIBIOUS', flag:'US' },
      { lat:18, lng:115, name:'CN Shandong CSG', detail:'China 2nd carrier. South China Sea patrol', type:'CARRIER', flag:'CN' },
      { lat:35, lng:124, name:'CN Liaoning CSG', detail:'1st carrier. Yellow/East China Sea. Taiwan facing', type:'CARRIER', flag:'CN' },
      { lat:35, lng:33, name:'RU Med Squadron', detail:'Black Sea Fleet detachment. Tartus-based. Syria support', type:'SURFACE', flag:'RU' },
      { lat:68, lng:35, name:'RU Northern Fleet', detail:'SSBN patrol. Kola Peninsula. Arctic dominance', type:'SUBMARINE', flag:'RU' },
      { lat:15, lng:68, name:'IN Western Fleet', detail:'INS Vikramaditya + Vikrant. Arabian Sea patrol', type:'CARRIER', flag:'IN' },
      { lat:10, lng:85, name:'IN Eastern Fleet', detail:'Bay of Bengal. Andaman & Nicobar forward deployed', type:'SURFACE', flag:'IN' },
      { lat:50, lng:-5, name:'UK Carrier Strike', detail:'HMS Queen Elizabeth / Prince of Wales. NATO', type:'CARRIER', flag:'UK' },
      { lat:36, lng:3, name:'FR Charles de Gaulle', detail:'French carrier. Mediterranean / Red Sea ops', type:'CARRIER', flag:'FR' },
    ];
    var self = this;
    fleets.forEach(function(f) {
      var tc = f.flag==='US'?'#3b82f6':f.flag==='CN'?'#ef4444':f.flag==='RU'?'#f97316':f.flag==='IN'?'#22c55e':'#a78bfa';
      var icon = L.divIcon({
        className:'', iconSize:[16,16], iconAnchor:[8,8],
        html:'<div style="font-size:12px;filter:drop-shadow(0 0 6px '+tc+');cursor:pointer">⚓</div>'
      });
      var m = L.marker([f.lat, f.lng], { icon: icon }).bindPopup(
        '<div style="max-width:210px"><span style="color:'+tc+';font-weight:700">'+f.name+'</span><br><span style="font-size:7px;color:var(--cyan);font-weight:600">'+f.type+'</span><br><span style="font-size:8px;color:var(--t3)">'+f.detail+'</span></div>'
      );
      m.addTo(self.map); self.markers.navalFleets.push(m);
    });
  },

  async loadQuakes() {
    try {
      var fetchFn = function() { return fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson').then(function(r) { return r.json(); }); };
      var d = window.NxCache ? await NxCache.fetch('quakes', 300000, fetchFn) : await fetchFn();
      var self = this;
      (d && d.features || []).forEach(function(f) {
        var coords = f.geometry.coordinates;
        var lng = coords[0], lat = coords[1];
        var mag = f.properties.mag;
        var m = L.circleMarker([lat, lng], {
          radius: Math.max(3, mag * 2), color:'#ff8c00', fillColor:'#ff8c00',
          fillOpacity:.3, weight:1
        }).bindPopup('<b>M'+mag+' Earthquake</b><br>'+f.properties.place);
        m.addTo(self.map); self.markers.quakes.push(m);
      });
    } catch (e) { /* silent */ }
  }
};

if (typeof window !== 'undefined') window.MapEngine = MapEngine;