<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Session Summary (2026-06-29)

### Done
- Fixed `app/job/queue/[job_id]/route.ts`: replaced slow `zrangebyscore` scan with direct O(1) `redis.get(JOB_KEY(job_id))` lookup; Redis stores each job under its own key at write time
- Fixed test mocks in 3 files to match route changes:
  - `flow.test.ts`: added `set` to pipeline mock; replaced `zrangebyscore` mock with `get` mock
  - `query.test.ts`: added `set` to pipeline mock
  - `queue-job-id.test.ts`: replaced `zrangebyscore` mock with `get` mock; removed obsolete "entries but none match" test; adapted array-returning mocks to single-string returns
- Switched LLM model from hardcoded strings to env vars (`LLM_MODEL`, `SIMPLIFY_MODEL`)
- Removed `SCRIPT_WORD_LIMIT` (was 83) and `trimToWordLimit` from `lib/llm.ts`
- Rewrote `SYSTEM_PROMPT` in `lib/llm.ts` with output purity rules and 70–90 word range
- Early 503 exit when RAG returns empty for non-empty queries
- Created `.env` file with `OPENROUTER_API_KEY`, `LLM_MODEL`, `REDIS_URL`, `MCP_API_URL`
- **Fixed news anchor tone**: replaced `"Terangkan tentang...dalam manifesto..."` llmPrompt with just `item.tajuk`; changed Rule 6 from casual/mesra to formal TV news anchor style; passed `item.konten` as RAG context for manifesto path (gives LLM grounding so it doesn't fabricate context); strengthened Rule 1 output purity with explicit negative examples
- All 135 tests pass

### Blocked
- RAG KB server at `http://165.99.199.21:8002` returning empty for real queries — 503 fallback triggered
