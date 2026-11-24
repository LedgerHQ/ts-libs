import { Challenge, crypto } from "@ledgerhq/hw-ledger-key-ring-protocol";
import {
  WalletAuthInvalidChallengeError,
  WalletAuthNoCredentialsError,
  type IdentityProvider,
  type IdPAuthParams,
  type KeycloakToken,
} from "@ledgerhq/auth";
import getApi, {
  type Challenge as ChallengeJson,
  type LKRPChallenge,
  LKRPChallengeSchema,
  type WeakChallengeSignature,
} from "./api";
import type { MemberCredentials, Trustchain } from "./types";
import { convertLiveCredentialsToKeyPair, credentialForPubKey, liveAuthentication } from "./utils";

export interface LkrpIdentityProviderStore {
  trustchain: Pick<Trustchain, "rootId"> | null;
  memberCredentials: MemberCredentials | null;
}

type IdPSession = { host: string; clientId: string; idPToken: string; owner: string };

export class LkrpIdentityProvider implements IdentityProvider {
  readonly brokerId = "lkrp";
  private session?: IdPSession;

  constructor(private readonly loadTrustchainStore: LoadTrustchainStore) {}

  async authenticate(request: IdPAuthParams): Promise<KeycloakToken> {
    const challenge = LkrpIdentityProvider.checkChallenge(request.challenge);
    const trustchainStore = await this.loadTrustchainStore();
    const host = challenge.json.host;
    const api = getApi(`https://${host}`);

    const authorizationCode = await api.oidcPostChallengeResponse(
      await this.signChallenge(challenge, trustchainStore),
    );

    const idPToken = await api.oidcExchangeAuthCode(
      authorizationCode,
      request.clientId,
      request.redirectUri,
      request.codeVerifier,
    );

    const token = await api.oidcExchangeToken(idPToken, request.clientId);
    this.session = { host, clientId: request.clientId, idPToken, owner: ownerOf(trustchainStore) };
    return token;
  }

  /**
   * Renews the IdP token of the last authentication instead of signing a new challenge. Throws,
   * so AuthSDK authenticates again, when there was none or the trustchain or member changed since.
   */
  async refresh(): Promise<KeycloakToken> {
    const session = this.session;
    if (!session || session.owner !== ownerOf(await this.loadTrustchainStore())) {
      throw new Error("no IdP token of the current member to refresh");
    }
    const api = getApi(`https://${session.host}`);
    const idPToken = await api.oidcRefreshToken(session.idPToken);
    const token = await api.oidcExchangeToken(idPToken, session.clientId);
    this.session = { ...session, idPToken };
    return token;
  }

  private async signChallenge(
    challenge: LKRPChallenge,
    trustchainStore: LkrpIdentityProviderStore | undefined,
  ): Promise<{
    challenge: ChallengeJson;
    signature: WeakChallengeSignature;
  }> {
    if (!trustchainStore?.memberCredentials) {
      throw new WalletAuthNoCredentialsError(this.brokerId);
    }

    const data = crypto.from_hex(challenge.tlv);
    const [parsed] = Challenge.fromBytes(data);
    const hash = crypto.hash(parsed.getUnsignedTLV());
    const keypair = convertLiveCredentialsToKeyPair(trustchainStore.memberCredentials);
    return {
      challenge: challenge.json,
      signature: {
        credential: credentialForPubKey(trustchainStore.memberCredentials.pubkey),
        signature: crypto.to_hex(crypto.sign(hash, keypair)),
        attestation: trustchainStore.trustchain?.rootId
          ? crypto.to_hex(liveAuthentication(trustchainStore.trustchain.rootId))
          : undefined,
      },
    };
  }

  private static checkChallenge(challenge: unknown): LKRPChallenge {
    try {
      return LKRPChallengeSchema.parse(challenge);
    } catch {
      throw new WalletAuthInvalidChallengeError();
    }
  }
}

function ownerOf(store: LkrpIdentityProviderStore | undefined): string {
  return `${store?.trustchain?.rootId ?? ""} ${store?.memberCredentials?.pubkey ?? ""}`;
}

type LoadTrustchainStore = () =>
  | Promise<LkrpIdentityProviderStore | undefined>
  | LkrpIdentityProviderStore
  | undefined;
