// Shared county constants + helpers. Mirror of backend/scoring.py's county
// normalization so the frontend and API agree on names (incl. Monroe).

// Canonical Title-Case names, keyed by 5-char tract FIPS prefix.
export const COUNTY_BY_FIPS = {
  "12086": "Miami-Dade",
  "12011": "Broward",
  "12099": "Palm Beach",
  "12087": "Monroe",
};

// Counties shown in the trend chart — FSF's full four-county service area.
// Monroe is much smaller than the other three (~26 scored tracts), so its
// impact score moves more year-to-year on the same underlying variance.
export const CORE_COUNTIES = ["Miami-Dade", "Broward", "Palm Beach", "Monroe"];

// Fuzzy county-name → canonical Title Case, or "" if unrecognized.
export function normalizeCounty(name) {
  if (!name) return "";
  const n = String(name).toLowerCase().trim();
  if (n.includes("miami") || n.includes("dade")) return "Miami-Dade";
  if (n.includes("broward")) return "Broward";
  if (n.includes("palm")) return "Palm Beach";
  if (n.includes("monroe")) return "Monroe";
  return "";
}

// 11-digit tract GEOID → canonical county name ("" if out of scope).
export function countyFromGeoid(geoid) {
  return COUNTY_BY_FIPS[String(geoid || "").slice(0, 5)] || "";
}
