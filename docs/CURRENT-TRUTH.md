# NexoraAI Current Implementation Truth

**Baseline:** v0.24.1

**Current release:** v0.25.1

**Current roadmap:** [ROADMAP-2026.md](../ROADMAP-2026.md)

**Status:** Phase 1 complete; Phase 2 — Verification OS is active.

This document describes what the current implementation can prove. Historical
roadmaps and release narratives explain how the product evolved, but they are not
authoritative when they conflict with source code, automated tests, or live desktop
evidence.

## Product reality

NexoraAI is an Electron desktop application with:

- an Electron main process for privileged filesystem, process, network, model,
  package, browser, and MCP operations;
- a context-isolated preload bridge;
- a React and Zustand renderer;
- local GGUF inference through llama-server with a node-llama-cpp worker fallback;
- optional, explicitly selected BYOK API providers;
- local persistent sessions, projects, build checks, browser checks, history, and export.

Local-first is the default. Explicitly selected features can use the network,
including API providers, model downloads, fetch actions, fonts, and catalogue refreshes.

## Verification truth

The required regression gate is:

1. `npm run typecheck`
2. `npm run test:engine`
3. `npm run test:capability`
4. `npm run build`
5. `npm audit --omit=dev`

`test:engine` is a broad Node-based regression suite for shared logic and selected
main-process services. It includes real loopback HTTP and SSE tests, but it is not a
full packaged Electron UI end-to-end suite.

`test:e2e-real` requires a local llama-server binary and GGUF model. It is outside the
default suite; missing prerequisites mean `unverified`, not `passed`.

There is currently no enforced lint, formatting, coverage, packaged-app smoke, or
automated real Electron UI gate. These remain follow-up quality work.

Verification has exactly three meanings:

- `passed`: the check ran and produced the required evidence;
- `failed`: the check ran and failed its acceptance condition;
- `unverified`: the check was skipped, unavailable, or lacked sufficient evidence.

Skipped and unavailable checks must never be promoted to green.

## Phase 1 truth

Phase 1 completed on 2026-07-19 after its automated and visible desktop gates passed.
It now provides request-scoped turn isolation, stale-continuation rejection, staged
artifact application, byte-exact rollback, mandatory CI, and an authoritative
renderer-to-main capability boundary.

`electron/shared/ipcCapabilityInventory.ts` classifies every one of the 108
renderer-to-main invoke methods. The capability test fails for an unclassified,
duplicate, or stale entry. Categories distinguish exact main-owned confirmation,
native chooser, managed read/write, session-authorized work, constrained-local work,
stop/revoke operations, and system UI.

The main process reclassifies agent actions before execution, while missing authority
defaults to read-only. Ask-class RUN commands, FETCH, FONT, DEV, external navigation,
provider/model network activity, and other privileged effects require an exact
main-owned confirmation or a narrower enforced invariant. Auto-safe workspace dev
commands (the project's own `npm`/`vite`/`tsc`/`eslint`/… lifecycle) run under the
`auto` tier without a modal — the tier grant *is* the standing approval — while a
forged renderer `auto` claim cannot smuggle an ask-class or network action, because
main re-derives the command's class from the exact string. BUILD runs fixed local
build binaries and is classified constrained-local, not a privileged confirmation.
Renderer `approved`, `projectAlways`, and `full` claims cannot bypass the boundary.
Confirmed actions are frozen and executed once, with no renderer-held replay token.
The confirmation modal carries a safety timeout and settles Deny if its window fails
to load, crashes, or hangs, so a broken modal can never wedge a turn.

The confirmation UI is a serialized main-process-owned desktop modal in a separate
non-persistent, preload-free, sandboxed partition. It displays the capability,
project, exact effect, and policy. Deny receives initial focus and Escape denies.
This replaced an earlier OS-message-box implementation after live Linux/GTK testing
showed that the affirmative button could receive focus despite the requested default.

The renderer itself is sandboxed, context-isolated, and has no Node integration.
Browser automation is loopback-only; unregistered external project paths are denied;
ZIP export always uses the main-owned save chooser. MCP processes cannot auto-start
without main authorization, and configuration reads redact environment values.
Provider keys are stored only in a main-process file, never in renderer local storage,
and legacy local-storage API keys are migrated out. They are encrypted with Electron
`safeStorage` whenever the OS keychain is available; on keyring-less Linux they fall
back to a base64 store the UI flags as unencrypted, so an existing key stays usable
instead of becoming silently unreadable (the v0.25.0 behavior). The store records which
mode it used, and decryption only invokes `safeStorage` when the store was written
encrypted. Startup advice is offline, and local
semantic indexing cannot silently download or start a missing embedding binary.

Package-manifest staging is classified as a managed-workspace write. It does not
execute packages: installation, build, development-server, and other process effects
remain separately protected by the corresponding main-owned capability gate.

The final gate passed typecheck, the full engine suite, all capability and IPC
inventory tests, the MCP lifecycle suite, the production renderer build, production
dependency audit, and diff validation. Visible Electron acceptance verified exact
Deny/Allow behavior against a real localhost server, sandbox isolation, loopback and
project-path restrictions, MCP redaction, forged ZIP-path rejection, Stop behavior,
and a clean application relaunch. The detailed evidence is recorded in
`ROADMAP-2026.md`.

v0.25.1 hardened this phase after a 6-agent adversarial review: it kept the boundary
above but removed the regressions it introduced — over-gated dev commands that popped a
modal on every build, a broken live-streaming path, and a credential store that made an
existing keyring-less key unreadable — and added the modal safety timeout. A live
desktop build (local model) then filled files incrementally with no modal and no error.

## Phase 2 truth

Phase 2 is active. Tri-state primitives (`passed`, `failed`, and `unverified`) already
exist, but one authoritative, evidence-backed verification ledger is not yet complete.
Build, queue, history, browser, UI, and proof-of-edit surfaces must preserve those
states without promoting skipped or unavailable checks to green.

## Packaging truth

CI contains Windows NSIS, Linux `.deb`, and macOS `.dmg` packaging jobs. Current
packages do not yet have every planned release control:

- macOS output is unsigned and not notarized;
- Windows signing is not configured;
- downloaded bundled Node runtimes are not checksum-verified;
- installer launch smoke tests, SBOM, provenance, and release checksums are not mandatory;
- Snap repair/publish is not part of the current GitHub Actions workflow.

## Source-of-truth order

When documents disagree, use this order:

1. current source code;
2. passing automated evidence from the same revision;
3. recorded desktop live-acceptance evidence;
4. this document;
5. `ROADMAP-2026.md`;
6. historical roadmaps, README chronicles, and old release notes.
