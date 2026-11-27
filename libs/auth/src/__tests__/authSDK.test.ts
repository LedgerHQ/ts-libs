import {
  WalletAuthInvalidChallengeError,
  WalletAuthInvalidTokenError,
  WalletAuthMissingBaseUrlError,
} from "../errors";
import { AuthSDK } from "../authSDK";
import type { AuthConfig, IdentityProvider, KeycloakService } from "../types";

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("AuthSDK", () => {
  const KEYCLOAK_BASE_URL = "https://keycloak.test";
  const config: AuthConfig = {
    clientId: "ledger-keycloak",
    keycloakBaseUrl: KEYCLOAK_BASE_URL,
    keycloakRealm: "ledger-bc-customers",
  };

  const keycloakService: jest.Mocked<KeycloakService> = {
    baseUrl: KEYCLOAK_BASE_URL,
    realmBaseUrl: `${KEYCLOAK_BASE_URL}/realms/${config.keycloakRealm}`,
    getChallenge: jest.fn(),
  };

  const identityProvider: jest.Mocked<IdentityProvider> = {
    brokerId: "lkrp",
    authenticate: jest.fn(),
  };

  const queryFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    queryFn.mockReset();
    identityProvider.authenticate.mockReset();
    keycloakService.getChallenge.mockReset();
    queryFn.mockReturnValue(Promise.resolve());

    keycloakService.getChallenge.mockResolvedValue("challenge");
    identityProvider.authenticate.mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "keycloak-jwt",
    });
  });

  it("should retry authentication after the Keycloak URL becomes available", async () => {
    const keycloakBaseUrl = jest
      .fn<string | null, []>()
      .mockReturnValueOnce(null)
      .mockReturnValue(KEYCLOAK_BASE_URL);
    const fetch = jest.fn<Promise<Response>, Parameters<typeof globalThis.fetch>>(async () =>
      Response.json("challenge"),
    );
    const sdk = new AuthSDK(
      { ...config, keycloakBaseUrl },
      {
        provider: identityProvider,
        fetch,
      },
    );

    await expect(sdk.withToken({ queryFn })).rejects.toBeInstanceOf(WalletAuthMissingBaseUrlError);
    await expect(sdk.withToken({ queryFn })).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain(
      `${KEYCLOAK_BASE_URL}/realms/${config.keycloakRealm}/protocol/openid-connect/auth`,
    );
    expect(identityProvider.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: `${KEYCLOAK_BASE_URL}/realms/${config.keycloakRealm}/broker/lkrp/endpoint`,
      }),
    );
  });

  it("retrieves a Keycloak JWT with PKCE by default", async () => {
    await new AuthSDK(config, {
      provider: identityProvider,
      keycloakService,
    }).withToken({ queryFn });

    expect(queryFn).toHaveBeenCalledWith({
      accessToken: "keycloak-jwt",
      tokenType: "Bearer",
    });

    expect(keycloakService.getChallenge).toHaveBeenLastCalledWith({
      responseType: "code",
      clientId: "ledger-keycloak",
      scope: "openid",
      redirectUri: "https://keycloak.test/realms/ledger-bc-customers/broker/lkrp/endpoint",
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      codeChallengeMethod: "S256",
    });

    expect(identityProvider.authenticate).toHaveBeenCalledWith({
      challenge: "challenge",
      clientId: "ledger-keycloak",
      redirectUri: "https://keycloak.test/realms/ledger-bc-customers/broker/lkrp/endpoint",
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    });
  });

  it("should use the injected PKCE pair factory", async () => {
    const pkcePair = {
      codeVerifier: "injected-code-verifier",
      codeChallenge: "injected-code-challenge",
      codeChallengeMethod: "S256" as const,
    };
    const createPkcePair = jest.fn(() => pkcePair);

    await new AuthSDK(config, {
      provider: identityProvider,
      createPkcePair,
      keycloakService,
    }).withToken({ queryFn });

    expect(createPkcePair).toHaveBeenCalledTimes(1);
    expect(keycloakService.getChallenge).toHaveBeenLastCalledWith({
      responseType: "code",
      clientId: "ledger-keycloak",
      scope: "openid",
      redirectUri: "https://keycloak.test/realms/ledger-bc-customers/broker/lkrp/endpoint",
      codeChallenge: pkcePair.codeChallenge,
      codeChallengeMethod: pkcePair.codeChallengeMethod,
    });
    expect(identityProvider.authenticate).toHaveBeenCalledWith({
      challenge: "challenge",
      clientId: "ledger-keycloak",
      redirectUri: "https://keycloak.test/realms/ledger-bc-customers/broker/lkrp/endpoint",
      codeVerifier: pkcePair.codeVerifier,
    });
  });

  it("disable PKCE values when configured", async () => {
    await new AuthSDK(
      { ...config, disablePkce: true },
      { provider: identityProvider, keycloakService },
    ).withToken({ queryFn });

    expect(keycloakService.getChallenge).toHaveBeenLastCalledWith(
      expect.objectContaining({
        codeChallenge: undefined,
        codeChallengeMethod: undefined,
      }),
    );

    expect(identityProvider.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        codeVerifier: undefined,
      }),
    );
  });

  it("returns the cached token on subsequent calls without re-authenticating", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = {
      accessToken: makeJwt({ exp: futureExp }),
      tokenType: "Bearer",
    };
    identityProvider.authenticate.mockResolvedValue(token);

    const sdk = new AuthSDK(config, {
      provider: identityProvider,
      keycloakService,
    });

    await sdk.withToken({ queryFn });
    await sdk.withToken({ queryFn });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryFn).toHaveBeenNthCalledWith(1, token);
    expect(queryFn).toHaveBeenNthCalledWith(2, token);
    expect(keycloakService.getChallenge).toHaveBeenCalledTimes(1);
    expect(identityProvider.authenticate).toHaveBeenCalledTimes(1);
  });

  it("refreshes a stale cached token before using it again", async () => {
    const staleToken = {
      accessToken: makeJwt({ exp: Math.floor(Date.now() / 1000) + 2 }),
      tokenType: "Bearer" as const,
    };
    const freshToken = {
      accessToken: makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      tokenType: "Bearer" as const,
    };
    const refreshedToken = createDeferred<typeof freshToken>();
    const refreshRequested = createDeferred<void>();
    identityProvider.authenticate.mockResolvedValueOnce(staleToken).mockImplementationOnce(() => {
      refreshRequested.resolve();
      return refreshedToken.promise;
    });

    const sdk = new AuthSDK(config, {
      provider: identityProvider,
      keycloakService,
    });

    await sdk.withToken({ queryFn });
    const secondCall = sdk.withToken({ queryFn });
    await refreshRequested.promise;

    expect(queryFn).toHaveBeenCalledTimes(1);

    refreshedToken.resolve(freshToken);
    await secondCall;

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryFn).toHaveBeenNthCalledWith(1, staleToken);
    expect(queryFn).toHaveBeenNthCalledWith(2, freshToken);
    expect(keycloakService.getChallenge).toHaveBeenCalledTimes(2);
    expect(identityProvider.authenticate).toHaveBeenCalledTimes(2);
  });

  it("shares the in-flight token request across concurrent calls", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = {
      accessToken: makeJwt({ exp: futureExp }),
      tokenType: "Bearer" as const,
    };
    const deferredToken = createDeferred<typeof token>();
    const challengeRequested = createDeferred<void>();
    const authenticationRequested = createDeferred<void>();
    keycloakService.getChallenge.mockImplementationOnce(() => {
      challengeRequested.resolve();
      return Promise.resolve("challenge");
    });
    identityProvider.authenticate.mockImplementationOnce(() => {
      authenticationRequested.resolve();
      return deferredToken.promise;
    });

    const sdk = new AuthSDK(config, {
      provider: identityProvider,
      keycloakService,
    });

    const first = sdk.withToken({ queryFn });
    const second = sdk.withToken({ queryFn });
    await challengeRequested.promise;
    await authenticationRequested.promise;

    expect(keycloakService.getChallenge).toHaveBeenCalledTimes(1);
    expect(identityProvider.authenticate).toHaveBeenCalledTimes(1);

    deferredToken.resolve(token);
    await Promise.all([first, second]);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryFn).toHaveBeenNthCalledWith(1, token);
    expect(queryFn).toHaveBeenNthCalledWith(2, token);
  });

  it("should retry with a fresh token when queryFn returns a retryable result", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const firstToken = {
      accessToken: makeJwt({ exp: futureExp, sub: "first" }),
      tokenType: "Bearer" as const,
    };
    const secondToken = {
      accessToken: makeJwt({ exp: futureExp, sub: "second" }),
      tokenType: "Bearer" as const,
    };
    identityProvider.authenticate
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(secondToken);
    const retryableResult = { status: 401 };
    const finalResult = { status: 200 };
    queryFn.mockResolvedValueOnce(retryableResult).mockResolvedValueOnce(finalResult);
    const refreshAndRetryWhen = jest.fn(result => result === retryableResult);

    await expect(
      new AuthSDK(config, {
        provider: identityProvider,
        keycloakService,
      }).withToken({ queryFn, refreshAndRetryWhen }),
    ).resolves.toBe(finalResult);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryFn).toHaveBeenNthCalledWith(1, firstToken);
    expect(queryFn).toHaveBeenNthCalledWith(2, secondToken);
    expect(refreshAndRetryWhen).toHaveBeenCalledTimes(1);
    expect(refreshAndRetryWhen).toHaveBeenCalledWith(retryableResult);
    expect(keycloakService.getChallenge).toHaveBeenCalledTimes(2);
    expect(identityProvider.authenticate).toHaveBeenCalledTimes(2);
  });

  it("should propagate queryFn errors without checking retry", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = {
      accessToken: makeJwt({ exp: futureExp }),
      tokenType: "Bearer",
    };
    identityProvider.authenticate.mockResolvedValue(token);
    const queryFnError = new Error("Unavailable");
    queryFn.mockRejectedValue(queryFnError);
    const refreshAndRetryWhen = jest.fn().mockReturnValue(false);

    await expect(
      new AuthSDK(config, {
        provider: identityProvider,
        keycloakService,
      }).withToken({ queryFn, refreshAndRetryWhen }),
    ).rejects.toBe(queryFnError);

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryFn).toHaveBeenCalledWith(token);
    expect(refreshAndRetryWhen).not.toHaveBeenCalled();
    expect(keycloakService.getChallenge).toHaveBeenCalledTimes(1);
    expect(identityProvider.authenticate).toHaveBeenCalledTimes(1);
  });

  it("re-authenticates when the cached token has expired", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    identityProvider.authenticate.mockResolvedValue({
      accessToken: makeJwt({ exp: pastExp }),
      tokenType: "Bearer",
    });

    const sdk = new AuthSDK(config, {
      provider: identityProvider,
      keycloakService,
    });

    await sdk.withToken({ queryFn });
    await sdk.withToken({ queryFn });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(keycloakService.getChallenge).toHaveBeenCalledTimes(2);
    expect(identityProvider.authenticate).toHaveBeenCalledTimes(2);
  });

  it("stops when the challenge response is invalid", async () => {
    keycloakService.getChallenge.mockResolvedValueOnce(undefined);

    await expect(
      new AuthSDK(config, {
        provider: identityProvider,
        keycloakService,
      }).withToken({ queryFn }),
    ).rejects.toBeInstanceOf(WalletAuthInvalidChallengeError);

    expect(queryFn).not.toHaveBeenCalled();
    expect(identityProvider.authenticate).not.toHaveBeenCalled();
  });

  it("stops when the identity provider token response is invalid", async () => {
    identityProvider.authenticate.mockResolvedValueOnce({
      accessToken: "",
      tokenType: "Bearer",
    });

    await expect(
      new AuthSDK(config, {
        provider: identityProvider,
        keycloakService,
      }).withToken({ queryFn }),
    ).rejects.toBeInstanceOf(WalletAuthInvalidTokenError);

    expect(queryFn).not.toHaveBeenCalled();
  });

  describe("renewing a stale token", () => {
    const staleToken = {
      accessToken: makeJwt({ exp: now() + 2 }),
      tokenType: "Bearer",
    };
    const freshToken = { accessToken: makeJwt({ exp: now() + 3600 }), tokenType: "Bearer" };

    it("uses the identity provider's refresh when it has one", async () => {
      const refresh = jest.fn().mockResolvedValue(freshToken);
      identityProvider.authenticate.mockResolvedValueOnce(staleToken);
      const sdk = new AuthSDK(config, {
        provider: { ...identityProvider, refresh },
        keycloakService,
      });

      await sdk.withToken({ queryFn });
      await sdk.withToken({ queryFn });

      expect(refresh).toHaveBeenCalledWith(staleToken);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(queryFn).toHaveBeenLastCalledWith(freshToken);
      expect(identityProvider.authenticate).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["fails", () => Promise.reject(new Error("refresh failed"))],
      ["returns no access token", () => Promise.resolve({ tokenType: "Bearer", accessToken: "" })],
    ])(
      "authenticates again when the identity provider's refresh %s",
      async (_name, refreshImpl) => {
        const refresh = jest.fn(refreshImpl);
        identityProvider.authenticate
          .mockResolvedValueOnce(staleToken)
          .mockResolvedValueOnce(freshToken);
        const sdk = new AuthSDK(config, {
          provider: { ...identityProvider, refresh },
          keycloakService,
        });

        await sdk.withToken({ queryFn });
        await sdk.withToken({ queryFn });

        expect(refresh).toHaveBeenCalledWith(staleToken);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(queryFn).toHaveBeenLastCalledWith(freshToken);
        expect(identityProvider.authenticate).toHaveBeenCalledTimes(2);
      },
    );

    it("renews the current token when queryFn asks for a retry", async () => {
      const validToken = { ...staleToken, accessToken: makeJwt({ exp: now() + 3600 }) };
      const refresh = jest.fn().mockResolvedValue(freshToken);
      identityProvider.authenticate.mockResolvedValueOnce(validToken);
      const retryableResult = { status: 401 };
      queryFn.mockResolvedValueOnce(retryableResult).mockResolvedValueOnce({ status: 200 });

      await new AuthSDK(config, {
        provider: { ...identityProvider, refresh },
        keycloakService,
      }).withToken({ queryFn, refreshAndRetryWhen: result => result === retryableResult });

      expect(refresh).toHaveBeenCalledWith(validToken);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(queryFn).toHaveBeenLastCalledWith(freshToken);
      expect(identityProvider.authenticate).toHaveBeenCalledTimes(1);
    });

    it("authenticates on a retry when the rejected token came from refresh", async () => {
      const loginToken = { accessToken: makeJwt({ exp: now() + 3600 }), tokenType: "Bearer" };
      const nextLoginToken = { accessToken: makeJwt({ exp: now() + 3601 }), tokenType: "Bearer" };
      const refresh = jest.fn().mockResolvedValue(freshToken);
      identityProvider.authenticate
        .mockResolvedValueOnce(loginToken)
        .mockResolvedValueOnce(nextLoginToken);
      const rejected = { status: 401 };
      queryFn.mockImplementation(token =>
        Promise.resolve(token === nextLoginToken ? { status: 200 } : rejected),
      );
      const refreshAndRetryWhen = (result: unknown) => result === rejected;
      const sdk = new AuthSDK(config, {
        provider: { ...identityProvider, refresh },
        keycloakService,
      });

      await expect(sdk.withToken({ queryFn, refreshAndRetryWhen })).resolves.toBe(rejected);
      await expect(sdk.withToken({ queryFn, refreshAndRetryWhen })).resolves.toEqual({
        status: 200,
      });

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith(loginToken);
      expect(identityProvider.authenticate).toHaveBeenCalledTimes(2);
      expect(queryFn).toHaveBeenLastCalledWith(nextLoginToken);
    });

    it("keeps refreshing a token that refresh produced once it expires", async () => {
      const staleRefreshedToken = { ...staleToken, accessToken: makeJwt({ exp: now() + 1 }) };
      const refresh = jest
        .fn()
        .mockResolvedValueOnce(staleRefreshedToken)
        .mockResolvedValueOnce(freshToken);
      identityProvider.authenticate.mockResolvedValueOnce(staleToken);
      const sdk = new AuthSDK(config, {
        provider: { ...identityProvider, refresh },
        keycloakService,
      });

      await sdk.withToken({ queryFn });
      await sdk.withToken({ queryFn });
      await sdk.withToken({ queryFn });

      expect(refresh).toHaveBeenNthCalledWith(2, staleRefreshedToken);
      expect(queryFn).toHaveBeenLastCalledWith(freshToken);
      expect(identityProvider.authenticate).toHaveBeenCalledTimes(1);
    });

    it("authenticates again on a retry when a concurrent renewal fails", async () => {
      const validToken = { accessToken: makeJwt({ exp: now() + 3600 }), tokenType: "Bearer" };
      const retryable = { status: 401 };
      const renewalStarted = createDeferred<void>();
      const renewal = createDeferred<typeof validToken>();
      const secondAnswer = createDeferred<typeof retryable>();
      const refresh = jest.fn().mockImplementationOnce(() => {
        renewalStarted.resolve();
        return renewal.promise;
      });
      identityProvider.authenticate
        .mockResolvedValueOnce(validToken)
        .mockRejectedValueOnce(new Error("renewal failed"))
        .mockResolvedValueOnce(freshToken);
      const firstQuery = jest.fn().mockResolvedValue(retryable);
      const secondQuery = jest
        .fn()
        .mockReturnValueOnce(secondAnswer.promise)
        .mockResolvedValueOnce({ status: 200 });
      const refreshAndRetryWhen = (result: unknown) => result === retryable;
      const sdk = new AuthSDK(config, {
        provider: { ...identityProvider, refresh },
        keycloakService,
      });

      const first = sdk.withToken({ queryFn: firstQuery, refreshAndRetryWhen });
      const second = sdk.withToken({ queryFn: secondQuery, refreshAndRetryWhen });
      await renewalStarted.promise;
      secondAnswer.resolve(retryable);
      await new Promise(resolve => setImmediate(resolve));
      renewal.reject(new Error("refresh failed"));

      await expect(first).rejects.toThrow("renewal failed");
      await expect(second).resolves.toEqual({ status: 200 });
      expect(secondQuery).toHaveBeenLastCalledWith(freshToken);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(identityProvider.authenticate).toHaveBeenCalledTimes(3);
    });

    it("authenticates at once on a retry during another authentication, without refresh", async () => {
      const validToken = { accessToken: makeJwt({ exp: now() + 3600 }), tokenType: "Bearer" };
      const retryable = { status: 401 };
      const authenticationStarted = createDeferred<void>();
      const authentication = createDeferred<typeof validToken>();
      const secondAnswer = createDeferred<typeof retryable>();
      identityProvider.authenticate
        .mockResolvedValueOnce(validToken)
        .mockImplementationOnce(() => {
          authenticationStarted.resolve();
          return authentication.promise;
        })
        .mockResolvedValueOnce(freshToken);
      const firstQuery = jest
        .fn()
        .mockResolvedValueOnce(retryable)
        .mockResolvedValueOnce({ status: 200 });
      const secondQuery = jest
        .fn()
        .mockReturnValueOnce(secondAnswer.promise)
        .mockResolvedValueOnce({ status: 200 });
      const refreshAndRetryWhen = (result: unknown) => result === retryable;
      const sdk = new AuthSDK(config, { provider: identityProvider, keycloakService });

      const first = sdk.withToken({ queryFn: firstQuery, refreshAndRetryWhen });
      const second = sdk.withToken({ queryFn: secondQuery, refreshAndRetryWhen });
      await authenticationStarted.promise;
      secondAnswer.resolve(retryable);

      await expect(second).resolves.toEqual({ status: 200 });
      expect(secondQuery).toHaveBeenLastCalledWith(freshToken);
      expect(identityProvider.authenticate).toHaveBeenCalledTimes(3);

      authentication.resolve(validToken);
      await expect(first).resolves.toEqual({ status: 200 });
    });
  });
});

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
