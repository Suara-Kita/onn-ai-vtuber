import LeftPanel from "@/components/LeftPanel";
import VRMViewerClient from "@/components/VRMViewerClient";
import QAOverlay from "@/components/QAOverlay";

export default function Page() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", display: "flex", overflow: "hidden" }}>

      {/* LEFT PANEL — 60% */}
      <LeftPanel />

      {/* RIGHT PANEL — 40% VRM canvas */}
      <div className="right-panel">
        <div className="bg-blur" />
        <div className="vrm-wrap">
          <VRMViewerClient />
        </div>
      </div>

      {/* QnA card — full-width overlay at the bottom across both panels */}
      <QAOverlay />

    </div>
  );
}
