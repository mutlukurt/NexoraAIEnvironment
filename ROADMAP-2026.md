# NexoraAI 2026 Product Roadmap

**Baseline:** v0.24.1

**Current release:** v0.25.0

**Product position:** Local Verified App Factory

**Status:** Phase 1 complete — Phase 2 active

## Product promise

NexoraAI turns an idea into a real, runnable application while keeping the model,
source code, project data, and verification evidence under the user's control.

> Your code stayed with you. The model ran on your machine. NexoraAI proved what
> changed and whether the result actually works.

Local-first privacy is the entry point, not the whole moat. The defensible product
is the combination of:

- hardware-aware local inference;
- a real application-building workspace;
- transactional and reversible agent changes;
- deterministic build and browser evidence;
- a visible, auditable verification ledger;
- optional cloud providers that are explicit, labelled, and BYOK.

## Non-negotiable engineering rules

1. **Local-first by default.** Network use is opt-in, visible, scoped, and revocable.
2. **Intent belongs to the model.** Deterministic code may validate safety, format,
   and correctness, but must not replace intent understanding with keyword routing.
3. **No unproven green state.** A skipped or unavailable check is `unverified`, never
   `passed`.
4. **Agent writes are transactional.** Incomplete output, aborts, crashes, and stale
   turns must not leave partially applied projects.
5. **The privileged boundary lives in Electron main.** Renderer decisions alone may
   never authorize process, filesystem, network, package, or MCP capabilities.
6. **Every phase has two gates.** Automated verification must pass first; then the
   packaged or development desktop application must pass a real live acceptance test
   on the user's computer.
7. **No phase advances on documentation claims.** Source code, automated evidence,
   and the live desktop test are the source of truth.

## Starting v0.24.1 baseline

### Strong foundations already shipped

- Local GGUF inference through llama-server with a node-llama-cpp worker fallback.
- Optional BYOK provider routing and a broad provider catalogue.
- Hardware advice, model search/download, storage management, and GPU offload control.
- Smart context selection, repo maps, code search, local embeddings, and project rules.
- Real project workspaces, terminal actions, Vite runtime, build checks, and ZIP export.
- Sessions, checkpoints, rewind, branches, task queue, schedules, and project knowledge.
- MCP stdio client and a localhost OpenAI-compatible serving endpoint.
- Local vision, Stable Diffusion image generation, and Whisper transcription paths.
- Trust tiers, hard-deny rules, package typo protection, and destructive-action preview.
- Windows, Linux, and macOS packaging jobs.

### Partially integrated or unreliable areas

- Turn, session, permission, directive, and stream continuations are not consistently
  request-scoped.
- Streaming file application and rollback are not fully atomic.
- Verification can currently promote skipped or weak checks to a green state.
- Trust coverage differs between RUN, DEV, PKG, FONT, FETCH, and MCP paths.
- Turbo is wired, but the bundled llama.cpp version requires newer speculative-decoding
  flags and stronger draft-model compatibility checks.
- Browser behavior checks and SpecVerifier exist, but do not yet form one authoritative
  evidence model.
- Preview code exists but is not currently a productized in-app real-runtime surface.
- The active configuration profile behaves globally despite session-scoped claims.
- Documentation contains stale and contradictory implementation claims.

## Phase delivery protocol

Every phase follows this fixed sequence:

1. Add characterization or regression tests for the current behavior.
2. Implement the smallest behavior-preserving slice.
3. Run targeted tests, full typecheck, the engine suite, and the production build.
4. Launch NexoraAI on the user's desktop.
5. Execute the phase's live acceptance checklist using real UI interactions.
6. Inspect visible output, runtime logs, changed files, and persisted state.
7. Record pass/fail evidence in the phase notes.
8. Advance only after every mandatory live item passes.

## Phase 1 — Truth and Safety

**Goal:** make turns isolated, writes reversible, permissions authoritative, and CI
incapable of accepting a known-broken change.

### Work

- Fix intent-gate and early-return lifecycle cleanup.
- Introduce request-scoped operation, turn, session, project, and base-revision identity.
- Reject stale stream, completion, permission, directive, and verification continuations.
- Move privileged capability authorization into Electron main.
- Apply one capability policy to process, filesystem, network, package, font, dev-server,
  browser-open, and MCP actions.
- Replace direct streaming mutation with staged, validated, atomic apply/rollback.
- Guarantee byte-exact rollback after abort, malformed output, or failed validation.
- Add a PR/main quality workflow for typecheck, engine tests, build, and production audit.
- Publish a concise current-truth document and mark stale roadmap claims as historical.

### Automated exit criteria

- No intent-gate path leaves `sending`, `generating`, timers, or empty stream messages active.
- Delayed events from an old turn cannot mutate a new turn, session, or project.
- Abort and failure restore the exact starting project hash.
- Read-only mode produces zero filesystem, network, package, process, or MCP side effects.
- Every privileged action is validated in Electron main.
- Pull requests cannot pass with a type, engine-test, or production-build failure.

### Mandatory desktop live acceptance

- Trigger ambiguous build clarification and confirm the UI returns to idle cleanly.
- Start a generation, stop it, start another turn, and confirm no stale token/file appears.
- Switch or create a session around an active/aborted turn and verify isolation.
- Exercise permission deny, allow-once, and read-only behavior for real actions.
- Abort a file-producing turn and verify the project returns to its exact prior state.
- Relaunch the application and verify session and pending-state integrity.

### Completion checkpoint — 2026-07-19

**Result:** Phase 1 is complete and Phase 2 is active. Request isolation, exact
artifact rollback, truthful tri-state verification primitives, mandatory quality
gates, and the complete renderer-to-main capability boundary passed both automated
and visible desktop acceptance.

The shared authoritative IPC inventory classifies all 108 renderer-to-main invoke
methods. CI fails when a bridge method is missing from the inventory, appears more
than once, or no longer exists. Each method is constrained as a main-owned exact
confirmation, native file/directory dialog, managed read/write, session-authorized
operation, stop/revoke action, constrained local action, or system UI operation.

Privileged actions use a serialized, main-owned desktop modal that displays the exact
capability, project, effect, and policy. The modal runs in a separate non-persistent,
preload-free, sandboxed partition; Deny owns initial focus and Escape denies. The
action is frozen and executed immediately after one approval, so renderer claims such
as `approved`, `projectAlways`, and `full` cannot authorize or replay it.

Additional closure controls:

- The renderer is sandboxed with context isolation and without Node integration.
- External navigation, model/catalog activity, provider network operations, local
  model/vision/image/audio paths, MCP lifecycle, and other privileged surfaces are
  gated or restricted by an enforced local invariant.
- Browser automation and capture endpoints accept loopback HTTP(S) only.
- ZIP export always uses the main-owned save chooser; a renderer-supplied save path is
  ignored.
- MCP servers cannot auto-start before main-process authorization. Configuration reads
  redact environment values, while changes show exact values in the approval effect.
- Provider secrets require Electron `safeStorage`; there is no plaintext/base64
  fallback. Legacy renderer API keys are removed from local storage during migration.
- Package-manifest staging is a managed-workspace write. Package installation and
  execution remain separately protected by the build/dev/process authority.
- Startup hardware advice is offline, and semantic indexing may use only an already
  installed local embedding binary, preventing silent network or process startup.

Automated evidence:

- `npm run typecheck` passed.
- `npm run test:engine` passed, including the request-lifecycle, verification-result,
  artifact-transaction, trust, profile, approval-persistence, package-shield, and
  artifact regression suites.
- `npm run test:capability` passed the 12 policy checks, 13 authority checks, and all
  13 IPC inventory checks covering 108 invokes.
- Native authority regression tests passed renderer-forgery, read-only, hard-deny,
  exact-confirmation, sandbox, credential, navigation, ZIP, MCP, and loopback checks.
- `npm run test:mcp` passed all 15 protocol and lifecycle-authorization checks.
- `npm run build` passed.
- `npm audit --omit=dev` reported zero vulnerabilities.
- `git diff --check` passed.

Desktop evidence, executed against the current source build in a visible Electron 43
window on the user's Linux desktop:

- An underspecified build request produced one clarification question, returned the
  composer to idle, and created no project or artifact.
- A real local Qwen2.5-Coder 3B generation was stopped; a concurrent request was
  rejected, a mismatched abort was ignored, the matching abort stopped the request,
  and a new session completed with only its own request-scoped events.
- Read-only and missing-authorization process calls produced no workspace side
  effects. An unapproved write was rejected, the same write succeeded with an
  allow-once authorization, and its marker was read back through the real command
  runner. A root-targeting destructive command remained denied even at Full trust.
- Fetch, dev-server, and MCP capabilities were blocked at the main boundary without
  the required authorization.
- A forged `full + approved + projectAlways` renderer call could not execute without
  main-owned confirmation. Deny produced zero workspace sync; Allow once wrote one
  exact marker; a second forged call required a new confirmation and Deny left the
  marker unchanged. Read-only and root-targeting hard deny did not open a modal.
- A visible file-producing turn reached `src/App.tsx`, was stopped, displayed the
  rollback notice, returned to zero artifacts, and left the on-disk project list
  empty.
- A session containing a marker file plus pending package, font, and dev approvals
  survived a full application relaunch and was visible and byte-equivalent after
  reload.
- On the final boundary pass, the confirmation visibly showed localhost port `18888`
  and the applicable policy with Deny focused. Deny kept the port closed; a fresh
  request followed by one Allow started the real endpoint and `/v1/models` returned
  HTTP 200; Stop closed the port again.
- Non-loopback browser automation was rejected, an unregistered `/etc` project path
  was rejected, MCP environment values were redacted, and a forged ZIP save path
  created no file and opened the main-owned chooser instead.
- The final relaunch used a clean isolated acceptance profile. The current repository
  renderer loaded with `require` and `process` unavailable, the preload bridge and
  home argument intact, no stale server running, and no unexpected privileged modal.
- The application remained visibly open on the current source build after acceptance.

Environment note: an earlier checkpoint used the installed Snap desktop runtime after
a host GTK launch failure. The final closure pass ran the repository's host Electron
43 binary successfully after removing VS Code's inherited `ELECTRON_RUN_AS_NODE`
environment variable. Both passes loaded this repository's
`out/renderer/index.html`, not a packaged renderer.

## Phase 2 — Verification OS

**Status:** Active

**Goal:** make every success claim truthful, inspectable, and evidence-backed.

### Work

- Introduce `passed`, `failed`, and `unverified` as the only verification outcomes.
- Preserve skipped/unavailable state through build, queue, history, and UI layers.
- Add a deterministic Judge and a per-turn Verification Ledger.
- Attach file hashes, command, exit code, diagnostics, DOM assertions, screenshots, and
  timestamps to verification rows.
- Add Proof-of-Edit receipts and structured ActionResult records.
- Wire EARS-style acceptance criteria into the production build flow.

### Exit criteria

- A skipped check can never become passed or green.
- Every passed row links to machine-readable evidence.
- False-verified rate is below 1% on the canonical mutant fixture set.
- The desktop live test visibly distinguishes passed, failed, and unverified projects.

## Phase 3 — Local Engine Autopilot

**Goal:** choose and run the best local configuration for the task and hardware.

### Work

- Fix Turbo flags for the bundled llama.cpp and probe binary capabilities.
- Verify draft/target tokenizer compatibility and auto-disable poor pairings.
- Add request-scoped inference scheduling, cancellation, and backpressure.
- Add one lifecycle manager for text, vision, image, embedding, and Whisper sidecars.
- Budget context/output from real tokens, model metadata, RAM, VRAM, and KV cost.
- Expose TTFT, prefill/decode speed, cache use, memory, and draft acceptance locally.
- Improve semantic-index persistence and changed-file-only indexing.

### Exit criteria

- Compatible Turbo pairs deliver at least 1.3x median decode speed without fallback.
- Incompatible pairs are never selected or are disabled automatically.
- Concurrent/aborted request stress produces zero mixed output or zombie generation.
- Supported hardware loads successfully on the first plan at least 95% of the time.

## Phase 4 — Proof-Backed Builder

**Goal:** turn user requirements into machine-checkable application behavior.

### Work

- Add a Living Spec mode with editable acceptance criteria.
- Make file/path/placement verification project-aware.
- Strengthen browser verification from click presence to observed URL, DOM, state,
  validation, network, and screenshot outcomes.
- Run local and frontier models through the same verifier.
- Store the spec, diff, build evidence, and browser proof with the session.

### Exit criteria

- Every acceptance criterion is visibly passed, failed, or unverified.
- At least 90% of canonical criteria are executable or explicitly marked unverified.
- No browser flow is passed merely because an element existed or received a click.

## Phase 5 — Visual Builder and First-Win UX

**Goal:** make the strongest capabilities visible and reduce time to a successful app.

### Work

- Add a real Vite-backed in-app split preview.
- Add preview element selection and source mapping.
- Support controlled text, spacing, color, typography, and image edits.
- Add guided first-run setup, safe model download recovery, and a starter success flow.
- Surface a combined Verification and Privacy Receipt after every turn.
- Improve permission scopes, destructive undo, accessibility, localization, and errors.
- Add copy-ready local endpoint configurations for external clients.

### Exit criteria

- Selected elements map to the correct source component at least 90% of the time.
- Warm Run-to-visible median is below five seconds on the reference machine.
- With a model ready, median time to the first working offline app is below five minutes.
- Privacy claims are based on measured routing/egress evidence, not labels alone.

## Phase 6 — Flagship Local Full-Stack Beta

**Goal:** build a real persistent application completely offline with one opinionated stack.

### Work

- Ship one supported path: React/Vite + Hono + SQLite.
- Add local auth/session, CRUD, file storage, seed, migration, backup, and restore.
- Verify persistence across process and application restarts.
- Add an adapter boundary for later opt-in cloud deployment without making cloud the default.
- Harden package size, signing, notarization, SBOM, checksums, and packaged smoke tests.

### Exit criteria

- A canonical auth + CRUD application works offline and preserves data after restart.
- Backup, restore, and migration pass automated and desktop live tests.
- Twenty canonical projects pass on three hardware classes.
- Stable releases are signed, reproducible, smoke-tested, and free of open P0 defects.

## Strategic backlog after Phase 6

- Worktree-isolated local agent teams and best-of-N verification.
- Portable, signed Skills and MCP packs with permission manifests.
- Unified code/document LocalDocs RAG with citations.
- Model and quant Arena.
- Encrypted remote status and approval companion.
- On-prem team policy and governance.
- Optional user-owned deployment adapters.

## Explicitly not now

- A new VS Code fork or an autocomplete race.
- A proprietary cloud inference fleet or hosting platform.
- Broad multi-agent fan-out before transaction and verification correctness.
- Supporting every backend, framework, and deployment target at once.
- YaRN, asymmetric KV, or grammar features without binary capability probes and benchmarks.
- A hosted lock-in marketplace.
- Unproven “zero-byte egress” marketing.
- Growth celebrations before the success signal is trustworthy.
- A big-bang appStore rewrite; extraction must use characterization tests and a strangler path.

## Initial implementation order

1. Intent lifecycle cleanup and regression tests.
2. Truthful verification result primitives needed by Phase 1/2 boundaries.
3. Required PR/main quality workflow.
4. Operation identity and stale-event rejection.
5. Main-owned capability authorization.
6. Transactional staged apply and byte-exact rollback.
7. Phase 1 automated gate.
8. Phase 1 desktop live acceptance.
