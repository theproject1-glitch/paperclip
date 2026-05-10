import { afterEach, describe, expect, it, vi } from "vitest";

const launchPersistentContext = vi.hoisted(() => vi.fn(() => new Promise(() => undefined)));

vi.mock("@playwright/test", () => ({
  chromium: {
    launchPersistentContext,
  },
}));

import {
  __bbaKeepaliveTestHooks,
  startBbaSessionKeepalive,
  stopBbaSessionKeepalive,
} from "../services/bba-session-keepalive.js";

function createLocator(isVisible: boolean, click = vi.fn(), inputValue = vi.fn(async () => "")) {
  return {
    first() {
      return this;
    },
    isVisible: vi.fn(async () => isVisible),
    click,
    inputValue,
  };
}

describe("bba-session-keepalive", () => {
  afterEach(() => {
    stopBbaSessionKeepalive();
    vi.restoreAllMocks();
    launchPersistentContext.mockClear();
  });

  it("tries the JOACA overlay selector before generic accept selectors", async () => {
    const selectors: string[] = [];
    const page = {
      locator: vi.fn((selector: string) => {
        selectors.push(selector);
        return createLocator(false);
      }),
      waitForTimeout: vi.fn(),
    };

    await __bbaKeepaliveTestHooks.dismissOverlays(page as any);

    expect(selectors[0]).toContain("JOAC");
    expect(selectors.findIndex((selector) => selector.includes("JOAC"))).toBeLessThan(
      selectors.findIndex((selector) => selector.includes("ACCEPT")),
    );
  });

  it("waits 2500ms after clicking JOACA IN CONTINUARE", async () => {
    const click = vi.fn();
    const page = {
      locator: vi.fn((selector: string) => createLocator(selector.includes("JOAC"), click)),
      waitForTimeout: vi.fn(),
    };

    const clickedJoaca = await __bbaKeepaliveTestHooks.dismissOverlays(page as any);

    expect(clickedJoaca).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).toHaveBeenCalledWith(2_500);
  });

  it("returns false when autofill username field is not found", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector === ".header-login-wrapper.user-box-link") {
          return createLocator(true);
        }
        return createLocator(false);
      }),
      waitForTimeout: vi.fn(),
    };

    await expect(__bbaKeepaliveTestHooks.attemptAutofillRelogin(page as any)).resolves.toBe(false);
  });

  it("starts the keepalive timer, unrefs it, and warms the cache immediately", async () => {
    const intervalHandle = { unref: vi.fn() };
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(intervalHandle as any);

    startBbaSessionKeepalive();

    await vi.waitFor(() => expect(launchPersistentContext).toHaveBeenCalledTimes(1));
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), __bbaKeepaliveTestHooks.KEEPALIVE_INTERVAL_MS);
    expect(intervalHandle.unref).toHaveBeenCalledTimes(1);
  });

  it("stops the keepalive timer", () => {
    const intervalHandle = { unref: vi.fn() };
    vi.spyOn(globalThis, "setInterval").mockReturnValue(intervalHandle as any);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);

    startBbaSessionKeepalive();
    stopBbaSessionKeepalive();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalHandle);
  });
});
