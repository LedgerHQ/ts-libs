import { makeBatcher } from "./index";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("makeBatcher", () => {
  it("coalesces one tick of calls into a single request and fans the results out", async () => {
    const request = jest.fn(async (inputs: number[], prefix: string) =>
      inputs.map(i => `${prefix}${i}`),
    );
    const batcher = makeBatcher(request, "x");

    const batch = Promise.all([batcher(1), batcher(2)]);
    expect(request).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(0);
    await expect(batch).resolves.toEqual(["x1", "x2"]);

    const next = batcher(3);
    await jest.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toBe("x3");
    expect(request.mock.calls).toEqual([
      [[1, 2], "x"],
      [[3], "x"],
    ]);
  });

  it("rejects every waiter of a failed batch", async () => {
    const error = new Error("down");
    const batcher = makeBatcher<number, null, number>(() => Promise.reject(error), null);

    const settled = Promise.all([batcher(1), batcher(2)].map(p => p.catch(e => e)));
    await jest.advanceTimersByTimeAsync(0);

    await expect(settled).resolves.toEqual([error, error]);
  });
});
