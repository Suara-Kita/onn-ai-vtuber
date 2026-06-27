"use client";

const Q_TEXT =
  "Apakah langkah kerajaan untuk memastikan projek infrastruktur di Sekijang P.141 disiapkan mengikut jadual dan memberi manfaat kepada penduduk tempatan?";

const A_TEXT =
  "Kerajaan telah memperuntukkan RM45 juta untuk projek infrastruktur Sekijang, dengan pemantauan bulanan oleh JKR dan penglibatan komuniti tempatan dalam proses perancangan.";

export default function QAFooter() {
  return (
    <div className="qa-footer">
      <div className="qa-footer-inner">
        <div className="qa-footer-row">
          <span className="qa-footer-label q">S.</span>
          <p className="qa-footer-text scrolling">
            {Q_TEXT}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{Q_TEXT}
          </p>
        </div>
        <div className="qa-footer-row">
          <span className="qa-footer-label a">J.</span>
          <p className="qa-footer-text">{A_TEXT}</p>
        </div>
      </div>
    </div>
  );
}
