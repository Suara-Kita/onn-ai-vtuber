"use client";

const Q_TEXT =
  "Apakah langkah kerajaan untuk memastikan projek infrastruktur di Sekijang P.141 disiapkan mengikut jadual dan memberi manfaat kepada penduduk tempatan?";

const A_TEXT =
  "Kerajaan telah memperuntukkan RM45 juta untuk projek infrastruktur Sekijang, dengan pemantauan bulanan oleh JKR dan penglibatan komuniti tempatan dalam proses perancangan.";

const FONT_MONO = "var(--font-jetbrains-mono), 'Courier New', monospace";
const FONT_MAIN = "var(--font-geist), system-ui, sans-serif";

export default function QAOverlay() {
  return (
    <div style={{
      position: "absolute",
      bottom: 20,
      left: 20,
      right: 20,
      zIndex: 20,
      background: "rgba(255, 255, 255, 0.96)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.8)",
      padding: "16px 28px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
    }}>

      {/* Question */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, overflow: "hidden" }}>
        <span style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 700,
          minWidth: 22,
          flexShrink: 0,
          color: "#9a6200",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}>S.</span>
        <div style={{ overflow: "hidden", flex: 1 }}>
          <p style={{
            fontFamily: FONT_MAIN,
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.5,
            color: "#0d0f1a",
            whiteSpace: "nowrap",
            margin: 0,
            display: "inline-block",
            animation: "qa-scroll 28s linear infinite",
          }}>
            {Q_TEXT}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{Q_TEXT}
          </p>
        </div>
      </div>

      {/* Answer */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, overflow: "hidden" }}>
        <span style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 700,
          minWidth: 22,
          flexShrink: 0,
          color: "#007060",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}>J.</span>
        <p style={{
          fontFamily: FONT_MAIN,
          fontSize: 13,
          fontWeight: 400,
          lineHeight: 1.5,
          color: "#2a2d3a",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          margin: 0,
          flex: 1,
        }}>
          {A_TEXT}
        </p>
      </div>

      <style>{`
        @keyframes qa-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
