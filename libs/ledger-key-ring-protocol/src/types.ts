import type { Observable } from "rxjs";
import { z } from "zod";
import type Transport from "@ledgerhq/hw-transport";
import type { TrustchainsResponse } from "./api";

/**
 * The JWT is a JSON Web Token that is used to authenticate the user.
 */
export type JWT = {
  accessToken: string;
  permissions?: {
    [trustchainId: string]: {
      [path: string]: string;
    };
  };
};

/**
 * A function which allow all interactions with the hardware device.
 */
export type WithDevice = (
  deviceId: string,
  options?: { openTimeoutMs?: number },
) => <T>(fn: (transport: Transport) => Observable<T>) => Observable<T>;

/**
 * A Trustchain contains the identifier and the contextual data we need to manage members and encrypt/decrypt data.
 */
export type Trustchain = {
  /**
   * The immutable id of the trustchain root
   */
  rootId: string;
  /**
   * The secret used to encrypt/decrypt the wallet sync data
   */
  walletSyncEncryptionKey: string;
  /**
   * The derivation path on which the current walletSyncEncryptionKey value is stored
   */
  applicationPath: string;
};

/**
 * The Trustchain member credentials are stored on each client, with the privatekey only known by the current client.
 */
export const MemberCredentialsSchema = z.strictObject({
  pubkey: z.hex().length(66).lowercase(),
  privatekey: z.hex().length(64).lowercase(),
});

export type MemberCredentials = z.infer<typeof MemberCredentialsSchema>;

/**
 * A member of the trustchain
 */
export type TrustchainMember = {
  /**
   * The id of the member. It corresponds to the MemberCredentials.pubkey
   */
  id: string;
  /**
   * The name of the member as displayed in the UI
   */
  name: string;
  /**
   * a technical permissions of the member. it will often just be Permissions.OWNER
   */
  permissions: number;
};

/**
 * A stream of the trustchain: an application stream or a subtree below it.
 */
export type TrustchainStream = {
  path: string;
  members: TrustchainMember[];
  closed: boolean;
};

export type GetStreamsOptions = {
  /**
   * The path to list from, compared by whole components: `m/0'/1'` does not match `m/0'/16'/0'`.
   * With a trailing `/`, only the streams below it.
   */
  pathPrefix: string;
} & (
  | {
      /**
       * Skip the member permissions check of the login.
       */
      ignorePermissionsChecks?: boolean;
      deviceId?: never;
      callbacks?: never;
    }
  | {
      /**
       * Read with this device's login instead of the member credentials, which are then not used.
       */
      deviceId: string;
      /**
       * Device interaction callbacks.
       */
      callbacks?: TrustchainDeviceCallbacks;
      ignorePermissionsChecks?: never;
    }
);

export type AddMemberOptions = {
  /**
   * The stream to add the member to. Defaults to the latest stream of the SDK's application.
   */
  path?: string;
} & (
  | { deviceId?: never; callbacks?: never }
  | {
      /**
       * The device that authenticates and signs instead of the member credentials.
       */
      deviceId: string;
      /**
       * Device interaction callbacks.
       */
      callbacks?: TrustchainDeviceCallbacks;
    }
);

/**
 * The TrustchainSDKContext is a context that is used to initialize the TrustchainSDK.
 */
export type TrustchainSDKContext = {
  applicationId: number;
  name: string;
  apiBaseUrl: string;
};

/**
 * provide global callbacks for specific lifecycles.
 * this allows us to decouple trustchain with the rest of Ledger Live.
 * For now, we only introduce very specific hooks we need.
 */
export type TrustchainLifecycle = {
  /**
   * called when a trustchain rotation is occuring
   * the first function is called when the rotation is starting
   * the second function is called when the rotation is done.
   *
   * in that case, we typically want to delete all other resources depending on it.
   * we do this with the existing jwt token before refreshing it.
   */
  onTrustchainRotation: (
    trustchainSdk: TrustchainSDK,
    oldTrustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ) => Promise<(newTrustchain: Trustchain) => Promise<void>>;
};

export enum TrustchainResultType {
  created = "created",
  updated = "updated",
  restored = "restored",
}

/**
 * the trustchain with a result type indicating what happened during getOrCreateTrustchain
 */
export type TrustchainResult =
  | {
      // the trustchain didn't exist and was created
      type: TrustchainResultType.created;
      trustchain: Trustchain;
    }
  | {
      // the trustchain already existed and was updated (typically the current member was added)
      type: TrustchainResultType.updated;
      trustchain: Trustchain;
    }
  | {
      // the trustchain existed and was just retrieved (no need to update it)
      type: TrustchainResultType.restored;
      trustchain: Trustchain;
    };

/**
 * cache (default): the SDK will use the cached JWT if it's still valid, otherwise it will refresh it.
 * refresh: the SDK will always refresh the JWT if possible.
 * no-cache: the SDK will always request a new JWT.
 */
export type AuthCachePolicy = "no-cache" | "refresh" | "cache";

/**
 * The main interface for the UI to interact with the trustchain protocol.
 *
 * @example
 *
 * import { sdk } from "@ledgerhq/ledger-key-ring-protocol";
 *
 * sdk.getOrCreateTrustchain(deviceId, memberCredentials).then(trustchain => console.log(trustchain));
 */
export interface TrustchainSDK {
  /**
   * Generate the live credentials that represents a Live instance, member of the trustchain.
   * This method is expected to be used the first time Ledger Live is opened (if Live never generated them before) and then persisted over the future user sessions of Ledger Live in order for the member to be able to authenticate and manage the trustchain.
   */
  initMemberCredentials(): Promise<MemberCredentials>;

  /**
   * Access a JWT from the TrustchainSDK. manage the reauthentication if needed.
   * A trustchain must have been created and the Live instance must have been added as a member.
   * The returned token will typically be used for regular operations like wallet sync.
   */
  withAuth<T>(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    f: (jwt: JWT) => Promise<T>,
    policy?: AuthCachePolicy,
    ignorePermissionsChecks?: boolean,
  ): Promise<T>;

  /**
   * This method will either create the required trustchains (root and application) or restore them.
   * The returned trustchain will be initialized on the root level and also will have the branch derivation corresponding to the contextual applicationId.
   * It will also have the wallet sync encryption key initialized.
   * The latest jwt is also returned because it was potentially updated during the process.
   */
  getOrCreateTrustchain(
    deviceId: string,
    memberCredentials: MemberCredentials,
    callbacks?: GetOrCreateTrustchainCallbacks,
    topic?: Uint8Array,
    currentTrustchain?: Trustchain,
  ): Promise<TrustchainResult>;

  /**
   * Restore the current trustchain encryption key, typically due to a key rotation.
   */
  restoreTrustchain(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<Trustchain>;

  /**
   * list the current members of the application trustchain
   */
  getMembers(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<TrustchainMember[]>;

  /**
   * remove a member from the application trustchain
   */
  removeMember(
    deviceId: string,
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    member: TrustchainMember,
    callbacks?: TrustchainDeviceCallbacks,
  ): Promise<Trustchain>;

  /**
   * add a member to the application trustchain, or with options.path to another existing stream:
   * m/0'/<application>'/<generation>' followed by any number of <object>'/<generation>' pairs.
   * Does nothing when the member is already in the stream with the same permissions, and refuses
   * other permissions. Refuses a missing stream (see createStreamWithDevice), a closed stream
   * (TrustchainEjected without options.path, as restoreTrustchain), a generation replaced by a
   * newer one, and a stream below an ancestor stream that is missing, closed or not the latest
   * generation.
   */
  addMember(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    member: TrustchainMember,
    options?: AddMemberOptions,
  ): Promise<void>;

  /**
   * destroy the trustchain
   */
  destroyTrustchain(trustchain: Trustchain, memberCredentials: MemberCredentials): Promise<void>;

  /**
   * Deactivate the current application for this member.
   * Normally this closes only the current application's stream (signed with the member's software key,
   * no hardware device), preserving the other applications and the trustchain root.
   * If the current application is the last open one, the whole trustchain is destroyed instead.
   * @returns `trustchainDestroyed` true when the whole trustchain was destroyed (last open application).
   */
  destroyApplication(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<{ trustchainDestroyed: boolean }>;

  /**
   * encrypt data with the trustchain encryption key
   */
  encryptUserData(trustchain: Trustchain, obj: object): Promise<Uint8Array>;

  /**
   * decrypt data with the trustchain encryption key
   */
  decryptUserData(trustchain: Trustchain, data: Uint8Array): Promise<Uint8Array>;

  invalidateJwt(): void;

  /**
   * Every stream at `options.pathPrefix` or below it, except the root. The backend only
   * returns the latest generation of a stream: once `…/<n+1>'` exists, `…/<n>'` is no longer listed.
   */
  getStreams(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    options: GetStreamsOptions,
  ): Promise<TrustchainStream[]>;

  /**
   * Create the stream at `path` (laid out as in addMember) with the device, with `member` in it.
   * Only the device can derive the key of a new stream. Refuses a stream that already exists
   * (add members to it with addMember), a generation replaced by a newer one, and the ancestor
   * streams addMember refuses.
   */
  createStreamWithDevice(
    deviceId: string,
    trustchain: Trustchain,
    path: string,
    member: TrustchainMember,
    callbacks?: TrustchainDeviceCallbacks,
  ): Promise<void>;

  /**
   * Close the stream at `path` (laid out as in addMember) with the device. Resolves to false
   * when it is missing (including a generation replaced by a newer one) or already closed.
   */
  closeStreamWithDevice(
    deviceId: string,
    trustchain: Trustchain,
    path: string,
    callbacks?: TrustchainDeviceCallbacks,
  ): Promise<boolean>;

  /**
   * Hand the SDK a device (seed) login obtained elsewhere for the same device, e.g. by another
   * Ledger Sync client, so the next getOrCreateTrustchain does not log the device in again. It
   * survives that call once; invalidateJwt drops it. If the backend refuses it, the SDK drops it
   * and logs the device in once, as it does for a refused login it obtained itself, even from the
   * same device: TrustchainNotAllowed comes only if the new login is refused too.
   */
  useDeviceJwt(jwt: JWT): void;

  /**
   * Like useDeviceJwt, for later hardware operations only: getOrCreateTrustchain still drops it.
   */
  cacheDeviceJwt(jwt: JWT): void;

  /**
   * Whether the SDK caches a device login it obtained itself, not one given to useDeviceJwt or
   * cacheDeviceJwt.
   */
  hasOwnDeviceJwt(): boolean;
}

export interface TrustchainDeviceCallbacks {
  onStartRequestUserInteraction?: () => void;
  onEndRequestUserInteraction?: () => void;
}

export interface GetOrCreateTrustchainCallbacks extends TrustchainDeviceCallbacks {
  onInitialResponse?: (trustchains: TrustchainsResponse) => void;
  /**
   * Permission bits given to the software member when this call adds it.
   * Defaults to Permissions.OWNER. A member that is already enrolled keeps its permissions, even
   * broader ones.
   */
  softwareMemberPermissions?: number;
}
