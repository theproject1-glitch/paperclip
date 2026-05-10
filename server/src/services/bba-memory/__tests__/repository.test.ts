import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../../middleware/logger.js";

let tmpDir: string;
let bbaMemory: typeof import("../index.js");

function resetDb() {
  bbaMemory.getDb().exec(`
    DELETE FROM failures;
    DELETE FROM popups_seen;
    DELETE FROM runs;
    DELETE FROM idempotency_keys;
  `);
}

describe.sequential("bba-memory repository", () => {
  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bba-repo-test-"));
    process.env.BBA_MEMORY_DIR = tmpDir;
    bbaMemory = await import("../index.js");
    bbaMemory.initBbaMemory();
  });

  beforeEach(() => {
    resetDb();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    bbaMemory.closeBbaMemory();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("safeParseMetaJson returns parsed object for valid JSON", () => {
    expect(bbaMemory.safeParseMetaJson('{"companyId":"company-1","count":2}', 1)).toEqual({
      companyId: "company-1",
      count: 2,
    });
  });

  it("safeParseMetaJson returns null and logs warning for malformed JSON", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    expect(bbaMemory.safeParseMetaJson("{bad-json", 42)).toBeNull();

    expect(warn).toHaveBeenCalledWith(
      { runId: 42, metaJson: "{bad-json" },
      "bba-memory: corrupt meta_json, treating as null",
    );
  });

  it("safeParseMetaJson returns null for null input", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    expect(bbaMemory.safeParseMetaJson(null, 1)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("safeParseMetaJson returns null for empty string", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    expect(bbaMemory.safeParseMetaJson("", 1)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("safeParseMetaJson does not throw for random byte sequences", () => {
    for (let i = 0; i < 50; i += 1) {
      const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
      const input = Buffer.from(bytes).toString("latin1");

      expect(() => bbaMemory.safeParseMetaJson(input, i)).not.toThrow();
    }
  });

  it("putIdempotencyKey then getIdempotencyKey within 60s returns the row", () => {
    bbaMemory.putIdempotencyKey("key-1", "company-1", '{"status":"completed"}');

    const row = bbaMemory.getIdempotencyKey("key-1");

    expect(row).toMatchObject({
      key: "key-1",
      company_id: "company-1",
      response_json: '{"status":"completed"}',
    });
  });

  it("getIdempotencyKey after 60s deletes the row and returns undefined", () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    bbaMemory.putIdempotencyKey("key-expired", "company-1", "{}");

    nowSpy.mockReturnValue(now + 61_000);
    expect(bbaMemory.getIdempotencyKey("key-expired")).toBeUndefined();
    const rows = bbaMemory.getDb()
      .prepare("SELECT * FROM idempotency_keys WHERE key = ?")
      .all("key-expired");
    expect(rows).toHaveLength(0);
  });

  it("deleteIdempotentForCompany removes only target company keys", () => {
    bbaMemory.putIdempotencyKey("key-1", "company-1", "{}");
    bbaMemory.putIdempotencyKey("key-2", "company-2", "{}");

    expect(bbaMemory.deleteIdempotentForCompany("company-1")).toBe(1);
    const remaining = bbaMemory.getDb()
      .prepare("SELECT company_id FROM idempotency_keys ORDER BY company_id")
      .all() as Array<{ company_id: string }>;

    expect(remaining.map((r) => r.company_id)).toEqual(["company-2"]);
  });
});
