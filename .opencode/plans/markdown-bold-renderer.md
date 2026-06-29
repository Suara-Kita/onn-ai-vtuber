# Plan: LLM Markdown Bold + Client-Side Bold Renderer

## Problem
`renderBullet` only bolds number patterns via regex. Non-number key facts like "satu taman tema air mini" or "Pengerang" have no way to become bold. The LLM could decide what to emphasize, but its `**bold**` markdown is ignored by React.

## Changes

### 1. `lib/llm.ts:47-51` — PANEL_SYSTEM: add bold instruction
Add `"Gunakan **bold** untuk menekankan fakta penting, angka, dan nilai."`

New prompt:
```
const PANEL_SYSTEM = `Anda adalah penganalisis data. Ekstrak maksimum TIGA fakta penting daripada maklumat yang diberikan dalam Bahasa Melayu.
Gunakan angka dan singkatan terus seperti dalam sumber asal (cth: RM68 bilion, 3,500 km², 7 Januari 2025).
Gunakan **bold** untuk menekankan fakta penting, angka, dan nilai.
Setiap poin: ringkas, padat, dan bermaklumat.
Format: markdown bullet list. Setiap poin dimulai dengan "- " (tanda sempang dan ruang). Tiada "1.", "2.", atau nombor sebagai bullet.`;
```

### 2. `LeftPanel.tsx:168-183` — Replace `renderBullet` with two-pass renderer

**Extract** `renderNumberBold` — the current regex bolding logic:

```ts
// Bold numbers, currency, percentages, and scale within a text segment
function renderNumberBold(text: string): React.ReactNode {
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
```

**Rewrite** `renderBullet` to split on `**bold**` first:

```ts
function renderBullet(raw: string): React.ReactNode {
  const text = convertMalayNumbers(raw);
  // Pass 1: split on LLM **markdown bold**
  const parts: React.ReactNode[] = [];
  const boldRe = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(renderNumberBold(text.slice(last, m.index)));
    }
    parts.push(<strong key={`md-${m.index}`} style={{ fontWeight: 900 }}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(renderNumberBold(text.slice(last)));
  return <>{parts}</>;
}
```

### Result chain per bullet line

```
LLM output:           "- **Pengerang** menerima RM2.9 bilion pelaburan"
                        ↓ convertMalayNumbers (no-op, already digits)
                        ↓ renderBullet splits on **...**
                        → renderNumberBold("Pengerang ")  → "Pengerang " (no match, plain)
                        → <strong>Pengerang</strong>
                        → renderNumberBold(" menerima RM2.9 bilion pelaburan")  → " menerima " + <strong>RM2.9 bilion</strong> + " pelaburan"
                        ↓ merged React fragment
UI render:            ▸ Pengerang menerima RM2.9 bilion pelaburan
                         ↑ bold     ↑ bold
```

### Files Affected
| File | Lines | Change |
|------|-------|--------|
| `lib/llm.ts` | 48 | Add bold usage instruction to PANEL_SYSTEM |
| `components/LeftPanel.tsx` | 168-183 | Replace `renderBullet` with two-pass parser; extract `renderNumberBold` |

### Verification
1. `npx vitest run` — all 135 tests pass
2. `curl` to `/job/query` with empty + real query, confirm `panel_analysis` contains `**...**` markdown and LeftPanel renders bold segments
