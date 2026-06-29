# Fix: News Anchor Tone for Manifesto Scripts

## Problem
Empty query (manifesto path) produces scripts like "Baik, tuan dan puan..." — casual/political tone instead of formal news anchor style.

## Root Causes
1. `app/job/query/route.ts:30` — `llmPrompt` is `Terangkan tentang "${item.tajuk}" di bawah teras ${item.teras} dalam manifesto BN Johor PRN 2026.` — "Terangkan" + "manifesto" cues political explanation
2. `lib/llm.ts:15` (Rule 6) — `"Bahasa Melayu percakapan ringkas, natural, dan mesra"` invites casual talk

## Changes

### 1. `app/job/query/route.ts:30`
Replace:
```
llmPrompt = `Terangkan tentang "${item.tajuk}" di bawah teras ${item.teras} dalam manifesto BN Johor PRN 2026.`;
```
With:
```
llmPrompt = item.tajuk;
```

### 2. `lib/llm.ts:15` (Rule 6 in SYSTEM_PROMPT)
Replace:
```
6. Bahasa Melayu percakapan ringkas, natural, dan mesra. Elakkan istilah teknikal. Terangkan untuk orang awam.
```
With:
```
6. Gaya penyampai berita televisyen: formal, profesional, lugas, dan berwibawa. Gunakan bahasa Melayu baku yang mudah difahami. Lapor berita, bukan terangkan atau ceramah.
```

## Verification
After changes, run: `curl -s -X POST http://localhost:3001/job/query -H "Content-Type: application/json" -d '{"query": "", "user_id": ""}' | python3 -m json.tool`

Expected: script starts with formal news anchor opening, no "Baik, tuan dan puan" style.
