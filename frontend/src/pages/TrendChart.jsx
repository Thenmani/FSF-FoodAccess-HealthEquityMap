import { useEffect, useRef, useState } from "react";
import { CORE_COUNTIES, normalizeCounty } from "../lib/counties";

const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");
const COUNTIES = CORE_COUNTIES;
const COUNTY_COLORS = {
  "Miami-Dade": { line: "#E24B4A", bg: "#FCEBEB", text: "#A32D2D" },
  "Broward":    { line: "#185FA5", bg: "#E6F1FB", text: "#0C447C" },
  "Palm Beach": { line: "#D4A017", bg: "#FEFBD8", text: "#7A5C00" },
  "Monroe":     { line: "#1D8F7A", bg: "#E4F4F0", text: "#0B5648" },
};
const METRICS = [
  { key: "impact_score",         label: "Impact score" },
  { key: "total_meals",       label: "Total meals served"   },
  { key: "total_individuals", label: "Individuals served"   },
  { key: "total_households",  label: "Households served"    },
];

function fmtVal(v, metric) {
  if (v === null || v === undefined) return "";
  if (metric === "impact_score") return Number(v).toFixed(1);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + "K";
  return v.toLocaleString();
}

export default function TrendChart({ onClose }) {
  const chartRef  = useRef(null);
  const chartInst = useRef(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [metric,    setMetric]    = useState("impact_score");
  const [trendData, setTrendData] = useState(null);
  const [chartjsReady, setChartjsReady] = useState(!!window.Chart);

  // ── Load Chart.js ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (window.Chart) { setChartjsReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";
    s.onload = () => setChartjsReady(true);
    document.head.appendChild(s);
  }, []);

  // ── Fetch trend data ───────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res   = await fetch(`${API}/api/fsf/available-years`);
        const years = await res.json();
        if (!years || years.length < 2) {
          setError(`Upload data for at least 2 years to see the trend chart. You have ${years?.length || 0} year(s) uploaded.`);
          setLoading(false);
          return;
        }

        // Pull the pre-computed county rollup (incl. impact_score) per year —
        // the backend is the single source of truth for the score.
        const yearlyData = {};
        for (const { year } of years) {
          try {
            const r    = await fetch(`${API}/api/fsf/county-summary?dist_year=${year}`);
            yearlyData[year] = r.ok ? await r.json() : [];
          } catch { yearlyData[year] = []; }
        }

        const trend = {};
        COUNTIES.forEach(c => { trend[c] = {}; });

        for (const [year, summary] of Object.entries(yearlyData)) {
          const byCounty = {};
          summary.forEach(s => { byCounty[normalizeCounty(s.county)] = s; });
          COUNTIES.forEach(c => {
            const s = byCounty[c];
            trend[c][year] = s
              ? {
                  impact_score:      s.impact_score,
                  total_meals:       s.meals_served,
                  total_individuals: s.individuals_served,
                  total_households:  s.households_served,
                }
              : { impact_score: 0, total_meals: 0, total_individuals: 0, total_households: 0 };
          });
        }

        const sortedYears = years.map(y => y.year).sort((a, b) => a - b);
        setTrendData({ trend, years: sortedYears });
      } catch (e) {
        setError("Could not load trend data. Is the backend running?");
      }
      setLoading(false);
    };
    load();
  }, []);

  // ── Draw chart ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!trendData || !chartRef.current || loading || !chartjsReady) return;
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }

    const { trend, years } = trendData;
    const isDark     = matchMedia("(prefers-color-scheme: dark)").matches;
    const gridColor  = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
    const labelColor = isDark ? "#aaa" : "#777";

    const datasets = COUNTIES.map(county => ({
      label:               county,
      data:                years.map(y => trend[county][y]?.[metric] ?? null),
      borderColor:         COUNTY_COLORS[county].line,
      backgroundColor:     COUNTY_COLORS[county].line + "18",
      borderWidth:         2.5,
      pointRadius:         4,
      pointHoverRadius:    6,
      pointBackgroundColor: COUNTY_COLORS[county].line,
      pointBorderColor:    "#fff",
      pointBorderWidth:    1.5,
      tension:             0.35,
      fill:                false,
      spanGaps:            true,
    }));

    chartInst.current = new window.Chart(chartRef.current, {
      type: "line",
      data: { labels: years.map(String), datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction:         { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? "#222" : "#fff",
            borderColor:     isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
            borderWidth:     1,
            titleColor:      isDark ? "#eee" : "#333",
            bodyColor:       isDark ? "#ccc" : "#555",
            padding:         10,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmtVal(ctx.parsed.y, metric)}`,
            },
          },
        },
        scales: {
          x: {
            grid:  { color: gridColor },
            ticks: { color: labelColor, font: { size: 11 }, autoSkip: false },
          },
          y: {
            grid:  { color: gridColor },
            ticks: { color: labelColor, font: { size: 11 }, callback: v => fmtVal(v, metric) },
            min: metric === "impact_score" ? 0 : undefined,
            max: metric === "impact_score" ? 100 : undefined,
          },
        },
      },
    });
  }, [trendData, metric, loading, chartjsReady]);

  useEffect(() => () => { if (chartInst.current) chartInst.current.destroy(); }, []);

  // ── Summary cards ──────────────────────────────────────────────────────────
  const summaryCards = trendData ? (() => {
    const { trend, years } = trendData;
    const last  = years[years.length - 1];
    const first = years[0];
    let meals=0, individuals=0, avgScore=0, cnt=0;
    COUNTIES.forEach(c => {
      const d = trend[c][last];
      if (!d) return;
      meals       += d.total_meals;
      individuals += d.total_individuals;
      avgScore    += d.impact_score;
      cnt++;
    });
    avgScore = cnt > 0 ? (avgScore / cnt).toFixed(1) : 0;

    let firstMeals = 0;
    COUNTIES.forEach(c => { firstMeals += trend[c][first]?.total_meals || 0; });
    const growth = firstMeals > 0 ? "+" + (((meals - firstMeals) / firstMeals) * 100).toFixed(0) + "%" : "—";

    return [
      { label: `Total meals (${last})`,        value: meals >= 1e6 ? (meals/1e6).toFixed(2)+"M" : Math.round(meals/1000)+"K" },
      { label: `Individuals served (${last})`,  value: individuals >= 1e6 ? (individuals/1e6).toFixed(2)+"M" : Math.round(individuals/1000)+"K" },
      { label: "Avg impact score",      value: avgScore + " / 100" },
      { label: `Meal growth (${first}→${last})`,value: growth },
    ];
  })() : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50,
      background: "rgba(10,20,15,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        background: "#ffffff",
        borderRadius: 14, border: "1px solid #e0e0e0",
        width: "100%", maxWidth: 860, padding: "16px 22px",
        maxHeight: "94vh", overflowY: "auto",
        boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 2px" }}>
              FSF impact score trend
            </h2>
            <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
              Year-over-year community impact progress by county
            </p>
          </div>
          <button onClick={onClose} style={{
            border: "none", background: "none", fontSize: 20,
            cursor: "pointer", color: "#666", lineHeight: 1,
          }}>×</button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "36px 0", color: "#666", fontSize: 13 }}>
            Loading trend data...
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            background: "#FFF3CD", color: "#856404",
            padding: "12px 14px", borderRadius: 8, fontSize: 12, textAlign: "center",
          }}>{error}</div>
        )}

        {/* Content */}
        {!loading && !error && trendData && (
          <>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, marginBottom: 10 }}>
              {summaryCards.map(({ label, value }) => (
                <div key={label} style={{
                  background: "#f5f5f5",
                  borderRadius: 8, padding: "8px 10px",
                }}>
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 17, fontWeight: 500, color: "#1a1a1a" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Metric toggles */}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {METRICS.map(m => (
                <button key={m.key} onClick={() => setMetric(m.key)} style={{
                  padding: "4px 12px", borderRadius: 18, fontSize: 11, cursor: "pointer",
                  border: "0.5px solid",
                  borderColor: metric === m.key ? "#185FA5" : "var(--color-border-secondary)",
                  background:  metric === m.key ? "#E6F1FB"  : "transparent",
                  color:       metric === m.key ? "#0C447C"  : "var(--color-text-secondary)",
                  fontWeight:  metric === m.key ? 500 : 400,
                }}>{m.label}</button>
              ))}
            </div>

            {/* County legend */}
            <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
              {COUNTIES.map(c => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 24, height: 3, background: COUNTY_COLORS[c].line, borderRadius: 2 }} />
                  <span style={{ fontSize: 11, color: "#666" }}>{c}</span>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div style={{ position: "relative", height: 190, marginBottom: 12, background: "#fff", borderRadius: 8, padding: "6px 4px" }}>
              <canvas ref={chartRef}
                role="img"
                aria-label="Line chart showing FSF impact score trend by county">
                FSF food distribution trend by county.
              </canvas>
            </div>

            {/* Per-county cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
              {COUNTIES.map(county => {
                const { trend, years } = trendData;
                const last  = years[years.length - 1];
                const first = years[0];
                const ld = trend[county][last];
                const fd = trend[county][first];
                const change = ld && fd ? (ld.impact_score - fd.impact_score).toFixed(1) : null;
                const col = COUNTY_COLORS[county];
                return (
                  <div key={county} style={{
                    background: col.bg, borderRadius: 8, padding: "8px 10px",
                    border: `0.5px solid ${col.line}44`,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 500, color: col.text, marginBottom: 4 }}>{county}</div>
                    <div style={{ fontSize: 18, fontWeight: 500, color: col.text }}>
                      {ld ? ld.impact_score.toFixed(1) : "—"}
                    </div>
                    <div style={{ fontSize: 10, color: col.text + "99", marginTop: 1 }}>
                      score in {last}
                    </div>
                    {change !== null && (
                      <div style={{
                        fontSize: 10, marginTop: 4, fontWeight: 500,
                        color: parseFloat(change) >= 0 ? "#3B6D11" : "#A32D2D",
                      }}>
                        {parseFloat(change) >= 0 ? "▲" : "▼"} {Math.abs(change)} since {first}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
