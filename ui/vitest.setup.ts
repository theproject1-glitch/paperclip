const localStorageEntries = new Map<string, string>();
const sessionStorageEntries = new Map<string, string>();

function installStorageMock(
  target: Record<string, unknown>,
  name: "localStorage" | "sessionStorage",
  entries: Map<string, string>,
) {
  Object.defineProperty(target, name, {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, String(value));
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
      clear: () => {
        entries.clear();
      },
    },
  });
}

if (
  typeof globalThis.localStorage?.getItem !== "function"
  || typeof globalThis.localStorage?.setItem !== "function"
  || typeof globalThis.localStorage?.removeItem !== "function"
  || typeof globalThis.localStorage?.clear !== "function"
) {
  installStorageMock(globalThis, "localStorage", localStorageEntries);
}

if (
  typeof globalThis.sessionStorage?.getItem !== "function"
  || typeof globalThis.sessionStorage?.setItem !== "function"
  || typeof globalThis.sessionStorage?.removeItem !== "function"
  || typeof globalThis.sessionStorage?.clear !== "function"
) {
  installStorageMock(globalThis, "sessionStorage", sessionStorageEntries);
}

if (typeof window !== "undefined" && window.localStorage !== globalThis.localStorage) {
  installStorageMock(window as unknown as Record<string, unknown>, "localStorage", localStorageEntries);
}

if (typeof window !== "undefined" && window.sessionStorage !== globalThis.sessionStorage) {
  installStorageMock(window as unknown as Record<string, unknown>, "sessionStorage", sessionStorageEntries);
}

// ── @testing-library/jest-dom matchers ─────────────────────────────────────
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});
