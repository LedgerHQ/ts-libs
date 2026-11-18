import { WalletAuthInvalidChallengeError, WalletAuthInvalidTokenError } from "./errors";
import { HttpKeycloakService } from "./keycloakService";
import { createPkcePairWithWebCrypto, type CreatePkcePair } from "./pkce";
import type {
  AuthConfig,
  FetchFn,
  IdentityProvider,
  KeycloakService,
  KeycloakToken,
} from "./types";
import { getTokenState } from "./utils";

export class AuthSDK {
  private token?: Promise<KeycloakToken>;
  private readonly refreshedTokens = new WeakSet<KeycloakToken>();
  private readonly idP: IdentityProvider;
  private readonly createPkcePair: CreatePkcePair;
  private readonly keycloakService: KeycloakService;

  constructor(
    private readonly config: AuthConfig,
    {
      provider,
      createPkcePair = createPkcePairWithWebCrypto,
      fetch = globalThis.fetch,
      keycloakService = new HttpKeycloakService(
        config.keycloakBaseUrl,
        config.keycloakRealm,
        fetch,
      ),
    }: {
      provider: IdentityProvider;
      createPkcePair?: CreatePkcePair;
      fetch?: FetchFn;
      keycloakService?: KeycloakService;
    },
  ) {
    this.idP = provider;
    this.createPkcePair = createPkcePair;
    this.keycloakService = keycloakService;
  }

  async withToken<T>({
    queryFn,
    refreshAndRetryWhen,
  }: {
    queryFn: (token: KeycloakToken) => Promise<T>;
    refreshAndRetryWhen?: (result: T) => boolean;
  }): Promise<T> {
    const token = await this.getToken();
    return queryFn(token).then(async (result: T) => {
      if (!refreshAndRetryWhen?.(result)) return result;
      const refreshedToken = await this.getToken(true);
      return queryFn(refreshedToken);
    });
  }

  private async getToken(forceRefresh = false): Promise<KeycloakToken> {
    if (forceRefresh) {
      // only refresh needs the previous token; a failed concurrent renewal leaves none to renew
      const previousToken = this.idP.refresh ? await this.token?.catch(() => undefined) : undefined;
      // a rejected token that refresh produced may be refused again: authenticate, so that
      // retries cannot loop between refresh and rejection
      const renewable =
        previousToken && !this.refreshedTokens.has(previousToken) ? previousToken : undefined;
      this.token = this.createTokenPromise(renewable);
      return this.token;
    }

    if (this.token) {
      const cachedToken = this.token;
      const token = await cachedToken;
      if (getTokenState(token.accessToken) === "valid") {
        return token;
      }

      if (this.token === cachedToken) {
        this.token = this.createTokenPromise(token);
      }
      return this.token;
    }

    this.token = this.createTokenPromise();
    return this.token;
  }

  private createTokenPromise(previousToken?: KeycloakToken): Promise<KeycloakToken> {
    const tokenPromise = this.refreshOrFetch(previousToken).catch(error => {
      if (this.token === tokenPromise) {
        this.token = undefined;
      }
      throw error;
    });
    return tokenPromise;
  }

  private async refreshOrFetch(previousToken?: KeycloakToken): Promise<KeycloakToken> {
    if (previousToken !== undefined && this.idP.refresh !== undefined) {
      try {
        const refreshedToken = await this.idP.refresh(previousToken);
        if (refreshedToken.accessToken) {
          this.refreshedTokens.add(refreshedToken);
          return refreshedToken;
        }
      } catch {
        return this.fetchToken();
      }
    }
    // no Keycloak refresh_token grant here: Ledger Live's client (ledger-keycloak) refuses it
    // (401 unauthorized_client on staging), so a provider without refresh authenticates again
    return this.fetchToken();
  }

  private async fetchToken(): Promise<KeycloakToken> {
    const pkce = this.config.disablePkce ? undefined : await this.createPkcePair();
    const redirectUri = `${this.keycloakService.realmBaseUrl}/broker/${this.idP.brokerId}/endpoint`;

    const challenge = await this.keycloakService.getChallenge({
      responseType: "code",
      clientId: this.config.clientId,
      scope: "openid",
      redirectUri,
      codeChallenge: pkce?.codeChallenge,
      codeChallengeMethod: pkce?.codeChallengeMethod,
    });
    if (!challenge) {
      throw new WalletAuthInvalidChallengeError();
    }

    const identityProviderTokenResponse = await this.idP.authenticate({
      challenge,
      clientId: this.config.clientId,
      redirectUri,
      codeVerifier: pkce?.codeVerifier,
    });
    if (!identityProviderTokenResponse.accessToken) {
      throw new WalletAuthInvalidTokenError();
    }

    return identityProviderTokenResponse;
  }
}
