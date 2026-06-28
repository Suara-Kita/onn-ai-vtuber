"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QAEntry } from "@/app/job/qa-recent/route";

// Remove "1. " / "2) " numbered-list markers from each line, then join into
// a single flowing string so the QA bar shows clean prose, not a list dump.
function cleanAnswer(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean)
    .join(" ");
}

export default function QAOverlay() {
  const [pool, setPool] = useState<Array<{ job_id?: string; q: string; a: string }>>([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [liveQA, setLiveQA] = useState<{ q: string; a: string } | null>(null);
  const cycleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // waits for LeftPanel to finish
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  // clears liveQA after 30s
  const poolRefresh = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshPool = useCallback(async () => {
    try {
      const res = await fetch("/job/qa-recent");
      if (!res.ok) return;
      const data = (await res.json()) as { entries: QAEntry[] };
      // Never wipe an existing pool — only update when there's real data coming back.
      // Guards against Redis blips and TTL expiry clearing the on-screen ticker mid-event.
      if (data.entries.length === 0) return;
      setPool(data.entries.map((e) => ({ job_id: e.job_id, q: e.query, a: cleanAnswer(e.qa_answer || e.script) })));
      setIdx(0);
    } catch {
      // Redis unavailable — keep existing pool
    }
  }, []);

  // Initial pool load + refresh every 30s
  useEffect(() => {
    refreshPool();
    poolRefresh.current = setInterval(refreshPool, 30_000);
    return () => {
      if (poolRefresh.current) clearInterval(poolRefresh.current);
    };
  }, [refreshPool]);

  // Rotate through pool every 7s when no live job
  useEffect(() => {
    cycleTimer.current = setInterval(() => {
      if (liveQA || pool.length === 0) return;
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % pool.length);
        setVisible(true);
      }, 500);
    }, 7000);
    return () => {
      if (cycleTimer.current) clearInterval(cycleTimer.current);
    };
  }, [liveQA, pool.length]);

  // Listen for live jobs via SSE.
  // Sequence: LeftPanel shows the answer first (0–30s), then QAOverlay pins it (30–60s).
  useEffect(() => {
    const es = new EventSource("/job/events");
    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        job_id?: string;
        query?: string;
        script?: string;
        qa_answer?: string;
        idle?: boolean;
      };
      if (data.idle) {
        if (delayTimer.current) clearTimeout(delayTimer.current);
        if (liveTimer.current) clearTimeout(liveTimer.current);
        setLiveQA(null);
        refreshPool();
        return;
      }
      if (!data.job_id) return;

      const fresh = { q: data.query ?? "", a: cleanAnswer((data.qa_answer || data.script) ?? "") };

      // Cancel any pending delay/clear from a previous job
      if (delayTimer.current) clearTimeout(delayTimer.current);
      if (liveTimer.current) clearTimeout(liveTimer.current);

      // Wait for LeftPanel's 30s display window to finish, then show in QAOverlay
      delayTimer.current = setTimeout(() => {
        setVisible(false);
        setTimeout(() => {
          setLiveQA(fresh);
          setVisible(true);
          liveTimer.current = setTimeout(() => {
            setLiveQA(null);
            refreshPool();
          }, 30_000);
        }, 500);
      }, 30_000);
    };
    return () => {
      es.close();
      if (delayTimer.current) clearTimeout(delayTimer.current);
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, [refreshPool]);

  const qa = liveQA ?? pool[idx % Math.max(pool.length, 1)] ?? null;

  return (
    <>
      <style>{`
        .qao-wrap {
          position: absolute;
          bottom: 20px; left: 20px; right: 20px;
          z-index: 20;
          display: flex;
          align-items: stretch;
          overflow: hidden;
          background: rgba(255,255,255,0.96);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 4px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.4);
        }
        .qao-tab {
          background: #EE1C25;
          padding: 14px 24px 14px 18px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          flex-shrink: 0;
          clip-path: polygon(0 0, 100% 0, 88% 100%, 0% 100%);
        }
        .qao-tab-sub {
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #fff;
          margin-bottom: 3px;
        }
        .qao-tab-name {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 800;
          font-style: italic;
          letter-spacing: -0.02em;
          text-transform: uppercase;
          color: #fff;
          text-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .qao-cols {
          flex: 1;
          display: flex;
          align-items: stretch;
          padding: 14px 20px;
          gap: 20px;
          transition: opacity 0.45s ease, transform 0.45s ease;
        }
        .qao-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .qao-label-s {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #EE1C25;
          margin-bottom: 6px;
          text-shadow: 0 0 12px rgba(238,28,37,0.4);
        }
        .qao-label-j {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #373d92;
          margin-bottom: 6px;
          text-shadow: 0 0 12px rgba(55,61,146,0.35);
        }
        .qao-question {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 800;
          font-style: italic;
          line-height: 1.25;
          letter-spacing: -0.01em;
          color: #0d0f1a;
          text-transform: uppercase;
          margin: 0;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .qao-answer {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 800;
          font-style: italic;
          line-height: 1.25;
          letter-spacing: -0.01em;
          color: #1b1f3a;
          text-transform: uppercase;
          margin: 0;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
      `}</style>

      <div className="qao-wrap">
        <div className="qao-tab">
          <span className="qao-tab-sub">Tanya lah</span>
          <span className="qao-tab-name">Onn</span>
        </div>

        <div
          className="qao-cols"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(5px)",
          }}
        >
          <div className="qao-col">
            <span className="qao-label-s">Soalan</span>
            <p className="qao-question">{qa?.q ?? ""}</p>
          </div>

          <div className="qao-col">
            <span className="qao-label-j">Jawapan</span>
            <p className="qao-answer">{qa?.a ?? ""}</p>
          </div>
        </div>
      </div>
    </>
  );
}
