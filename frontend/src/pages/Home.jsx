import { useNavigate } from "react-router-dom";

const STATS = [
  ["100M+", "MEALS PER YEAR"],
  ["4", "COUNTIES SERVED"],
  ["200+", "PARTNER AGENCIES"],
];

const TOOLS = [
  {
    num: "01",
    title: "Health Equity Intelligence",
    desc: "Maps where healthy food and nutrition education create the greatest community impact.",
    to: "/map",
  },
  {
    num: "02",
    title: "Catering Menu Intelligence",
    desc: "Cuts menu fatigue and buys smarter, so every catering dollar feeds more people.",
    to: "",
  },
  {
    num: "03",
    title: "Dynamic Pricing Engine",
    desc: "Tracks competitive SKU pricing and automates rules that protect program margins.",
    to: "",
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="fsf-home">

      {/* Header */}
      <header style={{
        flex: "0 0 auto", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: "clamp(12px, 2vw, 28px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="fsf-display" style={{
            width: 38, height: 38, borderRadius: "50%", background: "#F47B20",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 19, color: "#0F3B29", flexShrink: 0,
          }}>
            F
          </div>
          <div className="fsf-display" style={{
            display: "flex", flexDirection: "column",
            lineHeight: 1.05, letterSpacing: "0.06em",
          }}>
            <span style={{ fontSize: "clamp(13px, 1.15vw, 17px)", color: "#F47B20" }}>FEEDING</span>
            <span style={{ fontSize: "clamp(11px, 0.95vw, 14px)", color: "#F4F1E8" }}>SOUTH FLORIDA</span>
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center",
          gap: "clamp(12px, 1.8vw, 28px)", minWidth: 0,
        }}>
          <span className="fsf-display" style={{
            fontWeight: 600, fontSize: "clamp(10px, 0.85vw, 14px)",
            letterSpacing: "0.14em", color: "rgba(244,241,232,0.55)",
            minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            MIAMI-DADE · BROWARD · PALM BEACH · MONROE
          </span>
          <a
            className="fsf-sitelink"
            href="https://feedingsouthflorida.org/"
            target="_blank"
            rel="noreferrer"
          >
            feedingsouthflorida.org ↗
          </a>
        </div>
      </header>

      <div className="fsf-body">

        {/* Hero */}
        <section style={{
          display: "flex", flexDirection: "column", justifyContent: "center",
          gap: "clamp(12px, 2.6vh, 26px)", minHeight: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 4, background: "#F47B20", flexShrink: 0 }} />
            <span className="fsf-display" style={{
              fontWeight: 700, fontSize: "clamp(11px, 1.05vw, 15px)",
              letterSpacing: "0.18em", color: "#F47B20",
            }}>
              DATA-DRIVEN FOOD ACCESS TOOLS
            </span>
          </div>

          <h1 className="fsf-display" style={{
            margin: 0,
            fontSize: "clamp(30px, min(4.6vw, 8.2vh), 76px)",
            lineHeight: 0.98, letterSpacing: "-0.02em", textWrap: "balance",
          }}>
            1 in 8 neighbors<br />here can't count on<br />
            <span style={{ color: "#F47B20" }}>their next meal.</span>
          </h1>

          <p style={{
            margin: 0, maxWidth: "34ch",
            fontSize: "clamp(14px, min(1.35vw, 2.6vh), 24px)",
            lineHeight: 1.4, color: "rgba(244,241,232,0.82)", textWrap: "pretty",
          }}>
            Three intelligence tools built for Feeding South Florida, showing exactly
            where healthy food, education, and funding move the needle, county by county.
          </p>

          <div style={{
            display: "flex", gap: "clamp(18px, 3vw, 44px)",
            borderTop: "1px solid rgba(244,241,232,0.18)",
            paddingTop: "clamp(10px, 2.2vh, 22px)",
          }}>
            {STATS.map(([value, label]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="fsf-display" style={{
                  fontSize: "clamp(26px, min(2.6vw, 5vh), 44px)", lineHeight: 1, color: "#F4F1E8",
                }}>
                  {value}
                </span>
                <span className="fsf-display" style={{
                  fontWeight: 600, fontSize: "clamp(10px, 0.85vw, 14px)",
                  letterSpacing: "0.13em", color: "rgba(244,241,232,0.6)",
                }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Tool list */}
        <section style={{
          display: "flex", flexDirection: "column",
          gap: "clamp(8px, 1.5vh, 14px)", minHeight: 0,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span className="fsf-display" style={{
              fontWeight: 700, fontSize: "clamp(10px, 0.85vw, 14px)",
              letterSpacing: "0.18em", color: "rgba(244,241,232,0.5)",
            }}>
              THE PLATFORM
            </span>
            <span className="fsf-display" style={{
              fontWeight: 700, fontSize: "clamp(10px, 0.85vw, 14px)",
              letterSpacing: "0.18em", color: "rgba(244,241,232,0.5)",
            }}>
              03 TOOLS
            </span>
          </div>

          {TOOLS.map(({ num, title, desc, to }) => {
            const live = Boolean(to);
            const external = live && /^https?:\/\//.test(to);
            const handleClick = () => {
              if (external) window.open(to, "_blank", "noopener,noreferrer");
              else navigate(to);
            };
            return (
              <button
                key={num}
                type="button"
                className={`fsf-card ${live ? "fsf-card--live" : "fsf-card--soon"}`}
                onClick={live ? handleClick : undefined}
                disabled={!live}
                aria-label={live ? `Open ${title}${external ? " (opens in new tab)" : ""}` : `${title} — coming soon`}
              >
                <span className="fsf-card__num">{num}</span>
                <span style={{
                  display: "flex", flexDirection: "column",
                  gap: "clamp(2px, 0.7vh, 6px)", minWidth: 0,
                }}>
                  <span className="fsf-card__title">{title}</span>
                  <span className="fsf-card__desc">{desc}</span>
                </span>
                {live
                  ? <span className="fsf-card__arrow" aria-hidden="true">{external ? "↗" : "→"}</span>
                  : <span className="fsf-card__soon">COMING SOON</span>}
              </button>
            );
          })}
        </section>
      </div>

      {/* Mission */}
      <footer style={{
        flex: "0 0 auto", display: "flex", alignItems: "center",
        gap: "clamp(10px, 1.4vw, 18px)",
        borderTop: "1px solid rgba(244,241,232,0.18)",
        paddingTop: "clamp(9px, 1.8vh, 16px)",
      }}>
        <span className="fsf-display" style={{
          fontWeight: 700, fontSize: "clamp(10px, 0.85vw, 14px)",
          letterSpacing: "0.18em", color: "#F47B20", whiteSpace: "nowrap",
        }}>
          OUR MISSION
        </span>
        <span style={{
          fontSize: "clamp(12px, min(1.25vw, 2.4vh), 18px)",
          lineHeight: 1.35, color: "rgba(244,241,232,0.85)", textWrap: "pretty",
        }}>
          Equip Feeding South Florida with the data tools it needs to further its
          mission of ending hunger across the region.
        </span>
      </footer>
    </div>
  );
}
