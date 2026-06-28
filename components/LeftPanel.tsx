"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  qa_answer?: string;
}

function stripListMarker(s: string): string {
  return s.replace(/^\d+[.)]\s*/, "").trim();
}

// Group an ordered list of sentences into `bucketCount` buckets by word count.
function groupSentences(sentences: string[], bucketCount: number): string[] {
  if (sentences.length <= bucketCount) return sentences;
  const totalWords = sentences.reduce((acc, s) => acc + s.split(/\s+/).length, 0);
  const target = totalWords / bucketCount;
  const groups: string[] = [];
  let buf: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const w = s.split(/\s+/).length;
    if (groups.length < bucketCount - 1 && count >= target && buf.length > 0) {
      groups.push(buf.join(". "));
      buf = [];
      count = 0;
    }
    buf.push(s);
    count += w;
  }
  if (buf.length > 0) groups.push(buf.join(". "));
  return groups;
}

// Split TTS script into up to 3 display segments.
// Priority: newlines → period-grouped sentences → word-count thirds.
// Commas are intentionally ignored — they are prose punctuation in Malay
// and produce mid-phrase splits that break bullets.
// Short trailing fragments (< 4 words) are dropped before grouping to avoid
// incomplete sentence stubs like "Untuk maklumat lanjut".
function parseScript(text: string): string[] {
  if (!text.trim()) return [];

  // 1. Newlines — LLM explicitly listed items
  const byNewline = text.split(/\n+/).map((s) => stripListMarker(s.trim())).filter(Boolean);
  if (byNewline.length > 1) return byNewline.slice(0, 3);

  // 2. Period-grouped sentences — handles DeepSeek's paragraph output
  const sentences = text
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 4); // drop short trailing stubs
  if (sentences.length >= 3) {
    const grouped = groupSentences(sentences, 3)
      .map(stripListMarker)
      .filter((s) => s.split(/\s+/).length >= 5);
    if (grouped.length >= 2) return grouped.slice(0, 3);
  }

  // 3. Word-count thirds — continuous prose with no sentence markers
  const words = text.trim().split(/\s+/);
  if (words.length > 9) {
    const third = Math.ceil(words.length / 3);
    return [
      words.slice(0, third).join(" "),
      words.slice(third, third * 2).join(" "),
      words.slice(third * 2).join(" "),
    ].filter((s) => s.split(/\s+/).length >= 5).map(stripListMarker);
  }

  return [text.trim()];
}

// Convert Malay spelled-out numbers back to digit form for on-screen display.
// Uses a single-pass regex over compound patterns so "satu ribu tujuh ratus sembilan"
// becomes "1,709" rather than the broken "1,000 700 9" from piecemeal replacement.
function convertMalayNumbers(text: string): string {
  const onesMap: Record<string, number> = {
    satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
    enam: 6, tujuh: 7, lapan: 8, sembilan: 9,
  };

  // Recursively evaluate a matched Malay number phrase to an integer
  function parseNum(s: string): number {
    const w = s.toLowerCase().trim();
    let m: RegExpMatchArray | null;
    // Millions
    m = w.match(/^(satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan)\s+juta(?:\s+(.+))?$/);
    if (m) return onesMap[m[1]] * 1_000_000 + (m[2] ? parseNum(m[2]) : 0);
    m = w.match(/^sejuta(?:\s+(.+))?$/);
    if (m) return 1_000_000 + (m[1] ? parseNum(m[1]) : 0);
    // Thousands — non-greedy (.+?) so "empat puluh lapan ribu" captures "empat puluh lapan" as multiplier
    m = w.match(/^(.+?)\s+ribu(?:\s+(.+))?$/);
    if (m) return parseNum(m[1]) * 1_000 + (m[2] ? parseNum(m[2]) : 0);
    m = w.match(/^seribu(?:\s+(.+))?$/);
    if (m) return 1_000 + (m[1] ? parseNum(m[1]) : 0);
    // Hundreds
    m = w.match(/^(satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan)\s+ratus(?:\s+(.+))?$/);
    if (m) return onesMap[m[1]] * 100 + (m[2] ? parseNum(m[2]) : 0);
    m = w.match(/^seratus(?:\s+(.+))?$/);
    if (m) return 100 + (m[1] ? parseNum(m[1]) : 0);
    // Tens
    m = w.match(/^(satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan)\s+puluh(?:\s+(satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan))?$/);
    if (m) return onesMap[m[1]] * 10 + (m[2] ? onesMap[m[2]] : 0);
    // Teens
    m = w.match(/^(dua|tiga|empat|lima|enam|tujuh|lapan|sembilan)\s+belas$/);
    if (m) return onesMap[m[1]] + 10;
    if (w === 'sebelas') return 11;
    if (w === 'sepuluh') return 10;
    return onesMap[w] ?? 0;
  }

  function fmtNum(n: number): string {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Build a comprehensive regex that matches any Malay number compound in one shot
  const o  = 'satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan';
  const ow = `(?:${o})`;
  const teens   = `(?:(?:dua|tiga|empat|lima|enam|tujuh|lapan|sembilan)\\s+belas|sebelas|sepuluh)`;
  const tens    = `(?:${ow}\\s+puluh(?:\\s+${ow})?)`;
  const sub100  = `(?:${tens}|${teens}|${ow})`;
  const hundreds = `(?:(?:${ow}\\s+ratus|seratus)(?:\\s+${sub100})?)`;
  const sub1000 = `(?:${hundreds}|${sub100})`;
  const thousands = `(?:(?:${sub1000})\\s+ribu(?:\\s+${sub1000})?|seribu(?:\\s+${sub1000})?)`;
  const millions  = `(?:(?:${ow})\\s+juta(?:\\s+(?:${thousands}|${sub1000}))?|sejuta(?:\\s+(?:${thousands}|${sub1000})?)?)`;
  const fullNum   = `(?:${millions}|${thousands}|${sub1000})`;

  let t = text;

  // 1. Decimals: "lapan perpuluhan dua" → "8.2"
  t = t.replace(
    new RegExp(`\\b(${o})\\s+perpuluhan\\s+(${o})\\b`, 'gi'),
    (_, a, b) => `${onesMap[a.toLowerCase()]}.${onesMap[b.toLowerCase()]}`,
  );

  // 2. Years "dua ribu X puluh Y" → plain digits without thousand comma
  t = t.replace(
    /\bdua\s+ribu\s+(dua|tiga)\s+puluh(?:\s+(satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan))?\b/gi,
    (_, decade, unit) => String(2000 + onesMap[decade.toLowerCase()] * 10 + (unit ? onesMap[unit.toLowerCase()] : 0)),
  );

  // 3. All compound Malay numbers → digits with thousand separators
  t = t.replace(
    new RegExp(`\\b(${fullNum})\\b`, 'gi'),
    (match) => { const n = parseNum(match); return n > 0 ? fmtNum(n) : match; },
  );

  // 4. Currency / percentage
  t = t.replace(/\bRinggit\s+Malaysia\b/gi, 'RM');
  t = t.replace(/\bperatus\b/gi, '%');

  return t;
}

// Render a bullet string with numbers and currency bolded.
function renderBullet(raw: string): React.ReactNode {
  const text = convertMalayNumbers(raw);
  // Bold: numbers (with optional scale/currency prefix), years, percentages
  const boldRe = /(RM\s*[\d,.]+(?:\s+(?:juta|bilion))?|[\d,.]+(?:\s*%|\s+(?:juta|bilion|ribu))?)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={m.index} style={{ fontWeight: 900 }}>{m[0]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function LeftPanel() {
  const [liveSlide, setLiveSlide] = useState<LiveSlide | null>(null);
  const lastJobId = useRef<string | null>(null);

  const applySlide = useCallback((entry: { job_id: string; query: string; script: string; qa_answer?: string }) => {
    if (entry.job_id === lastJobId.current) return;
    lastJobId.current = entry.job_id;
    const slide = { job_id: entry.job_id, query: entry.query, script: entry.script, qa_answer: entry.qa_answer };
    setLiveSlide(slide);
    // Signal VRM model to animate while LeftPanel is displaying the answer.
    // globalThis persists the intent so VRMViewer can pick it up even if it
    // mounts after the event fires (dynamic import race condition).
    (globalThis as Record<string, unknown>).__tanyalahOnnTalkUntil = Date.now() + 30_000;
    window.dispatchEvent(new CustomEvent("tanyalah-onn:talking", { detail: { duration: 30 } }));
  }, []);

  // SSE — fires immediately when a job completes or is re-triggered via /job/queue/:id
  useEffect(() => {
    const es = new EventSource("/job/events");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        job_id?: string;
        query?: string;
        script?: string;
        qa_answer?: string;
        forced?: boolean;
        idle?: boolean;
      };
      if (data.idle) {
        lastJobId.current = null;
        setLiveSlide(null);
        (globalThis as Record<string, unknown>).__tanyalahOnnTalkUntil = 0;
        window.dispatchEvent(new CustomEvent("tanyalah-onn:idle"));
        return;
      }
      if (!data.job_id) return;
      // forced=true comes from /job/queue/:id — reset dedup so animation always re-fires
      if (data.forced) lastJobId.current = null;
      applySlide({ job_id: data.job_id, query: data.query ?? "", script: data.script ?? "", qa_answer: data.qa_answer ?? "" });
    };
    return () => es.close();
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
          applySlide({ job_id: latest.job_id, query: latest.query, script: latest.script, qa_answer: latest.qa_answer });
        }
      } catch { /* Redis unavailable */ }
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, [applySlide]);

  const headline = liveSlide?.query ?? DEFAULT_HEADLINE;
  const sectionLabel = liveSlide ? "Soalan Langsung" : "Laporan Hari Ini";

  const bullets = liveSlide
    ? (parseScript(liveSlide.script).length > 0 ? parseScript(liveSlide.script) : DEFAULT_BULLETS)
    : DEFAULT_BULLETS;

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
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 11 }}>
            {bullets.map((b, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, fontWeight: 400, lineHeight: 1.6, color: "#1b1f3a" }}>
                <span style={{ color: "#EE1C25", fontSize: 11, marginTop: 3, flexShrink: 0, fontFamily: "var(--font-mono)" }}>▸</span>
                <span style={{ fontFamily: "var(--font-main)" }}>{liveSlide ? renderBullet(b) : b}</span>
              </li>
            ))}
          </ul>
        </div>

      </main>

    </div>
  );
}
