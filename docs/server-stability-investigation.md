# Server first-start stability investigation

Date: 2026-05-13

## Context

The prior run observed: first server start served traffic and then exited; second start stayed healthy. The goal here was to find a root cause or add enough diagnostics to catch the next occurrence.

## Evidence checked

Temp logs:

- `C:\Users\thepr\AppData\Local\Temp\paperclip-codex-server\server.out.log`
- `C:\Users\thepr\AppData\Local\Temp\paperclip-codex-server\server.err.log`
- `C:\Users\thepr\AppData\Local\Temp\paperclip-codex-server-2\server.out.log`
- `C:\Users\thepr\AppData\Local\Temp\paperclip-codex-server-2\server.err.log`

Findings:

- First stdout log reached `Server listening on 127.0.0.1:3100`.
- BBA keepalive started and successfully refreshed Casa cookies.
- First stderr log was empty.
- No `unhandled`, `EADDRINUSE`, `SIGTERM`, `SIGINT`, fatal error, or shutdown line was present in the first log.
- Second stdout log is much larger and indicates the later server stayed alive.

## Root cause

No clear root cause was recoverable from the available logs. The first process exited without an error record, which means the useful missing signal is process-level lifecycle diagnostics rather than another narrow subsystem guess.

Most plausible causes, unproven:

- Parent PowerShell job lifetime / shell exit behavior around the first dev start.
- A process-level unhandled rejection or exception before logging was installed.
- External termination by another script or operator process.

## Fix added

`server/src/index.ts` now registers diagnostics only for the main server entry point:

- `unhandledRejection`: logs the rejection reason.
- `uncaughtException`: logs the exception and exits with code 1.
- `beforeExit`: logs the exit code.
- `exit`: logs the exit code.

Relevant code:

- `server/src/index.ts:934`
- `server/src/index.ts:938`
- `server/src/index.ts:945`
- `server/src/index.ts:954`

This should make the next first-start exit explain itself in stdout/stderr instead of disappearing cleanly.

## Follow-up if it recurs

1. Start with stdout/stderr from the exact failed process.
2. Check Windows Event Viewer for the Node process PID if available.
3. Correlate with plugin worker startup and BBA keepalive timestamps.
4. If the exit is still clean with `beforeExit`, inspect live handles with a temporary active-handle dump before process exit.
