import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { WalletAuthInvalidAuthorizationError, WalletAuthInvalidTokenError } from "@ledgerhq/auth";
import getApi from "./api";
import { CHALLENGE } from "./__mocks__/challenge";

const BASE = "https://trustchain.test";
const JWT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2ln";
const jwt = { accessToken: "access" };

describe("trustchain api", () => {
  const api = getApi(BASE);
  const seen: { url: string; method: string; headers: Headers; body: string }[] = [];
  const record = async (request: Request) => {
    seen.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    });
  };
  const server = setupServer();

  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    seen.length = 0;
  });
  afterAll(() => server.close());

  it("fetches the authentication challenge", async () => {
    const challenge = { json: { version: 1 }, tlv: "00" };
    server.use(http.get(`${BASE}/v1/challenge`, () => HttpResponse.json(challenge)));

    await expect(api.getAuthenticationChallenge()).resolves.toEqual(challenge);
  });

  it("maps the authenticate response to a JWT", async () => {
    server.use(
      http.post(`${BASE}/v1/authenticate`, () =>
        HttpResponse.json({ access_token: JWT_TOKEN, permissions: { a: { b: "c" } } }),
      ),
    );

    await expect(
      api.postChallengeResponse({
        challenge: CHALLENGE.json,
        signature: {
          credential: { version: 0, curveId: 0, signAlgorithm: 0, publicKey: "" },
          signature: "",
          attestation: "",
        },
      }),
    ).resolves.toEqual({ accessToken: JWT_TOKEN, permissions: { a: { b: "c" } } });
  });

  it("refreshes the jwt with the bearer token", async () => {
    server.use(
      http.get(`${BASE}/v1/refresh`, async ({ request }) => {
        await record(request);
        return HttpResponse.json({ access_token: JWT_TOKEN });
      }),
    );

    await expect(api.refreshAuth(jwt)).resolves.toEqual({
      accessToken: JWT_TOKEN,
      permissions: undefined,
    });
    expect(seen[0].headers.get("authorization")).toBe("Bearer access");
  });

  describe("oidcPostChallengeResponse", () => {
    const request = {
      challenge: CHALLENGE.json,
      signature: {
        credential: { version: 0, curveId: 0, signAlgorithm: 0, publicKey: "" },
        signature: "",
      },
    };

    it("returns the authorization code", async () => {
      server.use(http.post(`${BASE}/openid/v1/authenticate`, () => HttpResponse.json("code")));

      await expect(api.oidcPostChallengeResponse(request)).resolves.toBe("code");
    });

    it("rejects a non-string response", async () => {
      server.use(http.post(`${BASE}/openid/v1/authenticate`, () => HttpResponse.json({ a: 1 })));

      await expect(api.oidcPostChallengeResponse(request)).rejects.toBeInstanceOf(
        WalletAuthInvalidAuthorizationError,
      );
    });
  });

  describe("oidcExchangeAuthCode", () => {
    it("posts a form body without code verifier by default", async () => {
      server.use(
        http.post(`${BASE}/openid/v1/token`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({ access_token: JWT_TOKEN });
        }),
      );

      await expect(api.oidcExchangeAuthCode("code", "client", "app://cb")).resolves.toBe(JWT_TOKEN);

      const params = new URLSearchParams(seen[0].body);
      expect(Object.fromEntries(params)).toEqual({
        grant_type: "authorization_code",
        code: "code",
        client_id: "client",
        redirect_uri: "app://cb",
      });
      expect(seen[0].headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    });

    it("includes the code verifier when given", async () => {
      server.use(
        http.post(`${BASE}/openid/v1/token`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({ access_token: JWT_TOKEN });
        }),
      );

      await api.oidcExchangeAuthCode("code", "client", "app://cb", "verifier");

      expect(new URLSearchParams(seen[0].body).get("code_verifier")).toBe("verifier");
    });

    it("rejects an invalid token response", async () => {
      server.use(http.post(`${BASE}/openid/v1/token`, () => HttpResponse.json({})));

      await expect(api.oidcExchangeAuthCode("code", "client", "app://cb")).rejects.toBeInstanceOf(
        WalletAuthInvalidTokenError,
      );
    });
  });

  describe("oidcExchangeToken", () => {
    it("maps the keycloak response", async () => {
      server.use(
        http.post(`${BASE}/openid/v1/exchange`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({
            scope: "openid",
            token_type: "Bearer",
            access_token: JWT_TOKEN,
            expires_in: 10,
            refresh_token: JWT_TOKEN,
            refresh_expires_in: 20,
          });
        }),
      );

      await expect(api.oidcExchangeToken("idp", "client")).resolves.toEqual({
        scope: "openid",
        tokenType: "Bearer",
        accessToken: JWT_TOKEN,
        expiresIn: 10,
        refreshToken: JWT_TOKEN,
        refreshExpiresIn: 20,
      });
      expect(seen[0].headers.get("authorization")).toBe("Bearer idp");
      expect(JSON.parse(seen[0].body)).toEqual({ client_id: "client" });
    });

    it("rejects an invalid response", async () => {
      server.use(http.post(`${BASE}/openid/v1/exchange`, () => HttpResponse.json({})));

      await expect(api.oidcExchangeToken("idp", "client")).rejects.toBeInstanceOf(
        WalletAuthInvalidTokenError,
      );
    });
  });

  describe("trustchain management", () => {
    it("lists the trustchains", async () => {
      server.use(
        http.get(`${BASE}/v1/trustchains`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({ id: { path: ["read"] } });
        }),
      );

      await expect(api.getTrustchains(jwt)).resolves.toEqual({ id: { path: ["read"] } });
      expect(seen[0].headers.get("authorization")).toBe("Bearer access");
    });

    it("gets a trustchain", async () => {
      server.use(http.get(`${BASE}/v1/trustchain/ID`, () => HttpResponse.json({ k: "v" })));

      await expect(api.getTrustchain(jwt, "ID")).resolves.toEqual({ k: "v" });
    });

    it("posts a derivation", async () => {
      server.use(
        http.post(`${BASE}/v1/trustchain/ID/derivation`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({});
        }),
      );

      await api.postDerivation(jwt, "ID", '["stream"]');

      expect(seen[0].body).toBe('["stream"]');
      expect(seen[0].headers.get("authorization")).toBe("Bearer access");
    });

    it("posts a seed", async () => {
      server.use(
        http.post(`${BASE}/v1/seed`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({});
        }),
      );

      await api.postSeed(jwt, '["seed"]');

      expect(seen[0].body).toBe('["seed"]');
      expect(seen[0].headers.get("authorization")).toBe("Bearer access");
    });

    it("puts commands", async () => {
      server.use(
        http.put(`${BASE}/v1/trustchain/ID/commands`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({});
        }),
      );

      await api.putCommands(jwt, "ID", { path: "m/0'", blocks: ["b"] });

      expect(JSON.parse(seen[0].body)).toEqual({ path: "m/0'", blocks: ["b"] });
    });

    it("deletes a trustchain", async () => {
      server.use(
        http.delete(`${BASE}/v1/trustchain/ID`, async ({ request }) => {
          await record(request);
          return HttpResponse.json({});
        }),
      );

      await api.deleteTrustchain(jwt, "ID");

      expect(seen[0].method).toBe("DELETE");
      expect(seen[0].headers.get("authorization")).toBe("Bearer access");
    });

    it("fetches the status", async () => {
      server.use(
        http.get(`${BASE}/_info`, () => HttpResponse.json({ name: "trustchain", version: "1" })),
      );

      await expect(api.fetchStatus()).resolves.toEqual({ name: "trustchain", version: "1" });
    });
  });
});
