import { useEffect, useRef, useState, useCallback } from "react";
import TrendChart from "./TrendChart";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { countyFromGeoid } from "../lib/counties";

const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

const ACS_YEARS = [
  { value: 2024, label: "2020–2024 (Jan 2026) — Latest" },
  { value: 2023, label: "2019–2023 (Dec 2024)"          },
  { value: 2022, label: "2018–2022 (Dec 2023)"          },
  { value: 2021, label: "2017–2021 (Dec 2022)"          },
];

const ACC_LEGEND = [
  { color: "#f1bf83", label: "Excellent",  range: "65–100" },
  { color: "#185FA5", label: "Good",       range: "50–65"  },
  { color: "#5ec962", label: "Moderate",   range: "38–50"  },
  { color: "#F4C0D1", label: "Low",        range: "30–38"  },
  { color: "#534aac", label: "Minimal",    range: "0–30"   },
];

const DEFAULT_WEIGHTS = {
  poverty_rate: 25,
  snap_rate: 15,
  food_desert: 18,
  no_vehicle_rate: 12,
  median_income: 10,
  unemployment_rate: 10,
  housing_cost_burden: 10,
};

const LABELS = {
  poverty_rate: "Poverty rate",
  snap_rate: "SNAP enrollment",
  food_desert: "Food desert",
  no_vehicle_rate: "No vehicle access",
  median_income: "Low income",
  unemployment_rate: "Unemployment",
  housing_cost_burden: "Housing cost burden",
};

// ── Gap-analysis & weighted-scoring helpers (ported from the pre-refactor App.jsx) ──

// Haversine distance in miles between two lat/lng points
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Average of outer ring coordinates — used as a cheap tract centroid
function polyCentroid(feature) {
  const geom = feature.geometry;
  const ring =
    geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0][0];
  let sumLng = 0, sumLat = 0;
  ring.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
  return [sumLng / ring.length, sumLat / ring.length];
}

// ── ZIP centroids (approximate) for nearest-ZIP tract coloring (Option B) ──────
const ZIP_COORDS = {
  // Miami-Dade
  "33054":[25.907,-80.244],"33055":[25.930,-80.281],"33056":[25.947,-80.251],
  "33127":[25.813,-80.209],"33128":[25.778,-80.204],"33130":[25.767,-80.202],
  "33132":[25.783,-80.185],"33135":[25.764,-80.234],"33136":[25.787,-80.201],
  "33142":[25.808,-80.235],"33147":[25.852,-80.238],"33150":[25.855,-80.209],
  "33161":[25.895,-80.183],"33162":[25.931,-80.190],"33169":[25.947,-80.210],
  "33125":[25.784,-80.237],"33126":[25.777,-80.300],"33133":[25.735,-80.245],
  "33134":[25.755,-80.271],"33138":[25.851,-80.180],"33149":[25.700,-80.163],
  "33155":[25.735,-80.313],"33165":[25.735,-80.353],"33166":[25.823,-80.300],
  "33174":[25.760,-80.363],"33175":[25.720,-80.400],"33177":[25.595,-80.410],
  "33178":[25.842,-80.380],"33179":[25.960,-80.190],"33180":[25.958,-80.143],
  // Broward
  "33311":[26.145,-80.185],"33312":[26.100,-80.200],"33313":[26.155,-80.230],
  "33314":[26.075,-80.230],"33315":[26.085,-80.170],"33316":[26.100,-80.135],
  "33317":[26.115,-80.240],"33319":[26.185,-80.230],"33322":[26.145,-80.290],
  "33324":[26.110,-80.280],"33325":[26.110,-80.320],"33328":[26.070,-80.280],
  "33060":[26.235,-80.125],"33062":[26.245,-80.095],"33063":[26.255,-80.210],
  "33064":[26.275,-80.130],"33065":[26.270,-80.255],"33068":[26.215,-80.215],
  "33069":[26.235,-80.165],"33071":[26.240,-80.280],"33073":[26.290,-80.220],
  "33076":[26.305,-80.270],"33309":[26.185,-80.170],"33334":[26.205,-80.135],
  "33351":[26.180,-80.280],"33388":[26.120,-80.290],"33441":[26.310,-80.100],
  "33442":[26.305,-80.155],"33444":[26.455,-80.075],"33445":[26.450,-80.110],
  // Palm Beach
  "33409":[26.710,-80.085],"33430":[26.680,-80.665],"33435":[26.520,-80.070],
  "33460":[26.620,-80.060],"33461":[26.615,-80.095],"33462":[26.560,-80.080],
  "33463":[26.590,-80.130],"33467":[26.580,-80.180],"33472":[26.630,-80.190],
  "33484":[26.455,-80.155],"33401":[26.715,-80.065],"33403":[26.795,-80.075],
  "33404":[26.775,-80.070],"33405":[26.680,-80.055],"33406":[26.660,-80.095],
  "33407":[26.760,-80.085],"33408":[26.845,-80.060],"33410":[26.855,-80.090],
  "33411":[26.715,-80.210],"33412":[26.780,-80.210],"33413":[26.660,-80.160],
  "33414":[26.660,-80.250],"33415":[26.650,-80.130],"33417":[26.720,-80.125],
  "33418":[26.830,-80.160],"33426":[26.525,-80.115],"33428":[26.350,-80.230],
  "33431":[26.375,-80.100],"33432":[26.345,-80.080],"33433":[26.360,-80.155],
};

// ZIP population (matches backend main.py) for per-ZIP impact score
const ZIP_POP = {
  "33054":28000,"33055":32000,"33056":34000,"33127":19000,"33128":15000,
  "33130":21000,"33132":14000,"33135":24000,"33136":18000,"33142":27000,
  "33147":31000,"33150":22000,"33161":29000,"33162":31000,"33169":38000,
  "33125":22000,"33126":31000,"33133":18000,"33134":20000,"33138":19000,
  "33149":12000,"33155":29000,"33165":33000,"33166":28000,"33174":26000,
  "33175":35000,"33177":38000,"33178":41000,"33179":32000,"33180":28000,
  "33311":35000,"33312":42000,"33313":39000,"33314":28000,"33315":18000,
  "33316":12000,"33317":44000,"33319":37000,"33322":46000,"33324":41000,
  "33325":38000,"33328":43000,"33060":38000,"33062":29000,"33063":44000,
  "33064":36000,"33065":42000,"33068":38000,"33069":31000,"33071":40000,
  "33073":35000,"33076":28000,"33309":32000,"33334":29000,"33351":36000,
  "33388":18000,"33441":31000,"33442":28000,"33444":22000,"33445":24000,
  "33409":28000,"33430":18000,"33435":24000,"33460":21000,"33461":32000,
  "33462":27000,"33463":35000,"33467":41000,"33472":29000,"33484":31000,
  "33401":28000,"33403":18000,"33404":22000,"33405":19000,"33406":31000,
  "33407":24000,"33408":21000,"33410":38000,"33411":42000,"33412":19000,
  "33413":36000,"33414":31000,"33415":38000,"33417":29000,"33418":44000,
  "33426":24000,"33428":31000,"33431":28000,"33432":32000,"33433":36000,
};
const DEFAULT_ZIP_POP = 25000;

// Nearest ZIP (by squared distance) to a tract centroid, restricted to a set of ZIPs
function nearestZip(lat, lng, zipList) {
  let best = null, bestD = Infinity;
  for (const z of zipList) {
    const c = ZIP_COORDS[z];
    if (!c) continue;
    const dLat = c[0] - lat, dLng = c[1] - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}


// Approximate circle polygon for a point at (lng, lat) with radius in miles
function makeCircle(lng, lat, radiusMiles, steps = 48) {
  const R = 3958.8;
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const dLat = ((radiusMiles / R) * 180) / Math.PI * Math.cos(bearing);
    const dLng =
      (((radiusMiles / R) * 180) / Math.PI / Math.cos((lat * Math.PI) / 180)) *
      Math.sin(bearing);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

function scoreColor(score) {
  if (score >= 80) return "#2d1160";
  if (score >= 60) return "#440154";
  if (score >= 40) return "#3b528b";
  if (score >= 20) return "#21918c";
  return "#5ec962";
}

// Index of the right-most insertion point for x in a sorted array — i.e. the
// count of values <= x. Used for percentile ranking.
function bisectRight(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Percentile-rank normalize the raw ACS fields the weight sliders operate on.
// Each value becomes its fractional rank in [0,1] — "this tract is worse than X%
// of tracts." This is the CDC Social Vulnerability Index approach: robust to
// outliers (a single 100%-poverty group-quarters tract can't compress the scale)
// and spreads scores evenly across the full range.
// median_income is inverted — lower income means higher need.
function normalizeTracts(geojson) {
  const fields = ["poverty_rate", "snap_rate", "no_vehicle_rate", "median_income",
                  "unemployment_rate", "housing_cost_burden"];
  const invert = new Set(["median_income"]);
  fields.forEach((field) => {
    const sorted = geojson.features
      .map((x) => x.properties[field])
      .filter((v) => v != null && !Number.isNaN(Number(v)))
      .map(Number)
      .sort((a, b) => a - b);
    const n = sorted.length;
    geojson.features.forEach((f) => {
      const v = f.properties[field];
      if (v == null || Number.isNaN(Number(v)) || n === 0) { f.properties[field + "_norm"] = null; return; }
      let rank = bisectRight(sorted, Number(v)) / n; // fraction of tracts <= this value
      if (invert.has(field)) rank = 1 - rank;
      f.properties[field + "_norm"] = rank;
    });
  });
  geojson.features.forEach((f) => {
    const p = f.properties;
    p.food_desert_norm =
      p.food_desert === 1 || p.food_desert === "1" ? 1
      : p.food_desert === 0 || p.food_desert === "0" ? 0
      : null;
  });
  return geojson;
}

function computeScore(props, w) {
  const keys = Object.keys(w);
  let weighted = 0, present = 0;
  keys.forEach((k) => {
    const norm = props[k + "_norm"];
    if (norm != null && !Number.isNaN(Number(norm))) {
      weighted += Number(norm) * w[k];
      present += w[k];
    }
  });
  const count = keys.filter((k) => {
    const n = props[k + "_norm"];
    return n != null && !Number.isNaN(Number(n));
  }).length;
  return count >= 3 && present > 0 ? (weighted / present) * 100 : null;
}

function jenksBreaks(data, k) {
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= k) return sorted.slice(0, k - 1);
  const lc = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(1));
  const vc = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  for (let q = 1; q <= k; q++) vc[1][q] = 0;
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0;
    for (let m = 1; m <= l; m++) {
      const idx = l - m + 1;
      const v = sorted[idx - 1];
      s1 += v; s2 += v * v; w++;
      const variance = s2 - (s1 * s1) / w;
      const prev = idx - 1;
      if (prev !== 0) {
        for (let q = 2; q <= k; q++) {
          const candidate = variance + vc[prev][q - 1];
          if (vc[l][q] >= candidate) { lc[l][q] = idx; vc[l][q] = candidate; }
        }
      }
    }
    lc[l][1] = 1;
    vc[l][1] = s2 - (s1 * s1) / l;
  }
  const breaks = [];
  let pos = n;
  for (let q = k; q >= 2; q--) {
    breaks.unshift(sorted[lc[pos][q] - 2]);
    pos = lc[pos][q] - 1;
  }
  return breaks;
}


// Normalize a CSV county string to the canonical name countyFromGeoid() returns,
// so per-ZIP data and tract lookups use the same county keys.
function countyFromGeoid_zipCounty(name) {
  if (!name) return "";
  const n = String(name).toLowerCase();
  if (n.includes("miami") || n.includes("dade")) return countyFromGeoid("12086000000");
  if (n.includes("broward"))                     return countyFromGeoid("12011000000");
  if (n.includes("palm"))                        return countyFromGeoid("12099000000");
  if (n.includes("monroe"))                      return countyFromGeoid("12087000000");
  return name;
}

export default function HealthMap() {
  const mapContainer = useRef(null);
  const map          = useRef(null);
  const fullBounds   = useRef(null);
  const pollRef      = useRef(null);

  // ── Gap analysis / weighted-scoring refs — hold latest data so sliders
  //    can recompute instantly without refetching from the backend.
  const geojsonRef      = useRef(null);
  const agenciesRef     = useRef(null);
  const tractCentroids  = useRef({});
  const scoresRef       = useRef({}); // GEOID -> current weighted need score
  const weightsRef      = useRef(DEFAULT_WEIGHTS);
  const radiusRef       = useRef(2);

  // ── Layer
  const [activeLayer,    setActiveLayer]    = useState("need");

  // ── ACS
  const [acsYear,        setAcsYear]        = useState(2024);
  const [acsStatus,      setAcsStatus]      = useState({});

  // ── FSF — available years loaded from backend
  const [fsfAvailYears,  setFsfAvailYears]  = useState([]);   // [{year, rows, filename}]
  const [fsfYear,        setFsfYear]        = useState(null); // null = no selection yet

  // ── Upload panel
  const [uploadOpen,     setUploadOpen]     = useState(false);
  const [showTrend,      setShowTrend]      = useState(false);
  const [activeTab,      setActiveTab]      = useState("upload");
  const [uploadYear,     setUploadYear]     = useState("");
  const [fsfFile,        setFsfFile]        = useState(null);
  const [fsfUploading,   setFsfUploading]   = useState(false);
  const [fsfMsg,         setFsfMsg]         = useState("");

  // ── History
  const [fsfHistory,     setFsfHistory]     = useState([]);
  const [selectedIds,    setSelectedIds]    = useState(new Set());
  const [deleting,       setDeleting]       = useState(false);

  // ── Tract click
  const [selected,       setSelected]       = useState(null);

  // ── Toast
  const [toast,          setToast]          = useState("");

  // ── First-load intro (shown once per device; reopenable via header "?")
  const [showIntro, setShowIntro] = useState(() => {
    try { return !localStorage.getItem("fsf_intro_seen"); } catch { return true; }
  });
  const closeIntro = () => {
    try { localStorage.setItem("fsf_intro_seen", "1"); } catch { /* private mode */ }
    setShowIntro(false);
  };

  // ── Weight sliders (Need score view only)
  const [weights,        setWeights]        = useState(DEFAULT_WEIGHTS);
  const [showSettings,   setShowSettings]   = useState(false);
  const [breaks,         setBreaks]         = useState(null);

  // ── Coverage gap analysis (Need score view only)
  const [radius,         setRadius]         = useState(2);
  const [gapTracts,      setGapTracts]      = useState([]);

  // ── Resizable / closable side panels
  const [gapWidth,       setGapWidth]       = useState(300); // left coverage-gaps sidebar
  const [needWidth,      setNeedWidth]      = useState(300); // right detail panel
  const [gapOpen,        setGapOpen]        = useState(true);

  // Drag-to-resize a side panel — works with mouse and touch. `grow` is +1 when
  // dragging right widens the panel (left sidebar) and -1 when dragging left
  // widens it (right panel).
  const PANEL_MIN = 220, PANEL_MAX = 560;
  const startResize = (e, setWidth, grow) => {
    const pointX = (ev) => (ev.touches ? ev.touches[0].clientX : ev.clientX);
    if (e.type === "mousedown") e.preventDefault();
    const startX = pointX(e);
    const startW = grow > 0 ? gapWidth : needWidth;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev) => {
      if (ev.cancelable) ev.preventDefault();          // stop page scroll on touch
      const max = Math.min(PANEL_MAX, window.innerWidth - 80); // never wider than screen
      const next = startW + grow * (pointX(ev) - startX);
      setWidth(Math.max(PANEL_MIN, Math.min(max, next)));
    };
    const onUp = () => {
      ["mousemove", "touchmove"].forEach(t => window.removeEventListener(t, onMove));
      ["mouseup", "touchend"].forEach(t => window.removeEventListener(t, onUp));
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  };

  useEffect(() => { weightsRef.current = weights; }, [weights]);
  useEffect(() => { radiusRef.current = radius; }, [radius]);

  const showToast = (msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(""), duration);
  };

  // ── Fetch FSF available years ──────────────────────────────────────────────
  const fetchFsfAvailYears = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/fsf/available-years`);
      const data = await res.json();
      setFsfAvailYears(data);
      return data;
    } catch { setFsfAvailYears([]); return []; }
  }, []);

  // ── Fetch FSF upload history ───────────────────────────────────────────────
  const fetchFsfHistory = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/fsf/upload-history`);
      const data = await res.json();
      setFsfHistory(data);
    } catch { setFsfHistory([]); }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Fetch available years
      try {
        const res  = await fetch(`${API}/api/fsf/available-years`);
        const data = await res.json();
        setFsfAvailYears(data);
        // Auto-select latest year for the map display only —
        // leave the upload dropdown on its placeholder until the user picks.
        if (data && data.length > 0) {
          const latest = data.sort((a, b) => b.year - a.year)[0].year;
          setFsfYear(latest);
        }
      } catch { setFsfAvailYears([]); }
      // Fetch history
      try {
        const res  = await fetch(`${API}/api/fsf/upload-history`);
        const data = await res.json();
        setFsfHistory(data);
      } catch { setFsfHistory([]); }
      // Fetch agencies (for coverage-gap analysis)
      try {
        const res  = await fetch("/agencies.geojson");
        const data = await res.json();
        agenciesRef.current = data;
      } catch { agenciesRef.current = { type: "FeatureCollection", features: [] }; }
    };
    init();
  }, []);

  // ── Apply weight sliders — recompute every tract's score, update the
  //    choropleth (Jenks breaks) and feature-state, without refetching. ───────
  const applyWeights = useCallback((w, geojson) => {
    if (!map.current || !map.current.getLayer("tracts-fill") || !geojson) return;
    const validScores = [];
    const scores = {};
    geojson.features.forEach((f) => {
      const p = f.properties;
      const score = computeScore(p, w);
      map.current.setFeatureState({ source: "tracts", id: p.GEOID }, { computed_score: score });
      scores[p.GEOID] = score;
      if (score !== null) validScores.push(score);
    });
    scoresRef.current = scores;

    const q = jenksBreaks(validScores, 5);
    setBreaks(q);

    map.current.setPaintProperty("tracts-fill", "fill-color", [
      "step", ["coalesce", ["feature-state", "computed_score"], -1],
      "#cccccc",
      0,    "#5ec962",
      q[0], "#21918c",
      q[1], "#3b528b",
      q[2], "#440154",
      q[3], "#2d1160",
    ]);
  }, []);

  // ── Recompute coverage gaps — called whenever radius changes or fresh
  //    weighted scores are applied. Uses the current client-side score. ──────
  const recomputeGap = useCallback((geojson, agencies, r) => {
    if (!geojson || !agencies || !map.current) return;

    const agencyPoints = agencies.features.map((f) => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));

    const gaps = [];
    geojson.features.forEach((f) => {
      const props = f.properties;
      const score = scoresRef.current[props.GEOID];
      if (score === null || score === undefined) return;

      if (!tractCentroids.current[props.GEOID]) {
        tractCentroids.current[props.GEOID] = polyCentroid(f);
      }
      const [lng, lat] = tractCentroids.current[props.GEOID];

      const covered = agencyPoints.some(
        (a) => distanceMiles(lat, lng, a.lat, a.lng) <= r
      );

      map.current.setFeatureState(
        { source: "tracts", id: props.GEOID },
        { covered }
      );

      if (!covered) gaps.push({ ...props, _score: score });
    });

    gaps.sort((a, b) => b._score - a._score);
    setGapTracts(gaps);

    const coverageSource = map.current.getSource("coverage");
    if (coverageSource) {
      coverageSource.setData({
        type: "FeatureCollection",
        features: agencies.features.map((f) => ({
          type: "Feature",
          geometry: makeCircle(
            f.geometry.coordinates[0],
            f.geometry.coordinates[1],
            r
          ),
          properties: {},
        })),
      });
    }
  }, []);

  // ── Load ACS tracts ────────────────────────────────────────────────────────
  const loadAcsData = useCallback(async (year) => {
    if (!map.current) return;
    const source = map.current.getSource("tracts");
    if (!source) return;
    try {
      const res = await fetch(`${API}/api/acs/tracts?acs_year=${year}`);
      if (!res.ok) return;
      const apiData = await res.json();
      const lookup = {};
      apiData.forEach(t => { lookup[t.tract_id] = t; });

      const geojson = await (await fetch("/tracts_2022.geojson")).json();
      geojson.features.forEach(f => {
        const m = lookup[f.properties.GEOID];
        if (m) {
          f.properties.need_score           = m.need_score; // kept for reference only
          f.properties.median_income        = m.median_income;
          f.properties.total_pop            = m.population;
          f.properties.county_name          = m.county;
          f.properties.poverty_rate         = m.pct_below_poverty        != null ? +Number(m.pct_below_poverty).toFixed(1)        : null;
          f.properties.snap_rate            = m.pct_snap_enrollment      != null ? +Number(m.pct_snap_enrollment).toFixed(1)      : null;
          f.properties.no_vehicle_rate      = m.pct_no_vehicle           != null ? +Number(m.pct_no_vehicle).toFixed(1)           : null;
          f.properties.food_desert          = m.food_desert;
          f.properties.supermarket_dist_mi  = m.supermarket_dist_mi;
          f.properties.unemployment_rate    = m.unemployment_rate        != null ? +Number(m.unemployment_rate).toFixed(1)        : null;
          f.properties.housing_cost_burden  = m.housing_cost_burden_pct  != null ? +Number(m.housing_cost_burden_pct).toFixed(1) : null;
        } else {
          f.properties.need_score = null;
        }
      });

      normalizeTracts(geojson);
      geojsonRef.current = geojson;
      source.setData(geojson);

      // Defer until MapLibre finishes rebuilding tiles from the new source data.
      // setData processes asynchronously in a web worker; applying feature states
      // before the tiles exist causes them to be silently dropped.
      map.current.once("idle", () => {
        if (!map.current) return;
        applyWeights(weightsRef.current, geojson);
        // Constant opacity — coverage is shown via the blue radius circles, so the
        // choropleth colors stay stable when the radius slider changes.
        map.current.setPaintProperty("tracts-fill", "fill-opacity", 0.72);
        recomputeGap(geojson, agenciesRef.current, radiusRef.current);
      });
    } catch (e) { console.error("ACS load error", e); }
  }, [applyWeights, recomputeGap]);

  // ── Load FSF data ──────────────────────────────────────────────────────────
  const loadFsfData = useCallback(async (year) => {
    if (!map.current || !year) return;
    const source = map.current.getSource("tracts");
    if (!source) return;
    try {
      // ── Option B: per-ZIP impact score, assigned to each tract by nearest ZIP ──
      // Pull the raw per-ZIP distribution rows and compute a score for every ZIP,
      // then color each tract using the score of its geographically nearest ZIP.
      // This produces a within-county color mix instead of one flat county color.
      const res = await fetch(`${API}/api/fsf/distributions?dist_year=${year}`);
      if (!res.ok) return;
      const rows = await res.json();

      // 1. Aggregate rows → per-ZIP totals (sum across months)
      const zipAgg = {};
      rows.forEach(d => {
        const z = String(d.zip_code).padStart(5, "0");
        if (!zipAgg[z]) {
          zipAgg[z] = { ind: 0, meals: 0, hh: 0, months: 0, county: d.county };
        }
        zipAgg[z].ind    += d.individuals_served || 0;
        zipAgg[z].meals  += d.meals_served       || 0;
        zipAgg[z].hh     += d.households_served   || 0;
        zipAgg[z].months += 1;
      });

      // 2. Compute an impact score per ZIP (same formula & benchmarks as backend)
      const zipScore = {};
      Object.keys(zipAgg).forEach(z => {
        const a = zipAgg[z];
        const months  = Math.max(a.months, 1);
        const avgInd   = a.ind   / months;
        const avgMeals = a.meals / months;
        const pop      = ZIP_POP[z] || DEFAULT_ZIP_POP;
        const popPct   = Math.min((avgInd / pop) / 0.05, 1.0) * 60;
        const mealsSc  = Math.min((avgMeals / Math.max(avgInd, 1)) / 5.0, 1.0) * 40;
        zipScore[z] = {
          score: Math.round((popPct + mealsSc) * 10) / 10,
          ind:   a.ind,
          meals: a.meals,
          hh:    a.hh,
          county: a.county,
        };
      });

      // 3. Which ZIPs belong to each county (only those present in this year's data)
      const zipsByCounty = {};
      Object.keys(zipScore).forEach(z => {
        const cty = countyFromGeoid_zipCounty(zipScore[z].county);
        if (!zipsByCounty[cty]) zipsByCounty[cty] = [];
        zipsByCounty[cty].push(z);
      });

      // 4. Assign each tract the score of its nearest ZIP (within the same county)
      const geojson = await (await fetch("/tracts_2022.geojson")).json();
      geojson.features.forEach(f => {
        const county = countyFromGeoid(f.properties.GEOID);
        const zipList = zipsByCounty[county];
        if (!zipList || zipList.length === 0) {
          f.properties.impact_score = null;
          f.properties.households_served = null;
          f.properties.individuals_served = null;
          f.properties.meals_served = null;
          f.properties.nearest_zip = null;
          return;
        }
        // tract centroid (cache reused from need-score pass if present)
        let cen = tractCentroids.current[f.properties.GEOID];
        if (!cen) { cen = polyCentroid(f); tractCentroids.current[f.properties.GEOID] = cen; }
        const [lng, lat] = cen;
        const z = nearestZip(lat, lng, zipList);
        const s = z ? zipScore[z] : null;
        if (s) {
          f.properties.impact_score       = s.score;
          f.properties.households_served  = s.hh;
          f.properties.individuals_served = s.ind;
          f.properties.meals_served       = s.meals;
          f.properties.nearest_zip        = z;
          f.properties.dist_year          = year;
        } else {
          f.properties.impact_score = null;
          f.properties.nearest_zip  = null;
        }
      });

      source.setData(geojson);
      geojsonRef.current = geojson;

      map.current.setPaintProperty("tracts-fill", "fill-color", [
        "step", ["coalesce", ["get", "impact_score"], -1],
        "#cccccc", 0, "#534aac", 30, "#F4C0D1", 38, "#5ec962", 50, "#185FA5", 65, "#f1bf83",
      ]);
      map.current.setPaintProperty("tracts-fill", "fill-opacity", 0.72);
    } catch (e) { console.error("FSF load error", e); }
  }, []);

  // ── Trigger ACS fetch ──────────────────────────────────────────────────────
  const triggerAcsFetch = useCallback(async (year) => {
    setAcsStatus(prev => ({ ...prev, [year]: { status: "fetching", message: `Fetching ACS ${year}...` } }));
    showToast(`Fetching ACS ${year} from Census Bureau...`, 8000);
    try {
      const res  = await fetch(`${API}/api/acs/fetch?acs_year=${year}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setAcsStatus(prev => ({ ...prev, [year]: { status: "error", message: data.detail } }));
        showToast(`❌ ${data.detail}`);
        return;
      }
      if (data.cached) {
        setAcsStatus(prev => ({ ...prev, [year]: { status: "done", message: `ACS ${year} loaded`, tracts: data.tracts || 0 } }));
        await loadAcsData(year);
        showToast(`✅ ACS ${year} data loaded`);
        return;
      }
      pollRef.current = setInterval(async () => {
        try {
          const sr   = await fetch(`${API}/api/acs/fetch-status?acs_year=${year}`);
          const stat = await sr.json();
          setAcsStatus(prev => ({ ...prev, [year]: stat }));
          if (stat.status === "done") {
            clearInterval(pollRef.current);
            await loadAcsData(year);
            showToast(`✅ ACS ${year} — ${stat.tracts || "Data"} loaded successfully`);
          } else if (stat.status === "error") {
            clearInterval(pollRef.current);
            showToast(`❌ ${stat.message}`);
          }
        } catch { clearInterval(pollRef.current); }
      }, 2000);
    } catch (e) {
      setAcsStatus(prev => ({ ...prev, [year]: { status: "error", message: e.message } }));
      showToast("❌ Could not reach backend");
    }
  }, [loadAcsData]);

  // ── ACS year change ────────────────────────────────────────────────────────
  const handleAcsYearChange = useCallback(async (year) => {
    setAcsYear(year);
    setSelected(null);
    if (map.current) map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
    if (acsStatus[year]?.status === "done") {
      await loadAcsData(year);
      showToast(`Switched to ACS ${year}`);
    } else if (acsStatus[year]?.status !== "fetching") {
      await triggerAcsFetch(year);
    }
  }, [acsStatus, loadAcsData, triggerAcsFetch]);

  // ── FSF year change from combo ─────────────────────────────────────────────
  const handleFsfYearChange = useCallback(async (year) => {
    if (!year) return;
    setFsfYear(year);
    setSelected(null);
    if (map.current) map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
    await loadFsfData(year);
    showToast(`Loaded FSF distribution data for ${year}`);
  }, [loadFsfData]);

  // ── Layer switch ───────────────────────────────────────────────────────────
  const handleLayerSwitch = useCallback((layer) => {
    setActiveLayer(layer);
    setSelected(null);
    setUploadOpen(false);
    if (map.current) {
      map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
      const vis = layer === "need" ? "visible" : "none";
      ["agencies-points", "coverage-fill", "coverage-outline"].forEach((id) => {
        if (map.current.getLayer(id)) {
          map.current.setLayoutProperty(id, "visibility", vis);
        }
      });
    }
    if (layer === "need") {
      loadAcsData(acsYear);
    } else {
      if (fsfYear) {
        loadFsfData(fsfYear);
      } else if (fsfAvailYears.length > 0) {
        const latest = [...fsfAvailYears].sort((a,b) => b.year - a.year)[0].year;
        setFsfYear(latest);
        loadFsfData(latest);
      } else {
        const source = map.current?.getSource("tracts");
        if (source && map.current) {
          map.current.setPaintProperty("tracts-fill", "fill-color", "#cccccc");
        }
      }
    }
  }, [acsYear, fsfYear, fsfAvailYears, loadAcsData, loadFsfData]);

  // ── FSF Upload ─────────────────────────────────────────────────────────────
  const handleFsfUpload = async () => {
    if (!fsfFile || !uploadYear) return;
    setFsfUploading(true);
    setFsfMsg("");
    const formData = new FormData();
    formData.append("file", fsfFile);
    try {
      const res  = await fetch(`${API}/api/fsf/upload?dist_year=${uploadYear}`, {
        method: "POST", body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");

      setFsfFile(null);
      setUploadYear("");
      await fetchFsfAvailYears();
      await fetchFsfHistory();

      // Auto-select the uploaded year in combo and load map
      setFsfYear(data.year);
      setActiveLayer("impact");
      await loadFsfData(data.year);
      setUploadOpen(false);
      showToast(`✅ ${data.rows_imported} rows imported for ${data.year}`);
    } catch (err) {
      setFsfMsg(`❌ ${err.message || "Upload failed. Please try again."}`);
    }
    setFsfUploading(false);
  };

  // ── Delete FSF batches ─────────────────────────────────────────────────────
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    setDeleting(true);

    // Find which years are being deleted
    const deletedYears = new Set(
      fsfHistory.filter(b => selectedIds.has(b.id)).map(b => b.dist_year)
    );

    for (const id of selectedIds) {
      try { await fetch(`${API}/api/fsf/upload-history/${id}`, { method: "DELETE" }); }
      catch { /* continue */ }
    }
    setSelectedIds(new Set());
    const remainingYears = await fetchFsfAvailYears();
    await fetchFsfHistory();

    // If the currently active year was deleted, fall back to the new latest
    // available year (same logic as initial load) instead of leaving the
    // map and dropdown out of sync with a null selection.
    if (fsfYear && deletedYears.has(fsfYear)) {
      if (remainingYears && remainingYears.length > 0) {
        const latest = [...remainingYears].sort((a, b) => b.year - a.year)[0].year;
        setFsfYear(latest);
        if (activeLayer === "impact") await loadFsfData(latest);
      } else {
        setFsfYear(null);
        if (activeLayer === "impact" && map.current) {
          map.current.setPaintProperty("tracts-fill", "fill-color", "#cccccc");
        }
      }
    }

    setDeleting(false);
    showToast(`${count} file(s) deleted`);
  };

  const toggleSelectId = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = (checked) => {
    setSelectedIds(checked ? new Set(fsfHistory.map(b => b.id)) : new Set());
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Radius slider change — recompute gaps without refetching ───────────────
  const handleRadiusChange = (r) => {
    setRadius(r);
    recomputeGap(geojsonRef.current, agenciesRef.current, r);
  };

  // ── Weight slider change — rebalance others proportionally (unchanged
  //    logic from the original App.jsx), then recompute score + gaps live ────
  const handleWeightChange = (key, newVal) => {
    const others = Object.keys(weights).filter((x) => x !== key);
    const remaining = 100 - newVal;
    const oldOthersTotal = others.reduce((s, x) => s + weights[x], 0);
    const next = {};
    Object.keys(weights).forEach((x) => {
      next[x] = x === key
        ? newVal
        : oldOthersTotal > 0
          ? (weights[x] / oldOthersTotal) * remaining
          : remaining / others.length;
    });
    setWeights(next);
    applyWeights(next, geojsonRef.current);
    recomputeGap(geojsonRef.current, agenciesRef.current, radiusRef.current);
  };

  const handleResetWeights = () => {
    setWeights(DEFAULT_WEIGHTS);
    applyWeights(DEFAULT_WEIGHTS, geojsonRef.current);
    recomputeGap(geojsonRef.current, agenciesRef.current, radiusRef.current);
  };

  // ── Fly to a tract selected from the gap-list sidebar ───────────────────────
  const flyToTract = (geoid) => {
    if (!map.current || !geojsonRef.current) return;
    const feature = geojsonRef.current.features.find(f => f.properties.GEOID === geoid);
    if (!feature) return;
    setSelected(feature.properties);
    map.current.setFilter("tracts-selected", ["==", "GEOID", geoid]);
    const bounds = new maplibregl.LngLatBounds();
    const geom = feature.geometry;
    const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
    rings.forEach(ring => ring.forEach(c => bounds.extend(c)));
    map.current.fitBounds(bounds, {
      padding: { top: 80, bottom: 80, left: 80, right: 320 },
      maxZoom: 13, duration: 800,
    });
  };

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-80.3, 26.3],
      zoom: 8,
      minZoom: 6,
    });

    map.current.on("load", () => {
      map.current.addSource("tracts", {
        type: "geojson",
        data: "/tracts_2022.geojson",
        promoteId: "GEOID",
      });
      map.current.addSource("coverage", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.current.addSource("agencies", {
        type: "geojson",
        data: "/agencies.geojson",
      });

      fetch("/tracts_2022.geojson").then(r => r.json()).then(geojson => {
        // Two boxes. `core` (Miami-Dade/Broward/Palm Beach) frames the default
        // and reset view; Monroe (FIPS 12087) runs west to the Dry Tortugas and
        // would triple the viewport width, shrinking the dense urban corridor
        // where ~98% of tracts sit. `all` only widens the pan limit, so the Keys
        // stay reachable by panning or zooming out.
        const core = new maplibregl.LngLatBounds();
        const all  = new maplibregl.LngLatBounds();
        geojson.features.forEach(f => {
          if (!f.geometry) return;
          const isCore = !String(f.properties?.GEOID ?? "").startsWith("12087");
          const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
          polys.forEach(poly => poly.forEach(ring => ring.forEach(c => {
            all.extend(c);
            if (isCore) core.extend(c);
          })));
        });
        map.current.fitBounds(core, { padding: 60, duration: 0 });
        fullBounds.current = core;
        const sw = all.getSouthWest(), ne = all.getNorthEast();
        map.current.setMaxBounds([[sw.lng - 2, sw.lat - 2], [ne.lng + 2, ne.lat + 2]]);
      });

      // Coverage circles — drawn under the tract fill
      map.current.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: "coverage",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.18 },
      });
      map.current.addLayer({
        id: "coverage-outline",
        type: "line",
        source: "coverage",
        paint: { "line-color": "#1d4ed8", "line-width": 1.5, "line-opacity": 0.7 },
      });

      map.current.addLayer({
        id: "tracts-fill", type: "fill", source: "tracts",
        paint: {
          "fill-color": "#cccccc",
          "fill-opacity": 0.72,
        },
      });
      map.current.addLayer({
        id: "tracts-outline", type: "line", source: "tracts",
        paint: { "line-color": "#ffffff", "line-width": 0.3 },
      });
      map.current.addLayer({
        id: "tracts-selected", type: "line", source: "tracts",
        paint: { "line-color": "#000000", "line-width": 2.5 },
        filter: ["==", "GEOID", ""],
      });

      // Agency markers on top — Need score view only (coverage-gap context)
      map.current.addLayer({
        id: "agencies-points",
        type: "circle",
        source: "agencies",
        layout: { visibility: "visible" }, // default layer is "need"
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#1A3A6E",
          "circle-stroke-width": 2,
        },
      });

      map.current.on("click", "tracts-fill", e => {
        const props = e.features[0].properties;
        setSelected(props);
        map.current.setFilter("tracts-selected", ["==", "GEOID", props.GEOID]);
        const bounds = new maplibregl.LngLatBounds();
        const geom   = e.features[0].geometry;
        const rings  = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
        rings.forEach(ring => ring.forEach(c => bounds.extend(c)));
        map.current.fitBounds(bounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 320 },
          maxZoom: 13, duration: 800,
        });
      });
      map.current.on("mouseenter", "tracts-fill", () => { map.current.getCanvas().style.cursor = "pointer"; });
      map.current.on("mouseleave", "tracts-fill", () => { map.current.getCanvas().style.cursor = ""; });

      // Auto-fetch ACS 2024 on load
      triggerAcsFetch(2024);
    });
  }, [loadAcsData, triggerAcsFetch]);

  const fmt = (v, suffix = "") =>
    v === null || v === undefined || v === "" ? "—" : `${Number(v).toFixed(1)}${suffix}`;

  // Prefer merged ACS props from geojsonRef over the stale click-event snapshot;
  // prefer pre-computed score from scoresRef so weight/data changes reflect instantly.
  const selectedProps = selected
    ? (geojsonRef.current?.features?.find(f => f.properties.GEOID === selected.GEOID)?.properties ?? selected)
    : null;
  const selectedNeedScore = selected
    ? (scoresRef.current[selected.GEOID] ?? computeScore(selectedProps, weights))
    : null;

  const legendTitle = activeLayer === "need" ? "Need score" : "Impact score";
  const legendSrc   = activeLayer === "need"
    ? `ACS ${ACS_YEARS.find(y => y.value === acsYear)?.label || acsYear}`
    : fsfYear ? `FSF Distribution ${fsfYear}` : "No year selected";

  const currentAcsStatus = acsStatus[acsYear];
  const isFetching = currentAcsStatus?.status === "fetching";
  const showGapSidebar = activeLayer === "need";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", height: "100vh", width: "100vw", overflow: "hidden", fontFamily: "system-ui, sans-serif" }}>

      {/* First-load intro */}
      {showIntro && <IntroModal onClose={closeIntro} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 108, left: "50%", transform: "translateX(-50%)",
          background: "#085041", color: "#fff", padding: "8px 20px",
          borderRadius: 20, fontSize: 13, fontWeight: 500, zIndex: 100,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)", whiteSpace: "nowrap",
        }}>{toast}</div>
      )}

      {/* Header — spans full width, over both the sidebar and the map */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 50,
        background: "#1a3a2a", display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 20px", zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20, filter: "sepia(1) saturate(10) hue-rotate(-30deg)" }}>🌿</span>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>
            Feeding South Florida — Health Equity Intelligence
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setShowIntro(true)} title="How this map works"
            style={{
              color: "#9FE1CB", background: "transparent", border: "1px solid #9FE1CB",
              borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer",
              fontFamily: "inherit", fontWeight: 500,
            }}>? How it works</button>
          <a href="/" style={{
            color: "#9FE1CB", border: "1px solid #9FE1CB", borderRadius: 6,
            padding: "4px 12px", fontSize: 12, textDecoration: "none",
          }}>← Home</a>
        </div>
      </div>

      {/* Control Bar — also spans full width */}
      <div style={{
        position: "absolute", top: 50, left: 0, right: 0, height: 46,
        background: "#1a3a2a", borderTop: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", gap: 14, padding: "0 20px", zIndex: 20,
      }}>
        {/* Layer toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 6, padding: 3, gap: 2 }}>
          {[["need", "Need score"], ["impact", "Impact score"]].map(([key, label]) => (
            <button key={key} onClick={() => handleLayerSwitch(key)} style={{
              padding: "4px 14px", borderRadius: 4, fontSize: 12, cursor: "pointer",
              border: "none", fontWeight: 500, transition: "all 0.15s",
              background: activeLayer === key ? (key === "need" ? "#440154" : "#185FA5") : "transparent",
              color: activeLayer === key ? "#fff" : "rgba(255,255,255,0.6)",
            }}>{label}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)" }} />

        {/* Need score controls */}
        {activeLayer === "need" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#9FE1CB", fontSize: 11, whiteSpace: "nowrap" }}>ACS Year:</span>
            <select value={acsYear} onChange={e => handleAcsYearChange(Number(e.target.value))}
              disabled={isFetching}
              style={{
                background: "#0f2a1c", color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6, padding: "4px 8px", fontSize: 11,
                cursor: isFetching ? "not-allowed" : "pointer", minWidth: 220,
              }}>
              {ACS_YEARS.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
            </select>
            {currentAcsStatus && (
              <span style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap",
                background: isFetching ? "rgba(255,200,0,0.2)"
                  : currentAcsStatus.status === "done"  ? "rgba(29,158,117,0.25)"
                  : currentAcsStatus.status === "error" ? "rgba(226,75,74,0.25)" : "transparent",
                color: isFetching ? "#FAC775"
                  : currentAcsStatus.status === "done"  ? "#9FE1CB"
                  : currentAcsStatus.status === "error" ? "#F09595" : "#fff",
              }}>
                {isFetching ? "⏳ Fetching from Census Bureau..."
                  : currentAcsStatus.status === "done"  ? `✓ ${currentAcsStatus.tracts ? currentAcsStatus.tracts + " tracts loaded" : "Data loaded"}`
                  : currentAcsStatus.status === "error" ? `✗ ${currentAcsStatus.message}` : ""}
              </span>
            )}
          </div>
        )}

        {/* Weights button — pinned to far right in Need score view */}
        {activeLayer === "need" && (
          <div style={{ marginLeft: "auto" }}>
            <button onClick={() => setShowSettings(true)} style={{
              background: "transparent", color: "#9FE1CB",
              border: "1px solid #9FE1CB", borderRadius: 6,
              padding: "5px 12px", fontSize: 12,
              cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap",
            }}>⚙ Weights</button>
          </div>
        )}

        {/* Impact score — year selector (left side) */}
        {activeLayer === "impact" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#9FE1CB", fontSize: 11, whiteSpace: "nowrap" }}>FSF Year:</span>
            <select
              value={fsfYear || ""}
              onChange={e => handleFsfYearChange(e.target.value ? Number(e.target.value) : null)}
              style={{
                background: "#0f2a1c", color: fsfYear ? "#fff" : "rgba(255,255,255,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6, padding: "4px 8px", fontSize: 11,
                cursor: "pointer", minWidth: 200,
              }}>
              {fsfAvailYears.map(y => (
                <option key={y.year} value={y.year}>{y.year}</option>
              ))}
            </select>
          </div>
        )}

        {/* Upload CSV + Trend Chart buttons — pinned to far right */}
        {activeLayer === "impact" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {fsfAvailYears.length >= 2 && (
              <button onClick={() => setShowTrend(true)} style={{
                background: "transparent", color: "#9FE1CB",
                border: "1px solid #9FE1CB", borderRadius: 6,
                padding: "5px 12px", fontSize: 12,
                cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap",
              }}>📈 Trend chart</button>
            )}
            {!uploadOpen && (
              <button onClick={() => { setUploadOpen(true); setSelected(null); setUploadYear(""); }} style={{
                background: "#1D9E75", color: "#fff", border: "none",
                borderRadius: 6, padding: "6px 14px", fontSize: 12,
                cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap",
              }}>⬆ Upload CSV / Browse History</button>
            )}
          </div>
        )}
      </div>

      {/* ── Row below the header: gap sidebar + map pane ── */}
      <div style={{ position: "absolute", top: 96, left: 0, right: 0, bottom: 0, display: "flex" }}>

      {/* ── Left: Coverage-gap sidebar (Need score view only) ── */}
      {showGapSidebar && gapOpen && (
        <div style={{
          width: gapWidth, flexShrink: 0, position: "relative",
          display: "flex", flexDirection: "column",
          background: "#f8f9fa", borderRight: "1px solid #e0e0e0",
        }}>
          <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #e0e0e0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>
                Coverage gaps
              </div>
              <button onClick={() => setGapOpen(false)} title="Hide panel"
                style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#888", lineHeight: 1, marginTop: -2 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
              {gapTracts.length} tracts without a nearby partner
            </div>
            {/* Label + value on one row, slider full-width below — never
                collides or gets clipped no matter how narrow the panel is. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#555" }}>Radius</span>
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                {radius.toFixed(1)} mi
              </span>
            </div>
            <input
              type="range" min="0.5" max="5" step="0.1" value={radius}
              onChange={(e) => handleRadiusChange(Number(e.target.value))}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {gapTracts.length === 0 ? (
              <div style={{ padding: 16, color: "#999", fontSize: 13 }}>
                {isFetching ? "Loading…" : "No gaps found at this radius."}
              </div>
            ) : (
              gapTracts.map((tract, i) => (
                <button
                  key={tract.GEOID}
                  onClick={() => flyToTract(tract.GEOID)}
                  style={{
                    display: "flex", alignItems: "center",
                    width: "100%", padding: "10px 16px",
                    border: "none", borderBottom: "1px solid #ebebeb",
                    background: selected?.GEOID === tract.GEOID ? "#e8eef8" : "transparent",
                    cursor: "pointer", textAlign: "left", gap: 10,
                  }}
                >
                  <span style={{ fontSize: 11, color: "#aaa", minWidth: 22 }}>#{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {tract.county_name} County
                    </div>
                    <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Tract {tract.GEOID}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor(tract._score), minWidth: 30, textAlign: "right" }}>
                    {Math.round(tract._score)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Drag handle — right edge widens the sidebar (mouse + touch) */}
          <div
            onMouseDown={(e) => startResize(e, setGapWidth, +1)}
            onTouchStart={(e) => startResize(e, setGapWidth, +1)}
            title="Drag to resize"
            style={{
              position: "absolute", top: 0, right: -5, bottom: 0, width: 10,
              cursor: "col-resize", zIndex: 5, touchAction: "none",
            }}
          />
        </div>
      )}

      {/* ── Right: map + panels ── */}
      <div style={{ flex: 1, position: "relative" }}>

        {/* Map */}
        <div ref={mapContainer} style={{ position: "absolute", inset: 0 }} />

        {/* Reopen tab for the coverage-gaps sidebar (Need view, when hidden).
            Sits below the zoom controls (reset ≈16-48, zoom ≈60-120) so it
            never overlaps the +/− buttons on any screen size. */}
        {showGapSidebar && !gapOpen && (
          <button onClick={() => setGapOpen(true)} title="Show coverage gaps"
            style={{
              position: "absolute", top: 150, left: 0, zIndex: 10,
              background: "#fff", border: "none", borderRadius: "0 8px 8px 0",
              padding: "12px 7px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              boxShadow: "1px 1px 4px rgba(0,0,0,0.2)", color: "#444",
              fontFamily: "inherit", writingMode: "vertical-rl",
            }}>» Coverage gaps</button>
        )}

        {/* Zoom */}
        <div style={{ position: "absolute", top: 60, left: 16, display: "flex", flexDirection: "column", gap: 2, zIndex: 10 }}>
          {["+", "−"].map((label, i) => (
            <button key={label} onClick={() => i === 0 ? map.current.zoomIn() : map.current.zoomOut()} style={{
              width: 30, height: 30, fontSize: 18, lineHeight: 1, background: "#fff",
              border: "none", borderRadius: i === 0 ? "6px 6px 0 0" : "0 0 6px 6px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.2)", cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>

        {/* Reset */}
        <button onClick={() => {
          if (fullBounds.current) map.current.fitBounds(fullBounds.current, { padding: 60, duration: 800 });
          setSelected(null);
          map.current.setFilter("tracts-selected", ["==", "GEOID", ""]);
        }} style={{
          position: "absolute", top: 16, left: 16, zIndex: 10,
          background: "#fff", border: "none", borderRadius: 8,
          padding: "7px 13px", fontSize: 12, fontWeight: 600,
          cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        }}>↺ Reset view</button>

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: 24, left: 24, zIndex: 10,
          background: "rgba(255,255,255,0.97)", padding: "12px 15px",
          borderRadius: 8, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{legendTitle}</div>
          {activeLayer === "need" ? (
            breaks === null ? (
              <div style={{ color: "#aaa" }}>Loading…</div>
            ) : [
              ["#2d1160", "Highest need", `${Math.round(breaks[3])}–100`],
              ["#440154", "Very high",   `${Math.round(breaks[2])}–${Math.round(breaks[3])}`],
              ["#3b528b", "High",        `${Math.round(breaks[1])}–${Math.round(breaks[2])}`],
              ["#21918c", "Moderate",    `${Math.round(breaks[0])}–${Math.round(breaks[1])}`],
              ["#5ec962", "Low need",    `0–${Math.round(breaks[0])}`],
            ].map(([color, label, range]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ width: 15, height: 15, background: color, borderRadius: 3, flexShrink: 0 }} />
                <span style={{ flex: 1, color: "#444" }}>{label}</span>
                <span style={{ color: "#999", fontSize: 11 }}>{range}</span>
              </div>
            ))
          ) : (
            ACC_LEGEND.map(({ color, label, range }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ width: 15, height: 15, background: color, borderRadius: 3, flexShrink: 0 }} />
                <span style={{ flex: 1, color: "#444" }}>{label}</span>
                <span style={{ color: "#999", fontSize: 11 }}>{range}</span>
              </div>
            ))
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}>
            <div style={{ width: 13, height: 13, background: "#cccccc" }} />
            <span style={{ color: "#888", fontSize: 11 }}>No data</span>
          </div>
          {showGapSidebar && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <div style={{
                width: 13, height: 13, borderRadius: 2,
                background: "rgba(59,130,246,0.18)", border: "1.5px solid #1d4ed8",
              }} />
              <span style={{ color: "#888", fontSize: 11 }}>Partner radius</span>
            </div>
          )}
          <div style={{ borderTop: "0.5px solid #eee", marginTop: 8, paddingTop: 6, fontSize: 10, color: "#aaa" }}>
            {legendSrc}
          </div>
        </div>

        {/* ── Upload Panel ── */}
        {uploadOpen && activeLayer === "impact" && (
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 320,
            background: "#fff", boxShadow: "-2px 0 8px rgba(0,0,0,0.12)",
            zIndex: 15, display: "flex", flexDirection: "column",
          }}>
            <div style={{ padding: "14px 16px 10px", borderBottom: "0.5px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>FSF Distribution Data</div>
                <button onClick={() => setUploadOpen(false)}
                  style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#888", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 3, lineHeight: 1.5 }}>
                Upload annual distribution CSV to visualize impact score.
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "0.5px solid #e8e8e8" }}>
              {[["upload","Upload"],["history","History"],["fields","Fields"]].map(([key, label]) => (
                <button key={key} onClick={() => setActiveTab(key)} style={{
                  flex: 1, padding: "9px 0", textAlign: "center", fontSize: 12,
                  cursor: "pointer", background: "#fff", border: "none",
                  borderBottom: activeTab === key ? "2px solid #1D9E75" : "2px solid transparent",
                  color: activeTab === key ? "#1D9E75" : "#888",
                  fontWeight: activeTab === key ? 600 : 400,
                }}>{label}</button>
              ))}
            </div>

            {/* Upload tab */}
            {activeTab === "upload" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 500 }}>Distribution year</div>
                  <select value={uploadYear} onChange={e => { setUploadYear(e.target.value); setFsfMsg(""); }}
                    style={{ width: "100%", background: "#fff", border: "0.5px solid #ccc", borderRadius: 8, padding: "8px 10px", fontSize: 13, cursor: "pointer" }}>
                    <option value="">Select year to upload...</option>
                    {[2025, 2024, 2023, 2022, 2021].map(y => (
                      <option key={y} value={y}>
                        {y}{fsfAvailYears.find(a => a.year === y) ? " — Replace existing data" : " — Upload new"}
                      </option>
                    ))}
                  </select>
                </div>

                {uploadYear && (
                  <div>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 5, fontWeight: 500 }}>CSV file</div>
                    <label style={{
                      display: "block", border: "2px dashed #1D9E75",
                      borderRadius: 8, padding: "18px 12px", textAlign: "center",
                      cursor: "pointer", background: "#f8fffe",
                    }}>
                      <div style={{ fontSize: 26, color: "#1D9E75", marginBottom: 6 }}>📂</div>
                      <div style={{ fontSize: 13, color: fsfFile ? "#085041" : "#1D9E75", fontWeight: 500 }}>
                        {fsfFile ? fsfFile.name : "Click to select CSV file"}
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>
                        e.g. fsf_distribution_{uploadYear}.csv
                      </div>
                      <input type="file" accept=".csv" style={{ display: "none" }}
                        onChange={e => { setFsfFile(e.target.files[0]); setFsfMsg(""); }} />
                    </label>
                    {fsfFile && !fsfFile.name.includes(String(uploadYear)) && (
                      <div style={{
                        marginTop: 6, fontSize: 11, color: "#a36b00",
                        background: "#fff6e0", border: "0.5px solid #ffe1a0",
                        borderRadius: 6, padding: "6px 10px",
                      }}>
                        ⚠ This file name doesn't mention {uploadYear} — double-check it's the right file before submitting.
                      </div>
                    )}
                  </div>
                )}

                <button onClick={handleFsfUpload} disabled={!fsfFile || !uploadYear || fsfUploading} style={{
                  width: "100%", padding: "10px",
                  background: fsfFile && uploadYear && !fsfUploading ? "#1D9E75" : "#ccc",
                  color: "#fff", border: "none", borderRadius: 8,
                  fontSize: 13, fontWeight: 600,
                  cursor: fsfFile && uploadYear && !fsfUploading ? "pointer" : "not-allowed",
                }}>
                  {fsfUploading ? "Uploading…" : "Submit"}
                </button>

                {fsfMsg && (
                  <div style={{
                    padding: "10px 14px", borderRadius: 6,
                    background: fsfMsg.includes("✅") ? "#E1F5EE" : "#FCECEA",
                    color: fsfMsg.includes("✅") ? "#0F6E56" : "#a32d2d",
                    fontSize: 13,
                  }}>{fsfMsg}</div>
                )}
              </div>
            )}

            {/* History tab — grouped by year */}
            {activeTab === "history" && (
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "#888" }}>{fsfHistory.length} file{fsfHistory.length !== 1 ? "s" : ""} uploaded</span>
                  <button
                    onClick={handleDeleteSelected}
                    disabled={selectedIds.size === 0 || deleting}
                    style={{
                      padding: "5px 12px", fontSize: 12, fontWeight: 500,
                      background: selectedIds.size > 0 ? "#FCEBEB" : "#f5f5f5",
                      color: selectedIds.size > 0 ? "#A32D2D" : "#bbb",
                      border: selectedIds.size > 0 ? "0.5px solid #f5b8b8" : "0.5px solid #e8e8e8",
                      borderRadius: 6, cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                    }}>
                    🗑 Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                  </button>
                </div>

                {fsfHistory.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#999", textAlign: "center", marginTop: 20 }}>No uploads yet.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 28, padding: "6px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#888", borderBottom: "0.5px solid #e8e8e8", background: "#fafafa" }}>
                          <input type="checkbox"
                            checked={selectedIds.size === fsfHistory.length && fsfHistory.length > 0}
                            onChange={e => toggleSelectAll(e.target.checked)}
                            style={{ accentColor: "#1D9E75", cursor: "pointer" }} />
                        </th>
                        {["Year","File","Rows","Status"].map(h => (
                          <th key={h} style={{ padding: "6px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#888", letterSpacing: "0.05em", borderBottom: "0.5px solid #e8e8e8", background: "#fafafa" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fsfHistory.map(b => (
                        <tr key={b.id} style={{ background: selectedIds.has(b.id) ? "#E1F5EE" : "transparent" }}>
                          <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5" }}>
                            <input type="checkbox" checked={selectedIds.has(b.id)}
                              onChange={() => toggleSelectId(b.id)}
                              style={{ accentColor: "#1D9E75", cursor: "pointer" }} />
                          </td>
                          <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5", fontWeight: 600, color: "#1D9E75" }}>{b.dist_year}</td>
                          <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5", fontSize: 11, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.filename}</td>
                          <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5" }}>{b.row_count?.toLocaleString()}</td>
                          <td style={{ padding: "7px 6px", borderBottom: "0.5px solid #f5f5f5" }}>
                            <span style={{
                              fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 500,
                              background: b.status === "active" ? "#1D9E75" : "#e0e0e0",
                              color: b.status === "active" ? "#fff" : "#777",
                            }}>{b.status === "active" ? "ACTIVE" : "ARCHIVED"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Fields tab */}
            {activeTab === "fields" && (
              <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#888", letterSpacing: "0.06em", marginBottom: 4 }}>REQUIRED CSV COLUMNS</div>
                {[
                  ["zip_code",           "Where food was distributed", true],
                  ["county",             "One of 4 counties",          true],
                  ["households_served",  "Per ZIP per month",          true],
                  ["individuals_served", "Per ZIP per month",          true],
                  ["meals_served",       "No. of meals served",        true],
                  ["month",              "Monthly breakdown",          false],
                ].map(([col, note, req]) => (
                  <div key={col} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "0.5px solid #f5f5f5" }}>
                    <span style={{ fontSize: 11, color: "#185FA5", background: "#E6F1FB", padding: "2px 7px", borderRadius: 4, fontFamily: "monospace", flexShrink: 0 }}>{col}</span>
                    <span style={{ fontSize: 11, color: "#666", flex: 1 }}>{note}</span>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, flexShrink: 0, background: req ? "#FCEBEB" : "#E1F5EE", color: req ? "#A32D2D" : "#0F6E56" }}>
                      {req ? "required" : "optional"}
                    </span>
                  </div>
                ))}
                <div style={{ background: "#f8f8f8", borderRadius: 6, padding: 10, fontSize: 11, color: "#666", lineHeight: 1.7, marginTop: 4 }}>
                  County must be exactly one of:<br />
                  <strong>Miami-Dade · Broward · Palm Beach · Monroe</strong>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Trend Chart Modal ── */}
        {showTrend && <TrendChart onClose={() => setShowTrend(false)} />}

        {/* ── Tract Sidebar ── */}
        {selectedProps && !uploadOpen && (
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: needWidth,
            background: "#fff", boxShadow: "-2px 0 8px rgba(0,0,0,0.12)",
            padding: "18px 20px", overflowY: "auto", zIndex: 15,
          }}>
            {/* Drag handle — left edge widens the panel (mouse + touch) */}
            <div
              onMouseDown={(e) => startResize(e, setNeedWidth, -1)}
              onTouchStart={(e) => startResize(e, setNeedWidth, -1)}
              title="Drag to resize"
              style={{ position: "absolute", top: 0, left: -5, bottom: 0, width: 10, cursor: "col-resize", zIndex: 5, touchAction: "none" }}
            />
            <button onClick={() => { setSelected(null); map.current.setFilter("tracts-selected", ["==", "GEOID", ""]); }}
              style={{ float: "right", border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>×</button>

            {activeLayer === "need" ? (
              <>
                <h2 style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 600 }}>
                  Need score: {fmt(selectedNeedScore)}
                </h2>
                <p style={{ margin: "0 0 18px", color: "#888", fontSize: 12 }}>
                  {selectedProps.county_name} County · Tract {selectedProps.GEOID}
                </p>
                <Stat label="Population"          value={selectedProps.total_pop ? Number(selectedProps.total_pop).toLocaleString() : "—"} note={`ACS ${acsYear}`} />
                <Stat label="Below poverty"       value={fmt(selectedProps.poverty_rate, "%")}       note="vs ~13% nationally" />
                <Stat label="Receiving SNAP"      value={fmt(selectedProps.snap_rate, "%")}           note="of households" />
                <Stat label="No vehicle"          value={fmt(selectedProps.no_vehicle_rate, "%")}     note="of households" />
                <Stat label="Unemployment"        value={fmt(selectedProps.unemployment_rate, "%")}   note="of labor force" />
                <Stat label="Housing cost burden" value={fmt(selectedProps.housing_cost_burden, "%")} note="spending >30% on housing" />
                <Stat label="Food desert"
                  value={selectedProps.food_desert === 1 || selectedProps.food_desert === "1" ? "Yes" : selectedProps.food_desert === 0 || selectedProps.food_desert === "0" ? "No" : "—"}
                  note="USDA 2019" />
                <Stat label="Nearest supermarket"
                  value={selectedProps.supermarket_dist_mi ? `${Number(selectedProps.supermarket_dist_mi).toFixed(1)} mi` : "—"}
                  note="distance to nearest store" />
                <Stat label="Median income"
                  value={selectedProps.median_income ? `$${Math.round(selectedProps.median_income).toLocaleString()}` : "—"}
                  note="household, per year" />
              </>
            ) : (
              <>
                <h2 style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 600, color: "#185FA5" }}>
                  Impact score: {fmt(selectedProps.impact_score)}
                </h2>
                <p style={{ margin: "0 0 18px", color: "#888", fontSize: 12 }}>
                  {selectedProps.county_name} County · FSF {fsfYear}{selectedProps.nearest_zip ? ` · ZIP ${selectedProps.nearest_zip}` : ""}
                </p>
                <Stat label="Meals served"        value={selectedProps.meals_served       ? Number(selectedProps.meals_served).toLocaleString()       : "—"} note="total meals (annual)" />
                <Stat label="Individuals served"  value={selectedProps.individuals_served ? Number(selectedProps.individuals_served).toLocaleString() : "—"} note="people reached" />
                <Stat label="Households served"   value={selectedProps.households_served  ? Number(selectedProps.households_served).toLocaleString()  : "—"} note="family units" />
              </>
            )}
          </div>
        )}

        {/* ── Weight sliders modal (Need score view only) ── */}
        {showSettings && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 25,
          }}>
            <div style={{
              background: "#fff", borderRadius: 12, padding: 28, width: 420,
              boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
            }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Adjust indicator weights</h2>
              <p style={{ margin: "0 0 20px", color: "#666", fontSize: 13 }}>
                Weights always total 100. Moving one rebalances the others.
              </p>
              {Object.keys(weights).map((k) => (
                <div key={k} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                    <span>{LABELS[k]}</span>
                    <span style={{ fontWeight: 600 }}>{Math.round(weights[k])}</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={weights[k]}
                    onChange={(e) => handleWeightChange(k, Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                <button onClick={handleResetWeights} style={{
                  flex: 1, padding: "10px", borderRadius: 8,
                  border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: 14,
                }}>Reset to defaults</button>
                <button onClick={() => setShowSettings(false)} style={{
                  flex: 1, padding: "10px", borderRadius: 8, border: "none",
                  background: "#1A3A6E", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
                }}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#bbb" }}>{note}</div>
    </div>
  );
}

function IntroSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a2a", marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function IntroModal({ onClose }) {
  const Section = IntroSection;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 12, padding: "26px 28px",
          width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.3)", fontFamily: "inherit",
        }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>How this map works</h2>
          <button onClick={onClose}
            style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#888", lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: "0 0 18px", color: "#888", fontSize: 12 }}>
          A quick guide to the scores and colors. Reopen anytime with the “? How it works” button.
        </p>

        <Section title="Need score (0–100)">
          Ranks each census tract’s food-access need <em>relative to the other tracts</em> in Miami-Dade,
          Broward, Palm Beach &amp; Monroe. It’s a weighted blend of 7 indicators, each converted to a percentile
          rank (the CDC Social Vulnerability Index method) so one extreme tract can’t skew the scale:
          <div style={{ marginTop: 6, fontSize: 12, color: "#333", background: "#f5f7f5", borderRadius: 6, padding: "8px 10px" }}>
            Poverty 25% · Food desert 18% · SNAP 15% · No vehicle 12% · Low income 10% · Unemployment 10% · Housing cost burden 10%
          </div>
          <div style={{ marginTop: 6 }}>Change these anytime with <strong>⚙ Weights</strong> — the map recolors instantly.</div>
        </Section>

        <Section title="Map colors — Jenks natural breaks">
          The 5 color bands aren’t fixed cutoffs. They’re set by <strong>Jenks natural breaks</strong>, which
          finds the natural groupings in the data (minimizing variation within each band). That’s why the
          legend’s number ranges shift when you change weights or the ACS year — the colors always reflect
          the actual distribution.
        </Section>

        <Section title="Coverage gaps">
          The left panel lists high-need tracts with <strong>no partner agency within the radius you set</strong> (0.1–5 mi).
          Blue circles show each agency’s reach; tracts outside all circles are gaps.
        </Section>

        <Section title="Impact score (0–100)">
          On the Impact layer: How effectively FSF reached each county, from your uploaded distribution data. Two components:
          <br/>• <strong>Population reach (60%)</strong> — measured against a 5%-of-population monthly benchmark. 
          <br/>• <strong>Meals per person (40%)</strong> — measured against a 5-meals-per-person monthly benchmark.
        </Section>

        <Section title="Data sources">
          Census ACS 5-year estimates · USDA Food Access Research Atlas (food-desert flags) · FSF distribution
          uploads. Scores are relative within the 3-county region, not national.
        </Section>

        <button onClick={onClose} style={{
          width: "100%", marginTop: 8, padding: "11px", borderRadius: 8, border: "none",
          background: "#1a3a2a", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600,
          fontFamily: "inherit",
        }}>Got it</button>
      </div>
    </div>
  );
}
