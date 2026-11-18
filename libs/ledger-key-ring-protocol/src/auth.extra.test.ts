import { genericWithJWT, isJwtRefusal } from "./auth";
import { TrustchainNotAllowed, TrustchainOutdated } from "./errors";
import { JWT } from "./types";

const initialJwt: JWT = { accessToken: "initial" };
const refreshedJwt: JWT = { accessToken: "refreshed" };
const reauthedJwt: JWT = { accessToken: "reauthed" };

function httpError(message: string, status = 401) {
  return Object.assign(new Error(message), { status });
}

describe("genericWithJWT policies", () => {
  it("uses the initial jwt with the default cache policy", async () => {
    const auth = jest.fn();
    const job = jest.fn().mockResolvedValue("done");

    await expect(genericWithJWT(job, initialJwt, auth, jest.fn())).resolves.toBe("done");

    expect(job).toHaveBeenCalledWith(initialJwt);
    expect(auth).not.toHaveBeenCalled();
  });

  it("authenticates when there is no initial jwt", async () => {
    const auth = jest.fn().mockResolvedValue(reauthedJwt);
    const job = jest.fn().mockResolvedValue("done");

    await genericWithJWT(job, undefined, auth, jest.fn());

    expect(job).toHaveBeenCalledWith(reauthedJwt);
  });

  it("always authenticates with the no-cache policy", async () => {
    const auth = jest.fn().mockResolvedValue(reauthedJwt);
    const job = jest.fn().mockResolvedValue("done");

    await genericWithJWT(job, initialJwt, auth, jest.fn(), "no-cache");

    expect(auth).toHaveBeenCalledTimes(1);
    expect(job).toHaveBeenCalledWith(reauthedJwt);
  });

  it("refreshes the initial jwt with the refresh policy", async () => {
    const auth = jest.fn();
    const refreshAuth = jest.fn().mockResolvedValue(refreshedJwt);
    const job = jest.fn().mockResolvedValue("done");

    await genericWithJWT(job, initialJwt, auth, refreshAuth, "refresh");

    expect(refreshAuth).toHaveBeenCalledWith(initialJwt);
    expect(auth).not.toHaveBeenCalled();
    expect(job).toHaveBeenCalledWith(refreshedJwt);
  });
});

describe("genericWithJWT refresh failures", () => {
  it("re-authenticates when the initial refresh reports an expired jwt", async () => {
    const auth = jest.fn().mockResolvedValue(reauthedJwt);
    const refreshAuth = jest.fn().mockRejectedValue(httpError("JWT is expired"));
    const job = jest.fn().mockResolvedValue("done");

    await genericWithJWT(job, initialJwt, auth, refreshAuth, "refresh");

    expect(job).toHaveBeenCalledWith(reauthedJwt);
  });

  it("maps a permission failure during refresh to TrustchainNotAllowed", async () => {
    const refreshAuth = jest.fn().mockRejectedValue(httpError("JWT contains no permission"));

    await expect(
      genericWithJWT(jest.fn(), initialJwt, jest.fn(), refreshAuth, "refresh"),
    ).rejects.toBeInstanceOf(TrustchainNotAllowed);
  });

  it("maps a path mismatch during refresh to TrustchainOutdated", async () => {
    const refreshAuth = jest.fn().mockRejectedValue(httpError("path does not match"));

    await expect(
      genericWithJWT(jest.fn(), initialJwt, jest.fn(), refreshAuth, "refresh"),
    ).rejects.toBeInstanceOf(TrustchainOutdated);
  });

  it("rethrows other refresh failures", async () => {
    const error = httpError("boom", 500);
    const refreshAuth = jest.fn().mockRejectedValue(error);
    const job = jest.fn();

    await expect(genericWithJWT(job, initialJwt, jest.fn(), refreshAuth, "refresh")).rejects.toBe(
      error,
    );
    expect(job).not.toHaveBeenCalled();
  });

  it("propagates a refresh failure hit while recovering from an expired jwt", async () => {
    const error = httpError("boom", 500);
    const refreshAuth = jest.fn().mockRejectedValue(error);
    const job = jest.fn().mockRejectedValue(httpError("JWT is expired, call /refresh"));

    await expect(genericWithJWT(job, initialJwt, jest.fn(), refreshAuth)).rejects.toBe(error);
  });

  it("re-authenticates when the recovery refresh reports an expired jwt", async () => {
    const auth = jest.fn().mockResolvedValue(reauthedJwt);
    const refreshAuth = jest.fn().mockRejectedValue(httpError("JWT is expired"));
    const job = jest
      .fn()
      .mockRejectedValueOnce(httpError("JWT is expired, call /refresh"))
      .mockResolvedValueOnce("done");

    await expect(genericWithJWT(job, initialJwt, auth, refreshAuth)).resolves.toBe("done");

    expect(job).toHaveBeenNthCalledWith(2, reauthedJwt);
  });

  it("does not retry more than once after recovering", async () => {
    const auth = jest.fn().mockResolvedValue(reauthedJwt);
    const second = httpError("JWT is expired");
    const job = jest
      .fn()
      .mockRejectedValueOnce(httpError("JWT is expired"))
      .mockRejectedValueOnce(second);

    await expect(genericWithJWT(job, initialJwt, auth, jest.fn())).rejects.toBe(second);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a refreshed jwt", httpError("JWT is expired, call /refresh"), refreshedJwt],
    ["a re-authenticated jwt", httpError("Unexpected client error"), reauthedJwt],
  ])("reports a refusal of %s as a jwt refusal, without another retry", async (_, first, jwt) => {
    const job = jest
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(httpError("JWT contains no permission"));

    const error = await genericWithJWT(
      job,
      initialJwt,
      jest.fn().mockResolvedValue(reauthedJwt),
      jest.fn().mockResolvedValue(refreshedJwt),
    ).catch(e => e);

    expect(isJwtRefusal(error)).toBe(true);
    expect(job).toHaveBeenLastCalledWith(jwt);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a refreshed jwt", httpError("JWT is expired, call /refresh"), refreshedJwt],
    ["a re-authenticated jwt", httpError("Unexpected client error"), reauthedJwt],
  ])("maps a path mismatch with %s to TrustchainOutdated", async (_, first, jwt) => {
    const job = jest
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(httpError("path does not match"));

    await expect(
      genericWithJWT(
        job,
        initialJwt,
        jest.fn().mockResolvedValue(reauthedJwt),
        jest.fn().mockResolvedValue(refreshedJwt),
      ),
    ).rejects.toBeInstanceOf(TrustchainOutdated);
    expect(job).toHaveBeenLastCalledWith(jwt);
    expect(job).toHaveBeenCalledTimes(2);
  });
});

describe("isJwtRefusal", () => {
  it("is true for the backend refusing the jwt in the job or in a refresh", async () => {
    const refusal = httpError("JWT contains no permission");
    const fromJob = await genericWithJWT(
      jest.fn().mockRejectedValue(refusal),
      initialJwt,
      jest.fn(),
      jest.fn(),
    ).catch(e => e);
    const fromRefresh = await genericWithJWT(
      jest.fn(),
      initialJwt,
      jest.fn(),
      jest.fn().mockRejectedValue(refusal),
      "refresh",
    ).catch(e => e);

    expect(fromJob).toBeInstanceOf(TrustchainNotAllowed);
    expect(fromJob).toHaveProperty("name", "TrustchainNotAllowed");
    expect(isJwtRefusal(fromJob)).toBe(true);
    expect(isJwtRefusal(fromRefresh)).toBe(true);
  });

  it("is false for any other error", () => {
    expect(isJwtRefusal(new TrustchainNotAllowed())).toBe(false);
    expect(isJwtRefusal(new TrustchainOutdated())).toBe(false);
    expect(isJwtRefusal(httpError("JWT contains no permission"))).toBe(false);
  });
});
