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
          <span className="logo-pill">Tanya lah Onn</span>
        </div>
        <div className="live-badge">
          <span className="live-dot" />
          LIVE
        </div>
      </header>

      {/* CONTENT CARD */}
      <main className="content-card">

        {/* Large white content card — height based on content, doesn't stretch */}
        <div className="white-card" style={{ flex: "none", marginTop: 32, paddingBottom: 160 }}>
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
