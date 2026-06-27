"use client";

import dynamic from "next/dynamic";

const VRMViewer = dynamic(() => import("./VRMViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
        <span className="text-xs text-white/40">Memuatkan model...</span>
      </div>
    </div>
  ),
});

export default function VRMViewerClient() {
  return <VRMViewer />;
}
