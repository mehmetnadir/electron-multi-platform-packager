# Build-Agent Runner (pull model)

This Mac acts as a **build agent** for book-update. It PULLs jobs from book-update's
agent API, builds each via the **local packager HTTP service**, then POSTs the
artifact **file** back to book-update (which uploads it to R2 server-side —
Decision B, so R2 credentials never live on the agent).

Supported platforms on this agent: **android** (APK) and **macos** (.dmg, signed).

## Prerequisites

- Node.js 18+ (`node --version`).
- The local **packager service** running on this Mac. It defaults to port **3000**,
  so start it on **3001** to match `PACKAGER_API`:
  ```bash
  PORT=3001 npm start        # from the packager repo root
  ```
- Extraction tool for the Windows SFX exe — **one of**:
  ```bash
  brew install unrar     # preferred (WinRAR SFX = RAR format)
  brew install p7zip     # fallback (provides 7z)
  ```
- For signed/notarized macOS builds: Xcode command line tools (`codesign`, `xcrun notarytool`).

## Configuration (env)

| Var | Default | Notes |
|---|---|---|
| `BOOKUPDATE_API` | `https://akillitahta.ndr.ist/api/v1` | book-update agent API base |
| `AGENT_ENROLL_SECRET` | — | required only for first-time enrollment |
| `PACKAGER_API` | `http://127.0.0.1:3001` | local packager (run packager with `PORT=3001`) |
| `AGENT_CAPS` | `android,macos` | comma-separated capabilities |
| `AGENT_TOKEN_FILE` | `~/.empp-agent/token.json` | persisted `{agentId, token}` |
| `AGENT_NAME` | hostname | agent display name |
| `APPLE_SIGN_IDENTITY` | — | e.g. `Developer ID Application: Mehmet Arslan (335PPR74QM)` |
| `APPLE_TEAM_ID` | — | e.g. `335PPR74QM` |
| `APPLE_NOTARY_PROFILE` | — | notarytool keychain profile (preferred) |
| `APPLE_ID` / `APPLE_PASSWORD` | — | app-specific password fallback (needs `APPLE_TEAM_ID`) |

If signing env is missing, the runner ships the dmg **unsigned with a warning** (build still succeeds).

## Run

```bash
# from the packager repo root
export AGENT_ENROLL_SECRET=...           # first run only
export APPLE_SIGN_IDENTITY="Developer ID Application: Mehmet Arslan (335PPR74QM)"
export APPLE_TEAM_ID=335PPR74QM
export APPLE_NOTARY_PROFILE=empp-notary  # set up once: xcrun notarytool store-credentials

npm run agent
# or
node src/agent/runner.js
```

First run enrolls and writes `~/.empp-agent/token.json`; later runs reuse it.

## Run as a launchd service

```bash
# 1. edit launchd/com.empp.agent.plist — fix the node path, repo path, and secrets
cp launchd/com.empp.agent.plist ~/Library/LaunchAgents/com.empp.agent.plist
launchctl load -w ~/Library/LaunchAgents/com.empp.agent.plist

# logs
tail -f /tmp/empp-agent.out /tmp/empp-agent.err

# stop
launchctl unload -w ~/Library/LaunchAgents/com.empp.agent.plist
```

`RunAtLoad` + `KeepAlive` keep the agent running and restart it if it exits.

## Loop summary

1. `GET {API}/agents/{id}/next-job` (X-Agent-Token) every ~10s. 204 → sleep.
2. On a job `{bookId, platform, downloadUrl}`: download the Windows SFX exe → temp.
3. Extract it (`unrar`, fallback `7z`) → find `resources/app/build`.
4. Zip the build dir → `POST {PACKAGER}/api/upload-build` → `POST /api/package` →
   poll `/api/package-status/{jobId}` → download `/api/download/{jobId}/{platform}`.
5. macOS: `codesign` + `xcrun notarytool` (best-effort).
6. `POST {API}/agents/{id}/result` (multipart: file + bookId + platform + status + buildMethod).
   On any failure → POST `status: 'failed'` + error.

Heartbeat: `POST {API}/agents/{id}/heartbeat` every ~15s. One bad job never kills
the loop; network errors back off exponentially; `SIGTERM`/`SIGINT` exit gracefully.

## Tests

Pure helpers are unit-tested (no network/IO):

```bash
node --test src/agent/runner-helpers.test.js
node --check src/agent/runner.js   # syntax gate
```
