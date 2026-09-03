import { atomicQueue, delay, execAndWaitAtLeast, promiseAllBatched, retry } from "./promise";

describe("promise", () => {
  test("promiseAllBatched", async () => {
    const promisifyIdPlusOne = (a: number) => Promise.resolve(a + 1);

    const p = promiseAllBatched(5, [], promisifyIdPlusOne);
    expect(typeof p.then).toBe("function");
    expect(await p).toEqual([]);
    expect(await promiseAllBatched(5, [1, 2, 3, 4, 5, 6, 7, 8], promisifyIdPlusOne)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(await promiseAllBatched(1, [1, 2, 3, 4, 5, 6, 7, 8], promisifyIdPlusOne)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(await promiseAllBatched(10, [1, 2, 3, 4, 5, 6, 7, 8], promisifyIdPlusOne)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(await promiseAllBatched(2, Array(6).fill(0), (_, i) => Promise.resolve(i))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
  describe("promise retries", () => {
    test("should retry by default", async () => {
      let numberOfExecutions = 0;
      const testFunction = () => Promise.reject(numberOfExecutions++);
      try {
        await retry(() => testFunction(), {
          maxRetry: 5,
        });
      } catch (e) {
        expect(e).toBe(5);
      }
      expect(numberOfExecutions).toBe(6);
    });

    test("should retry when retryCondition is passed", async () => {
      let numberOfExecutions = 0;
      const testFunction = () => Promise.reject(numberOfExecutions++);
      try {
        await retry(() => testFunction(), {
          maxRetry: 5,
          retryCondition: _ => {
            return true;
          },
        });
      } catch (e) {
        expect(e).toBe(5);
      }
      expect(numberOfExecutions).toBe(6);
    });

    test("should not retry when retryCondition returns false", async () => {
      let numberOfExecutions = 0;
      const testFunction = () => Promise.reject(numberOfExecutions++);
      try {
        await retry(() => testFunction(), {
          maxRetry: 5,
          retryCondition: e => {
            expect(e).toBe(0);
            return false;
          },
        });
      } catch (e) {
        expect(e).toBe(0);
      }
      expect(numberOfExecutions).toBe(1);
    });
  });
});

describe("delay", () => {
  test("resolves after the given duration", async () => {
    jest.useFakeTimers();
    const resolved = jest.fn();
    const p = delay(100).then(resolved);
    await jest.advanceTimersByTimeAsync(99);
    expect(resolved).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe("retry", () => {
  test("waits interval * intervalMultiplicator between each attempt", async () => {
    jest.useFakeTimers();
    const f = jest.fn(() => Promise.reject(new Error("nope")));
    const p = retry(f, {
      maxRetry: 2,
      interval: 100,
      intervalMultiplicator: 2,
      context: "ctx",
    }).catch(e => e);
    await jest.advanceTimersByTimeAsync(99);
    expect(f).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(200);
    expect(f).toHaveBeenCalledTimes(3);
    await expect(p).resolves.toEqual(new Error("nope"));
    jest.useRealTimers();
  });
});

const track = (order: number[]) => (n: number, ms: number) =>
  delay(ms).then(() => {
    order.push(n);
    if (n === 2) throw new Error("boom");
    return n;
  });

describe("atomicQueue", () => {
  test("serializes on a single queue and survives a rejection", async () => {
    const order: number[] = [];
    const job = atomicQueue(track(order));
    const results = await Promise.allSettled([job(1, 20), job(2, 0), job(3, 0)]);
    expect(order).toEqual([1, 2, 3]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  test("runs distinct queue identifiers in parallel", async () => {
    const order: number[] = [];
    const job = atomicQueue(track(order), n => String(n));
    await Promise.all([job(4, 20), job(5, 0)]);
    expect(order).toEqual([5, 4]);
  });
});

describe("execAndWaitAtLeast", () => {
  test("returns immediately when the job is already slower", async () => {
    expect(await execAndWaitAtLeast(0, () => Promise.resolve("a"))).toBe("a");
  });

  test("waits for the remaining time otherwise", async () => {
    const startTime = Date.now();
    expect(await execAndWaitAtLeast(50, () => Promise.resolve("b"))).toBe("b");
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(49);
  });
});

describe("promiseAllBatched rejection", () => {
  test("propagates the first rejection", async () => {
    await expect(
      promiseAllBatched(2, [1, 2, 3], n =>
        n === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(n),
      ),
    ).rejects.toThrow("boom");
  });
});
