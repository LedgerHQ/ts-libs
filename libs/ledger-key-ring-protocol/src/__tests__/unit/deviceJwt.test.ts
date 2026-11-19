import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { HWDeviceProvider } from "../../HWDeviceProvider";
import { SDK } from "../../sdk";
import { TrustchainNotAllowed, TrustchainOutdated } from "../../errors";
import { JWT, WithDevice } from "../../types";

const BASE = "https://trustchain.test";
const SHARED: JWT = { accessToken: "SHARED LOGIN" };
const DEVICE_LOGIN = "DEVICE LOGIN";
const seedId = {
  signature: new Uint8Array([1]),
  pubkeyCredential: { toJSON: () => ({}) },
  attestationResult: new Uint8Array([2]),
};

const server = setupServer(
  http.get(`${BASE}/v1/challenge`, () => HttpResponse.json({ json: {}, tlv: "00" })),
  http.post(`${BASE}/v1/authenticate`, () =>
    HttpResponse.json({ access_token: DEVICE_LOGIN, permissions: {} }),
  ),
  http.get(`${BASE}/v1/refresh`, () =>
    HttpResponse.json({ access_token: "REFRESHED LOGIN", permissions: {} }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

function httpError(message: string) {
  return Object.assign(new Error(message), { status: 401 });
}

function createProvider() {
  const provider = new HWDeviceProvider(BASE, (() => () => {}) as unknown as WithDevice);
  const withHw = jest.spyOn(provider, "withHw").mockResolvedValue(seedId as never);
  return { provider, withHw };
}

const refusesSharedLogin = (jwt: JWT) =>
  jwt.accessToken === SHARED.accessToken
    ? Promise.reject(httpError("JWT contains no permission"))
    : Promise.resolve(jwt.accessToken);

describe("HWDeviceProvider device login sharing", () => {
  it("uses a login given to setJwt without logging the device in", async () => {
    const { provider, withHw } = createProvider();
    provider.setJwt(SHARED);

    await expect(provider.withJwt("device", async jwt => jwt.accessToken, "cache")).resolves.toBe(
      SHARED.accessToken,
    );
    expect(withHw).not.toHaveBeenCalled();
    expect(provider.hasOwnJwt()).toBe(false);
  });

  it("logs the device in once when the backend refuses a login given to setJwt", async () => {
    const { provider, withHw } = createProvider();
    provider.setJwt(SHARED);
    const job = jest.fn(refusesSharedLogin);

    await expect(provider.withJwt("device", job, "cache")).resolves.toBe(DEVICE_LOGIN);
    expect(job).toHaveBeenCalledTimes(2);
    expect(withHw).toHaveBeenCalledTimes(1);
    expect(provider.hasOwnJwt()).toBe(true);
  });

  it("does not retry twice when the device login is refused too", async () => {
    const { provider, withHw } = createProvider();
    provider.setJwt(SHARED);
    const job = jest.fn().mockRejectedValue(httpError("JWT contains no permission"));

    await expect(provider.withJwt("device", job, "cache")).rejects.toBeInstanceOf(
      TrustchainNotAllowed,
    );
    expect(job).toHaveBeenCalledTimes(2);
    expect(withHw).toHaveBeenCalledTimes(1);
  });

  it("logs the device in once when the backend refuses a login the provider cached itself", async () => {
    const { provider, withHw } = createProvider();
    await provider.withJwt("device", async jwt => jwt.accessToken, "cache");
    const job = jest
      .fn()
      .mockRejectedValueOnce(httpError("JWT contains no permission"))
      .mockResolvedValue("done");

    await expect(provider.withJwt("other device", job, "cache")).resolves.toBe("done");
    expect(job).toHaveBeenCalledTimes(2);
    expect(withHw).toHaveBeenCalledTimes(2);
    expect(withHw).toHaveBeenLastCalledWith("other device", expect.any(Function), undefined);
  });

  it("logs the same device in once more before refusing its own cached login", async () => {
    const { provider, withHw } = createProvider();
    await provider.withJwt("device", async jwt => jwt.accessToken, "cache");
    const job = jest.fn().mockRejectedValue(httpError("JWT contains no permission"));

    await expect(provider.withJwt("device", job, "cache")).rejects.toBeInstanceOf(
      TrustchainNotAllowed,
    );
    expect(job).toHaveBeenCalledTimes(2);
    expect(withHw).toHaveBeenCalledTimes(2);
    expect(withHw).toHaveBeenLastCalledWith("device", expect.any(Function), undefined);
  });

  it("logs the device in once when the backend refuses the refreshed cached login", async () => {
    const { provider, withHw } = createProvider();
    await provider.withJwt("device", async jwt => jwt.accessToken, "cache");
    const job = jest
      .fn()
      .mockRejectedValueOnce(httpError("JWT is expired, call /refresh"))
      .mockRejectedValueOnce(httpError("JWT contains no permission"))
      .mockResolvedValue("done");

    await expect(provider.withJwt("other device", job, "cache")).resolves.toBe("done");
    expect(job).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accessToken: "REFRESHED LOGIN" }),
    );
    expect(job).toHaveBeenCalledTimes(3);
    expect(withHw).toHaveBeenLastCalledWith("other device", expect.any(Function), undefined);
    expect(withHw).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the backend refuses a login obtained in the same call", async () => {
    const { provider, withHw } = createProvider();
    const job = jest.fn().mockRejectedValue(httpError("JWT contains no permission"));

    await expect(provider.withJwt("device", job, "cache")).rejects.toBeInstanceOf(
      TrustchainNotAllowed,
    );
    expect(job).toHaveBeenCalledTimes(1);
    expect(withHw).toHaveBeenCalledTimes(1);
  });

  it("does not retry other errors on a login given to setJwt", async () => {
    const { provider, withHw } = createProvider();
    provider.setJwt(SHARED);
    const job = jest.fn().mockRejectedValue(httpError("path does not match"));

    await expect(provider.withJwt("device", job, "cache")).rejects.toBeInstanceOf(
      TrustchainOutdated,
    );
    expect(job).toHaveBeenCalledTimes(1);
    expect(withHw).not.toHaveBeenCalled();
  });

  it("owns the device login that replaces an expired login given to setJwt", async () => {
    const { provider, withHw } = createProvider();
    provider.setJwt(SHARED);
    const job = jest.fn((jwt: JWT) =>
      jwt.accessToken === SHARED.accessToken
        ? Promise.reject(httpError("JWT is expired"))
        : Promise.resolve(jwt.accessToken),
    );

    await expect(provider.withJwt("device", job, "cache")).resolves.toBe(DEVICE_LOGIN);
    expect(withHw).toHaveBeenCalledTimes(1);
    expect(provider.hasOwnJwt()).toBe(true);
  });

  it("drops a login given to setJwt on clearJwt", async () => {
    const { provider, withHw } = createProvider();
    provider.setJwt(SHARED);
    provider.clearJwt();

    await expect(provider.withJwt("device", async jwt => jwt.accessToken, "cache")).resolves.toBe(
      DEVICE_LOGIN,
    );
    expect(withHw).toHaveBeenCalledTimes(1);
  });
});

describe("SDK device login sharing", () => {
  const hw = {
    setJwt: jest.fn(),
    clearJwt: jest.fn(),
    hasOwnJwt: jest.fn(),
    withJwt: jest.fn(),
  } satisfies Partial<HWDeviceProvider>;
  const creds = { pubkey: "PUBKEY", privatekey: "PRIVATEKEY" };

  function createSdk() {
    return new SDK(
      { applicationId: 16, name: "test", apiBaseUrl: BASE },
      hw as unknown as HWDeviceProvider,
    );
  }

  async function getOrCreateTrustchain(sdk: SDK) {
    await expect(sdk.getOrCreateTrustchain("device", creds)).rejects.toThrow("stop");
  }

  beforeEach(() => {
    Object.values(hw).forEach(mock => mock.mockReset());
    hw.withJwt.mockRejectedValue(new Error("stop"));
  });

  it("keeps a login given to useDeviceJwt through the next getOrCreateTrustchain only", async () => {
    const sdk = createSdk();
    sdk.useDeviceJwt(SHARED);
    expect(hw.setJwt).toHaveBeenCalledWith(SHARED);
    expect(hw.setJwt).toHaveBeenCalledTimes(1);

    await getOrCreateTrustchain(sdk);
    expect(hw.clearJwt).not.toHaveBeenCalled();

    await getOrCreateTrustchain(sdk);
    expect(hw.clearJwt).toHaveBeenCalledTimes(1);
  });

  it("drops a login given to useDeviceJwt once the provider has replaced it with its own", async () => {
    const sdk = createSdk();
    sdk.useDeviceJwt(SHARED);
    hw.hasOwnJwt.mockReturnValue(true);

    await getOrCreateTrustchain(sdk);
    expect(hw.clearJwt).toHaveBeenCalledTimes(1);
  });

  it("drops a login given to cacheDeviceJwt on getOrCreateTrustchain, even after useDeviceJwt", async () => {
    const sdk = createSdk();
    sdk.useDeviceJwt(SHARED);
    sdk.cacheDeviceJwt(SHARED);
    expect(hw.setJwt).toHaveBeenCalledWith(SHARED);
    expect(hw.setJwt).toHaveBeenCalledTimes(2);

    await getOrCreateTrustchain(sdk);
    expect(hw.clearJwt).toHaveBeenCalledTimes(1);
  });

  it("drops a login given to useDeviceJwt on invalidateJwt", async () => {
    const sdk = createSdk();
    sdk.useDeviceJwt(SHARED);
    sdk.invalidateJwt();
    expect(hw.clearJwt).toHaveBeenCalledTimes(1);

    await getOrCreateTrustchain(sdk);
    expect(hw.clearJwt).toHaveBeenCalledTimes(2);
  });

  it("reports whether the device login is its own", () => {
    const sdk = createSdk();
    hw.hasOwnJwt.mockReturnValue(true);
    expect(sdk.hasOwnDeviceJwt()).toBe(true);
    hw.hasOwnJwt.mockReturnValue(false);
    expect(sdk.hasOwnDeviceJwt()).toBe(false);
  });
});
