const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const LLM_MODEL = "deepseek/deepseek-chat";
const SIMPLIFY_MODEL = "deepseek/deepseek-chat";

export const SCRIPT_WORD_LIMIT = 83;

export const SYSTEM_PROMPT = `Anda adalah pemberita AI bernama Onn.
Tugas anda: ringkaskan jawapan kepada soalan yang diberikan dalam Bahasa Melayu yang mudah difahami oleh semua lapisan masyarakat, sebagai skrip ucapan lisan.

⚠️ HAD MUTLAK: LAPAN PULUH TIGA (83) PATAH PERKATAAN SAHAJA. Lebih = audio terpotong. Kurang = kesunyian. Kira setiap patah perkataan sebelum menghantar.

PERATURAN WAJIB UNTUK SKRIP TTS:
1. BILANGAN PATAH PERKATAAN MESTI TEPAT LAPAN PULUH TIGA (83) — tidak lebih, tidak kurang. Ini adalah had keras. Kira semula sebelum balas.
2. TIADA nombor digit — ejakan semua nombor dalam Bahasa Melayu. Contoh: "dua ribu" bukan "2,000", "lapan perpuluhan dua" bukan "8.2", "empat puluh lima juta" bukan "45 juta"
3. TIADA titik "." — guna perkataan "perpuluhan" untuk perpuluhan
4. TIADA tanda kurung "()" langsung
5. TIADA singkatan atau akronim — ejakan SEMUA dalam perkataan penuh tanpa pengecualian. Contoh: "Jabatan Kerja Raya" bukan "JKR", "Ringgit Malaysia" bukan "RM", "Zon Ekonomi Khas Johor Singapura" bukan "JS-SEZ", "Bantuan Kasih Johor" bukan "BKJ". Risiko bunyi TTS rosak terlalu tinggi
6. Bahasa mudah dan ringkas — elakkan istilah teknikal, terangkan dengan cara yang boleh difahami oleh orang awam
7. Tulis dalam Bahasa Melayu percakapan yang natural dan mesra
8. Fokus HANYA pada satu topik atau satu teras yang disebutkan dalam soalan — JANGAN bincangkan teras lain atau topik di luar soalan

Balas dengan teks skrip SAHAJA tanpa sebarang label, tajuk atau penjelasan tambahan. Semak bilangan patah perkataan: mesti lapan puluh tiga (83).`;

// Hard cap: trim to at most `limit` whitespace-separated tokens.
// The LLM prompt requests exactly SCRIPT_WORD_LIMIT words but models occasionally
// overshoot. This ensures we never send an oversized script to TTS regardless.
function trimToWordLimit(text: string, limit: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= limit ? text.trim() : words.slice(0, limit).join(" ");
}

export async function generateScript(query: string, ragContext: string): Promise<string> {
  const userContent = ragContext
    ? `Konteks daripada pangkalan pengetahuan:\n${ragContext}\n\nSoalan: ${query}`
    : `Soalan: ${query}`;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      // 83 Malay words ≈ 120 tokens; 200 gives headroom without allowing runaway output
      max_tokens: 200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter returned empty content");
  return trimToWordLimit(content, SCRIPT_WORD_LIMIT);
}

const PANEL_SYSTEM = `Anda adalah penganalisis data. Berikan TIGA poin fakta utama dalam Bahasa Melayu berdasarkan maklumat yang diberikan.
Setiap poin: maksimum dua belas patah perkataan, padat, bermaklumat, dan boleh menggunakan angka serta singkatan.
Format: satu poin per baris sahaja. Tiada nombor, tiada bullet, tiada penjelasan tambahan.`;

export async function analyzeForPanel(query: string, ragContext: string): Promise<string> {
  const userContent = ragContext
    ? `Konteks: ${ragContext}\n\nSoalan: ${query}`
    : `Soalan: ${query}`;
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: SIMPLIFY_MODEL,
      max_tokens: 200,
      messages: [
        { role: "system", content: PANEL_SYSTEM },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

const SIMPLIFY_SYSTEM = `Jawab soalan dalam SATU ayat ringkas bahasa Melayu (maksimum lima belas patah perkataan). Tiada akronim. Tiada penjelasan tambahan. Teks jawapan sahaja.`;

export async function simplifyForQA(query: string, ragContext: string): Promise<string> {
  try {
    const userContent = ragContext
      ? `Konteks: ${ragContext}\n\nSoalan: ${query}`
      : query;
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: SIMPLIFY_MODEL,
        max_tokens: 50,
        messages: [
          { role: "system", content: SIMPLIFY_SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[simplify] OpenRouter ${res.status}: ${await res.text()}`);
      return "";
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const raw = data.choices[0]?.message?.content?.trim() ?? "";
    // Hard cap: 160 chars to guarantee it fits within 2 display lines
    return raw.length > 160 ? raw.slice(0, 157) + "..." : raw;
  } catch (err) {
    console.error("[simplify] fetch error:", (err as Error).message);
    return "";
  }
}
