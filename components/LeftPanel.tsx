"use client";

const BULLETS = [
  "Kerajaan Johor lancar program perumahan mampu milik baharu untuk 2,000 unit di Batu Pahat",
  "Kawasan Ekonomi Khas Johor-Singapura tarik pelaburan RM8.2 bilion suku pertama 2026",
  "Projek naik taraf Jalan Sekijang sepanjang 18km dijangka siap Q4 2026",
];

export default function LeftPanel() {
  return (
    <div className="left-panel">

      {/* TOP BAR */}
      <header className="top-bar">
        <div className="brand">
          {/* Skewed brand block — reference design pattern */}
          <div style={{
            background: "#000066",
            borderLeft: "4px solid #EE1C25",
            padding: "6px 20px 6px 14px",
            transform: "skewX(-10deg)",
            display: "inline-flex",
            alignItems: "center",
          }}>
            <span style={{
              fontFamily: "var(--font-anybody), system-ui, sans-serif",
              fontWeight: 800,
              fontStyle: "italic",
              fontSize: 13,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "#fff",
              display: "inline-block",
              transform: "skewX(10deg)",
            }}>
              Tanya lah Onn
            </span>
          </div>
        </div>
      </header>

      {/* CONTENT CARD */}
      <main className="content-card">

        {/* White report card */}
        <div className="white-card" style={{ flex: "none", marginTop: 24, paddingBottom: 120 }}>
          <div className="section-label">Laporan Hari Ini</div>

          <h1 className="headline">
            Pembangunan Sekijang: Pelaburan, Infrastruktur &amp; Perumahan Mampu Milik
          </h1>
          <div className="accent-line" />

          <div className="points-label">Poin Utama</div>
          <ul className="bullet-list">
            {BULLETS.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>

      </main>

    </div>
  );
}
