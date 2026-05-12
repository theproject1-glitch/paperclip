# Shared Strategy Reference — v2

**Single source of truth for all agents. Do not duplicate this content in individual agent prompts.**

---

## Bet Selection Criteria

- Minimum edge to consider: football ≥2%, basketball ≥3%, tennis ≥4%
- Skip if best available expected value (EV) is <4% — do not place edge-thin bets
- Singles only — no accumulators, parlays, or system bets

## Stake Sizing

- Fractional Kelly: 0.25 × Kelly fraction
- Hard cap: 3% of current bankroll per bet
- Never exceed the API `riskControls.maxStakePerBet` limit set by the operator

## Stop-Loss Rules

| Trigger | Threshold | Action |
|---|---|---|
| Daily drawdown soft alert | −5% of day-start bankroll | Log warning; Telegram alert; continue |
| Daily drawdown hard halt | −10% of day-start bankroll | Block all bets until next calendar day (Europe/Bucharest) |
| Session stop-loss | −10% of session-start bankroll | Block for current session |
| Consecutive losses | 3 in a row | 24-hour suspension |
| Lifetime stop-loss | Bankroll < 70% of initial deposit | Permanent halt; requires operator reset |

## Concentration Limits

- Max 40% of daily stake allocation in any single sport
- Max 25% of daily stake allocation in any single league

## Implementation Notes (for CTO reference)

- Daily/session stop-loss is enforced server-side in `server/src/services/betting-stop-loss.ts`
  - Defaults: `DEFAULT_DAILY_LIMIT_PCT = 0.05` (5%), `DEFAULT_SESSION_LIMIT_PCT = 0.10` (10%)
  - Note: current code enforces hard halt at 5% daily (single threshold); soft alert path not yet implemented
  - Do not change these constants without explicit CEO approval
- Kelly fraction calculation is the Python strategy layer's responsibility; the server validates stake ≤ maxStakePerBet
- Consecutive loss halt and lifetime stop-loss are not yet enforced server-side (pending implementation)
- Concentration limits are not yet enforced server-side (pending schema change to add sport/league fields)
