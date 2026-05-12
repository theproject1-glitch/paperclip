# Phase 1 End-to-End Verification

Generated: 2026-05-12

## Summary

The safe verification path passed, but a live real-money Casa execution was not run.

Reasons:

- `localhost:3100` is currently down, so the Python engine cannot post into Paperclip or call BBA `/execute`.
- The Python-to-Paperclip bridge is in PR #50 and not merged into the running server.
- The calibration persistence layer is in PR #51 and not merged into the running server.
- Running `daily_loop.py` without `--dry-run` now attempts live Casa placement through Paperclip BBA. That should wait for review/merge of PRs #48, #50, and #51 plus an explicit operator confirmation immediately before real-money execution.

## Completed Safe Checks

- Python strategy dry-run completed successfully.
- Output showed singles-only bet selection.
- Output showed zero combo bets.
- Output showed bankroll status with:
  - `bets_remaining: 15`
  - `singles_remaining: 15`
  - `combos_remaining: 0`
  - `tiered_stop_loss: none`
  - `drawdown_recovery_multiplier: 1.0`
  - `lifetime_halt_triggered: false`
- Python bridge calls fail softly while the server is down, so dry-run remains usable.

Command:

```powershell
cd C:\Users\thepr\.paperclip\instances\default\projects\b94fed82-38bf-4eb3-81d8-9b1a8aa84921\9ab808d0-c649-4e11-893e-6f9767fad183\_default\betting-system
python daily_loop.py --dry-run
```

Server check:

```powershell
Test-NetConnection -ComputerName localhost -Port 3100 -InformationLevel Quiet
```

Result: `False`

## Current PR Dependencies

- #48: BBA Playwright/Casa hardening.
- #49: Telegram runtime removal.
- #50: Python -> Paperclip bridge endpoints.
- #51: Sport + league + bet-type calibration signal persistence.

## Live Demo Runbook After Review/Merge

1. Merge and restart with PR #48 so BBA has the Chrome/profile/login hardening.
2. Merge and restart with PR #50 so Python can post predictions, bankroll snapshots, placed bets, and performance reports.
3. Merge and restart with PR #51 so calibration signals can persist.
4. Confirm Casa credentials are available as Paperclip secrets:
   - `CASA_USERNAME`
   - `CASA_PASSWORD`
5. Confirm Casa browser profile is authenticated or manually log in once.
6. Run a final dry-run:

   ```powershell
   python daily_loop.py --dry-run
   ```

7. Only with the operator present and ready for real-money execution, run:

   ```powershell
   python daily_loop.py
   ```

8. Verify:
   - Predictions appear in Paperclip.
   - BBA `/execute` creates a BBA Memory run.
   - Casa reaches the bet slip and places the intended single bet.
   - Placed bet is recorded in Paperclip.
   - Calibration/report bridge remains fail-safe if a write endpoint is unavailable.

## Verdict

End-to-end live placement is not verified yet. The implementation is staged, but real-money execution should wait until the PR stack is reviewed, merged, and the local Paperclip server is restarted from the merged master.
