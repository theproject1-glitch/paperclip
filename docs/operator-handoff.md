# Operator Handoff: BBA Real-Bet Path

Date: 2026-05-12

This handoff is for operating BBA against the user's own Casa Pariurilor account
through the user's already logged-in Chrome session.

## One-Time Setup

1. Close Chrome manually if it is already open without remote debugging.
2. Run:

   ```powershell
   .\scripts\start-chrome-debug.ps1
   ```

3. Confirm the script prints a Chrome debug endpoint on port `9222`.
4. In that Chrome window, confirm Casa Pariurilor is logged in as the user's
   account and the expected balance is visible.

The script will not kill Chrome automatically. If Chrome is already running
without the debug port, the script stops and asks the operator to close Chrome
manually first.

## Per Session

- Keep the Chrome window open while BBA is operating.
- If Chrome closes or restarts, rerun `scripts/start-chrome-debug.ps1`.
- BBA will attach to `http://localhost:9222` and reuse an existing Casa tab when
  one exists.
- BBA leaves Chrome open at the end of execution.
- BBA handles Casa's inactivity prompt by clicking `JOACĂ ÎN CONTINUARE` when
  visible.

## First Real Bet Protocol

Use an operator-present dry preview first:

1. Start Paperclip server.
2. Start Chrome with `scripts/start-chrome-debug.ps1`.
3. Confirm Casa login and balance in Chrome.
4. Trigger BBA with `execution.attachToUserChrome: true`.
5. Keep `riskControls.requireFinalConfirmation: true`.
6. Confirm BBA reaches the review/preview stage.
7. Verify match, market, selection, odds, and stake visually.
8. Do not submit until the operator explicitly approves the final click.

Recommended first live stake: `1-5 RON`.

## Cannot Be Fully Automated

- Initial Casa account login.
- Any OTP/CAPTCHA challenge.
- Keeping the Chrome user profile healthy.
- Anthropic/Codex subscription maintenance.
- CEO escalation decisions for anomaly, lifetime stop-loss, or suspicious odds.

## BBA Now Auto-Handles

- Using the user's real Chrome session through CDP.
- Avoiding bundled Chromium for Casa by default.
- Refusing to proceed with a clear error when the debug port is unavailable.
- Keeping the user's Chrome open after execution.
- Casa inactivity prompt handling.
- Avoiding closing login modals during overlay cleanup.
- Basic Playwright/bot-detection mitigations on the attached page.

## Preview Test Status

`http://localhost:9222/json/version` was reachable during this work and reported
Chrome `147.0.7727.138`.

No preview execution was run in this PR because the task requires operator
confirmation before manipulating the live Casa account UI. This is intentional:
the code is ready for the operator-present preview, but Codex did not navigate
or click in the live betting account.
