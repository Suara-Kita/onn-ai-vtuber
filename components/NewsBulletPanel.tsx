"use client";

export interface NewsItem {
  id: number;
  category: string;
  headline: string;
  summary: string;
  time: string;
}

const MOCK_NEWS: NewsItem[] = [
  {
    id: 1,
    category: "POLITIK",
    headline: "Kerajaan Johor Lancar Program Perumahan Mampu Milik Baharu",
    summary: "Sebanyak 2,000 unit rumah mampu milik akan dibina di daerah Batu Pahat menjelang 2027 bagi membantu golongan B40.",
    time: "2 minit lalu",
  },
  {
    id: 2,
    category: "EKONOMI",
    headline: "Pelaburan Asing di Johor Meningkat 34% Suku Pertama 2026",
    summary: "Kawasan Ekonomi Khas Johor-Singapura menarik pelaburan bernilai RM8.2 bilion dalam tempoh Jan-Mac 2026.",
    time: "15 minit lalu",
  },
  {
    id: 3,
    category: "KESIHATAN",
    headline: "Hospital Batu Pahat Terima Peralatan Perubatan Canggih Baharu",
    summary: "Kerajaan negeri memperuntukkan RM12 juta untuk meningkatkan kemudahan pembedahan dan diagnostik di hospital awam.",
    time: "32 minit lalu",
  },
  {
    id: 4,
    category: "INFRASTRUKTUR",
    headline: "Jalan Raya Sekijang-Batu Pahat Akan Dinaik Taraf",
    summary: "Projek melebarkan Jalan Sekijang sepanjang 18km dijangka siap menjelang Q4 2026, mengurangkan masa perjalanan.",
    time: "1 jam lalu",
  },
  {
    id: 5,
    category: "PENDIDIKAN",
    headline: "SMK Kemelah Raih Anugerah Sekolah Cemerlang Kebangsaan",
    summary: "Sekolah menengah di kawasan DUN N.04 Kemelah ini diiktiraf atas pencapaian akademik dan ko-kurikulum cemerlang.",
    time: "2 jam lalu",
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  POLITIK: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  EKONOMI: "bg-green-500/20 text-green-300 border-green-500/30",
  KESIHATAN: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  INFRASTRUKTUR: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  PENDIDIKAN: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

export default function NewsBulletPanel() {
  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      <div className="flex items-center gap-2 pb-2 border-b border-white/10">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">
          Berita Terkini — Sekijang
        </span>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-1 scrollbar-thin">
        {MOCK_NEWS.map((item, idx) => (
          <div
            key={item.id}
            className="group flex gap-3 p-3 rounded-xl bg-white/5 border border-white/8 hover:bg-white/10 hover:border-white/15 transition-all duration-200"
          >
            <div className="flex-shrink-0 w-6 h-6 mt-0.5 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/40">
              {idx + 1}
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[item.category] ?? "bg-white/10 text-white/50 border-white/20"}`}
                >
                  {item.category}
                </span>
                <span className="text-[10px] text-white/30">{item.time}</span>
              </div>
              <p className="text-sm font-semibold text-white/90 leading-snug">
                {item.headline}
              </p>
              <p className="text-xs text-white/50 leading-relaxed">
                {item.summary}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
