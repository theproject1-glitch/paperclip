import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  executeBbaBet,
  type ExecuteBetRequest,
  type ExecuteBetResult,
} from "../../api/bbaMemory";
import { cn } from "../../lib/utils";

interface BetSummary {
  matchLabel: string;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  currency?: string;
  bookmaker: string;
}

export interface BbaMemoryExecuteBetPanelProps {
  companyId: string;
  payload: ExecuteBetRequest | null;
  betSummary: BetSummary | null;
  onSuccess?: (response: ExecuteBetResult) => void;
  disabled?: boolean;
  className?: string;
}

const IDEMPOTENCY_WINDOW_MS = 60_000;
const CONFIRM_KEYWORD = "CONFIRM";
const PARTIAL_POLL_INTERVAL_MS = 5_000;
const PARTIAL_POLL_MAX_MS = 60_000;
const SS_KEY = "bba-memory.lastSubmitAt";

function readLastSubmit(companyId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, number>;
    return map[companyId] ?? null;
  } catch {
    return null;
  }
}

function writeLastSubmit(companyId: string, ts: number): void {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    const map = raw ? JSON.parse(raw) as Record<string, number> : {};
    map[companyId] = ts;
    sessionStorage.setItem(SS_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable in private mode or quota-constrained contexts.
  }
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `bba-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BbaMemoryExecuteBetPanel({
  companyId,
  payload,
  betSummary,
  onSuccess,
  disabled = false,
  className,
}: BbaMemoryExecuteBetPanelProps) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<ExecuteBetResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [wasReplay, setWasReplay] = useState(false);
  const [submitClock, setSubmitClock] = useState(Date.now());
  const modalRef = useRef<HTMLDivElement>(null);

  const lastCompanySubmit = readLastSubmit(companyId);
  const isWithinIdempotencyWindow =
    lastCompanySubmit !== null && submitClock - lastCompanySubmit < IDEMPOTENCY_WINDOW_MS;

  const { mutate, isPending } = useMutation({
    mutationFn: ({ req, idempotencyKey }: { req: ExecuteBetRequest; idempotencyKey: string }) =>
      executeBbaBet(companyId, req, { idempotencyKey }),
    onSuccess: (res) => {
      setResult(res);
      setWasReplay(res.wasReplay ?? false);
      setResultError(null);
      queryClient.invalidateQueries({ queryKey: ["bba-memory", "recent-runs", companyId] });
      queryClient.invalidateQueries({ queryKey: ["bba-memory", "stats", companyId] });
      onSuccess?.(res);
    },
    onError: (err) => {
      setResultError(err instanceof Error ? err.message : String(err));
      setResult(null);
      setWasReplay(false);
    },
  });

  useEffect(() => {
    if (!isWithinIdempotencyWindow) return;
    const timer = window.setInterval(() => setSubmitClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isWithinIdempotencyWindow]);

  useEffect(() => {
    if (result?.status !== "partial") return;
    const start = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - start >= PARTIAL_POLL_MAX_MS) {
        window.clearInterval(interval);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["bba-memory", "recent-runs", companyId] });
      queryClient.invalidateQueries({ queryKey: ["bba-memory", "stats", companyId] });
    }, PARTIAL_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [result?.status, companyId, queryClient]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setConfirmText("");
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeModal, modalOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    const modal = modalRef.current;
    if (!modal) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener("keydown", handler);
    return () => modal.removeEventListener("keydown", handler);
  }, [modalOpen]);

  const openModal = useCallback(() => {
    setSubmitClock(Date.now());
    if (disabled || isWithinIdempotencyWindow || !payload || !betSummary) return;
    setConfirmText("");
    setResult(null);
    setResultError(null);
    setWasReplay(false);
    setModalOpen(true);
  }, [betSummary, disabled, isWithinIdempotencyWindow, payload]);

  const handleConfirm = useCallback(() => {
    if (!payload || confirmText !== CONFIRM_KEYWORD || isPending) return;
    const idempotencyKey = makeIdempotencyKey();
    writeLastSubmit(companyId, Date.now());
    setSubmitClock(Date.now());
    setModalOpen(false);
    mutate({ req: payload, idempotencyKey });
  }, [companyId, confirmText, isPending, mutate, payload]);

  const isPlaceDisabled =
    disabled || !payload || !betSummary || isPending || isWithinIdempotencyWindow;
  const isSuccess = result?.status === "completed";
  const isPartial =
    result?.status === "partial" || result?.status === "submitted_unconfirmed";

  return (
    <div data-testid="bba-execute-panel" className={cn("space-y-3", className)}>
      {isWithinIdempotencyWindow && (
        <div data-testid="idempotency-warning" className="text-xs text-amber-700">
          A bet was submitted less than 60 seconds ago. Wait before placing another.
        </div>
      )}

      <button
        data-testid="place-bet-button"
        type="button"
        disabled={isPlaceDisabled}
        onClick={openModal}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-5 py-2 text-sm font-semibold text-white transition",
          isPlaceDisabled
            ? "cursor-not-allowed bg-gray-400"
            : "bg-red-600 hover:bg-red-700",
        )}
      >
        {isPending ? "Placing bet..." : "Place Bet"}
      </button>

      {isPending && (
        <span data-testid="placing-spinner" className="ml-2 text-sm text-gray-500">
          Placing bet...
        </span>
      )}

      {result && (
        <div
          data-testid="result-panel"
          data-outcome={result.status}
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            isSuccess && "bg-green-100 text-green-800",
            isPartial && "bg-yellow-100 text-yellow-800",
            !isSuccess && !isPartial && "bg-red-100 text-red-800",
          )}
        >
          {isSuccess && (
            <span>
              Bet placed successfully
              {result.placedBetId ? ` (ID: ${result.placedBetId})` : ""}.
            </span>
          )}
          {isPartial && <span>Bet submitted but needs bookmaker history verification.</span>}
          {!isSuccess && !isPartial && (
            <span>Bet failed{result.failureReason ? `: ${result.failureReason}` : "."}</span>
          )}
          {wasReplay && (
            <div className="mt-1 text-xs italic text-gray-500" data-testid="replay-banner">
              ↻ Cached replay (60s window)
            </div>
          )}
        </div>
      )}

      {resultError && (
        <div data-testid="error-panel" className="text-xs text-red-800">
          Error: {resultError}
        </div>
      )}

      {modalOpen && betSummary && (
        <div
          data-testid="confirm-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        >
          <div
            ref={modalRef}
            className="w-full max-w-[480px] rounded-lg bg-white p-6 shadow-2xl"
          >
            <h2 id="confirm-modal-title" className="m-0 text-lg font-semibold text-gray-900">
              Confirm Real Bet Placement
            </h2>

            <p className="mt-4 text-sm leading-6 text-gray-700">
              Confirm placing{" "}
              <strong>
                {betSummary.currency ?? "RON"} {betSummary.stake}
              </strong>{" "}
              on <strong>{betSummary.matchLabel}</strong> at{" "}
              <strong>{betSummary.bookmaker}</strong> with odds{" "}
              <strong>{betSummary.odds}</strong>.
            </p>

            <p className="text-xs text-gray-500">
              Market: {betSummary.market} · Selection: {betSummary.selection}
            </p>

            <label className="mt-4 block text-sm font-semibold text-gray-700">
              Type <code>{CONFIRM_KEYWORD}</code> to proceed
              <input
                data-testid="confirm-input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type CONFIRM"
                autoFocus
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                data-testid="cancel-button"
                type="button"
                onClick={closeModal}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                data-testid="confirm-submit-button"
                type="button"
                disabled={confirmText !== CONFIRM_KEYWORD}
                onClick={handleConfirm}
                className={cn(
                  "rounded px-4 py-2 text-sm font-semibold text-white",
                  confirmText === CONFIRM_KEYWORD
                    ? "bg-red-600 hover:bg-red-700"
                    : "cursor-not-allowed bg-gray-400",
                )}
              >
                Place Real Bet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
