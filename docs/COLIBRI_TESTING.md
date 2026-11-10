# Colibri validation scope

## Automated suites

- `npm test`: existing attachment/context/retrieval/export tests plus provider migration, loopback enforcement, HTTP discovery, authentication, request contracts, streaming/UTF-8, malformed/error/oversized streams, redirects, cancellation/deadlines and IPC privacy tests. Uses synthetic localhost fixtures; no real model.
- `npm run build:ui`: production React bundle.
- `npm run test:desktop`: actual Electron entrypoint, sandboxed preload, IPC, React UI, and native SQLite against a deliberately simulated local server. Tests old settings migration, preserved chat, model discovery, response diagnostic, default-provider selection, streamed chat, secret exclusion, CSP and persistence after reload. Writes screenshots and JSON to `test-artifacts`. A temporary user-data directory is used; real user data is untouched.
- `npm run test:windows-launcher`: Windows PowerShell argument/path handling, custom ports, rejected invalid paths and source/release layouts, without starting inference.
- `npm run dist`: Windows NSIS packaging; generated installer is unsigned unless signing is configured separately. Building an installer is not proof of successful installation on every Windows PC.
- `npm run test:colibri`: opt-in integration test against an already-running real Colibri server, using only a fixed synthetic prompt. NOT part of hardware-free CI.

## GitHub Actions

`colibri-validation.yml` executes the regression suite, production UI build and actual desktop smoke on Windows and Linux, plus PowerShell launcher tests and Windows packaging. Linux uses Xvfb. It uploads desktop screenshots/reports, the exact source snapshot and the Windows installer. Always consult the run for the commit being reviewed; a passing baseline does not validate later commits.

## Not established by simulated tests

No CI claim is made about actual RTX 5080 CUDA/Vulkan execution, SSD offload speed, tokens/second, VRAM/RAM fit, real Qwen/Gemma model compatibility, multilingual/clinical answer quality, extended GPU stability, or installation on the user's PC. Those require the user's selected prepared model and hardware. The PR remains a review branch until these acceptance checks and user approval.

The desktop fixture is explicitly labelled in source and JSON reports. No real resident documents, conversations, API keys, or user database are included in test artifacts.
