import { describe, expect, it, vi } from "vitest";
import { installLifecycle } from "./lifecycle.js";

const logger = () => ({ info: vi.fn(), error: vi.fn(), fatal: vi.fn() });
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("installLifecycle", () => {
  it("kaynakları bir kez kapatıp verilen kodla çıkar", async () => {
    const close = vi.fn(async () => {});
    const exit = vi.fn();
    const shutdown = installLifecycle({ logger: logger(), close, exit, processHandlers: false });
    shutdown("SIGTERM");
    shutdown("SIGTERM");
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("kapanış hatasında kod 1", async () => {
    const exit = vi.fn();
    const log = logger();
    const shutdown = installLifecycle({
      logger: log,
      close: async () => {
        throw new Error("db kapanmadı");
      },
      exit,
      processHandlers: false,
    });
    shutdown("SIGTERM");
    await settle();
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.error).toHaveBeenCalled();
  });

  it("süre aşılırsa zorla çıkar", async () => {
    const exit = vi.fn();
    const shutdown = installLifecycle({
      logger: logger(),
      close: () => new Promise(() => {}),
      exit,
      timeoutMs: 5,
      processHandlers: false,
    });
    shutdown("SIGTERM");
    await settle();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
