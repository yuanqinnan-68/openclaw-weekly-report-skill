# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A **skill definition** for OpenClaw that turns raw Feishu (飞书) weekly-report rows into a formatted HTML email. The skill is consumed by OpenClaw's agent runtime — it is not a standalone runnable application and has no package.json, build step, or test runner of its own.

The repo contains:
- `SKILL.md` — the skill manifest loaded by OpenClaw at runtime.
- `agents/openai.yaml` — OpenAI-compatible agent interface metadata.
- `references/` — authoritative contracts that govern output correctness.
- `implementation/` — desensitized TypeScript snapshots of the live service components.

## Architecture

The end-to-end flow is owned by a **Bridge** (not in this repo) that calls one single tool:

```
generate_weekly_report (openclaw-tool.ts)
  └── Bridge
        ├── Feishu sync  →  database
        ├── project-analysis-service.ts   (normalize → AI refine → validate → highlight)
        ├── weekly-report-renderer.ts     (stable status sort → HTML)
        └── SMTP send
```

Key design rules enforced in code:
- `normalizeSourceRows` assigns a stable `id` to every row; identical rows are never merged.
- `applyRefinement` aligns model output back to source rows by `id` and falls back to original text when the model output is missing, too long, or contains step lists / ellipses.
- `stableSortByStatus` in the renderer applies the fixed status order (`done → stuck → debug → docking → design → doing → todo`) while preserving original order within the same status.
- Highlights are selected only from `已完成` rows outside `下周规划` period, capped at 5.

## Editing guidelines

**Before changing summarization prompts or sort logic**, read `references/report-contract.md` — it defines the exact field lengths, highlight rules, status order, and the validation checklist you must satisfy.

**Before touching Feishu sync, model config, SMTP, or deployment**, read `references/integration.md` — it defines the single-tool constraint (no combining sync + analyze + send), idempotency requirements, and the backup/rollback procedure.

**When modifying `implementation/` files**, make minimal, targeted edits and keep the constraints in `references/` in sync. These are snapshots of the live service; changes here should reflect what you intend to deploy.

## Validation after any change

Run mentally (or with a test harness) against the checklist in `references/report-contract.md`:
1. Output row count equals input row count.
2. Every input `id` appears exactly once in output.
3. Empty fields remain empty strings (not `"暂无"`).
4. Highlights ≤ 5, all from `已完成` tasks.
5. Each project table uses the unified status order.
6. No ellipses, truncated sentences, JSON fragments, or Markdown fences in HTML output.

Do not send real emails during automated validation — use a no-send generation check only.
