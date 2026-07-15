# NexoraAI — Next Roadmap (Phase 21+)

*Lead architect synthesis of 8 external research angles + 1 internal source audit. Verified against the real source tree at `~/Masaüstü/NexoraAI` (v0.23.1), not just the roadmap docs. Every proposal keeps LOCAL-FIRST as the default, cloud strictly opt-in + labelled, no telemetry, no paywall, model-agnostic, intent-based (never keyword regex), on an Electron + Node + llama.cpp stack.*

> ## 🔒 HARD INVARIANT — intent-based, across EVERY phase (non-negotiable)
> NexoraAI's generation/decision-making **stays intent-based for the entire roadmap (Phases 21–26 and beyond).** The model decides *what* the user wants; there is **never keyword-regex intent detection.** In particular, any grammar/GBNF work (22.3) constrains only the **output FORMAT** — and only via **lazy triggers** that engage *after* the model has already, freely, begun emitting a directive. Grammar must **never** decide intent, and must **never** be applied to whole free-form generation. If the bundled llama-server does not support lazy grammar triggers, **grammar is not shipped at all** (no grammar > grammar that forces free chat/code into directive JSON). Deterministic layers (The Judge 21.1, verifiers, difficulty-router 22.6) may only **verify/format**, never **generate intent**. When unsure whether a change decides intent vs. checks form/correctness: **stop and ask the user.**

---

## 1. Executive summary — where NexoraAI stands vs the market

NexoraAI is not behind the market; it is **ahead on the hard parts and behind on the visible parts**. Across every research angle the same picture emerged:

**We already lead (do not rebuild):** local-first-by-default with 157-provider opt-in keychain BYOK (unmatched by the cloud-locked leaders), a deterministic-DETECT / model-FIX debug engine (a genuinely differentiated take on Copilot's "self-healing"), MCP client, checkpoints+rewind, project knowledge base with dream-consolidation (= Claude's AutoDream), scheduled tasks, command palette, conversation-branching DAG, trust-tiers + deny-list (= human-in-the-loop), repo-map PageRank + local embeddings + semantic index (= Aider/Tabby), capability-adaptive sectioned+grammar generation for 3B–8B models (LM Studio/Jan just *chat*), SpecVerifier + project contracts, real Vite+React+TS+Tailwind project export, on-device SD image-gen + VL vision + Whisper, and — a sleeper strength almost nobody markets — **it serves its own OpenAI-compatible endpoint**. During this audit I also confirmed two things the pooled research got *wrong*: **AGENTS.md/CLAUDE.md ingestion already exists** (`src/lib/specDocs.ts`, root + nested, binding rules) and an **in-app HuggingFace GGUF search+download with progress already exists** (`electron/main/hfService.ts`). Those are not gaps.

**The four honest gap-clusters, all local-first-compatible:**
1. **Half-wired engine wins sitting inert in the repo.** Speculative decoding is fully coded but `setTurboDraft()` at `llamaServerEngine.ts:142` has **zero callers** — the free 1.4–2.5× speedup never fires. `buildDirectiveGrammar()` at `editGrammar.ts:121` has zero callers — directive JSON is repaired reactively instead of constrained at inference. These are the highest impact-per-line items in the entire codebase.
2. **The 2026 frontier convergence: verify, spec, parallelize.** Every leader converged on (a) a deterministic self-verifier ("the agent explores, code judges"), (b) spec-as-canonical-artifact, and (c) parallel/worktree agents. NexoraAI has all the raw pieces (headless render, CDP prover, SpecVerifier, isolated subagents, byte-checkpoints) but hasn't productized them into these three named features.
3. **The builder edits only by chat.** NexoraAI builds *real* projects but has no visual select-to-edit (Lovable's most-praised feature), no local full-stack backend (Bolt/Lovable ship cloud Supabase; the local inverse is uniquely ours to own), and no self-driving browser verification loop.
4. **The delight/shareability/distribution skin is missing.** The single most-shareable asset in this category — "I built a working React app with the wifi off" — is currently uncapturable. No build-card export, no guided first-win, no celebration, no integration hub to become "the local backend for Cline/Continue/Zed," no template gallery.

**Strategic bet:** lead the next roadmap with **Trust & Verify (fully offline)** — the one thing cloud tools *cannot credibly offer* (offline supply-chain safety, private-by-default verification, zero retention) — while cashing the free engine speedups and finally making the local-first magic *braggable*.

---

## 2. QUICK WINS (S-effort, high delight)

These are small, mostly one-surface changes with outsized payoff. Ship them first.

- **Finish Turbo (wire speculative decoding).** `turboEngine.ts` + `--model-draft` spawn arg are DONE; only a Settings toggle + IPC calling `setTurboDraft()` + a live accept-rate readout are missing. Verified: `setTurboDraft` has zero callers today. A measured **1.4–2.5× local speedup for free**, fully offline. Highest impact-per-line item in the repo.
- **Finish preventive directive grammar.** Attach `buildDirectiveGrammar()` + lazy `grammar_triggers` to the local completion request so `[RUN]`/`[IMG]`/`[SEARCH]`/`[MCP]` payloads are ~100% valid at inference on a 3B (must live-test against the bundled llama-server; lazy-trigger support varies). The artifact already exists.
- **YaRN context stretch toggle.** One spawn arg (`--rope-scaling yarn --yarn-orig-ctx N -c 4N`) lifts `pickContextSize`'s clamp for an honest 4× (8K→32K) so a whole-project agent stops silently truncating repo context. Opt-in toggle.
- **Celebration moments (opt-in confetti + subtle chime).** Fire on first-ever build compiled, first preview booted, first project exported. Raycast's confetti is a legendary word-of-mouth driver; our success paths are currently silent. Pure local canvas + optional WebAudio, off by default.
- **Live Privacy Meter ("0 bytes egress").** Our strongest differentiator is invisible status-bar text. Make it an animated, screenshot-worthy badge + an "Airplane-mode build" demo mode. Reads existing local telemetry; collects nothing new.
- **Proof-of-Edit receipts.** Every claimed edit gets a byte-level before/after receipt in the transparency inspector, killing phantom-edit distrust. Cheap on the existing logRepair/rollback telemetry.
- **Destructive-Action Dry Run.** Before a run, replay planned tool calls against the checkpoint and show "this run will delete 3 files, overwrite 2." Native undo was Claude Code's #1 request; we already have the checkpoints to diff against.
- **Emit AGENTS.md (ingestion already exists).** We *read* AGENTS.md/CLAUDE.md today; add a one-click "export AGENTS.md" so NexoraAI projects are portable to Codex/Cursor/Goose. High-goodwill, near-zero effort.
- **"Connect an external tool" card.** The OpenAI-compatible serve endpoint exists but is undiscoverable — generate copy-paste Continue/Cline/Zed/Cursor config (base URL + model id + copy button). This is the Ollama growth loop with near-zero new infra.
- **Guided first-win + "meanwhile" download companion.** Turn `WelcomeSetup.tsx`'s last step into a one-click curated starter that ends in a live preview (compress time-to-first-aha under ~2 min), and replace the raw model-download progress bar with a skeleton teaser + upfront size/VRAM disclosure (Hardware Advisor data already exists).

---

## 3. 1→10 UPGRADES to existing features

| Feature | Today | Upgrade | Why |
|---|---|---|---|
| **Speculative decoding** (`turboEngine.ts`) | Fully coded, `setTurboDraft` has **zero callers**; `pickDraftModel` returns null unless a compatible GGUF happens to be on disk | Wire the toggle + a **curated same-family draft catalog with one-click download** (0.5B draft for 8B target, Hardware-Advisor-aware default) + live accept-rate meter that auto-disables bad pairings | Most users never get the 1.4–2.5× they're entitled to; provisioning lights it up for everyone |
| **Debug engine** (detect→model-fix) | DETECTS, hands FIX to model, re-verifies | Add a **deterministic LLM-free Evaluator** ("The Judge") that captures a headless screenshot and renders an *unflippable* pass/fail (HTTP status, horizontal-overflow, required selectors, filtered console errors, expected text); gate "accept turn" on it | Turns "built, probably works" into "built AND proven working" — the #1 2026 differentiator, and we're closest to it |
| **Retrieval** (repo-map + local embeddings) | Embeddings-only ranking | Add a **BGE-reranker pass** using the *same* vendored `llama-server` in `--reranking --pooling rank` mode over `[SEARCH]`/repo-map candidates | Highest retrieval-quality-per-effort win; zero new dependency, the binary already ships it |
| **KV cache** (`llamaWorker.ts` Q8/Q8 + flash-attn) | Fixed symmetric Q8/Q8 | **VRAM-aware asymmetric policy** (K→Q4_0, V stays Q8_0) *only* when it unlocks a bigger context or a draft model, driven by the v0.16 Hardware Advisor | Fits 32K context into 8GB; lets low-VRAM laptops run configs they currently can't |
| **API escalation** (`errorClass.ts`) | Reactive: escalates only after ≥3 repro failures | Optional **local difficulty pre-router** (tiny embedding classifier) that routes obviously-hard prompts up *before* a doomed small-model turn | Saves minutes of failed turns; fully on-device, no privacy cost |
| **Model browser** (`hfService.ts` + `ModelBrowser.tsx`) | Search + download-with-progress exists; no fit pill at quant/load time, no offload slider, no storage manager | Attach the Hardware Advisor as a reusable **"Fits / Spills / Won't fit" pill** per quant, add an `n_gpu_layers` 0–100% slider with live tok/s + VRAM readout, add a **storage dashboard** (size/last-used/prune/dedupe) | Kills the #1 r/LocalLLaMA pain point; makes the tactile LM Studio interaction ours |
| **Behavior prover** (`behaviorTest.ts`) | Line-by-line JSX heuristics | Normalize each JSX element to one logical line before heuristics; make it the source of truth for "verified" everywhere; feed the render back via the VL sidecar | Fixes the multi-line `<button>`/`<a>`/`<form>` blind spot cheaply; closes the self-verification loop |
| **Serve endpoint** (`serveEngine.ts`) | Passive 127.0.0.1 endpoint | Make it a **persistent tray/background service** (tray + powerSaveBlocker already in-stack) with a prominent copy-paste base URL + "connect your IDE" onboarding | LM Studio's biggest complaint is it isn't persistent — flips us from consumer of the ecosystem to hub of it |
| **Knowledge base** (`knowledgeService.ts`) | `.md` hits-counted entries + dream-consolidation | Add an **architecture-decision-log item type** read at every plan turn; evolve toward a typed entity/relationship graph over the repo-map | Stops later turns re-litigating settled choices (Zustand-vs-Redux drift); durable structural memory |
| **Sub-agent offload** (Faz 17) | One foreground agent, sequential queue | **Named role team** (Explore/Plan/Implement/Verify) with per-role model routing (cheap 3B explores, strong 13B/API implements, dedicated Verify agent peer-reviews), visible in the Motor panel | Cuts local latency/VRAM and adds cross-agent verification — reuses `options.isolate` |
| **Task queue** (`taskQueue.ts`) | Sequential, single working dir | **Git-worktree isolation** per queued/parallel task so they can't collide; checkpoints already snapshot bytes → review/merge-or-discard per task | Fire several builds at once, cherry-pick winners — the frontier scaling default, all on-device |
| **`[EDIT]` img2img** | Fixed denoise strength 0.65 | **Intent-aware strength**: model reads change magnitude ("gece moduna çevir" → ~0.8, "add a small hat" → ~0.45) | Fixed 0.65 makes big edits barely change and small edits drift; subject-fidelity is already correct |
| **Local Stable Diffusion** (`localImageService.ts`) | Works only when GPU timing splits luckily on 4GB | Add the **LLM↔SD VRAM mutex/handoff** + a **gray-output validator** (channel-variance + stderr `ErrorOutOfDeviceMemory` scan, never trust exit code) | Takes offline image-gen from "demo" to "dependable on 4GB"; both localized to one file |

---

## 4. WOW FEATURES (users would love — with effort + local/cloud + why)

Ranked by evangelism potential × feasibility on our stack.

1. **The Judge — deterministic self-verifier gate** — *M, local.* A pure-assertion LLM-free Evaluator that captures a headless screenshot and renders an unflippable verdict (status/overflow/required-selector/filtered-console/expected-text) the model can never rationalize away. Turns the debug engine into a real prompt→act→verify→retry→stop loop. Users get "built AND proven working." The single biggest 2026 differentiator, and we're closest to it.

2. **Local Full-Stack — one-prompt PocketBase / Hono+SQLite backend on 127.0.0.1** — *L, local.* "A todo app with login and saved data" → a REAL working full-stack app (auth, DB, REST, admin UI) entirely offline. Every competitor's "prompt → working app with login + persistence" moment is cloud-locked (Bolt+Supabase, Lovable Cloud). We do the local inverse — a category we can *own* — riding existing `serveEngine` + `procRun` + trust gate, and the Behavior Prover can verify persistence.

3. **Visual select-to-edit for the web-builder (local Lovable/Onlook)** — *L, local.* Click any element in the live Vite preview, tweak size/color/text/padding/font (or type a nudge), and the agent rewrites the exact source. Lovable's most-praised feature and the single biggest UX leap for a builder. Most infra exists: the preview is a served dev server, `behaviorTest.ts` is already a CDP driver, and 14.10 point-and-steer captured locators.

4. **Real-browser self-verification loop (Computer Use, offline)** — *L, local.* After a fix, an embedded Electron webview / Puppeteer drives the running app, clicks the changed flow, screenshots it, and feeds the render back via the existing VL vision to confirm behavior. Cline's most-raved capability, done fully on-device.

5. **One-click Build Card export (GIF + screenshot of prompt→live preview)** — *L, local.* Captures the exact moment that makes NexoraAI special — a sentence becoming a live app entirely offline — as a polished, watermarked GIF/PNG users paste into X/Discord in seconds. Electron `desktopCapturer`/`capturePage` + an embedded gif encoder (gifenc). Turns every successful build into free word-of-mouth. **The highest-leverage virality feature.**

6. **Offline Slopsquatting Shield (package firewall)** — *M, local.* Before any dependency is installed or written to package.json, check it against a bundled offline registry snapshot + typo/age heuristics and block likely-hallucinated packages (a study found ~20% of generated code recommends non-existent packages). **No cloud tool offers this offline**; it stops an active malware class and fits the trust deny-list plumbing.

7. **Verification Ledger — every diff proven runnable** — *M, local.* Each change shows a bottom-up receipt (compiles / typechecks / tests / behavior-screenshot) from the deterministic detect engine. Answers the #1 review-fatigue wish ("stop making me read 600 lines") — users gate on green rows.

8. **Spec-Driven mode: editable living `spec.md` (Spec→Plan→Tasks→Implement)** — *L, local.* Matches Spec Kit / AWS Kiro, the anti-vibe-coding consensus. We already have SpecVerifier + projectContract internally; surface an editable spec that stays canonical and is re-judged every turn. EARS-style "WHEN…THE SYSTEM SHALL…" acceptance criteria feed straight into The Judge as machine-checkable asserts.

9. **Model Arena — synchronized side-by-side compare** — *L, local.* Msty's most-loved feature. Run one prompt (or one build brief) across N local models/quants in parallel panes and diff outputs: "which 7B builds this landing page best," "does Q4 vs Q6 change the code." Turns model choice from guesswork into evidence and showcases the capability-adaptive engine. Extends the branching DAG.

10. **Persistent tray server + integration hub** — *S, local.* Make the OpenAI endpoint a first-class persistent tray service with copy-paste config for Continue/Cline/Zed/Cursor/Aider. **No competitor offers "be the private backend for the whole ecosystem"** — and it's the exact loop that made Ollama the default local backend.

11. **LocalDocs / "Chat with my folder" RAG** — *M, local.* The most-demanded use case in the whole local-AI scene. Point at a folder of PDF/docx/txt/md → auto-index with the embedding infra we already have → cited, offline answers. Lands us in the AnythingLLM/GPT4All/Msty demand pool with mostly-existing plumbing.

12. **Screenshot / wireframe / sketch → app** — *S, local.* v0/Lovable's "killer feature," fully local: drop a screenshot or napkin sketch and the already-spawned Qwen-VL model turns it into an editable build. Near-free — just a drop-zone + refine loop.

13. **Parallel/background local agents with a runs sidebar** — *XL, local.* Fan out N history-isolated agents on independent sub-tasks (sequential on one GPU, still worktree-isolated), plus a local best-of-N judge ranking them by the verify+repro+fidelity results the engine already computes. Directly attacks our own documented run-to-run 3B variance — reliability as a feature, on YOUR GPU, no per-agent cloud bill.

14. **Local next-edit prediction (grammar-constrained tab-tab-tab)** — *XL, local.* The one defining 2025–26 IDE capability we have literally nothing of. Even a narrow "propagate the rename/signature change I just made" predictor — fed the recent diff + tree-sitter symbols, GBNF-constrained to emit a minimal applicable diff on a fast local GGUF — delivers the modern in-flow feel. Grammar-constraining is exactly what makes it feasible on the 3B we already run.

15. **Make-it-a-PWA / installable-app finisher** — *M, local.* One click adds a manifest + service worker (or Tauri-wraps the exported site) so the generated project installs like a native app and works offline. A delightful, on-mission finisher no local builder offers.

16. **Labeled opt-in "Publish" (BYO netlify-cli / wrangler / gh-pages)** — *M, cloud (opt-in + labelled).* Build locally, then ship to the user's OWN Netlify/Cloudflare/GitHub via *their* CLI/account/key, clearly labelled "this uploads to <host>." The only cloud touch, and it stays honest — routed through the user, never us.

---

## 5. Phased ROADMAP (Phase 21+)

### Phase 21 — Trust & Verify (fully offline)
**Goal:** make every change *provably* correct offline — the one thing cloud tools can't credibly offer.
- 21.1 **The Judge** — pure-assertion LLM-free Evaluator (status/overflow/required-selector/filtered-console/expected-text) with an unflippable verdict + hard retry ceiling; gate "accept turn" on it.
- 21.2 **Verification Ledger** — per-diff bottom-up receipts (compiles/typechecks/tests/behavior-screenshot); users gate on green rows.
- 21.3 **Proof-of-Edit receipts** — byte-level before/after in the transparency inspector.
- 21.4 **Destructive-Action Dry Run** ✅ **DONE** — `electron/shared/blastRadius.ts`: pure, deterministic, runs NOTHING. `analyzeCommand` parses destructive verbs (rm/rmdir/rd/del/erase/shred → delete; mv/move + `>` redirect → overwrite; recursive & Windows `/s` aware; quote-aware tokenizer). `describeImpact` matches targets against the project's in-memory file list (folder → all files under prefix, glob `*`, `./` normalize) and returns a human summary ("🗑 Silinecek: dist/ (3 dosya)" / "✏️ Üzerine yazılacak: config.json (yeni)"). Wired into the approval modal (`permissionRequest.items[].impact`, red preview box in PermissionModal) so the user sees the blast radius BEFORE approving. Intent-based invariant respected: previews command EFFECT, never decides intent. `test:blast` 27/27; typecheck node+web clean; build clean. LIVE-VERIFIED (real app + CDP: 6 previews correct incl. dist/=3-files count + visible modal screenshot dryrun-onay.png).
- 21.5 **Offline Slopsquatting Shield** ✅ **DONE** — `electron/shared/pkgShield.ts`: offline, deterministic. Parses install targets (npm/yarn/pnpm/bun/pip/pipx/python -m pip), screens each package against a bundled popular-package snapshot via Damerau-Levenshtein ≤1 (catches `reactt`, transposition `lodahs`) + separator-confusion (`crossenv`≈`cross-env`). Typosquats elevate the trust verdict `auto`→`ask` (user sees the reason before it installs); unknown-but-plausible names pass untouched (no nag). Wired into `commandVerdict` (single source of truth — all 3 exec paths covered). Intent-based invariant respected: verifies command SAFETY, never decides intent. `test:pkgshield` 51/51; trust 31/31 unchanged; ships in both bundles (live-verified).
- 21.6 Fix the behavior-prover multi-line JSX blind spot; make it the source of truth for "verified."
- **Impact: high · Effort: L · Why users win:** they stop reading 600-line diffs and get "built AND proven working," with data-loss and hallucinated-malware made basically impossible — offline.

### Phase 22 — Free Engine Wins (cash the half-wired code)
**Goal:** every local turn gets faster and every retrieval gets sharper, at near-zero build cost.
- 22.1 **Wire Turbo** — Settings toggle + IPC → `setTurboDraft()` + live accept-rate meter (auto-disable bad pairings).
- 22.2 **Draft-model provisioning** — curated same-family draft catalog + one-click download + Hardware-Advisor-aware default; auto-detect MTP/EAGLE-3 self-speculation heads.
- 22.3 **Wire preventive directive grammar** — attach `buildDirectiveGrammar()` + **lazy triggers** to the completion request so only a directive's *syntax* is constrained after the model freely chose to emit it (output-format only; **intent stays with the model — see the Hard Invariant above**). Live-test the bundled llama-server actually supports lazy grammar triggers; **if it doesn't, do not ship grammar** (no grammar > grammar that forces free generation into directive JSON). Opt-in + safe worker fallback, like Turbo.
- 22.4 **Local reranker** — BGE-reranker pass on the same `llama-server` binary over retrieval candidates.
- 22.5 **YaRN context stretch** toggle + **VRAM-aware asymmetric KV quant** (K=Q4/V=Q8 only when it unlocks context/draft).
- 22.6 **Predictive local difficulty router** (tiny embedding classifier, opt-in) + quant-quality-aware model picker hints.
- **Impact: high · Effort: M · Why users win:** a measured 1.4–2.5× speedup for free, whole-project context that no longer silently truncates, and sharper file selection — all offline.

### Phase 23 — The Builder Grows Up
**Goal:** stop editing only by chat; make generated apps genuinely functional offline.
- 23.1 **Local Full-Stack backend** — one-prompt PocketBase / Hono+SQLite on 127.0.0.1, AI-generated schema+auth+routes wired to the frontend, verified by the Behavior Prover.
- 23.2 **Visual select-to-edit** — click an element in the live preview → tweak size/color/text/padding/font → model rewrites exact source (reuse CDP + 14.10 locators).
- 23.3 **Real-browser self-verification loop** (Computer Use) feeding the render back via the VL sidecar.
- 23.4 **Screenshot/wireframe/sketch → app** drop zone on the running VL sidecar.
- 23.5 **Make-it-a-PWA** finisher (manifest + service worker).
- **Impact: high · Effort: XL · Why users win:** "prompt → working full-stack app with login + persistence" and click-to-edit — the two most-praised builder moments — but 100% offline, no data shipped to Supabase.

### Phase 24 — Frontier Agent Layer
**Goal:** match the 2026 convergence on spec-driven + parallel + role-scoped agents, on-device.
- 24.1 **Spec-Driven mode** — editable living `spec.md` (Spec→Plan→Tasks→Implement) re-judged every turn; EARS asserts feed The Judge.
- 24.2 **Git-worktree parallel isolation** per queued/parallel task; per-task review/merge-or-discard.
- 24.3 **Named sub-agent team** (Explore/Plan/Implement/Verify) with per-role model routing, visible in the Motor panel + cross-agent peer review before accept.
- 24.4 **Parallel best-of-N** — fan out 2–4 isolated attempts, local judge ranks by existing verify+repro+fidelity scores.
- 24.5 **Plan/Act + role-constrained custom modes** (Architect/Code/Debug/Ask) gating tools via existing trust-tier + deny-list.
- 24.6 **Confidence-scored escalation** — pause for human only on a confidence drop / repeated repro-fail (extends the 9.5 rule via the logRepair throat).
- 24.7 **Agent hooks** — filesystem/lifecycle triggers (on-save/create/delete → AI action) through the same trust gate; **Skills bundles** (prompt + tool-scope + optional hook, importable/exportable .zip); **MCP 2026 Tasks/Apps** support.
- **Impact: high · Effort: XL · Why users win:** trustworthy long builds that don't drift, fire-several-and-cherry-pick reliability, and safe higher autonomy — all on your GPU.

### Phase 25 — Local-AI Runner Table-Stakes
**Goal:** be a first-class local model *manager*, not just "bring your own GGUF."
- 25.1 **Fit pill everywhere** ✅ **DONE** — `classifyModelFit(sizeBytes, hw)` in `electron/shared/advisor.ts` (pure; same 1.5 GB headroom as the Advisor): 🟢 fits (weights fit VRAM → fast) / 🔵 spills·slow (fits RAM, partial offload) / 🔴 too big (exceeds RAM). ModelBrowser fetches `advisor.detect()` once on open and shows a colored badge next to each local model's size — user sees fit BEFORE loading (prevents surprise OOM on 4 GB). `test:advisor` +10 (21 total). LIVE-VERIFIED on the real RTX 2050 4 GB machine: 3B (1.9 GB)→🟢 sığar, 7B (4.7 GB)→🔵 taşar, 14B (9 GB)→🔵 taşar (model-sigma.png). *Deferred: per-quant pill at download time.*
- 25.2 **GPU-offload slider** (`n_gpu_layers` 0–100%) + quant picker with live tok/s + VRAM readout.
- 25.3 **Model storage dashboard** ✅ **CORE DONE** — ModelBrowser now shows total disk used (🖴 badge next to the İNDİRİLENLER count, e.g. "39.6 GB") + a per-model trash button with a two-step in-row confirm ("Silinsin mi? Sil/İptal") → one-click prune. New `electron/shared/modelStorage.ts` (pure: `fmtBytes`/`totalBytes`/`storageSummary` + delete-safety `isSafeModelName`/`isInsideDir`), `deleteLocalModel(dir,name)` in hfService (defense-in-depth: safe basename + resolves inside dir + is-file + unlink), IPC `HF_DELETE_LOCAL` + preload + `hfStore.deleteLocal`. `test:modelstorage` 30/30 (heavy path-safety coverage). LIVE-VERIFIED (real app + CDP: total badge + trash UI screenshot; delete of a dummy freed 10 MB & refreshed list 13→12; `../../../etc/passwd` & non-model names REJECTED, /etc/passwd untouched). *Deferred: last-used timestamp + dedupe-by-blob.*
- 25.4 **LocalDocs / "chat with my folder" RAG** with citations (+ optional YouTube-transcript ingest) on existing embedding infra.
- 25.5 **Model Arena** — synchronized side-by-side multi-model/multi-quant compare (extends branching DAG).
- 25.6 **Persistent tray server** + prominent copy-paste base URL.
- **Impact: medium-high · Effort: L · Why users win:** the #1 r/LocalLLaMA frustration (VRAM fit) dies, the most-demanded RAG use case is covered, and model choice becomes evidence-based.

### Phase 26 — Delight, Shareability & Growth
**Goal:** make the local-first magic *braggable* and turn every build into a discovery channel.
- 26.1 **One-click Build Card export** (GIF + annotated PNG of prompt→live preview, watermarked).
- 26.2 **Celebration moments** (opt-in confetti + chime) on first build/preview/export; **Time-machine rewind animation**.
- 26.3 **Live Privacy Meter** (0-bytes-egress badge) + "Airplane-mode build" demo mode.
- 26.4 **Guided first-win** starter + **"meanwhile" download companion** (skeleton + upfront size/VRAM disclosure).
- 26.5 **Integration hub** — "Use NexoraAI as your backend" copy-paste configs (Continue/Cline/Zed/Cursor) + **emit AGENTS.md**.
- 26.6 **Templates & Starters gallery** (portfolio/landing/dashboard/blog/docs — double as regression fixtures) + opt-in "Built with NexoraAI" export footer.
- 26.7 **Distribution:** winget + Homebrew Cask + Scoop + GitHub AppImage, promote Snap edge→stable; README 30s demo GIF above the fold + comparison table; awesome-list PRs + console.dev/TLDR pitches; timed HN launch 12–17 UTC.
- **Impact: high (growth) · Effort: M · Why users win:** their offline builds become instantly shareable, onboarding hits the first "aha" in <2 min, and NexoraAI becomes the default local backend the way Ollama did.

---

## 6. Explicitly out of scope / rejected (violates local-first or our values)

- **Cloud/background agents that upload the repo** (Cursor Cloud Agents, Codex Cloud, Copilot Coding Agent async, Devin handoff). Rejected: the repo would leave the machine. Our answer is *local* worktree parallelism (24.2/24.4).
- **Cloud-VM PR generation / issue→PR-as-a-service.** Same reason.
- **Any telemetry / usage analytics**, even anonymized. Non-negotiable. The "Privacy Meter" and "0-bytes egress" claims must stay literally true.
- **Any paywall, quota, or "pro tier."** Free & unlimited is a core value.
- **Silent cloud calls or cloud-by-default anything.** All 157 providers, the API escalation path, and the opt-in "Publish" step stay opt-in, labelled, and BYO-key/CLI routed through the *user's* account.
- **Cloud image/video generation** (hosted DALL·E-as-default, cloud text-to-video). On-device SD/VL only; cloud image is opt-in provider territory, never the default.
- **Marketplace with server-side hosting / lock-in** (a hosted Skills/MCP store). A *curated, local, no-telemetry, opt-in* catalog is fine (24.7); a hosted marketplace is not.
- **Flathub.** Permanently off the table (rejected under their AI-generated policy; do not re-propose). Distribution stays GitHub Releases + winget/Homebrew/Scoop/AppImage/Snap.
- **Keyword-regex intent detection.** Every new directive/mode must go through the intent gate, never a keyword match — this is a stack invariant, not a feature choice.
- **Tab-complete as a near-term commitment.** Kept as a WOW/backlog item (14 above), *not* a phase: it needs a dedicated low-latency completion model and is the hardest thing on the list; ship grammar-constrained *next-edit* first, only promote full inline autocomplete if a viable local model proves out.
- **Figma via raw REST as default.** Only via the local Figma dev-mode MCP server (config on our existing MCP client), or an explicitly opt-in token — never a baked-in cloud call.

---

## TL;DR recommendation
Start with **Phase 21 (Trust & Verify)** immediately, and slot **Phase 22.1–22.3 (wire Turbo + directive grammar)** alongside it as a parallel quick-win track — the turbo speedup is already coded and just needs a caller for `setTurboDraft()`. Trust & Verify is the one capability cloud tools cannot credibly match, and the engine wins are nearly free code already sitting in the repo.
