const UNIT = "imperial"; // inches / °F / mph
const $ = id => document.getElementById(id);

const DEFAULT_FAVORITES = [
  { name: "Breckenridge", lat: 39.4817, lon: -106.0384 },
  { name: "Vail", lat: 39.6403, lon: -106.3742 },
  { name: "Aspen", lat: 39.1911, lon: -106.8175 },
  { name: "Telluride", lat: 37.9375, lon: -107.8123 },
  { name: "Steamboat", lat: 40.4850, lon: -106.8317 },
  { name: "Winter Park", lat: 39.8868, lon: -105.7625 },
];
const FAV_KEY = "favorites_v1";
function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAV_KEY) || "null");
    if (Array.isArray(saved)) return saved; // respects an empty list too
  } catch {}
  return DEFAULT_FAVORITES.slice();
}
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch {}
}
let favorites = loadFavorites();
let currentLoc = null;      // last location loaded (for "use searched location")
let favEditMode = false;    // chips edit mode on/off
let loadSeq = 0;            // increments per search; async loaders check it so a stale
                            // response never paints over a newer location's data

// WMO weather code -> flat icon type + label
function wmo(code, isNight) {
  const map = {
    0: ["clear","Clear"], 1: ["clear","Mostly clear"], 2: ["partly","Partly cloudy"], 3: ["cloudy","Overcast"],
    45: ["fog","Fog"], 48: ["fog","Rime fog"],
    51: ["drizzle","Light drizzle"], 53: ["drizzle","Drizzle"], 55: ["drizzle","Heavy drizzle"],
    56: ["sleet","Freezing drizzle"], 57: ["sleet","Freezing drizzle"],
    61: ["rain","Light rain"], 63: ["rain","Rain"], 65: ["rain","Heavy rain"],
    66: ["sleet","Freezing rain"], 67: ["sleet","Freezing rain"],
    71: ["snow","Light snow"], 73: ["snow","Snow"], 75: ["snow","Heavy snow"], 77: ["snow","Snow grains"],
    80: ["rain","Light showers"], 81: ["rain","Showers"], 82: ["rain","Violent showers"],
    85: ["snow","Snow showers"], 86: ["snow","Heavy snow showers"],
    95: ["thunder","Thunderstorm"], 96: ["thunder","Thunderstorm + hail"], 99: ["thunder","Severe thunderstorm"],
  };
  let [type, label] = map[code] || ["cloudy", "—"];
  if (isNight && type === "clear") type = "clear-night";
  if (isNight && type === "partly") type = "partly-night";
  return { type, label };
}

// Flat weather icons (SVG), styled to match the geometric sun. Sized to 1em via .wi.
const _svg = inner => `<svg class="wi" viewBox="0 0 24 24" fill="none" aria-hidden="true">${inner}</svg>`;
const _cloud = (fill = "#f4f9ff") => `<path d="M7.5 14a4.2 4.2 0 0 1-.5-8.37 5.6 5.6 0 0 1 10.8-1.03A3.8 3.8 0 0 1 17 14h-9.5z" fill="${fill}"/>`;
const _sunRays = (cx, cy, len, sw) => `<g stroke="#FFC93C" stroke-width="${sw}" stroke-linecap="round">
  <line x1="${cx}" y1="${cy-len-2.3}" x2="${cx}" y2="${cy-len}"/><line x1="${cx}" y1="${cy+len}" x2="${cx}" y2="${cy+len+2.3}"/>
  <line x1="${cx-len-2.3}" y1="${cy}" x2="${cx-len}" y2="${cy}"/><line x1="${cx+len}" y1="${cy}" x2="${cx+len+2.3}" y2="${cy}"/>
  <line x1="${cx-len-1.4}" y1="${cy-len-1.4}" x2="${cx-len-0.3}" y2="${cy-len-0.3}"/><line x1="${cx+len+0.3}" y1="${cy+len+0.3}" x2="${cx+len+1.4}" y2="${cy+len+1.4}"/>
  <line x1="${cx-len-1.4}" y1="${cy+len+1.4}" x2="${cx-len-0.3}" y2="${cy+len+0.3}"/><line x1="${cx+len+0.3}" y1="${cy-len-0.3}" x2="${cx+len+1.4}" y2="${cy-len-1.4}"/>
</g>`;
const ICONS = {
  clear: _svg(_sunRays(12, 12, 6.9, 2) + `<circle cx="12" cy="12" r="4.6" fill="#FFC93C"/>`),
  "clear-night": _svg(`<path d="M20 14.4A8 8 0 0 1 9.6 4 6.6 6.6 0 1 0 20 14.4z" fill="#d6e4ff"/>`),
  partly: _svg(`<g stroke="#FFC93C" stroke-width="1.6" stroke-linecap="round"><line x1="8" y1="1.7" x2="8" y2="3.2"/><line x1="1.9" y1="7.8" x2="3.4" y2="7.8"/><line x1="3.6" y1="3.4" x2="4.7" y2="4.5"/><line x1="12.4" y1="3.4" x2="11.3" y2="4.5"/></g><circle cx="8" cy="7.8" r="3" fill="#FFC93C"/>` + `<path d="M9.2 19.4a3.9 3.9 0 0 1-.5-7.78 5.3 5.3 0 0 1 10.2-1A3.6 3.6 0 0 1 18.3 19.4H9.2z" fill="#f4f9ff"/>`),
  "partly-night": _svg(`<path d="M10.6 3.6a3.4 3.4 0 1 0 3.3 5.3 4.4 4.4 0 0 1-3.3-5.3z" fill="#d6e4ff"/>` + `<path d="M9.2 19.4a3.9 3.9 0 0 1-.5-7.78 5.3 5.3 0 0 1 10.2-1A3.6 3.6 0 0 1 18.3 19.4H9.2z" fill="#f4f9ff"/>`),
  cloudy: _svg(`<path d="M7.5 18.5a4.5 4.5 0 0 1-.5-8.97 5.8 5.8 0 0 1 11.2-1.08A4 4 0 0 1 17.5 18.5h-10z" fill="#f4f9ff"/>`),
  fog: _svg(_cloud() + `<g stroke="#a9b8cb" stroke-width="2" stroke-linecap="round"><line x1="5.5" y1="17.6" x2="16" y2="17.6"/><line x1="8" y1="21" x2="18.5" y2="21"/></g>`),
  drizzle: _svg(_cloud() + `<g stroke="#6ec6ff" stroke-width="2" stroke-linecap="round"><line x1="9" y1="17.3" x2="8.4" y2="18.9"/><line x1="12.5" y1="17.3" x2="11.9" y2="18.9"/><line x1="16" y1="17.3" x2="15.4" y2="18.9"/></g>`),
  rain: _svg(_cloud() + `<g stroke="#6ec6ff" stroke-width="2" stroke-linecap="round"><line x1="8.6" y1="16.8" x2="7.4" y2="20.4"/><line x1="12.2" y1="16.8" x2="11" y2="20.4"/><line x1="15.8" y1="16.8" x2="14.6" y2="20.4"/></g>`),
  snow: _svg(_cloud() + `<g fill="#cfeaff"><circle cx="8.6" cy="18" r="1.15"/><circle cx="12.2" cy="20.2" r="1.15"/><circle cx="15.8" cy="18" r="1.15"/></g>`),
  sleet: _svg(_cloud() + `<g stroke="#6ec6ff" stroke-width="2" stroke-linecap="round"><line x1="9" y1="16.8" x2="7.9" y2="20"/><line x1="15.3" y1="16.8" x2="14.2" y2="20"/></g><circle cx="12.2" cy="19.3" r="1.15" fill="#cfeaff"/>`),
  thunder: _svg(_cloud() + `<path d="M12.6 14.3l-3.2 5.2H12l-1 3.4 4-5.7h-2.6l1.2-2.9z" fill="#FFC93C"/>`),
};
const iconSVG = type => ICONS[type] || ICONS.cloudy;

function setStatus(msg, isErr) {
  const s = $("status");
  s.className = "status" + (isErr ? " err" : "");
  s.innerHTML = msg;
  s.classList.remove("hidden");
  $("content").classList.add("hidden");
}

// ---------- search / geocoding ----------
let suggestTimer, activeIdx = -1, currentSuggestions = [];

// Parse decimal-degree input: "37.892, -107.714", "37.892 -107.714",
// "37.892N 107.714W", "37.892° N, 107.714° W", reversed lon/lat, etc.
function parseCoords(s) {
  s = String(s).trim();
  if (!/\d/.test(s)) return null; // place names have no digits in this position
  const tokens = s.replace(/°/g, " ").replace(/,/g, " ").trim().split(/\s+/);
  const nums = []; // { val, dir }
  for (const tk of tokens) {
    if (/^[NSEW]$/i.test(tk)) {                       // standalone direction letter
      if (nums.length && !nums[nums.length - 1].dir) nums[nums.length - 1].dir = tk.toUpperCase();
      else return null;
      continue;
    }
    const m = tk.match(/^(-?\d+(?:\.\d+)?)([NSEW])?$/i); // number, optional trailing dir
    if (!m) return null;
    nums.push({ val: parseFloat(m[1]), dir: m[2] ? m[2].toUpperCase() : null });
  }
  if (nums.length !== 2) return null;
  const apply = n => n.dir ? Math.abs(n.val) * (/[SW]/.test(n.dir) ? -1 : 1) : n.val;
  const [a, b] = nums;
  // If directions say first token is longitude (E/W) or second is latitude (N/S), it's reversed.
  const reversed = /[EW]/.test(a.dir || "") || /[NS]/.test(b.dir || "");
  const lat = apply(reversed ? b : a), lon = apply(reversed ? a : b);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}
const coordLoc = c => ({ name: `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`, lat: c.lat, lon: c.lon, coord: true });

$("q").addEventListener("input", e => {
  clearTimeout(suggestTimer);
  const v = e.target.value.trim();
  const c = parseCoords(v);
  if (c) { // looks like coordinates — offer a direct "go here" suggestion, skip geocoding
    currentSuggestions = [{ ...coordLoc(c), detail: "📍 go to coordinates" }];
    activeIdx = 0;
    renderSuggest();
    return;
  }
  if (v.length < 2) { hideSuggest(); return; }
  suggestTimer = setTimeout(() => fetchSuggest(v), 220);
});
$("q").addEventListener("keydown", e => {
  if ($("suggest").classList.contains("hidden")) {
    if (e.key === "Enter") doSearch();
    return;
  }
  if (e.key === "ArrowDown") { activeIdx = Math.min(activeIdx + 1, currentSuggestions.length - 1); renderSuggest(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { activeIdx = Math.max(activeIdx - 1, 0); renderSuggest(); e.preventDefault(); }
  else if (e.key === "Enter") {
    if (activeIdx >= 0 && currentSuggestions[activeIdx]) pick(currentSuggestions[activeIdx]);
    else doSearch();
  } else if (e.key === "Escape") hideSuggest();
});
$("go").addEventListener("click", doSearch);
$("geo").addEventListener("click", useMyLocation);
document.addEventListener("click", e => { if (!e.target.closest(".search")) hideSuggest(); });

// ---------- GPS / current location ----------
async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const d = await r.json();
    const name = d.locality || d.city || d.principalSubdivision || null;
    return name || null;
  } catch { return null; }
}

function useMyLocation() {
  const btn = $("geo");
  if (!navigator.geolocation) {
    setStatus("Location isn't available on this device.");
    return;
  }
  btn.classList.add("locating");
  setStatus("Getting your location…");
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    const name = await reverseGeocode(lat, lon);
    btn.classList.remove("locating");
    const loc = name
      ? { name, lat, lon }
      : coordLoc({ lat, lon });
    $("q").value = loc.name;
    loadWeather(loc);
  }, err => {
    btn.classList.remove("locating");
    setStatus(err.code === err.PERMISSION_DENIED
      ? "Location permission denied — search a place instead."
      : "Couldn't get your location — try again or search a place.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function hideSuggest() { $("suggest").classList.add("hidden"); activeIdx = -1; }

async function fetchSuggest(v) {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(v)}&count=6&language=en&format=json`);
    const d = await r.json();
    currentSuggestions = (d.results || []).map(x => ({
      name: x.name, lat: x.latitude, lon: x.longitude,
      detail: [x.admin1, x.country_code].filter(Boolean).join(", ")
    }));
    activeIdx = -1;
    renderSuggest();
  } catch { hideSuggest(); }
}

function renderSuggest() {
  const box = $("suggest");
  if (!currentSuggestions.length) { hideSuggest(); return; }
  box.innerHTML = currentSuggestions.map((s, i) =>
    `<div data-i="${i}" class="${i === activeIdx ? "active" : ""}">${s.name} <span class="small">${s.detail}</span></div>`
  ).join("");
  box.classList.remove("hidden");
  [...box.children].forEach(el => el.addEventListener("click", () => pick(currentSuggestions[+el.dataset.i])));
}

function doSearch() {
  const v = $("q").value.trim();
  if (!v) return;
  const c = parseCoords(v);
  if (c) { pick(coordLoc(c)); return; }
  if (currentSuggestions[0]) pick(currentSuggestions[0]);
  else fetchSuggest(v).then(() => currentSuggestions[0] && pick(currentSuggestions[0]));
}

function pick(loc) {
  hideSuggest();
  $("q").value = loc.name;
  loadWeather(loc);
}

// ---------- favorite chips (customizable) ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderChips() {
  const chips = favorites.map((f, i) => favEditMode
    ? `<div class="chip editing" data-edit="${i}"><span class="chip-label">${esc(f.name)}</span><button class="chip-x" data-del="${i}" title="Remove" aria-label="Remove ${esc(f.name)}">✕</button></div>`
    : `<div class="chip" data-go="${i}">${esc(f.name)}</div>`
  ).join("");
  const controls = favEditMode
    ? `<button class="chip chip-ctrl" data-act="add">＋ Add</button><button class="chip chip-ctrl done" data-act="done">Done</button>`
    : `<button class="chip chip-ctrl" data-act="edit" title="Customize favorites">✎ Edit</button>`;
  $("chips").innerHTML = chips + controls;
  $("chips").querySelectorAll("[data-go]").forEach(el =>
    el.addEventListener("click", () => { const f = favorites[+el.dataset.go]; $("q").value = f.name; loadWeather(f); }));
  $("chips").querySelectorAll("[data-edit]").forEach(el =>
    el.querySelector(".chip-label").addEventListener("click", () => openFavEditor(+el.dataset.edit)));
  $("chips").querySelectorAll("[data-del]").forEach(el =>
    el.addEventListener("click", () => deleteFavorite(+el.dataset.del)));
  $("chips").querySelectorAll("[data-act]").forEach(el =>
    el.addEventListener("click", () => {
      const a = el.dataset.act;
      if (a === "edit") { favEditMode = true; renderChips(); }
      else if (a === "done") { favEditMode = false; closeFavEditor(); renderChips(); }
      else if (a === "add") openFavEditor(null);
    }));
  renderCompare(); // keep the compare card's chips in sync with the favorites list
}

function deleteFavorite(i) {
  favorites.splice(i, 1);
  saveFavorites();
  if (favEditIndex === i) closeFavEditor();
  renderChips();
}

let favEditIndex = null; // index being edited, or null when adding
function openFavEditor(index) {
  favEditMode = true;
  favEditIndex = index;
  renderChips();
  const f = index != null ? favorites[index] : null;
  const coords = f ? `${f.lat}, ${f.lon}` : "";
  $("favEditor").innerHTML = `
    <div class="fav-field"><label>Name</label><input id="favName" type="text" placeholder="e.g. Breckenridge" value="${f ? esc(f.name) : ""}"></div>
    <div class="fav-field"><label>Coordinates (lat, lon)</label><input id="favCoords" type="text" placeholder="39.4817, -106.0384" value="${esc(coords)}"></div>
    <button class="fav-use" id="favUse" type="button">Use searched location${currentLoc ? ` (${esc(currentLoc.name)})` : ""}</button>
    <div class="fav-err" id="favErr"></div>
    <div class="fav-actions">
      <button class="fav-save" id="favSave" type="button">${index != null ? "Save" : "Add"}</button>
      <button class="fav-cancel" id="favCancel" type="button">Cancel</button>
    </div>`;
  $("favEditor").classList.remove("hidden");
  $("favUse").disabled = !currentLoc;
  $("favUse").addEventListener("click", () => {
    if (!currentLoc) return;
    $("favName").value = currentLoc.coord ? "" : currentLoc.name;
    $("favCoords").value = `${(+currentLoc.lat).toFixed(5)}, ${(+currentLoc.lon).toFixed(5)}`;
    $("favName").focus();
  });
  $("favSave").addEventListener("click", saveFavEditor);
  $("favCancel").addEventListener("click", closeFavEditor);
  $("favName").focus();
}

function saveFavEditor() {
  const name = $("favName").value.trim();
  const coords = parseCoords($("favCoords").value);
  if (!name) return showFavErr("Please enter a name.");
  if (!coords) return showFavErr("Enter valid coordinates, e.g. 39.4817, -106.0384");
  const fav = { name, lat: coords.lat, lon: coords.lon };
  if (favEditIndex != null) favorites[favEditIndex] = fav;
  else favorites.push(fav);
  saveFavorites();
  closeFavEditor();
  renderChips();
}
function showFavErr(msg) { $("favErr").textContent = msg; }
function closeFavEditor() {
  favEditIndex = null;
  $("favEditor").innerHTML = "";
  $("favEditor").classList.add("hidden");
}

// ---------- weather ----------
async function loadWeather(loc) {
  currentLoc = loc;
  const seq = ++loadSeq;
  setStatus(`<span class="spin"></span>Loading ${loc.name}…`);
  try {
    const [nws, om] = await Promise.all([fetchNWS(loc), fetchOpenMeteoSnow(loc)]);
    if (seq !== loadSeq) return; // a newer search superseded this one
    modelTotals = {};
    render(loc, nws, om);
    loadSnotel(loc);          // async, non-blocking — SNOTEL card + storm tracker
    loadSnodasPoint(loc);     // async, non-blocking — gridded snowpack at the exact point
    loadAvalanche(loc, seq);  // async, non-blocking — CAIC danger card (in season)
    loadEnsemble(loc, seq);   // async, non-blocking — snowfall uncertainty range
  } catch (e) {
    if (e.code === "NOT_US")
      setStatus(`No NWS forecast for ${loc.name}.<br><span style="font-size:0.82rem">The National Weather Service covers the United States only — try a US location.</span>`, true);
    else
      setStatus(`Couldn't load weather for ${loc.name}.<br><span style="font-size:0.82rem">${e.message}. The NWS API can be briefly flaky — try again.</span>`, true);
  }
}

// ---- NWS (api.weather.gov): forecasts, current conditions, gridpoint snowfall ----
async function fetchJSON(url, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/geo+json" }, cache: "no-store" });
      if (r.ok) return r.json();
      if (r.status === 404) { const e = new Error("outside US"); e.code = "NOT_US"; throw e; }
      last = new Error("HTTP " + r.status);
    } catch (e) { if (e.code === "NOT_US") throw e; last = e; }
    await new Promise(res => setTimeout(res, 500));
  }
  throw last;
}
// Latest live observation from the nearest station that has fresh data — this is what
// weather.gov shows as "Current Conditions" (a real measurement, not the forecast).
async function fetchObservation(stationsUrl) {
  try {
    const sd = await fetchJSON(stationsUrl);
    // NWS returns stations ordered by distance (nearest first). Always use the NEAREST
    // station that has a usable reading — deterministic, so the same place doesn't hop
    // between stations. require_qc=false returns the raw latest ob (the QC'd one can lag an hour+).
    const feats = (sd.features || []).slice(0, 5); // candidates, in distance order
    const results = await Promise.all(feats.map(async f => {
      const id = f.properties && f.properties.stationIdentifier;
      if (!id) return null;
      try {
        const o = await fetchJSON(`https://api.weather.gov/stations/${id}/observations/latest?require_qc=false`);
        const pr = o.properties;
        if (!pr || !pr.temperature || pr.temperature.value == null) return null;
        if ((Date.now() - new Date(pr.timestamp)) / 3600000 > 4) return null; // skip stale
        const c = f.geometry && f.geometry.coordinates; // [lon, lat]
        return { ...pr, stationName: f.properties.name || id, stationLat: c ? c[1] : null, stationLon: c ? c[0] : null };
      } catch { return null; }
    }));
    // first non-null in distance order = nearest station with data
    return results.find(Boolean) || null;
  } catch { /* no observations available */ }
  return null;
}
async function fetchNWS(loc) {
  const pts = await fetchJSON(`https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`);
  const p = pts.properties;
  const [fc, hr, gr, obs] = await Promise.all([
    fetchJSON(p.forecast), fetchJSON(p.forecastHourly), fetchJSON(p.forecastGridData), fetchObservation(p.observationStations),
  ]);
  return { tz: p.timeZone || "America/Denver", daily: fc.properties.periods, hourly: hr.properties.periods, grid: gr.properties, obs };
}
// Open-Meteo daily snowfall: past 7 days for the history card (NWS has no past data),
// next 7 days as an independent model cross-check against the NWS gridpoint total.
async function fetchOpenMeteoSnow(loc) {
  try {
    const params = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon, daily: "snowfall_sum",
      precipitation_unit: "inch", timezone: "auto", past_days: "7", forecast_days: "7",
    });
    const d = await (await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)).json();
    const past = [], future = [];
    d.daily.time.forEach((t, i) => {
      (i < 7 ? past : future).push({ date: t, snow: d.daily.snowfall_sum[i] || 0 });
    });
    return { past, futureTotal: future.reduce((s, x) => s + x.snow, 0) };
  } catch { return null; }
}

// GFS ensemble (31 members): 7-day snowfall total per member -> 10th–90th percentile range.
// The spread is a direct read on forecast uncertainty ("2–9 in" beats a false-precision "5 in").
async function loadEnsemble(loc, seq) {
  try {
    const u = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon, models: "gfs025",
      hourly: "snowfall", forecast_days: "7", precipitation_unit: "inch",
    });
    const d = await (await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${u}`)).json();
    const totals = [];
    for (const k in d.hourly) {
      if (!k.startsWith("snowfall")) continue;
      totals.push((d.hourly[k] || []).reduce((s, v) => s + (v || 0), 0));
    }
    if (totals.length < 5 || seq !== loadSeq) return;
    totals.sort((a, b) => a - b);
    const q = p => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))];
    modelTotals.ens = { lo: q(0.1), hi: q(0.9), n: totals.length };
    updateModelsNote();
  } catch { /* ensemble is a bonus — skip quietly */ }
}

let modelTotals = {}; // { nws, om, ens:{lo,hi,n} } — 7-day snowfall totals per source
function updateModelsNote() {
  const el = $("modelsNote");
  if (!el) return;
  const m = modelTotals, p = [];
  if (m.nws != null) p.push(`<strong>NWS</strong> ${m.nws.toFixed(1)}″`);
  if (m.om != null) p.push(`<strong>Open-Meteo</strong> ${m.om.toFixed(1)}″`);
  if (m.ens) p.push(`<strong>GFS ensemble</strong> ${m.ens.lo.toFixed(1)}–${m.ens.hi.toFixed(1)}″ <span style="font-weight:400">(10–90% of ${m.ens.n} members)</span>`);
  el.innerHTML = p.length > 1 || m.ens
    ? `<small>Model check · 7-day totals · ${p.join(" · ")} — the spread between models is the forecast uncertainty.</small>`
    : "";
}

// ISO-8601 duration (e.g. "PT6H", "P1DT6H") -> hours
function durHours(s) {
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(s || "") || [];
  return (+(m[1] || 0)) * 24 + (+(m[2] || 0)) + (+(m[3] || 0)) / 60;
}
const dayKey = (d, tz) => d.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD in the location's tz
function addDayKey(key, n) { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const cToF = c => c == null ? null : c * 9 / 5 + 32;
// NWS wind chill (°F, mph); valid for T ≤ 50°F and wind ≥ 3 mph.
const windChillF = (t, v) => 35.74 + 0.6215 * t - 35.75 * Math.pow(v, 0.16) + 0.4275 * t * Math.pow(v, 0.16);
// Value of a gridpoint time-series whose interval contains `when` (default: now).
function gridValueAt(series, when = Date.now()) {
  if (!series || !series.values) return null;
  for (const e of series.values) {
    const [start, dur] = e.validTime.split("/");
    const t0 = new Date(start).getTime(), t1 = t0 + (durHours(dur) || 1) * 3600000;
    if (when >= t0 && when < t1) return e.value;
  }
  return series.values[0] ? series.values[0].value : null;
}

// Sunrise / sunset via the NOAA solar equations (suncalc-style) — pure math, no API.
function sunTimes(lat, lng, date = new Date()) {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
  const lw = -lng * rad, phi = lat * rad;
  const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const cosH = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null; // polar day / night
  const w = Math.acos(cosH);
  const Jset = J2000 + (0.0009 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  const toDate = j => new Date((j + 0.5 - J1970) * dayMs);
  return { sunrise: toDate(Jrise), sunset: toDate(Jset) };
}

// Sum gridpoint snowfallAmount (mm, per time interval) into local days -> inches.
function gridDailySnow(grid, tz) {
  const mm = {}, s = grid.snowfallAmount;
  if (s && s.values) for (const e of s.values) {
    const [start, dur] = e.validTime.split("/");
    const hours = durHours(dur) || 1, per = (e.value || 0) / hours, t0 = new Date(start);
    for (let h = 0; h < hours; h++) {
      const k = dayKey(new Date(t0.getTime() + h * 3600000), tz);
      mm[k] = (mm[k] || 0) + per;
    }
  }
  const inches = {}; for (const k in mm) inches[k] = mm[k] / 25.4;
  return inches;
}

// Map an NWS shortForecast phrase to one of our flat icon types.
function nwsIcon(text, isDay) {
  const s = (text || "").toLowerCase(), night = !isDay;
  if (s.includes("thunder")) return "thunder";
  if (/(snow|flurr|blizzard|wintry)/.test(s)) return "snow";
  if (/(sleet|freezing|ice pellet)/.test(s)) return "sleet";
  if (s.includes("drizzle")) return "drizzle";
  if (/(rain|shower)/.test(s)) return "rain";
  if (/(fog|haze|smoke|mist)/.test(s)) return "fog";
  if (s.includes("cloud")) return (s.includes("partly") || s.includes("mostly sunny")) ? (night ? "partly-night" : "partly") : "cloudy";
  if (/(sunny|clear|fair)/.test(s)) return (s.includes("partly") || s.includes("mostly")) ? (night ? "partly-night" : "partly") : (night ? "clear-night" : "clear");
  return night ? "clear-night" : "cloudy";
}

// Render a row of snowfall bars. Each bar is scaled to the tallest day in the
// set, so the two cards (past / forecast) read on their own independent scales.
function snowBars(days) {
  const max = Math.max(0.5, ...days.map(x => x.snow));
  return days.map(x => {
    const pct = Math.round((x.snow / max) * 100);
    const dn = new Date(x.date + "T00:00").toLocaleDateString("en", { weekday: "short" });
    return `<div class="bar-col">
      <div class="bar-val">${x.snow >= 0.05 ? x.snow.toFixed(1) + '"' : "—"}</div>
      <div class="bar-track"><div class="bar ${x.snow < 0.05 ? "zero" : ""}" style="height:${x.snow < 0.05 ? 3 : pct}%"></div></div>
      <div class="bar-day">${dn}</div>
    </div>`;
  }).join("");
}

let lastNWS = null, lastSnowMap = null;
function render(loc, nws, om) {
  lastNWS = nws;
  $("status").classList.add("hidden");
  $("content").classList.remove("hidden");
  $("stormBanner").classList.add("hidden");
  const tz = nws.tz, grid = nws.grid, h0 = nws.hourly[0] || {};

  // ---- current conditions: prefer the live station observation (what weather.gov shows);
  //      fall back to the current-hour forecast + gridpoint when no fresh station is nearby ----
  const obs = nws.obs;
  const obsF = obs && obs.temperature && obs.temperature.value != null ? obs.temperature.value * 9 / 5 + 32 : null;
  const curTempF = obsF != null ? obsF : (h0.temperature != null ? h0.temperature : null);
  const curDesc = obs && obs.textDescription ? obs.textDescription : (h0.shortForecast || "—");
  $("nowIcon").innerHTML = iconSVG(nwsIcon(curDesc, h0.isDaytime));
  $("nowPlace").textContent = loc.coord ? `📍 ${loc.name}` : loc.name + (loc.detail ? `, ${loc.detail}` : ", CO");
  $("nowTemp").textContent = curTempF != null ? Math.round(curTempF) + "°" : "—";
  // today's forecast high/low from the NWS daily periods (daytime high, nighttime low)
  const todayKey = dayKey(new Date(), tz);
  let tHi = null, tLo = null;
  for (const p of nws.daily) {
    if (dayKey(new Date(p.startTime), tz) !== todayKey) continue;
    if (p.isDaytime) tHi = p.temperature; else if (tLo == null) tLo = p.temperature;
  }
  $("nowHiLo").innerHTML = (tHi != null ? `<span class="hi">H ${Math.round(tHi)}°</span>` : "") +
    (tLo != null ? `<span class="lo">L ${Math.round(tLo)}°</span>` : "");
  $("nowDesc").textContent = curDesc;
  if (obs) {
    const ot = new Date(obs.timestamp).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: tz });
    $("nowObs").textContent = `Observed · ${(obs.stationName || "").split(",")[0]} · ${ot}`;
  } else $("nowObs").textContent = "Forecast — no live station reporting nearby";
  const elevM = grid.elevation ? grid.elevation.value : null;
  $("nowElev").textContent = elevM != null ? Math.round(elevM * 3.281).toLocaleString() + " ft" : "";
  $("nowElevM").textContent = elevM != null ? Math.round(elevM).toLocaleString() + " m" : "";
  // feels like: observed wind chill / heat index when present, else observed temp, else gridpoint apparent temp
  const obsFeelsC = obs ? (obs.windChill?.value ?? obs.heatIndex?.value ?? null) : null;
  const feelsF = obsFeelsC != null ? cToF(obsFeelsC) : (obsF != null ? obsF : cToF(gridValueAt(grid.apparentTemperature)));
  $("mFeels").textContent = feelsF != null ? Math.round(feelsF) + "°" : (curTempF != null ? Math.round(curTempF) + "°" : "—");
  // wind: observed speed (km/h → mph) + direction, else forecast string
  if (obs && obs.windSpeed && obs.windSpeed.value != null) {
    const mph = Math.round(obs.windSpeed.value * 0.621371);
    const dir = obs.windDirection && obs.windDirection.value != null && mph > 0 ? " " + bearingToCompass(obs.windDirection.value) : "";
    $("mWind").textContent = mph === 0 ? "Calm" : `${mph} mph${dir}`;
  } else $("mWind").textContent = h0.windSpeed || "—";
  const obsRH = obs && obs.relativeHumidity && obs.relativeHumidity.value != null ? obs.relativeHumidity.value : null;
  $("mHum").textContent = obsRH != null ? Math.round(obsRH) + "%"
    : (h0.relativeHumidity && h0.relativeHumidity.value != null ? Math.round(h0.relativeHumidity.value) + "%" : "—");

  // ---- sunrise / sunset / daylight (computed locally, shown in the location's tz) ----
  const st = sunTimes(loc.lat, loc.lon);
  if (st) {
    const fmt = d => d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: tz });
    $("mSunrise").textContent = fmt(st.sunrise);
    $("mSunset").textContent = fmt(st.sunset);
    const mins = Math.round((st.sunset - st.sunrise) / 60000);
    $("mDaylight").textContent = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  } else {
    $("mSunrise").textContent = $("mSunset").textContent = $("mDaylight").textContent = "—";
  }

  // ---- last 7 days snowfall (Open-Meteo history) ----
  if (om && om.past) {
    const pastTotal = om.past.reduce((s, x) => s + x.snow, 0);
    $("total7").innerHTML = pastTotal.toFixed(1) + `" <span>total this past week</span>`;
    $("bars").innerHTML = snowBars(om.past);
  } else {
    $("total7").innerHTML = "—";
    $("bars").innerHTML = `<div class="snotel-msg" style="padding:6px 0">Past-snow data unavailable.</div>`;
  }

  // ---- next 7 days snowfall (NWS gridpoint — precise) ----
  const snowMap = gridDailySnow(grid, tz);
  lastSnowMap = snowMap;
  const todayK = dayKey(new Date(), tz);
  const fcDays = [];
  for (let i = 0; i < 7; i++) { const k = addDayKey(todayK, i); fcDays.push({ date: k, snow: snowMap[k] || 0 }); }
  const fcTotal = fcDays.reduce((s, x) => s + x.snow, 0);
  $("total7f").innerHTML = fcTotal.toFixed(1) + `" <span>forecast next 7 days</span>`;
  $("barsf").innerHTML = snowBars(fcDays);
  modelTotals.nws = fcTotal;
  if (om) modelTotals.om = om.futureTotal;
  updateModelsNote();

  // ---- 7-day forecast (pair NWS day/night periods into calendar days) ----
  const byDay = {};
  for (const p of nws.daily) {
    const k = dayKey(new Date(p.startTime), tz);
    const o = byDay[k] = byDay[k] || { date: k };
    if (p.isDaytime) { o.hi = p.temperature; o.dayP = p; } else { o.lo = p.temperature; o.nightP = p; }
  }
  const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
  let dhtml = "";
  days.forEach((o, idx) => {
    const ref = o.dayP || o.nightP;
    const type = nwsIcon(ref.shortForecast, !!o.dayP);
    const dn = idx === 0 ? "Today" : new Date(o.date + "T12:00:00Z").toLocaleDateString("en", { weekday: "short" });
    const pop = Math.max(o.dayP?.probabilityOfPrecipitation?.value || 0, o.nightP?.probabilityOfPrecipitation?.value || 0);
    const snow = snowMap[o.date] || 0;
    const hi = o.hi != null ? Math.round(o.hi) + "°" : "—";
    const lo = o.lo != null ? Math.round(o.lo) + "°" : "—";
    dhtml += `<div class="day-item">
      <div class="day" data-date="${o.date}">
        <div class="dname">${dn}</div>
        <div class="di">${iconSVG(type)}</div>
        <div class="dpop">${pop >= 5 ? "💧 " + pop + "%" : ""}</div>
        <div class="dsnow">${snow >= 0.05 ? "❄️ " + snow.toFixed(1) + '"' : ""}</div>
        <div class="drange">${hi} <span class="lo">${lo}</span></div>
        <div class="day-caret">▾</div>
      </div>
      <div class="day-detail" hidden></div>
    </div>`;
  });
  $("daily").innerHTML = dhtml;

  // open Today's row by default so its temp + precip graph shows without a tap
  const firstRow = $("daily").querySelector(".day");
  if (firstRow) {
    const detail = firstRow.parentElement.querySelector(".day-detail");
    if (detail) {
      detail.innerHTML = dayHoursHTML(nws, firstRow.dataset.date);
      detail.removeAttribute("hidden");
      firstRow.classList.add("open");
    }
  }

  updateMapSearch(loc);
  updateMapObs(nws.obs);
  loadElevationBands(loc, elevM); // async, non-blocking — backcountry elevation panel
  renderCompare();                // compare card (chips + cached per-favorite fetches)
}

// Smooth (Catmull-Rom) SVG path through points.
function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
// Temperature curve for a day's hours, plotted at column centers (width = n*COL) so it
// aligns 1:1 with the hourly columns below. Gradient-banded by temperature, hi/low marked.
function tempGraphSVG(hrs, COL) {
  const temps = hrs.map(p => Math.round(p.temperature));
  const n = temps.length;
  if (n < 2) return "";
  const W = n * COL, H = 120, padTop = 26, padBot = 24;
  const min = Math.min(...temps), max = Math.max(...temps), range = Math.max(1, max - min);
  const X = i => i * COL + COL / 2;
  const Y = t => padTop + (1 - (t - min) / range) * (H - padTop - padBot);
  const baseY = H - padBot; // shared baseline: low temp = 0% precip. Fill stops here — no color below.
  const pts = temps.map((t, i) => ({ x: X(i), y: Y(t) }));
  const line = smoothPath(pts);
  const area = `${line} L ${X(n - 1).toFixed(1)} ${baseY} L ${X(0).toFixed(1)} ${baseY} Z`;
  const hiIdx = temps.indexOf(max), loIdx = temps.lastIndexOf(min);
  const marker = (idx, t, hi) => `<circle cx="${X(idx).toFixed(1)}" cy="${Y(t).toFixed(1)}" r="3.4" class="tg-dot ${hi ? "hi" : "lo"}"/>` +
    `<text x="${X(idx).toFixed(1)}" y="${(Y(t) + (hi ? -9 : 16)).toFixed(1)}" class="tg-lbl ${hi ? "hi" : "lo"}">${hi ? "H " : "L "}${t}°</text>`;
  // precipitation probability: 0-100% mapped over the plot height (0% bottom, 100% top), drawn as a blue line.
  // NOTE: padTop(26) and H-padBot(96) here must match the .tg-yaxis label positions set in dayHoursHTML.
  const Yp = v => padTop + (1 - v / 100) * (H - padTop - padBot);
  const pline = smoothPath(hrs.map((p, i) => ({ x: X(i), y: Yp(p.probabilityOfPrecipitation?.value || 0) })));
  const grid = [0, 25, 50, 75, 100].map(v => `<line x1="0" y1="${Yp(v).toFixed(1)}" x2="${W}" y2="${Yp(v).toFixed(1)}" class="tg-grid"/>`).join("");
  return `<svg class="tempgraph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:${W}px;height:${H}px">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6a23c"/><stop offset="0.38" stop-color="#f2d24b"/>
      <stop offset="0.7" stop-color="#7fd36b"/><stop offset="1" stop-color="#6ec6ff"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#tg)" opacity="0.16"/>
    <path d="${line}" fill="none" stroke="url(#tg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <path d="${pline}" fill="none" stroke="#5fb0ef" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" class="tg-pop"/>
    ${marker(hiIdx, max, true)}${marker(loIdx, min, false)}
  </svg>`;
}
// Hourly breakdown for one day (shown when a 7-day row is tapped).
function dayHoursHTML(nws, dateKey) {
  const hrs = nws.hourly.filter(p => dayKey(new Date(p.startTime), nws.tz) === dateKey);
  if (!hrs.length) return `<div class="snotel-msg" style="padding:8px 2px 2px">Hourly detail isn't available this far out.</div>`;
  const COL = 54;
  const cells = hrs.map(p => {
    const time = new Date(p.startTime).toLocaleTimeString("en", { hour: "numeric", timeZone: nws.tz });
    const pop = p.probabilityOfPrecipitation?.value || 0;
    const di = COMPASS.indexOf(p.windDirection || "");
    const arrow = di >= 0 ? `<span class="dh-arrow" style="transform:rotate(${di * 22.5 + 180}deg)">↑</span>` : "";
    const spd = (p.windSpeed || "").replace(/ mph/i, "");
    const rh = p.relativeHumidity?.value;
    return `<div class="dh" style="width:${COL}px">
      <div class="dh-t">${time}</div>
      <div class="dh-i">${iconSVG(nwsIcon(p.shortForecast, p.isDaytime))}</div>
      <div class="dh-temp">${Math.round(p.temperature)}°</div>
      <div class="dh-pop">${pop >= 5 ? "💧" + pop + "%" : ""}</div>
      <div class="dh-wind">${arrow}${spd}</div>
      <div class="dh-rh">${rh != null ? rh + "%" : ""}</div>
    </div>`;
  }).join("");
  const W = hrs.length * COL;
  return `<div class="day-hours-head">Hourly · ${new Date(dateKey + "T12:00:00Z").toLocaleDateString("en", { weekday: "long", month: "short", day: "numeric" })} <span><i class="lg-pop"></i>precip % · wind mph · RH%</span></div>
    <div class="day-chart">
      <div class="day-scroll"><div class="day-inner" style="width:${W + 34}px">${tempGraphSVG(hrs, COL)}<div class="day-hours">${cells}</div></div></div>
      <div class="tg-yaxis"><span style="top:26px">100%</span><span style="top:61px">50%</span><span style="top:96px">0%</span></div>
    </div>`;
}
function initDailyExpand() {
  $("daily").addEventListener("click", e => {
    const row = e.target.closest(".day");
    if (!row) return;
    const detail = row.parentElement.querySelector(".day-detail");
    if (!detail) return;
    const wasOpen = !detail.hasAttribute("hidden");
    $("daily").querySelectorAll(".day-detail").forEach(d => d.setAttribute("hidden", ""));
    $("daily").querySelectorAll(".day").forEach(d => d.classList.remove("open"));
    if (!wasOpen && lastNWS) {
      detail.innerHTML = dayHoursHTML(lastNWS, row.dataset.date);
      detail.removeAttribute("hidden");
      row.classList.add("open");
    }
  });
}

// ====================== Compare favorites (next-7-day snowfall) ======================
const CMP_KEY = "compare_v1";
let cmpSel = (() => {
  try { const a = JSON.parse(localStorage.getItem(CMP_KEY) || "null"); if (Array.isArray(a)) return a; } catch {}
  return favorites.slice(0, 3).map(f => f.name);
})();
const _cmpCache = {}; // "lat,lon" -> promise of 7 daily snowfall values

function renderCompare() {
  const chips = $("cmpChips");
  if (!chips) return;
  cmpSel = cmpSel.filter(n => favorites.some(f => f.name === n)); // drop deleted favorites
  chips.innerHTML = favorites.map(f =>
    `<button type="button" class="chip${cmpSel.includes(f.name) ? " cmp-on" : ""}" data-cmp="${esc(f.name)}">${esc(f.name)}</button>`
  ).join("") || `<div class="snotel-msg">Add favorites above to compare them.</div>`;
  chips.querySelectorAll("[data-cmp]").forEach(b => b.addEventListener("click", () => {
    const n = b.dataset.cmp;
    if (cmpSel.includes(n)) cmpSel = cmpSel.filter(x => x !== n);
    else { cmpSel.push(n); if (cmpSel.length > 4) cmpSel.shift(); } // cap at 4 rows
    try { localStorage.setItem(CMP_KEY, JSON.stringify(cmpSel)); } catch {}
    renderCompare();
  }));
  loadCompare();
}

async function loadCompare() {
  const body = $("cmpBody");
  if (!body) return;
  const sel = favorites.filter(f => cmpSel.includes(f.name));
  if (!sel.length) {
    body.innerHTML = `<div class="snotel-msg">Tap favorites above to compare their next-7-day snowfall.</div>`;
    return;
  }
  body.innerHTML = `<div class="snotel-msg"><span class="spin"></span>Comparing…</div>`;
  const rows = await Promise.all(sel.map(async f => {
    const key = `${f.lat},${f.lon}`;
    if (!_cmpCache[key]) {
      _cmpCache[key] = (async () => {
        const u = new URLSearchParams({
          latitude: f.lat, longitude: f.lon, daily: "snowfall_sum",
          precipitation_unit: "inch", timezone: "auto", forecast_days: "7", models: "gfs_seamless",
        });
        const d = await (await fetch(`https://api.open-meteo.com/v1/forecast?${u}`)).json();
        return d.daily.snowfall_sum.map(v => v || 0);
      })().catch(() => null);
    }
    return { f, days: await _cmpCache[key] };
  }));
  const ok = rows.filter(r => r.days);
  if (!ok.length) { body.innerHTML = `<div class="snotel-msg err">Comparison data unavailable right now.</div>`; return; }
  const max = Math.max(0.5, ...ok.flatMap(r => r.days));
  ok.sort((a, b) => b.days.reduce((s, x) => s + x, 0) - a.days.reduce((s, x) => s + x, 0));
  body.innerHTML = ok.map(r => {
    const total = r.days.reduce((s, x) => s + x, 0);
    const bars = r.days.map(v => `<i class="${v < 0.05 ? "z" : ""}" style="height:${v < 0.05 ? 6 : Math.max(8, Math.round(v / max * 100))}%"></i>`).join("");
    return `<div class="cmp-row"><div class="cmp-name">${esc(r.f.name)}</div><div class="cmp-bars">${bars}</div><div class="cmp-total">${total.toFixed(1)}″</div></div>`;
  }).join("") +
  `<div class="elev-note"><small><strong>Open-Meteo</strong> · HRRR/GFS · Daily snowfall for the next 7 days, tallest bar = ${max.toFixed(1)}″.</small></div>`;
}

// ====================== Avalanche forecast (CAIC) ======================
// Colorado Avalanche Information Center zone forecast for the searched point.
// Off-season (or on any fetch/shape surprise) the card simply stays hidden.
const AVY_NAMES = ["No rating", "Low", "Moderate", "Considerable", "High", "Extreme"];
const AVY_BG = ["rgba(255,255,255,0.08)", "#57b657", "#ffd23c", "#f7941e", "#ed1c24", "#1b1b1b"];
const AVY_FG = ["#9fb4d4", "#04240c", "#3c2f04", "#341c04", "#fff", "#fff"];
function avyLevel(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Math.max(0, Math.min(5, v));
  const m = { low: 1, moderate: 2, considerable: 3, high: 4, extreme: 5 };
  return m[String(v).toLowerCase()] || 0;
}
async function loadAvalanche(loc, seq) {
  const card = $("avyCard"), body = $("avyBody");
  card.classList.add("hidden");
  try {
    const r = await fetch(`https://api.avalanche.state.co.us/api/v2/public/product?type=avalancheforecast&lat=${loc.lat.toFixed(4)}&lng=${loc.lon.toFixed(4)}`);
    if (!r.ok) return;
    const d = await r.json();
    if (seq !== loadSeq) return;
    const days = d?.dangerRatings?.days || d?.dangerRatings || [];
    const today = days[0];
    if (!today) return;
    const rows = [
      ["Above treeline", today.alp ?? today.upper],
      ["Near treeline", today.tln ?? today.middle],
      ["Below treeline", today.btl ?? today.lower],
    ];
    const levels = rows.map(([, v]) => avyLevel(v));
    if (!levels.some(l => l > 0)) return; // off-season / no rating — keep hidden
    const pills = rows.map(([label], i) => {
      const l = levels[i];
      return `<div class="avy-row"><div class="avy-elev">${label}</div>
        <div class="avy-pill" style="background:${AVY_BG[l]};color:${AVY_FG[l]}">${l > 0 ? `${l} — ${AVY_NAMES[l]}` : AVY_NAMES[0]}</div></div>`;
    }).join("");
    const summaryRaw = d?.avalancheSummary?.days?.[0]?.content || "";
    const summary = summaryRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
    const zone = d.title || d.areaName || "Backcountry zone";
    const dateTxt = today.date ? new Date(today.date + (today.date.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }) : "";
    body.innerHTML = `<div class="avy-zone">${esc(zone)}</div>
      <div class="avy-sub">${dateTxt ? `Danger rating · ${dateTxt}` : "Today's danger rating"}</div>
      <div class="avy-rows">${pills}</div>
      ${summary ? `<div class="avy-sum">${esc(summary)}${summaryRaw.length > 260 ? "…" : ""}</div>` : ""}
      <a class="avy-link" href="https://avalanche.state.co.us" target="_blank" rel="noopener">Full forecast at avalanche.state.co.us →</a>
      <div class="elev-note"><small><strong>CAIC</strong> · Colorado Avalanche Information Center · Always read the full forecast before backcountry travel.</small></div>`;
    card.classList.remove("hidden");
  } catch { /* keep the card hidden */ }
}

// ====================== SNOTEL (USDA NRCS AWDB) ======================
const SNOTEL_API = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const SNOTEL_NETWORKS = ["SNTL", "SNTLT"]; // SNOTEL + SNOTEL-Lite
const SNOTEL_CACHE_KEY = "snotelStations_v2"; // v2: includes dataTimeZone
const SNOTEL_CACHE_DAYS = 30;

// Pretty units for the stored unit codes SNOTEL uses.
function unitLabel(u) {
  const map = { in: '"', degF: "°F", pct: "%", mph: "mph", degree: "°",
    "watt/m2": " W/m²", unitless: "", volt: " V", inch_Hg: " inHg", langley: " ly" };
  return (u in map) ? map[u] : (u ? " " + u : "");
}

// Curated, grouped display. Each metric picks a preferred feed (daily/hourly/any).
// Anything a station reports that isn't here falls into "Other sensors".
const SNOTEL_GROUPS = [
  { title: "❄️ Snowpack", metrics: [
    { code: "SNWD", label: "Snow Depth", feed: "any", hero: true },
    { code: "WTEQ", label: "Snow Water Equiv.", feed: "any", hero: true },
    { code: "SNDN", label: "Snow Density", feed: "daily" },
    { code: "SNRR", label: "Snow / Rain Ratio", feed: "daily" },
  ]},
  { title: "🌡️ Temperature", metrics: [
    { code: "TOBS", label: "Current Temp", feed: "any" },
    { code: "TMAX", label: "Daily High", feed: "daily" },
    { code: "TMIN", label: "Daily Low", feed: "daily" },
    { code: "TAVG", label: "Daily Avg", feed: "daily" },
  ]},
  { title: "🌧️ Precipitation", metrics: [
    { code: "PRCP", label: "New Precip (24h)", feed: "daily" },
    { code: "PRCPSA", label: "New Precip · snow-adj.", feed: "daily" },
    { code: "PRCPMTD", label: "Precip · month-to-date", feed: "daily" },
    { code: "PREC", label: "Precip · season total", feed: "daily" },
  ]},
  { title: "💨 Wind", metrics: [
    { code: "WSPDV", label: "Wind Speed", feed: "hourly" },
    { code: "WSPDX", label: "Wind Gust", feed: "hourly" },
    { code: "WDIRV", label: "Wind Direction", feed: "hourly", dir: true },
  ]},
  { title: "💧 Air & Ground", metrics: [
    { code: "RHUM", label: "Humidity", feed: "hourly" },
    { code: "DPTP", label: "Dew Point", feed: "any" },
    { code: "PTEMP", label: "Pack Profile Temp", feed: "any" },
    { code: "STO", label: "Soil Temp", feed: "any" },
    { code: "SMS", label: "Soil Moisture", feed: "any" },
  ]},
];
const SNOTEL_CURATED = new Set(SNOTEL_GROUPS.flatMap(g => g.metrics.map(m => m.code)));
// Station-health + redundant statistical variants we don't surface.
const SNOTEL_HIDE = new Set([
  "BATT","BATV","BATX","BATN","ETIB","ETIL","VOLT","DIAG","COND",
  "RHUMN","RHUMV","RHUMX","WSPDN","SMV","SMN","SMX","STV","STN","STX","TGSX","TGSN","TGSI",
]);
// Friendly names for the non-curated extras that may appear under "Other sensors".
const ELEMENT_NAMES = {
  LWINV: "Longwave In", LWOTV: "Longwave Out", SWINV: "Solar In", SWOTV: "Solar Out",
  SRAD: "Solar Radiation", SRADV: "Solar Radiation", NTRDV: "Net Solar Rad.",
  TGSV: "Ground Surface Temp", PRES: "Pressure", FUEL: "Fuel Moisture",
};

function haversineMiles(la1, lo1, la2, lo2) {
  const R = 3958.8, t = Math.PI / 180;
  const dLa = (la2 - la1) * t, dLo = (lo2 - lo1) * t;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * t) * Math.cos(la2 * t) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
// SNOTEL stamps readings in a fixed standard-time offset (dataTimeZone, e.g. -8 = PST),
// NOT the local clock — so "14:00" must be read at that offset or it looks hours stale.
function snotelDate(str, tzOffset) {
  if (!str) return null;
  let iso = str.replace(" ", "T");
  if (!/T\d{2}:\d{2}:\d{2}/.test(iso)) iso += ":00"; // ensure seconds
  if (tzOffset == null) return new Date(iso); // unknown offset → parse as local
  const sign = tzOffset < 0 ? "-" : "+", ah = Math.abs(tzOffset);
  const hh = String(Math.floor(ah)).padStart(2, "0");
  const mm = String(Math.round((ah % 1) * 60)).padStart(2, "0");
  return new Date(`${iso}${sign}${hh}:${mm}`);
}
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const bearingToCompass = deg => COMPASS[Math.round(deg / 22.5) % 16];

// --- station list: fetch once, trim to SNOTEL, cache in localStorage ---
let _stationsPromise = null;
async function getSnotelStations() {
  try {
    const c = JSON.parse(localStorage.getItem(SNOTEL_CACHE_KEY) || "null");
    if (c && Date.now() - c.t < SNOTEL_CACHE_DAYS * 864e5 && Array.isArray(c.s) && c.s.length) return c.s;
  } catch {}
  if (_stationsPromise) return _stationsPromise;
  _stationsPromise = (async () => {
    const r = await fetch(`${SNOTEL_API}/stations?activeOnly=true`);
    if (!r.ok) throw new Error("stations HTTP " + r.status);
    const all = await r.json();
    const stations = all
      .filter(s => SNOTEL_NETWORKS.includes((s.stationTriplet || "").split(":")[2]) && s.latitude != null && s.longitude != null)
      .map(s => ({ t: s.stationTriplet, n: s.name, lat: s.latitude, lon: s.longitude, el: s.elevation, tz: s.dataTimeZone }));
    try { localStorage.setItem(SNOTEL_CACHE_KEY, JSON.stringify({ t: Date.now(), s: stations })); } catch {}
    return stations;
  })();
  return _stationsPromise;
}

// --- latest non-null value per element, merged across daily + hourly feeds ---
function lastValue(values) {
  if (!values) return null;
  for (let i = values.length - 1; i >= 0; i--)
    if (values[i] && values[i].value != null) return values[i];
  return null;
}
async function fetchStationLatest(triplet) {
  const end = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const begin = new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10);
  const url = dur => `${SNOTEL_API}/data?stationTriplets=${encodeURIComponent(triplet)}&elements=*&duration=${dur}&beginDate=${begin}&endDate=${end}`;
  // Third call: WTEQ with the day-of-year MEDIAN attached — powers "% of normal snowpack".
  const medianUrl = `${SNOTEL_API}/data?stationTriplets=${encodeURIComponent(triplet)}&elements=WTEQ&duration=DAILY&beginDate=${begin}&endDate=${end}&centralTendencyType=MEDIAN`;
  const [daily, hourly, median] = await Promise.all([
    fetch(url("DAILY")).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(url("HOURLY")).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(medianUrl).then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  const out = {}; // code -> { daily:{value,unit,date}, hourly:{...} }
  const ingest = (json, feed) => {
    const rows = (json && json[0] && json[0].data) || [];
    for (const e of rows) {
      const lv = lastValue(e.values);
      if (!lv) continue;
      (out[e.stationElement.elementCode] ||= {})[feed] = { value: lv.value, unit: e.stationElement.storedUnitCode, date: lv.date };
      // keep the raw daily snow-depth series for the storm tracker (last-48h new snow)
      if (feed === "daily" && e.stationElement.elementCode === "SNWD") out.__snwd = e.values;
    }
  };
  ingest(daily, "daily");
  ingest(hourly, "hourly");
  // % of median: newest day whose value AND median are both present
  const medVals = (median && median[0] && median[0].data && median[0].data[0] && median[0].data[0].values) || [];
  for (let i = medVals.length - 1; i >= 0; i--) {
    const v = medVals[i];
    if (v && v.value != null && v.median != null && v.median > 0) {
      out.__pct = { pct: Math.round(v.value / v.median * 100), asof: v.date };
      break;
    }
  }
  return out;
}
function pickFeed(rec, feed) {
  if (!rec) return null;
  if (feed === "daily") return rec.daily || rec.hourly || null;
  return rec.hourly || rec.daily || null; // "any"/"hourly" prefer most-recent hourly
}

// --- rendering ---
function fmtVal(code, datum, dir) {
  const v = datum.value;
  if (dir) return `${Math.round(v)}<span class="su">° ${bearingToCompass(v)}</span>`;
  const dp = ["SNWD","SNDN","RHUM","SMS"].includes(code) ? 0 : 1;
  const num = (typeof v === "number") ? v.toFixed(dp).replace(/\.0$/, "") : v;
  return `${num}<span class="su">${unitLabel(datum.unit)}</span>`;
}
const tileHTML = (m, datum) => `<div class="stile${m.hero ? " hero" : ""}">
    <div class="sv">${fmtVal(m.code, datum, m.dir)}</div>
    <div class="sl">${m.label}</div>
  </div>`;

// Copy text to clipboard, with a fallback for non-secure contexts.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

function renderSnotel(station, distMi, latest) {
  let newest = "";
  for (const [code, rec] of Object.entries(latest)) {
    if (code.startsWith("__")) continue;
    for (const f of ["daily", "hourly"]) if (rec[f] && rec[f].date > newest) newest = rec[f].date;
  }

  const elevTxt = station.el != null ? `<b class="alt">${Math.round(station.el).toLocaleString()} ft</b>` : "";
  const asOf = newest ? snotelDate(newest, station.tz).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const coords = `${station.lat.toFixed(5)}, ${station.lon.toFixed(5)}`; // decimal degrees — also valid search input
  $("snotelHead").innerHTML = `<div class="sname">${station.n}</div>
    <div class="smeta">${[elevTxt, `${distMi.toFixed(1)} mi away`, station.t].filter(Boolean).join(" · ")}</div>
    <div class="scoord"><span class="scoord-pin">📍</span><span class="scoord-val">${coords}</span><button class="scoord-copy" type="button" title="Copy coordinates">Copy</button></div>
    ${asOf ? `<div class="sas">Live reading · as of ${asOf}</div>` : ""}`;
  const copyBtn = $("snotelHead").querySelector(".scoord-copy");
  copyBtn.addEventListener("click", async () => {
    if (await copyText(coords)) {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("done");
    } else {
      // Couldn't copy programmatically — select the text so the user can copy it.
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents($("snotelHead").querySelector(".scoord-val"));
      sel.removeAllRanges(); sel.addRange(range);
      copyBtn.textContent = "Selected";
    }
    setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("done"); }, 1600);
  });

  let html = "";
  SNOTEL_GROUPS.forEach((g, gi) => {
    const tiles = g.metrics
      .map(m => { const d = pickFeed(latest[m.code], m.feed); return d ? tileHTML(m, d) : ""; })
      .filter(Boolean);
    // % of median snowpack — the number skiers quote all season — joins the Snowpack group
    if (gi === 0 && latest.__pct) tiles.push(`<div class="stile hero">
      <div class="sv">${latest.__pct.pct}<span class="su">%</span></div>
      <div class="sl">of Median Snowpack (SWE, this date)</div></div>`);
    if (tiles.length) html += `<div class="snotel-group"><div class="gtitle">${g.title}</div><div class="sgrid">${tiles.join("")}</div></div>`;
  });
  const others = Object.entries(latest)
    .filter(([code]) => !code.startsWith("__") && !SNOTEL_CURATED.has(code) && !SNOTEL_HIDE.has(code))
    .map(([code, rec]) => { const d = rec.hourly || rec.daily; return d ? tileHTML({ code, label: ELEMENT_NAMES[code] || code }, d) : ""; })
    .filter(Boolean);
  if (others.length) html += `<div class="snotel-group"><div class="gtitle">📟 Other sensors</div><div class="sgrid">${others.join("")}</div></div>`;

  $("snotelBody").innerHTML = html || `<div class="snotel-msg">This station reported no recent data.</div>`;
  updateMapStation(station);
}

// ---- storm total tracker: observed new snow (SNOTEL depth deltas, last 48h)
//      + forecast next 48h (NWS gridpoint). Banner shows only during real storms. ----
function renderStorm(latest, station) {
  const el = $("stormBanner");
  if (!el) return;
  el.classList.add("hidden");
  const vals = (latest.__snwd || []).filter(v => v && v.value != null);
  let obs48 = 0;
  for (let i = Math.max(1, vals.length - 2); i < vals.length; i++) {
    const d = vals[i].value - vals[i - 1].value;
    if (d > 0) obs48 += d;
  }
  const sm = lastSnowMap || {}, tz = lastNWS ? lastNWS.tz : "America/Denver";
  const t = dayKey(new Date(), tz);
  const fc48 = (sm[t] || 0) + (sm[addDayKey(t, 1)] || 0);
  if (obs48 + fc48 < 1.5) return; // no meaningful storm — stay hidden
  const parts = [];
  if (obs48 >= 0.5) parts.push(`new snow last 48 h: <b>${obs48.toFixed(obs48 >= 10 ? 0 : 1)}″</b> (${esc(station.n)} SNOTEL)`);
  if (fc48 >= 0.5) parts.push(`next 48 h forecast: <b>+${fc48.toFixed(1)}″</b>`);
  el.innerHTML = `🌨 <b>Storm tracker</b> — ${parts.join(" · ")}`;
  el.classList.remove("hidden");
}

// Tallest terrain within ~2 miles (Copernicus 90m DEM via Open-Meteo elevation API) — for the Summit band.
async function tallestWithin2mi(lat, lon, baseM) {
  const Rmi = 2, dLat = 1 / 69, dLon = 1 / (69 * Math.cos(lat * Math.PI / 180)), N = 5;
  const lats = [], lons = [];
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const fx = i / N, fy = j / N;
    if (fx * fx + fy * fy <= 1.0001) { // inside the 2-mile circle (~81 points, under the 100-point API cap)
      lats.push((lat + fy * Rmi * dLat).toFixed(5));
      lons.push((lon + fx * Rmi * dLon).toFixed(5));
    }
  }
  const d = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`)).json();
  const e = d.elevation;
  if (!Array.isArray(e) || !e.length) return null;
  let m = 0; for (let k = 1; k < e.length; k++) if (e[k] > e[m]) m = k;
  return { lat: +lats[m], lon: +lons[m], em: Math.max(e[m], baseM) }; // never below the searched point
}

// "By Elevation" backcountry panel — Open-Meteo downscaled to 3 elevations around the point.
async function loadElevationBands(loc, elevM) {
  const el = $("elevBands"), sl = $("snowline");
  if (!el) return;
  el.innerHTML = `<div class="snotel-msg">Loading elevation forecast…</div>`;
  sl.textContent = "";
  try {
    let baseM = elevM;
    if (baseM == null) {
      const probe = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&forecast_days=1`)).json();
      baseM = probe.elevation != null ? probe.elevation : 2500;
    }
    const DROP = 460; // Base sits ~1,500 ft below the searched point
    // Summit = tallest real terrain within 2 miles; fall back to +1,500 ft if the DEM lookup fails
    let summit = { lat: loc.lat, lon: loc.lon, em: baseM + DROP };
    try { const peak = await tallestWithin2mi(loc.lat, loc.lon, baseM); if (peak) summit = peak; } catch { /* keep fallback */ }
    const bands = [
      { role: "Summit", lat: summit.lat, lon: summit.lon, em: summit.em },
      { role: "Mid", lat: loc.lat, lon: loc.lon, em: baseM },
      { role: "Base", lat: loc.lat, lon: loc.lon, em: Math.max(0, baseM - DROP) },
    ];
    const data = await Promise.all(bands.map(async b => {
      const u = new URLSearchParams({
        latitude: b.lat, longitude: b.lon, elevation: Math.round(b.em),
        current: "temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day",
        hourly: "freezing_level_height", daily: "snowfall_sum,temperature_2m_max,temperature_2m_min",
        temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
        timezone: "auto", forecast_days: "3",
        // HRRR (3km, terrain-aware) for the near term, seamlessly extended by GFS — best US mountain resolution.
        models: "gfs_seamless",
      });
      return (await fetch(`https://api.open-meteo.com/v1/forecast?${u}`)).json();
    }));
    // freezing level (already in feet with imperial units) — same atmosphere, take it from the mid band at the current hour
    const mid = data[1], ct = mid.current.time.slice(0, 13);
    let fi = mid.hourly.time.findIndex(t => t.slice(0, 13) === ct);
    if (fi < 0) fi = 0;
    const flSeries = mid.hourly.freezing_level_height || [];
    const flFt = flSeries[fi];
    // 72-hour freezing-level trend sparkline — answers "is the rain/snow line rising or falling?"
    let spark = "";
    const flVals = flSeries.filter(v => v != null);
    if (flVals.length > 8) {
      const mn = Math.min(...flVals), mx = Math.max(...flVals), rng = Math.max(500, mx - mn);
      const W = 260, H = 34;
      const pts = flSeries.map((v, i) => v == null ? null :
        `${(i / (flSeries.length - 1) * W).toFixed(1)},${(H - 3 - ((v - mn) / rng) * (H - 8)).toFixed(1)}`).filter(Boolean).join(" ");
      spark = `<svg class="fl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="#9fd0ff" stroke-width="1.6"/></svg>
        <div class="fl-lbls"><span>now</span><span>next 72 h · range ${Math.round(mn).toLocaleString()}–${Math.round(mx).toLocaleString()} ft</span></div>`;
    }
    sl.innerHTML = flFt != null
      ? `❄️ Snow line (freezing level): <b>${Math.round(flFt).toLocaleString()} ft</b> <span class="sl-note">— precip falls as snow above, rain below</span>${spark}`
      : "";
    el.innerHTML = bands.map((b, i) => {
      const c = data[i].current;
      const ft = Math.round(b.em * 3.281).toLocaleString();
      const icon = iconSVG(wmo(c.weather_code, !c.is_day).type);
      const wd = c.wind_direction_10m;
      const arrow = wd != null ? `<span class="band-arrow" style="transform:rotate(${wd + 180}deg)">↑</span>` : "";
      const snow3 = (data[i].daily.snowfall_sum || []).slice(0, 3).reduce((s, x) => s + (x || 0), 0);
      const hi = data[i].daily.temperature_2m_max?.[0], lo = data[i].daily.temperature_2m_min?.[0];
      const hl = (hi != null || lo != null)
        ? `<div class="band-hl">${hi != null ? `<span class="hi">H ${Math.round(hi)}°</span>` : ""}${lo != null ? `<span class="lo">L ${Math.round(lo)}°</span>` : ""}</div>`
        : "";
      return `<div class="band">
        <div class="band-elev"><div class="be-role">${b.role}</div><div class="be-ft">${ft} ft</div></div>
        <div class="band-icon">${icon}</div>
        <div class="band-temps"><div class="band-now">${Math.round(c.temperature_2m)}°</div>${hl}</div>
        <div class="band-wind">${arrow}${Math.round(c.wind_speed_10m)} mph</div>
        <div class="band-snow">${snow3 >= 0.1 ? "❄️ " + snow3.toFixed(1) + '"' : "—"}</div>
      </div>`;
    }).join("");
    // Add data source footnote
    el.innerHTML += `<div class="elev-note"><small><strong>Open-Meteo</strong> · HRRR model, 3km · Downscaled to each elevation — most accurate for the next 48 hours.</small></div>`;
  } catch (e) {
    el.innerHTML = `<div class="snotel-msg">Elevation forecast unavailable (${e.message}).</div>`;
    sl.textContent = "";
  }
}

// ---------- SNODAS snowpack: 1km gridded snow analysis, cropped to Colorado, ----------
// refreshed daily by a GitHub Action and fetched same-origin (see tools/build_snodas.py).
let _snodasPromise = null;
async function getSnodas() {
  if (_snodasPromise) return _snodasPromise;
  _snodasPromise = (async () => {
    const meta = await (await fetch("./data/snodas-co.json", { cache: "no-store" })).json();
    const load = async name => {
      const res = await fetch("./data/" + name);
      const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      return new Int16Array(buf); // little-endian Int16, mm
    };
    const [depth, swe] = await Promise.all([load(meta.products.depth), load(meta.products.swe)]);
    return { meta, depth, swe };
  })();
  return _snodasPromise;
}
function snodasIndex(m, lat, lon) {
  const col = Math.floor((lon - m.west) / m.cellsize);
  const row = Math.floor((m.north - lat) / m.cellsize);
  if (col < 0 || col >= m.ncols || row < 0 || row >= m.nrows) return -1; // outside the CO crop
  return row * m.ncols + col;
}
function snodasSample(s, lat, lon) {
  const i = snodasIndex(s.meta, lat, lon);
  if (i < 0) return null;
  const d = s.depth[i], w = s.swe[i];
  return { depth: d === s.meta.nodata ? null : d, swe: w === s.meta.nodata ? null : w, idx: i }; // mm, or null = no data
}
// Weekly snowpack trend: the Action archives each day's depth grid under data/history/;
// pick the archive closest to 7 days old (4–9 day window) and diff the same cell.
const _snodasHist = {};
async function snodasWeekOld(s, idx) {
  const hist = s.meta.history || [];
  const base = new Date(s.meta.date + "T00:00:00Z").getTime();
  const cand = hist
    .map(d => ({ d, age: (base - new Date(d + "T00:00:00Z").getTime()) / 864e5 }))
    .filter(x => x.age >= 4 && x.age <= 9)
    .sort((a, b) => Math.abs(a.age - 7) - Math.abs(b.age - 7))[0];
  if (!cand) return null;
  if (!_snodasHist[cand.d]) {
    _snodasHist[cand.d] = (async () => {
      const res = await fetch(`./data/history/snodas-depth-${cand.d.replace(/-/g, "")}.bin.gz`);
      if (!res.ok) throw new Error("no archive");
      const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      return new Int16Array(buf);
    })();
  }
  try {
    const old = await _snodasHist[cand.d];
    const v = old[idx];
    if (v == null || v === s.meta.nodata) return null;
    return { days: Math.round(cand.age), mm: v };
  } catch { return null; }
}
async function loadSnodasPoint(loc) {
  const card = $("snodasCard"), body = $("snodasBody");
  body.innerHTML = `<div class="snotel-msg"><span class="spin"></span>Loading snowpack…</div>`;
  try {
    const s = await getSnodas();
    const v = snodasSample(s, loc.lat, loc.lon);
    if (!v) { card.classList.add("hidden"); return; } // outside Colorado coverage — hide card
    card.classList.remove("hidden");
    const depthIn = v.depth != null ? v.depth / 25.4 : null;
    const sweIn = v.swe != null ? v.swe / 25.4 : null;
    if (depthIn == null && sweIn == null) {
      body.innerHTML = `<div class="snotel-msg">No snowpack analysis at this point.</div>`;
      return;
    }
    // weekly change (needs the history archives the Action builds up over its first week)
    let trendTile = "";
    if (v.depth != null) {
      const old = await snodasWeekOld(s, v.idx);
      if (old) {
        const dIn = (v.depth - old.mm) / 25.4;
        const txt = Math.abs(dIn) < 0.5 ? "—" : (dIn > 0 ? "+" : "−") + Math.abs(dIn).toFixed(dIn >= 10 ? 0 : 1);
        trendTile = `<div class="stile hero"><div class="sv">${txt}<span class="su">in</span></div><div class="sl">Change · last ${old.days} days</div></div>`;
      }
    }
    const dateTxt = new Date(s.meta.date + "T12:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
    body.innerHTML = `<div class="sgrid${trendTile ? " three" : ""}">
        <div class="stile hero"><div class="sv">${depthIn != null ? depthIn.toFixed(depthIn >= 10 ? 0 : 1) : "—"}<span class="su">in</span></div><div class="sl">Snow Depth</div></div>
        <div class="stile hero"><div class="sv">${sweIn != null ? sweIn.toFixed(1) : "—"}<span class="su">in</span></div><div class="sl">Snow Water Equiv.</div></div>
        ${trendTile}
      </div>
      <div class="elev-note"><small><strong>NOAA SNODAS</strong> · National Snow Analysis, 1km · Assimilates SNOTEL, airborne &amp; satellite data · Updated daily · Latest: ${dateTxt}</small></div>`;
  } catch {
    card.classList.add("hidden"); // data not published yet, fetch failed, or no DecompressionStream
  }
}

async function loadSnotel(loc) {
  $("snotelHead").innerHTML = "";
  $("snotelBody").innerHTML = `<div class="snotel-msg"><span class="spin"></span>Finding nearest station…</div>`;
  try {
    const stations = await getSnotelStations();
    if (!stations.length) { $("snotelBody").innerHTML = `<div class="snotel-msg">No SNOTEL stations available.</div>`; return; }
    let best = null, bestD = Infinity;
    for (const s of stations) {
      const dmi = haversineMiles(loc.lat, loc.lon, s.lat, s.lon);
      if (dmi < bestD) { bestD = dmi; best = s; }
    }
    $("snotelBody").innerHTML = `<div class="snotel-msg"><span class="spin"></span>Reading ${best.n}…</div>`;
    const latest = await fetchStationLatest(best.t);
    renderSnotel(best, bestD, latest);
    renderStorm(latest, best);
    maybePromoteSnotel(best, bestD, latest);
  } catch (e) {
    $("snotelBody").innerHTML = `<div class="snotel-msg err">Couldn't load SNOTEL data (${e.message}).</div>`;
  }
}

// If the nearest SNOTEL station is closer to the searched point than the NWS
// observation station (or there's no NWS obs at all), its live readings are the
// closest real measurement — promote them into the current-conditions box.
function maybePromoteSnotel(station, distMi, latest) {
  const nws = lastNWS, loc = currentLoc;
  if (!nws || !loc) return;
  const tobs = pickFeed(latest.TOBS, "any");
  if (!tobs || tobs.value == null) return; // no current temp to show

  // Skip an obviously stale reading so we don't overwrite live conditions.
  const when = snotelDate(tobs.date, station.tz);
  const ageH = when ? (Date.now() - when.getTime()) / 3600000 : Infinity;
  if (!(ageH <= 4)) return;

  const obs = nws.obs;
  const obsDist = obs && obs.stationLat != null
    ? haversineMiles(loc.lat, loc.lon, obs.stationLat, obs.stationLon)
    : Infinity;
  if (distMi >= obsDist) return; // NWS station is closer (or tied) — keep it

  const tempF = tobs.value;
  $("nowTemp").textContent = Math.round(tempF) + "°";

  // wind + feels-like (wind chill when cold and breezy)
  const wind = pickFeed(latest.WSPDV, "hourly");
  const wdir = pickFeed(latest.WDIRV, "hourly");
  if (wind && wind.value != null) {
    const mph = Math.round(wind.value);
    const dir = wdir && wdir.value != null && mph > 0 ? " " + bearingToCompass(wdir.value) : "";
    $("mWind").textContent = mph === 0 ? "Calm" : `${mph} mph${dir}`;
    $("mFeels").textContent = Math.round(tempF <= 50 && mph >= 3 ? windChillF(tempF, mph) : tempF) + "°";
  } else {
    $("mFeels").textContent = Math.round(tempF) + "°";
  }

  const rh = pickFeed(latest.RHUM, "hourly");
  if (rh && rh.value != null) $("mHum").textContent = Math.round(rh.value) + "%";

  const ot = when ? when.toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: nws.tz }) : "";
  $("nowObs").textContent = `Observed · ${station.n} (SNOTEL) · ${distMi.toFixed(1)} mi${ot ? " · " + ot : ""}`;
}

// ====================== MAP (Leaflet, no API key) ======================
const USGS_BASE = "https://basemap.nationalmap.gov/arcgis/rest/services";
const ESRI_BASE = "https://server.arcgisonline.com/ArcGIS/rest/services";
// OpenTopoMap rate-limits / serves error ("red") tiles when many low-zoom tiles load at once,
// so we floor the map's zoom while Topo is active and swap any failed tile for a transparent one.
const TOPO_MIN_ZOOM = 5, OTHER_MIN_ZOOM = 2;
const TRANSPARENT_TILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// Base layers (mutually exclusive). All free, no API key. USGS/NatGeo cache to z16 → upscale above that.
const MAP_BASES = {
  topo: () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    { subdomains: "abc", maxZoom: 17, errorTileUrl: TRANSPARENT_TILE, attribution: "© OpenStreetMap, SRTM | © OpenTopoMap" }),
  usgs: () => L.tileLayer(`${USGS_BASE}/USGSTopo/MapServer/tile/{z}/{y}/{x}`,
    { maxNativeZoom: 16, maxZoom: 19, attribution: "USGS The National Map" }),
  natgeo: () => L.tileLayer(`${ESRI_BASE}/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}`,
    { maxNativeZoom: 16, maxZoom: 19, attribution: "Tiles © Esri, National Geographic" }),
  cyclosm: () => L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    { subdomains: "abc", maxZoom: 20, attribution: "© OpenStreetMap, CyclOSM" }),
  sat: () => L.tileLayer(`${ESRI_BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 19, attribution: "Tiles © Esri" }),
};
let mapState = null;
function initMap() {
  if (mapState) return mapState;
  if (typeof L === "undefined") { document.querySelector(".map-card")?.classList.add("hidden"); return null; }
  const map = L.map("map", { attributionControl: true, zoomControl: true }).setView([39.2, -106.5], 9);
  // dedicated pane so radar sits above basemaps but below markers, and ignores clicks
  map.createPane("radar");
  map.getPane("radar").style.zIndex = 350;
  map.getPane("radar").style.pointerEvents = "none";
  const layers = {};
  for (const [k, make] of Object.entries(MAP_BASES)) layers[k] = make();
  layers.usgs.addTo(map);
  map.setMinZoom(OTHER_MIN_ZOOM);
  mapState = { map, layers, current: "usgs", searchMarker: null, stationMarker: null, obsMarker: null };
  document.querySelectorAll("#mapToggles button").forEach(btn =>
    btn.addEventListener("click", () => setBase(btn.dataset.base)));
  map.on("click", e => { // tap-to-pick — reuse the decimal-degree flow
    const loc = coordLoc({ lat: e.latlng.lat, lon: e.latlng.lng });
    $("q").value = loc.name;
    loadWeather(loc);
  });
  initRadar();
  return mapState;
}

// ---- radar overlay: NEXRAD/MRMS (IEM) max fidelity + RainViewer ----
let radarLayer = null, radarSource = "off", radarOpacity = 0.75;
let radarFrames = [], radarIdx = 0, radarTimer = null, radarPlaying = false;
function initRadar() {
  document.querySelectorAll("#radarSources button").forEach(btn =>
    btn.addEventListener("click", () => setRadar(btn.dataset.radar)));
  const op = $("radarOpacity");
  if (op) op.addEventListener("input", e => {
    radarOpacity = e.target.value / 100;
    if (radarLayer) radarLayer.setOpacity(radarOpacity);
    if (radarFrames[radarIdx]) radarFrames[radarIdx].layer.setOpacity(radarOpacity);
  });
  $("radarPlay")?.addEventListener("click", () => radarPlaying ? pauseRadar() : playRadar());
  $("radarTimeline")?.addEventListener("input", e => { pauseRadar(); showFrame(+e.target.value); });
  const head = $("radarHead"), body = $("radarBody");
  if (head) head.addEventListener("click", () => {
    const open = !body.hasAttribute("hidden");
    body.toggleAttribute("hidden", open);
    head.setAttribute("aria-expanded", String(!open));
  });
}
function clearRadar() {
  if (radarTimer) { clearTimeout(radarTimer); radarTimer = null; }
  radarPlaying = false;
  if (radarLayer) { mapState.map.removeLayer(radarLayer); radarLayer = null; }
  radarFrames.forEach(f => mapState.map.removeLayer(f.layer));
  radarFrames = [];
}
async function setRadar(source) {
  if (mapState) clearRadar();
  radarSource = source;
  document.querySelectorAll("#radarSources button").forEach(b => b.classList.toggle("active", b.dataset.radar === source));
  $("radarAnim").toggleAttribute("hidden", source !== "rainviewer");
  const stateEl = $("radarState"), noteEl = $("radarNote");
  if (source === "off") { stateEl.textContent = "Off"; noteEl.textContent = "Radar off."; return; }
  if (!mapState) return;
  if (source === "nexrad") {
    stateEl.textContent = "NEXRAD";
    noteEl.textContent = "NOAA NEXRAD national composite (Iowa Env. Mesonet) — highest-fidelity US radar.";
    radarLayer = L.tileLayer("https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png",
      { pane: "radar", opacity: radarOpacity, maxZoom: 19, attribution: "Radar: NWS NEXRAD / Iowa Env. Mesonet" }).addTo(mapState.map);
  } else if (source === "rainviewer") {
    stateEl.textContent = "RainViewer";
    noteEl.textContent = "Loading RainViewer…";
    try {
      const d = await (await fetch("https://api.rainviewer.com/public/weather-maps.json")).json();
      if (radarSource !== "rainviewer") return; // selection changed during fetch
      const past = d.radar?.past || [], nowcast = d.radar?.nowcast || [];
      const seq = [...past, ...nowcast];
      if (!seq.length) throw new Error("no frames");
      radarFrames = seq.map((fr, i) => ({
        time: fr.time,
        forecast: i >= past.length,
        layer: L.tileLayer(`${d.host}${fr.path}/256/{z}/{x}/{y}/4/1_1.png`,
          { pane: "radar", opacity: 0, maxZoom: 19, attribution: "Radar: RainViewer" }).addTo(mapState.map),
      }));
      const tl = $("radarTimeline"); tl.max = radarFrames.length - 1; tl.value = past.length - 1;
      const fcMin = nowcast.length ? Math.round((nowcast[nowcast.length - 1].time - past[past.length - 1].time) / 60) : 0;
      noteEl.textContent = fcMin
        ? `RainViewer loop — past 2 h + ${fcMin} min predicted precip (⏩ forecast frames).`
        : "RainViewer loop — past 2 h. No live forecast frames from RainViewer right now (its free nowcast is intermittent).";
      showFrame(Math.max(0, past.length - 1)); // start on the "now" frame
      playRadar();
    } catch (e) {
      noteEl.textContent = "Couldn't load RainViewer (" + e.message + ").";
    }
  }
}
function showFrame(i) {
  if (!radarFrames.length) return;
  radarIdx = (i + radarFrames.length) % radarFrames.length;
  radarFrames.forEach((f, j) => f.layer.setOpacity(j === radarIdx ? radarOpacity : 0));
  const f = radarFrames[radarIdx], tl = $("radarTimeline"), lbl = $("radarTime");
  if (tl) tl.value = radarIdx;
  if (lbl) {
    const mins = Math.round((f.time * 1000 - Date.now()) / 60000);
    const rel = mins === 0 ? "now" : mins > 0 ? `+${mins} min` : `−${-mins} min`;
    const timeStr = new Date(f.time * 1000).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }) + " · " + rel;
    lbl.innerHTML = f.forecast ? `<span class="fc-badge">FORECAST</span> ${timeStr}` : timeStr;
  }
}
function playRadar() {
  radarPlaying = true;
  $("radarPlay").textContent = "⏸";
  const step = () => {
    showFrame(radarIdx + 1);
    const hold = radarIdx === radarFrames.length - 1 ? 1400 : 600; // pause on the final frame
    radarTimer = setTimeout(step, hold);
  };
  if (radarTimer) clearTimeout(radarTimer);
  radarTimer = setTimeout(step, 600);
}
function pauseRadar() {
  radarPlaying = false;
  if ($("radarPlay")) $("radarPlay").textContent = "▶";
  if (radarTimer) { clearTimeout(radarTimer); radarTimer = null; }
}
function setBase(key) {
  const ms = mapState;
  if (!ms || !ms.layers[key] || key === ms.current) return;
  ms.map.removeLayer(ms.layers[ms.current]);
  ms.layers[key].addTo(ms.map);
  ms.current = key;
  ms.map.setMinZoom(key === "topo" ? TOPO_MIN_ZOOM : OTHER_MIN_ZOOM); // re-zooms in if currently below
  document.querySelectorAll("#mapToggles button").forEach(b => b.classList.toggle("active", b.dataset.base === key));
}
function updateMapSearch(loc) {
  const ms = initMap();
  if (!ms) return;
  const ll = [loc.lat, loc.lon];
  if (ms.searchMarker) ms.searchMarker.setLatLng(ll);
  else ms.searchMarker = L.circleMarker(ll, { radius: 8, weight: 2, color: "#fff", fillColor: "#6ec6ff", fillOpacity: 1, interactive: false }).addTo(ms.map);
  ms.map.setView(ll, Math.max(ms.map.getZoom(), 11));
  setTimeout(() => ms.map.invalidateSize(), 60); // container may have just become visible
}
function updateMapStation(station) {
  const ms = mapState;
  if (!ms) return;
  const ll = [station.lat, station.lon];
  if (ms.stationMarker) {
    ms.stationMarker.setLatLng(ll);
    ms.stationMarker.setTooltipContent(station.n);
  } else {
    ms.stationMarker = L.circleMarker(ll, { radius: 7, weight: 2, color: "#fff", fillColor: "#ffcf6e", fillOpacity: 1, interactive: false }).addTo(ms.map);
    ms.stationMarker.bindTooltip(station.n, { permanent: true, direction: "top", offset: [0, -5], className: "station-label" });
  }
  ms.map.invalidateSize(); // refresh size first so fitBounds frames correctly and tiles load for the real viewport
  const pts = [ll];
  if (ms.searchMarker) pts.push(ms.searchMarker.getLatLng());
  if (ms.obsMarker) pts.push(ms.obsMarker.getLatLng());
  if (pts.length > 1) ms.map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 12 });
}
// Red marker at the station broadcasting the current conditions (matches the "Observed ·" credit).
function updateMapObs(obs) {
  const ms = initMap();
  if (!ms) return;
  if (!obs || obs.stationLat == null || obs.stationLon == null) {
    if (ms.obsMarker) { ms.map.removeLayer(ms.obsMarker); ms.obsMarker = null; }
    return;
  }
  const ll = [obs.stationLat, obs.stationLon], name = (obs.stationName || "Observation").split(",")[0];
  if (ms.obsMarker) {
    ms.obsMarker.setLatLng(ll);
    ms.obsMarker.setTooltipContent(name);
  } else {
    ms.obsMarker = L.circleMarker(ll, { radius: 7, weight: 2, color: "#fff", fillColor: "#ff5a5a", fillOpacity: 1, interactive: false }).addTo(ms.map);
    ms.obsMarker.bindTooltip(name, { permanent: true, direction: "bottom", offset: [0, 7], className: "station-label obs-label" });
  }
}

renderChips();
initDailyExpand();

// Register the service worker for offline support + installable PWA (no-op on unsupported browsers).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
