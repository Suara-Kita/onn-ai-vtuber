"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QAEntry } from "@/app/job/qa-recent/route";

const DEFAULT_HEADLINE = "Apa yang anda ingin tahu hari ini?";

const DEFAULT_BULLETS = [
  "Tanya tentang JS-SEZ dan impaknya kepada ekonomi Johor",
  "Ketahui bantuan Bantuan Kasih Johor untuk rakyat",
  "Soal tentang peluang pekerjaan dan latihan kemahiran belia",
];

interface LiveSlide {
  job_id: string;
  query: string;
  script: string;
}

// Script uses commas as sentence separators (no periods — TTS rule).
// Split into up to 3 display segments.
function parseScript(text: string): string[] {
  return text
    .split(/,\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export default function LeftPanel() {
  const [liveSlide, setLiveSlide] = useState<LiveSlide | null>(null);
  const [lastSlide, setLastSlide] = useState<LiveSlide | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastJobId = useRef<string | null>(null);

  const applySlide = useCallback((entry: { job_id: string; query: string; script: string }) => {
    if (entry.job_id === lastJobId.current) return;
    lastJobId.current = entry.job_id;
    if (clearTimer.current) clearTimeout(clearTimer.current);
    const slide = { job_id: entry.job_id, query: entry.query, script: entry.script };
    setLiveSlide(slide);
    setLastSlide(slide);
    // Signal VRM model to animate while LeftPanel is displaying the answer.
    // globalThis persists the intent so VRMViewer can pick it up even if it
    // mounts after the event fires (dynamic import race condition).
    (globalThis as Record<string, unknown>).__tanyalahOnnTalkUntil = Date.now() + 28_000;
    window.dispatchEvent(new CustomEvent("tanyalah-onn:talking", { detail: { duration: 28 } }));
    clearTimer.current = setTimeout(() => setLiveSlide(null), 30_000);
  }, []);

  // SSE — fires immediately when a job completes or is re-triggered via /job/queue/:id
  useEffect(() => {
    const es = new EventSource("/job/events");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        job_id?: string;
        query?: string;
        script?: string;
        forced?: boolean;
        idle?: boolean;
      };
      if (data.idle) {
        lastJobId.current = null;
        if (clearTimer.current) clearTimeout(clearTimer.current);
        setLiveSlide(null);
        (globalThis as Record<string, unknown>).__tanyalahOnnTalkUntil = 0;
        window.dispatchEvent(new CustomEvent("tanyalah-onn:idle"));
        return;
      }
      if (!data.job_id) return;
      // forced=true comes from /job/queue/:id — reset dedup so animation always re-fires
      if (data.forced) lastJobId.current = null;
      applySlide({ job_id: data.job_id, query: data.query ?? "", script: data.script ?? "" });
    };
    return () => {
      es.close();
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, [applySlide]);

  // Polling fallback — picks up latest entry from Redis every 5s
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/job/qa-recent");
        if (!res.ok) return;
        const data = (await res.json()) as { entries: QAEntry[] };
        if (data.entries.length > 0) {
          const latest = data.entries[0];
          applySlide({ job_id: latest.job_id, query: latest.query, script: latest.script });
        }
      } catch { /* Redis unavailable */ }
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, [applySlide]);

  const displaySlide = liveSlide ?? lastSlide;
  const headline = displaySlide?.query ?? DEFAULT_HEADLINE;
  const bullets = displaySlide ? parseScript(displaySlide.script) : DEFAULT_BULLETS;
  const sectionLabel = liveSlide ? "Soalan Langsung" : lastSlide ? "Soalan Terakhir" : "Laporan Hari Ini";

  return (
    <div className="left-panel">

      {/* TOP BAR */}
      <header className="top-bar">
        <div className="brand">
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
          <div className="section-label">{sectionLabel}</div>

          <h1 className="headline">{headline}</h1>
          <div className="accent-line" />
          {!liveSlide && <div className="points-label">Contoh Soalan</div>}
          <ul className="bullet-list">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>

      </main>

    </div>
  );
}
