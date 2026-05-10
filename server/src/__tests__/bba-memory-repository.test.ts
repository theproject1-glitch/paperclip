import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;
let dbApi: typeof import("../services/bba-memory/db.js");
let repo: typeof import("../services/bba-memory/repository.js");

async function setupFreshDb() {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bba-memory-repo-"));
  process.env.BBA_MEMORY_DIR = tmpDir;
  dbApi = await import("../services/bba-memory/db.js");
  repo = await import("../services/bba-memory/repository.js");
  dbApi.initBbaMemory();
}

beforeEach(async () => {
  await setupFreshDb();
});

afterEach(() => {
  dbApi.closeBbaMemory();
  delete process.env.BBA_MEMORY_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bba-memory repository", () => {
  it("startRun + completeRun success path stores correct row", () => {
    const runId = repo.startRun({
      source: "manual",
      trigger: "unit-test",
      sessionStatusBefore: "expired",
      cookieCountBefore: 2,
    });

    repo.completeRun(runId, {
      outcome: "success",
      sessionStatusAfter: "active",
      cookieCountAfter: 8,
      durationMs: 1234,
      notes: "ok",
      meta: { companyId: "acme" },
    });

    const row = repo.getRun(runId);
    expect(row).toMatchObject({
      id: runId,
      source: "manual",
      trigger: "unit-test",
      outcome: "success",
      failure_class: null,
      session_status_before: "expired",
      session_status_after: "active",
      cookie_count_before: 2,
      cookie_count_after: 8,
      duration_ms: 1234,
      notes: "ok",
    });
    expect(JSON.parse(row?.meta_json ?? "{}")).toEqual({ companyId: "acme" });
  });

  it("completeRun with failureClass writes to runs.failure_class", () => {
    const runId = repo.startRun({ source: "manual" });

    repo.completeRun(runId, {
      outcome: "failure",
      failureClass: "NETWORK_ERROR",
    });

    expect(repo.getRun(runId)?.failure_class).toBe("NETWORK_ERROR");
  });

  it("failure_class CHECK constraint rejects invalid value", () => {
    const runId = repo.startRun({ source: "manual" });
    const db = dbApi.getDb();

    expect(() => {
      db.prepare("UPDATE runs SET failure_class = ? WHERE id = ?").run(
        "NOT_A_REAL_CLASS",
        runId,
      );
    }).toThrow(/CHECK constraint failed/);
  });

  it("recordSelectorObservation creates new selector with isNew=true", () => {
    const result = repo.recordSelectorObservation({
      purpose: "overlay",
      selector: ".new-overlay",
      hit: true,
      selectorLabel: "New overlay",
    });

    const row = dbApi
      .getDb()
      .prepare("SELECT * FROM selectors_observed WHERE id = ?")
      .get(result.selectorId) as { selector: string; hit_count: number; source: string };

    expect(result.isNew).toBe(true);
    expect(row.selector).toBe(".new-overlay");
    expect(row.hit_count).toBe(1);
    expect(row.source).toBe("discovered");
  });

  it("recordSelectorObservation increments counters on existing selector", () => {
    const first = repo.recordSelectorObservation({
      purpose: "overlay",
      selector: ".repeat-overlay",
      hit: true,
    });
    const second = repo.recordSelectorObservation({
      purpose: "overlay",
      selector: ".repeat-overlay",
      miss: true,
      clickFail: true,
    });

    const row = dbApi
      .getDb()
      .prepare("SELECT * FROM selectors_observed WHERE id = ?")
      .get(first.selectorId) as {
      hit_count: number;
      miss_count: number;
      click_fail_count: number;
    };

    expect(second).toEqual({ selectorId: first.selectorId, isNew: false });
    expect(row.hit_count).toBe(1);
    expect(row.miss_count).toBe(1);
    expect(row.click_fail_count).toBe(1);
  });

  it("recordPopup CASCADE delete: deleting a run deletes its popups", () => {
    const runId = repo.startRun({ source: "manual" });
    repo.recordPopup({
      runId,
      selector: ".popup",
      action: "dismissed",
      outcome: "closed",
    });

    dbApi.getDb().prepare("DELETE FROM runs WHERE id = ?").run(runId);

    expect(repo.listPopupsForRun(runId)).toEqual([]);
  });

  it("recordFailure CASCADE delete: deleting a run deletes its failures", () => {
    const runId = repo.startRun({ source: "manual" });
    repo.recordFailure({
      runId,
      failureClass: "SELECTOR_NOT_FOUND",
      step: "submit",
    });

    dbApi.getDb().prepare("DELETE FROM runs WHERE id = ?").run(runId);

    expect(repo.listFailuresForRun(runId)).toEqual([]);
  });

  it("reviewPopup approved sets source='reviewed' on linked selector", () => {
    const runId = repo.startRun({ source: "manual" });
    const { popupId } = repo.recordPopup({
      runId,
      selector: ".approve-me",
      action: "detected-only",
    });

    repo.reviewPopup(popupId, "approved");

    const row = dbApi
      .getDb()
      .prepare(
        `SELECT s.source, s.enabled
         FROM selectors_observed s
         JOIN popups_seen p ON p.selector_id = s.id
         WHERE p.id = ?`,
      )
      .get(popupId) as { source: string; enabled: number };

    expect(row.source).toBe("reviewed");
    expect(row.enabled).toBe(1);
  });

  it("reviewPopup rejected disables the linked selector", () => {
    const runId = repo.startRun({ source: "manual" });
    const { popupId } = repo.recordPopup({
      runId,
      selector: ".reject-me",
      action: "detected-only",
    });

    repo.reviewPopup(popupId, "rejected");

    const row = dbApi
      .getDb()
      .prepare(
        `SELECT s.enabled
         FROM selectors_observed s
         JOIN popups_seen p ON p.selector_id = s.id
         WHERE p.id = ?`,
      )
      .get(popupId) as { enabled: number };

    expect(row.enabled).toBe(0);
  });

  it("pruneOldRuns removes runs older than cutoff + their popups/failures", () => {
    const db = dbApi.getDb();
    const oldRunId = repo.startRun({ source: "manual" });
    const freshRunId = repo.startRun({ source: "manual" });
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(oldDate, oldRunId);
    repo.recordPopup({
      runId: oldRunId,
      selector: ".old-popup",
      action: "detected-only",
    });
    repo.recordFailure({
      runId: oldRunId,
      failureClass: "UNKNOWN",
      step: "other",
    });
    repo.recordPopup({
      runId: freshRunId,
      selector: ".fresh-popup",
      action: "detected-only",
    });

    const result = dbApi.pruneOldRuns(30);

    expect(result.deletedRuns).toBe(1);
    expect(repo.getRun(oldRunId)).toBeNull();
    expect(repo.getRun(freshRunId)).not.toBeNull();
    expect(repo.listPopupsForRun(oldRunId)).toEqual([]);
    expect(repo.listFailuresForRun(oldRunId)).toEqual([]);
    expect(repo.listPopupsForRun(freshRunId)).toHaveLength(1);
  });
});
