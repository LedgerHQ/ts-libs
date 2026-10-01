import { genericWithJWT } from "./auth";
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
});
