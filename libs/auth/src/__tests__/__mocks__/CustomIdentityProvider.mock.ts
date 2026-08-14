import { z } from "zod";
import {
  WalletAuthInvalidAuthorizationError,
  WalletAuthInvalidChallengeError,
  WalletAuthInvalidTokenError,
  WalletAuthSignatureError,
} from "../../errors";
import { postForm, postJson } from "../../http";
import { bytesToBase64Url, stringToBytes } from "../../utils";
import type { IdentityProvider, IdPAuthParams, KeycloakToken } from "../../types";

const ChallengeSchema = z.object({
  json: z.object({
    host: z.string(),
    challenge: z.object({ data: z.string() }),
  }),
});

const AuthTokenSchema = z.object({
  access_token: z.string(),
});

const ExchangeTokenSchema = z.object({
  scope: z.string(),
  token_type: z.string(),
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  refresh_expires_in: z.number(),
});

export class CustomIdentityProvider implements IdentityProvider {
  readonly brokerId = "custom";

  constructor(private readonly signer: Signer) {}

  async authenticate(request: IdPAuthParams): Promise<KeycloakToken> {
    const challengeResponse = parseOrThrow(
      ChallengeSchema,
      request.challenge,
      () => new WalletAuthInvalidChallengeError(),
    );

    const host = challengeResponse.json.host;
    const challenge = challengeResponse.json.challenge.data;
    const signature = await this.signer
      .sign({ name: "ECDSA", hash: "SHA-256" }, stringToBytes(challenge))
      .catch(error => {
        throw new WalletAuthSignatureError(error);
      });

    const signedChallenge: SignedChallengeRequest = {
      challenge,
      algorithm: "ES256",
      jwk: this.signer.jwk,
      signature: bytesToBase64Url(signature),
    };

    // Step 1: prove ownership of the key by sending the signed challenge, getting back an authorization code.
    const authCode = parseOrThrow(
      z.string(),
      await postJson(`https://${host}/openid/v1/authenticate`, signedChallenge),
      () => new WalletAuthInvalidAuthorizationError(),
    );

    // Step 2: redeem the authorization code (with PKCE verifier when present) for the IdP access token.
    const formBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
    });
    if (request.codeVerifier) {
      formBody.set("code_verifier", request.codeVerifier);
    }
    const tokenResponse = parseOrThrow(
      AuthTokenSchema,
      await postForm(`https://${host}/openid/v1/token`, formBody),
      () => new WalletAuthInvalidTokenError(),
    );

    // Step 3: exchange the IdP token for the Keycloak token directly at the IdP, authenticating with the IdP token.
    const exchangeBody: ExchangeRequest = { client_id: request.clientId };
    const exchangeResponse = parseOrThrow(
      ExchangeTokenSchema,
      await postJson(`https://${host}/openid/v1/exchange`, exchangeBody, {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      }),
      () => new WalletAuthInvalidTokenError(),
    );

    return {
      scope: exchangeResponse.scope,
      tokenType: exchangeResponse.token_type,
      accessToken: exchangeResponse.access_token,
      expiresIn: exchangeResponse.expires_in,
      refreshToken: exchangeResponse.refresh_token,
      refreshExpiresIn: exchangeResponse.refresh_expires_in,
    };
  }
}

// --- Types ---

export type CustomChallenge = z.input<typeof ChallengeSchema>;

type Signer = {
  jwk: JoseSignature["jwk"];
  sign: (algorithm: SigningAlgorithm, data: BufferSource) => Promise<ArrayBuffer>;
};

type SigningAlgorithm = Parameters<SubtleCrypto["sign"]>[0];

type SignedChallengeRequest = {
  challenge: string;
  algorithm: JoseSignature["alg"];
  jwk: JoseSignature["jwk"];
  signature: JoseSignature["signature"];
};

type JoseSignature = {
  alg: "ES256";
  jwk: Pick<JsonWebKey, "kty" | "crv" | "x" | "y"> & { kid?: string };
  signature: string;
};

type ExchangeRequest = {
  client_id: string;
};

// --- Utils ---

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, error: () => Error): T {
  const result = schema.safeParse(value);
  if (!result.success) throw error();
  return result.data;
}
