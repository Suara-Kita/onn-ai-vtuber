"use client";

const TICKER_ITEMS = [
  "🔴 TERKINI: Mesyuarat Majlis Keselamatan Negara dijadualkan esok",
  "📢 Harga RON95 kekal pada RM2.05 seliter untuk bulan Julai",
  "🏗️ Projek MRT Johor Bahru fasa kedua mendapat kelulusan Kabinet",
  "🌧️ Amaran hujan lebat di Johor Selatan — jaga keselamatan anda",
  "📊 BURSA: KLCI ditutup +0.42% pada 1,612.88 mata",
  "🤝 Perjanjian perdagangan bebas ASEAN-EU dijangka ditandatangani Q3 2026",
  "🏥 Kempen vaksin denggi kebangsaan bermula di seluruh Johor mulai Isnin",
  "🎓 Permohonan biasiswa JPA 2026/2027 dibuka — tarikh tutup 15 Ogos",
];

export default function NewsTicker() {
  const repeated = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="relative flex items-center overflow-hidden h-full bg-black/30 backdrop-blur-md border-t border-white/10">
      {/* Live label */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 h-full bg-red-600/80 backdrop-blur z-10">
        <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        <span className="text-[11px] font-bold tracking-widest text-white uppercase whitespace-nowrap">
          LANGSUNG
        </span>
      </div>

      {/* Scrolling text */}
      <div className="flex overflow-hidden">
        <div className="flex whitespace-nowrap animate-ticker">
          {repeated.map((item, i) => (
            <span key={i} className="inline-flex items-center text-xs text-white/80 px-6">
              {item}
              <span className="ml-6 text-white/20">◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
