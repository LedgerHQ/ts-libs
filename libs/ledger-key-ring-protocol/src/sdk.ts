import {
  JWT,
  MemberCredentials,
  TrustchainSDKContext,
  Trustchain,
  TrustchainMember,
  TrustchainSDK,
  TrustchainDeviceCallbacks,
  AuthCachePolicy,
  TrustchainResult,
  TrustchainResultType,
  TrustchainLifecycle,
  GetOrCreateTrustchainCallbacks,
  TrustchainStream,
  AddMemberOptions,
  GetStreamsOptions,
} from "./types";
import {
  crypto,
  Challenge,
  CommandStream,
  CommandStreamEncoder,
  StreamTree,
  Permissions,
  DerivationPath,
  SoftwareDevice,
  Device,
} from "@ledgerhq/hw-ledger-key-ring-protocol";
import getApi from "./api";
import { log } from "@ledgerhq/logs";
import {
  TrustchainAlreadyInitialized,
  TrustchainAlreadyInitializedWithOtherSeed,
  TrustchainEjected,
  TrustchainNotAllowed,
  TrustchainOutdated,
} from "./errors";
import { HWDeviceProvider } from "./HWDeviceProvider";
import { genericWithJWT } from "./auth";
import { assertPermissions, samePermissions } from "./permissions";
import {
  convertLiveCredentialsToKeyPair,
  credentialForPubKey,
  initMemberCredentials,
  liveAuthentication,
} from "./utils";

type WithJwt = <T>(job: (jwt: JWT) => Promise<T>) => Promise<T>;
type WithDevice = <T>(job: (device: Device) => Promise<T>) => Promise<T>;
type Signer = { withJwt: WithJwt; withDevice: WithDevice };

export class SDK implements TrustchainSDK {
  private context: TrustchainSDKContext;
  private hwDeviceProvider: HWDeviceProvider;
  private lifecycle?: TrustchainLifecycle;
  private api: ReturnType<typeof getApi>;

  constructor(
    context: TrustchainSDKContext,
    hwDeviceProvider: HWDeviceProvider,
    lifecyle?: TrustchainLifecycle,
  ) {
    this.context = context;
    this.hwDeviceProvider = hwDeviceProvider;
    this.lifecycle = lifecyle;
    this.api = getApi(context.apiBaseUrl);
  }

  private jwt: JWT | undefined = undefined;
  private jwtHash = "";
  withAuth<T>(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    job: (jwt: JWT) => Promise<T>,
    policy?: AuthCachePolicy,
    ignorePermissionsChecks?: boolean,
  ): Promise<T> {
    const hash = trustchain.rootId + " " + memberCredentials.pubkey;
    if (this.jwtHash !== hash) {
      this.jwt = undefined;
      this.jwtHash = hash;
    }
    return genericWithJWT(
      jwt => {
        this.jwt = jwt;
        if (!ignorePermissionsChecks) {
          const permissions = jwt?.permissions?.[trustchain.rootId];
          if (!permissions) {
            throw new TrustchainNotAllowed("permissions not available for current trustchain");
          }
          // check if the application path is allowed
          if (!permissions[trustchain.applicationPath]) {
            throw new TrustchainOutdated(
              `expected ${trustchain.applicationPath}, got: ${Object.keys(permissions)[0]}`,
            );
          }
        }
        return job(jwt);
      },
      this.jwt,
      () => this.auth(trustchain, memberCredentials),
      jwt => this.api.refreshAuth(jwt),
      policy,
    );
  }

  async initMemberCredentials(): Promise<MemberCredentials> {
    return initMemberCredentials();
  }

  async getOrCreateTrustchain(
    deviceId: string,
    memberCredentials: MemberCredentials,
    callbacks?: GetOrCreateTrustchainCallbacks,
    topic?: Uint8Array,
    currentTrustchain?: Trustchain,
  ): Promise<TrustchainResult> {
    if (callbacks?.softwareMemberPermissions !== undefined) {
      assertPermissions(callbacks.softwareMemberPermissions);
    }
    this.invalidateJwt();

    let type = TrustchainResultType.restored;

    const withJwt: WithJwt = job =>
      this.hwDeviceProvider.withJwt(deviceId, job, "cache", callbacks);
    const withHw: WithDevice = job => this.hwDeviceProvider.withHw(deviceId, job, callbacks);

    let trustchains = await withJwt(this.api.getTrustchains);

    callbacks?.onInitialResponse?.(trustchains);

    if (currentTrustchain) {
      await this.restoreTrustchain(currentTrustchain, memberCredentials).then(
        () => {
          throw Object.keys(trustchains).includes(currentTrustchain.rootId)
            ? new TrustchainAlreadyInitialized()
            : new TrustchainAlreadyInitializedWithOtherSeed();
        },
        () => {
          // The user was ejected from the trustchain therefore we can continue
        },
      );
    }

    if (Object.keys(trustchains).length === 0) {
      log("trustchain", "getOrCreateTrustchain: no trustchain yet, let's create one");
      type = TrustchainResultType.created;
      const streamTree = await this.hwDeviceProvider.withHw(deviceId, hw =>
        StreamTree.createNewTree(hw, { topic }),
      );
      await streamTree.getRoot().resolve(); // double checks the signatures are correct before sending to the backend
      const commandStream = CommandStreamEncoder.encode(streamTree.getRoot().blocks);
      await withJwt(jwt => this.api.postSeed(jwt, crypto.to_hex(commandStream)));
      // deviceJwt have changed, proactively refresh it
      await this.hwDeviceProvider.refreshJwt(deviceId, callbacks);
      trustchains = await withJwt(this.api.getTrustchains);
    }

    // we find our trustchain root id
    let trustchainRootId: string | undefined;
    const trustchainRootPath = "m/";
    for (const [trustchainId, info] of Object.entries(trustchains)) {
      for (const path in info) {
        if (path === trustchainRootPath) {
          trustchainRootId = trustchainId;
        }
      }
    }

    invariant(trustchainRootId, "trustchainRootId should be defined");
    log("trustchain", "getOrCreateTrustchain rootId=" + trustchainRootId);

    // make a stream tree from all the trustchains associated to this root id
    let { streamTree } = await withJwt(jwt => this.fetchTrustchain(jwt, trustchainRootId));
    let path = streamTree.getApplicationRootPath(this.context.applicationId);
    let resolved = (await streamTree.getChild(path)?.resolve()) ?? null;

    // if the current application stream was closed (deactivated), reopen it on the next index
    if (resolved?.isClosed()) {
      path = streamTree.getApplicationRootPath(this.context.applicationId, 1);
      resolved = null; // the reopened stream does not exist yet; pushMember will derive it
    }

    let shouldShare = true;
    if (resolved) {
      const members = resolved.getMembers();
      shouldShare = !members.some(m => crypto.to_hex(m) === memberCredentials.pubkey); // not already a member
    }
    if (shouldShare) {
      if (type === TrustchainResultType.restored) type = TrustchainResultType.updated;
      streamTree = await this.pushMember(streamTree, path, trustchainRootId, withJwt, withHw, {
        id: memberCredentials.pubkey,
        name: this.context.name,
        permissions: callbacks?.softwareMemberPermissions ?? Permissions.OWNER,
      });
    }

    const walletSyncEncryptionKey = await extractEncryptionKey(streamTree, path, memberCredentials);

    const trustchain = {
      rootId: trustchainRootId,
      walletSyncEncryptionKey,
      applicationPath: path,
    };

    return { type, trustchain };
  }

  async restoreTrustchain(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<Trustchain> {
    const { streamTree, applicationRootPath, resolved } = await this.withAuth(
      trustchain,
      memberCredentials,
      jwt => this.fetchTrustchainAndResolve(jwt, trustchain.rootId, this.context.applicationId),
      "refresh",
      true,
    );
    if (resolved.isClosed()) {
      throw new TrustchainEjected("application stream is closed");
    }
    const walletSyncEncryptionKey = await extractEncryptionKey(
      streamTree,
      applicationRootPath,
      memberCredentials,
    );

    return {
      rootId: trustchain.rootId,
      walletSyncEncryptionKey,
      applicationPath: applicationRootPath,
    };
  }

  async getMembers(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<TrustchainMember[]> {
    const { resolved } = await this.withAuth(trustchain, memberCredentials, jwt =>
      this.fetchTrustchainAndResolve(jwt, trustchain.rootId, this.context.applicationId),
    );
    const members = resolved.getMembersData();
    if (!members.some(m => m.id === memberCredentials.pubkey)) {
      throw new TrustchainEjected("Not a member of trustchain");
    }
    return members;
  }

  async removeMember(
    deviceId: string,
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    member: TrustchainMember,
    callbacks?: TrustchainDeviceCallbacks,
  ): Promise<Trustchain> {
    this.invalidateJwt();

    const withJwt: WithJwt = job =>
      this.hwDeviceProvider.withJwt(deviceId, job, "cache", callbacks);
    const withHw: WithDevice = job => this.hwDeviceProvider.withHw(deviceId, job, callbacks);

    // invariant because the sdk does not support this case, and the UI should not allows it.
    invariant(
      memberCredentials.pubkey !== member.id,
      "removeMember must not be used to remove the current member.",
    );

    const afterRotation = await this.lifecycle?.onTrustchainRotation(
      this,
      trustchain,
      memberCredentials,
    );

    const applicationId = this.context.applicationId;
    const trustchainId = trustchain.rootId;
    // oxlint-disable-next-line eslint/prefer-const -- reassigned below after resolution
    let { resolved, streamTree, applicationRootPath } = await withJwt(jwt =>
      this.fetchTrustchainAndResolve(jwt, trustchainId, applicationId),
    );
    const members = resolved.getMembersData();
    const withoutMember = members.filter(m => m.id !== member.id);
    invariant(withoutMember.length < members.length, "member not found"); // invariant because the UI should not allow this case.
    const withoutMemberOrMe = withoutMember.filter(m => m.id !== memberCredentials.pubkey);
    const softwareDevice = getSoftwareDevice(memberCredentials);

    const newPath = streamTree.getApplicationRootPath(applicationId, 1);

    // We close the current trustchain with the hardware wallet in order to get a user confirmation of the action
    const sendCloseStreamToAPI = await this.closeStream(
      streamTree,
      applicationRootPath,
      trustchainId,
      withJwt,
      withHw,
    );

    // derive a new branch of the tree on the new path
    streamTree = await this.pushMember(streamTree, newPath, trustchainId, withJwt, withHw, {
      id: memberCredentials.pubkey,
      name: this.context.name,
      permissions: Permissions.OWNER,
    });

    // add the remaining members
    const withSw = (job: (device: Device) => Promise<StreamTree>) => job(softwareDevice);
    for (const m of withoutMemberOrMe) {
      streamTree = await this.pushMember(streamTree, newPath, trustchainId, withJwt, withSw, m);
    }
    const walletSyncEncryptionKey = await extractEncryptionKey(
      streamTree,
      newPath,
      memberCredentials,
    );

    // we send the close stream to the API only after the new stream is created in case user cancelled the process in the middle.
    await sendCloseStreamToAPI();

    // deviceJwt have changed, proactively refresh it
    await this.hwDeviceProvider.refreshJwt(deviceId, callbacks);

    const newTrustchain: Trustchain = {
      rootId: trustchainId,
      walletSyncEncryptionKey,
      applicationPath: newPath,
    };

    if (afterRotation) await afterRotation(newTrustchain);

    // refresh the jwt with the new trustchain
    this.jwt = await this.withAuth(
      newTrustchain,
      memberCredentials,
      jwt => Promise.resolve(jwt),
      "refresh",
    );

    return newTrustchain;
  }

  async addMember(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    member: TrustchainMember,
    options: AddMemberOptions = {},
  ): Promise<void> {
    const { path, deviceId, callbacks } = options;
    if (path !== undefined) assertStreamPath(path);
    assertPermissions(member.permissions);
    const { withJwt, withDevice } =
      deviceId === undefined
        ? // a member of the stream at path alone has no permissions on the application path
          this.memberSigner(trustchain, memberCredentials, path !== undefined)
        : this.deviceSigner(deviceId, callbacks);
    const target = await withJwt(jwt => this.fetchTarget(jwt, trustchain.rootId, path));
    await assertCanAddMember(target.streamTree, target.path, member, options);
    await this.pushMember(
      target.streamTree,
      target.path,
      trustchain.rootId,
      withJwt,
      withDevice,
      member,
    );
  }

  async getStreams(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    options: GetStreamsOptions,
  ): Promise<TrustchainStream[]> {
    const { withJwt } =
      options.deviceId === undefined
        ? this.memberSigner(trustchain, memberCredentials, options.ignorePermissionsChecks)
        : this.deviceSigner(options.deviceId, options.callbacks);
    const { streamTree } = await withJwt(jwt => this.fetchTrustchain(jwt, trustchain.rootId));
    return Promise.all(
      Object.keys(streamTree.serialize())
        .filter(path => isAtOrBelow(path, options.pathPrefix))
        .flatMap(path => {
          // the root ("m/") has no child path
          const stream = streamTree.getChild(path);
          return stream ? [describeStream(path, stream)] : [];
        }),
    );
  }

  async createStreamWithDevice(
    deviceId: string,
    trustchain: Trustchain,
    path: string,
    member: TrustchainMember,
    callbacks?: TrustchainDeviceCallbacks,
  ): Promise<void> {
    assertStreamPath(path);
    assertPermissions(member.permissions);
    const { withJwt, withDevice } = this.deviceSigner(deviceId, callbacks);
    const { streamTree } = await withJwt(jwt => this.fetchTrustchain(jwt, trustchain.rootId));
    await assertCurrentGeneration(streamTree, path);
    invariant(!streamTree.getChild(path), `stream ${path} already exists`);
    await this.pushMember(streamTree, path, trustchain.rootId, withJwt, withDevice, member);
  }

  async closeStreamWithDevice(
    deviceId: string,
    trustchain: Trustchain,
    path: string,
    callbacks?: TrustchainDeviceCallbacks,
  ): Promise<boolean> {
    assertStreamPath(path);
    this.jwt = undefined;
    const { withJwt, withDevice } = this.deviceSigner(deviceId, callbacks);
    const { streamTree } = await withJwt(jwt => this.fetchTrustchain(jwt, trustchain.rootId));
    const stream = streamTree.getChild(path);
    if (!stream || (await stream.resolve()).isClosed()) return false;
    const sendCloseStreamToAPI = await this.closeStream(
      streamTree,
      path,
      trustchain.rootId,
      withJwt,
      withDevice,
    );
    await sendCloseStreamToAPI();
    // deviceJwt have changed, proactively refresh it; the stream is closed already, so only log a failure
    try {
      await this.hwDeviceProvider.refreshJwt(deviceId, callbacks);
    } catch (e) {
      log("trustchain", "refreshing the device login after closing a stream failed", e);
    }
    return true;
  }

  invalidateJwt() {
    this.jwt = undefined;
    this.hwDeviceProvider.clearJwt();
  }

  async destroyTrustchain(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<void> {
    await this.withAuth(trustchain, memberCredentials, jwt =>
      this.api.deleteTrustchain(jwt, trustchain.rootId),
    );
    this.invalidateJwt();
  }

  async destroyApplication(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
  ): Promise<{ trustchainDestroyed: boolean }> {
    this.invalidateJwt();

    const applicationId = this.context.applicationId;
    const trustchainId = trustchain.rootId;
    const withJwt: WithJwt = job =>
      this.withAuth(trustchain, memberCredentials, job, "refresh", true);

    const { streamTree, applicationRootPath, resolved } = await withJwt(jwt =>
      this.fetchTrustchainAndResolve(jwt, trustchainId, applicationId),
    );

    // already deactivated: closing again would push a redundant CloseStream
    if (resolved.isClosed()) {
      return { trustchainDestroyed: false };
    }

    // if this is the last open application, closing its stream would leave an empty
    // trustchain: destroy the whole root instead, preserving the previous deactivation behaviour.
    if (!(await streamTree.hasAnotherOpenApplication(applicationId))) {
      await this.destroyTrustchain(trustchain, memberCredentials);
      return { trustchainDestroyed: true };
    }

    // otherwise close only the current application stream, signed with the member's software key (no device)
    const softwareDevice = getSoftwareDevice(memberCredentials);
    const withSw = (job: (device: Device) => Promise<StreamTree>) => job(softwareDevice);
    const sendCloseStreamToAPI = await this.closeStream(
      streamTree,
      applicationRootPath,
      trustchainId,
      withJwt,
      withSw,
    );
    await sendCloseStreamToAPI();
    this.invalidateJwt();
    return { trustchainDestroyed: false };
  }

  async encryptUserData(trustchain: Trustchain, input: Uint8Array): Promise<Uint8Array> {
    const key = crypto.from_hex(trustchain.walletSyncEncryptionKey);
    const encrypted = await crypto.encryptUserData(key, input);
    return encrypted;
  }

  async decryptUserData(trustchain: Trustchain, data: Uint8Array): Promise<Uint8Array> {
    const key = crypto.from_hex(trustchain.walletSyncEncryptionKey);
    const decrypted = await crypto.decryptUserData(key, data);
    return decrypted;
  }

  private async fetchTrustchain(jwt: JWT, trustchainId: string) {
    const trustchainData = await this.api.getTrustchain(jwt, trustchainId);
    const streamTree = StreamTree.deserialize(trustchainData);
    return { streamTree };
  }

  private async fetchTrustchainAndResolve(jwt: JWT, trustchainId: string, applicationId: number) {
    const { streamTree } = await this.fetchTrustchain(jwt, trustchainId);
    const applicationRootPath = streamTree.getApplicationRootPath(applicationId);
    const applicationNode = streamTree.getChild(applicationRootPath);
    invariant(applicationNode, "could not find the application stream.");
    const resolved = await applicationNode.resolve();
    return { resolved, streamTree, applicationRootPath, applicationNode };
  }

  private async auth(trustchain: Trustchain, memberCredentials: MemberCredentials): Promise<JWT> {
    const challenge = await this.api.getAuthenticationChallenge();
    const data = crypto.from_hex(challenge.tlv);
    const [parsed, _] = Challenge.fromBytes(data);
    const hash = await crypto.hash(parsed.getUnsignedTLV());
    const keypair = convertLiveCredentialsToKeyPair(memberCredentials);
    const response = await this.api
      .postChallengeResponse({
        challenge: challenge.json,
        signature: {
          credential: credentialForPubKey(memberCredentials.pubkey),
          signature: crypto.to_hex(await crypto.sign(hash, keypair)),
          attestation: crypto.to_hex(liveAuthentication(trustchain.rootId)),
        },
      })
      .catch(e => {
        if (
          (e as { name?: string })?.name === "LedgerAPI4xx" &&
          ((e as Error)?.message.includes("Not a member of trustchain") ||
            (e as Error)?.message.includes("You are not member"))
        ) {
          throw new TrustchainEjected((e as Error)?.message);
        }
        throw e;
      });
    return response;
  }

  private async pushMember(
    streamTree: StreamTree,
    path: string,
    trustchainId: string,
    withJwt: WithJwt,
    withDevice: (job: (device: Device) => Promise<StreamTree>) => Promise<StreamTree>,
    member: TrustchainMember,
  ) {
    const isMemberAlreadyInStreamTree = await isMemberInStreamTree(streamTree, path, member);
    if (isMemberAlreadyInStreamTree) {
      return streamTree;
    }
    const isNewDerivation = !streamTree.getChild(path);
    streamTree = await withDevice(device =>
      streamTree.share(path, device, crypto.from_hex(member.id), member.name, member.permissions),
    );

    const child = streamTree.getChild(path);
    invariant(child, "StreamTree.share failed to create the child stream.");
    await child.resolve(); // double checks the signatures are correct before sending to the backend
    if (isNewDerivation) {
      const commandStream = CommandStreamEncoder.encode(child.blocks);
      await withJwt(jwt =>
        this.api.postDerivation(jwt, trustchainId, crypto.to_hex(commandStream)),
      );
    } else {
      const commandStream = CommandStreamEncoder.encode([child.blocks[child.blocks.length - 1]]);
      const request = {
        path,
        blocks: [crypto.to_hex(commandStream)],
      };
      await withJwt(jwt => this.api.putCommands(jwt, trustchainId, request));
    }
    return streamTree;
  }

  private memberSigner(
    trustchain: Trustchain,
    memberCredentials: MemberCredentials,
    ignorePermissionsChecks?: boolean,
  ): Signer {
    return {
      withJwt: job =>
        this.withAuth(trustchain, memberCredentials, job, undefined, ignorePermissionsChecks),
      withDevice: job => job(getSoftwareDevice(memberCredentials)),
    };
  }

  private deviceSigner(deviceId: string, callbacks?: TrustchainDeviceCallbacks): Signer {
    return {
      withJwt: job => this.hwDeviceProvider.withJwt(deviceId, job, "cache", callbacks),
      withDevice: job => this.hwDeviceProvider.withHw(deviceId, job, callbacks),
    };
  }

  private async fetchTarget(
    jwt: JWT,
    trustchainId: string,
    path?: string,
  ): Promise<{ streamTree: StreamTree; path: string }> {
    if (path !== undefined) {
      const { streamTree } = await this.fetchTrustchain(jwt, trustchainId);
      return { streamTree, path };
    }
    const { streamTree, applicationRootPath } = await this.fetchTrustchainAndResolve(
      jwt,
      trustchainId,
      this.context.applicationId,
    );
    return { streamTree, path: applicationRootPath };
  }

  private async closeStream(
    streamTree: StreamTree,
    path: string,
    trustchainId: string,
    withJwt: WithJwt,
    withDevice: (job: (device: Device) => Promise<StreamTree>) => Promise<StreamTree>,
  ) {
    streamTree = await withDevice(device => streamTree.close(path, device));
    const child = streamTree.getChild(path);
    invariant(child, "StreamTree.close failed to create the child stream.");
    await child.resolve(); // double checks the signatures are correct before sending to the backend
    const commandStream = CommandStreamEncoder.encode([child.blocks[child.blocks.length - 1]]);
    const request = {
      path,
      blocks: [crypto.to_hex(commandStream)],
    };
    return () => withJwt(jwt => this.api.putCommands(jwt, trustchainId, request));
  }
}

function getSoftwareDevice(memberCredentials: MemberCredentials): SoftwareDevice {
  const kp = convertLiveCredentialsToKeyPair(memberCredentials);
  return new SoftwareDevice(kp);
}

async function extractEncryptionKey(
  streamTree: StreamTree,
  path: string,
  memberCredentials: MemberCredentials,
): Promise<string> {
  const softwareDevice = getSoftwareDevice(memberCredentials);
  const pathNumbers = DerivationPath.toIndexArray(path);
  try {
    const key = await softwareDevice.readKey(streamTree, pathNumbers);
    // private key is in the first 32 bytes
    return crypto.to_hex(key.slice(0, 32));
  } catch (e) {
    if (e instanceof Error) {
      throw new TrustchainEjected(e.message);
    }
    throw e;
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const MAX_HARDENED_INDEX = 0x7fffffff;

// streams are generations of a container (the application, then objects below it), and the
// backend only returns streams laid out this way
function assertStreamPath(path: string): void {
  invariant(
    /^m\/0'((\/(0|[1-9]\d*)'){2})+$/.test(path) &&
      // a larger index overflows its 32-bit encoding, so the device would sign another path
      path
        .slice(2)
        .split("/")
        .every(component => Number.parseInt(component, 10) <= MAX_HARDENED_INDEX),
    `path ${path} must be m/0'/<application>'/<generation>' followed by any number of hardened <object>'/<generation>' pairs`,
  );
}

async function assertCanAddMember(
  streamTree: StreamTree,
  path: string,
  member: TrustchainMember,
  options: AddMemberOptions,
): Promise<void> {
  await assertCurrentGeneration(streamTree, path);
  const stream = streamTree.getChild(path);
  invariant(stream, `stream ${path} is missing, create it with createStreamWithDevice`);
  const resolved = await stream.resolve();
  if (resolved.isClosed()) {
    if (options.path === undefined) {
      throw new TrustchainEjected(`application stream ${path} is closed`);
    }
    throw new Error(`stream ${path} is closed`);
  }
  const current = resolved
    .getMembersData()
    .find(m => m.id.toLowerCase() === member.id.toLowerCase());
  invariant(
    !current || samePermissions(current.permissions, member.permissions),
    `member ${member.id} is already in ${path} with permissions ${current?.permissions}`,
  );
}

async function assertCurrentGeneration(streamTree: StreamTree, path: string): Promise<void> {
  await assertBelowCurrentStreams(streamTree, path);
  // the backend lists only the latest generation, so a replaced one usually looks missing too
  const replacedBy = newerGeneration(streamTree, path);
  invariant(!replacedBy, `stream ${path} was replaced by ${replacedBy}`);
}

// every member of an ancestor stream can derive the keys of the streams below it, so each ancestor
// must be the current one: not replaced (members removed by the rotation still hold its key) nor
// closed. The path is container/generation pairs (assertStreamPath), so each ancestor is a stream.
async function assertBelowCurrentStreams(streamTree: StreamTree, path: string): Promise<void> {
  const components = path.split("/");
  for (let end = 4; end < components.length; end += 2) {
    const ancestor = components.slice(0, end).join("/");
    const stream = streamTree.getChild(ancestor);
    invariant(
      stream && !(await stream.resolve()).isClosed() && !newerGeneration(streamTree, ancestor),
      `stream ${path} must be below open streams of the latest generation (${ancestor})`,
    );
  }
}

function isAtOrBelow(path: string, prefix: string): boolean {
  return prefix.endsWith("/")
    ? path.startsWith(prefix)
    : path === prefix || path.startsWith(`${prefix}/`);
}

// the last component of a stream path is its generation
function newerGeneration(streamTree: StreamTree, path: string): string | undefined {
  const parent = path.slice(0, path.lastIndexOf("/") + 1);
  const generation = Number.parseInt(path.slice(parent.length), 10);
  return Object.keys(streamTree.serialize()).find(other => {
    const rest = other.slice(parent.length);
    return (
      other.startsWith(parent) && /^\d+'$/.test(rest) && Number.parseInt(rest, 10) > generation
    );
  });
}

async function describeStream(path: string, stream: CommandStream): Promise<TrustchainStream> {
  const resolved = await stream.resolve();
  return { path, members: resolved.getMembersData(), closed: resolved.isClosed() };
}

async function isMemberInStreamTree(
  streamTree: StreamTree,
  path: string,
  member: TrustchainMember,
): Promise<boolean> {
  const child = streamTree.getChild(path);
  if (!child) {
    return false;
  }
  const resolved = await child.resolve();
  const members = resolved.getMembersData();
  return members.some(m => m.id.toLowerCase() === member.id.toLowerCase());
}
