import { hours, makeLRUCache, minutes, seconds } from "./cache";

it("builds ttl options", () => {
  expect([seconds(30), seconds(1, 5), minutes(2), hours(2), hours(1, 3)]).toEqual([
    { max: 100, ttl: 30_000 },
    { max: 5, ttl: 1_000 },
    { max: 100, ttl: 120_000 },
    { max: 100, ttl: 7_200_000 },
    { max: 3, ttl: 3_600_000 },
  ]);
});

describe("makeLRUCache", () => {
  let calls = 0;
  const f = jest.fn(async (k: string) => `${k}${++calls}`);

  beforeEach(() => {
    calls = 0;
    f.mockClear();
  });

  it("memoizes per extracted key and invalidates on demand", async () => {
    const cached = makeLRUCache(f, k => k);

    await expect(cached("a")).resolves.toBe("a1");
    await expect(cached("a")).resolves.toBe("a1");
    await expect(cached("b")).resolves.toBe("b2");
    await expect(cached.force("a")).resolves.toBe("a3");
    await expect(cached("a")).resolves.toBe("a3");

    cached.hydrate("a", "hydrated");
    await expect(cached("a")).resolves.toBe("hydrated");

    cached.clear("a");
    await expect(cached("a")).resolves.toBe("a4");
    await expect(cached("b")).resolves.toBe("b2");

    cached.reset();
    await expect(cached("b")).resolves.toBe("b5");
    expect(f).toHaveBeenCalledTimes(5);
  });

  it("collapses concurrent calls onto one promise, and uses one key without an extractor", () => {
    const cached = makeLRUCache(f);

    expect(cached("a")).toBe(cached("b"));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("does not memoize a rejection (force: %s)", async force => {
    const rejectingOnce = jest.fn<Promise<string>, [string]>();
    rejectingOnce.mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    const cached = makeLRUCache(rejectingOnce, k => k);

    await expect(force ? cached.force("a") : cached("a")).rejects.toThrow("boom");
    await expect(cached("a")).resolves.toBe("ok");
  });

  it("defaults to ttlAutopurge when no max is given", async () => {
    const cached = makeLRUCache(f, k => k, { ttl: 20 });

    await expect(cached("a")).resolves.toBe("a1");
    await expect(cached("a")).resolves.toBe("a1");
    await new Promise(resolve => setTimeout(resolve, 40));
    await expect(cached("a")).resolves.toBe("a2");
  });
});
