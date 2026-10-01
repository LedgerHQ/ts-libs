import { Permissions } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { TrustchainEjected } from "../../errors";
import { MockSDK } from "../../mockSdk";
import { TrustchainResultType, type Trustchain, type TrustchainSDKContext } from "../../types";

const makeSdk = (
  name: string,
  applicationId = 16,
  lifecycle?: ConstructorParameters<typeof MockSDK>[1],
) => {
  const context: TrustchainSDKContext = { applicationId, name, apiBaseUrl: "https://api.test" };
  return new MockSDK(context, lifecycle);
};

const setupWithBob = async (lifecycle?: ConstructorParameters<typeof MockSDK>[1]) => {
  const owner = makeSdk("owner", 16, lifecycle);
  const ownerCredentials = await owner.initMemberCredentials();
  const { trustchain } = await owner.getOrCreateTrustchain("", ownerCredentials);
  const bobCredentials = await makeSdk("bob").initMemberCredentials();
  const bob = { id: bobCredentials.pubkey, name: "bob", permissions: Permissions.OWNER };
  await owner.addMember(trustchain, ownerCredentials, bob);
  return { owner, ownerCredentials, trustchain, bob };
};

describe("MockSDK", () => {
  const cleanup = makeSdk("cleanup");
  let sdk: MockSDK;
  let credentials: Awaited<ReturnType<MockSDK["initMemberCredentials"]>>;

  beforeEach(async () => {
    sdk = makeSdk("alice");
    credentials = await sdk.initMemberCredentials();
  });

  afterEach(async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    await cleanup.destroyTrustchain(trustchain, credentials);
  });

  it("generates distinct credentials on each call", async () => {
    const second = await sdk.initMemberCredentials();
    expect(second.pubkey).not.toBe(credentials.pubkey);
    expect(credentials.privatekey).toMatch(/^mock-private-key-alice-/);
  });

  it("rejects credentials that are not the mocked ones", async () => {
    await expect(
      sdk.getOrCreateTrustchain("", { pubkey: "p", privatekey: "real-key" }),
    ).rejects.toThrow("in mock context, memberCredentials must be the mocked memberCredentials");
  });

  it("rejects a trustchain that is not the mocked one", async () => {
    const foreign: Trustchain = {
      rootId: "other",
      walletSyncEncryptionKey: "00",
      applicationPath: "m/0'/16'/0'",
    };
    await expect(sdk.restoreTrustchain(foreign, credentials)).rejects.toThrow(
      "in mock context, trustchain must be the mocked trustchain",
    );
    expect(() => sdk.encryptUserData(foreign, new Uint8Array())).toThrow(
      "in mock context, trustchain must be the mocked trustchain",
    );
  });

  it("runs the job with the mocked jwt in withAuth", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    const job = jest.fn().mockResolvedValue("done");

    await expect(sdk.withAuth(trustchain, credentials, job)).resolves.toBe("done");
    expect(job).toHaveBeenCalledWith({ accessToken: "mock-live-jwt", permissions: {} });
  });

  it("returns the same jwt on refreshAuth", async () => {
    const jwt = { accessToken: "a" };
    await expect(sdk.refreshAuth(jwt)).resolves.toBe(jwt);
  });

  it("xors data on encrypt and decrypt so that they round-trip", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    const input = Uint8Array.from([0, 1, 2, 255]);

    const encrypted = await sdk.encryptUserData(trustchain, input);

    expect(Array.from(encrypted)).toEqual([255, 254, 253, 0]);
    expect(await sdk.decryptUserData(trustchain, encrypted)).toEqual(input);
  });

  it("creates, then restores, then updates for a new member", async () => {
    const first = await sdk.getOrCreateTrustchain("", credentials);
    expect(first.type).toBe(TrustchainResultType.created);
    expect(first.trustchain.applicationPath).toBe("m/0'/16'/0'");
    expect(first.trustchain.walletSyncEncryptionKey).toBe("1".padStart(64, "0"));

    const again = await sdk.getOrCreateTrustchain("", credentials);
    expect(again.type).toBe(TrustchainResultType.restored);

    const bob = makeSdk("bob");
    const bobCredentials = await bob.initMemberCredentials();
    const updated = await bob.getOrCreateTrustchain("", bobCredentials);
    expect(updated.type).toBe(TrustchainResultType.updated);
  });

  it("calls device interaction callbacks when acquiring auth and adding itself", async () => {
    const callbacks = {
      onStartRequestUserInteraction: jest.fn(),
      onEndRequestUserInteraction: jest.fn(),
    };

    await sdk.getOrCreateTrustchain("", credentials, callbacks);
    expect(callbacks.onStartRequestUserInteraction).toHaveBeenCalledTimes(2);
    expect(callbacks.onEndRequestUserInteraction).toHaveBeenCalledTimes(2);

    await sdk.getOrCreateTrustchain("", credentials, callbacks);
    expect(callbacks.onStartRequestUserInteraction).toHaveBeenCalledTimes(3);
  });

  it("lists members as a copy, with the creator as owner", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);

    const members = await sdk.getMembers(trustchain, credentials);

    expect(members).toEqual([
      { id: credentials.pubkey, name: "alice", permissions: Permissions.OWNER },
    ]);
    members.pop();
    expect(await sdk.getMembers(trustchain, credentials)).toHaveLength(1);
  });

  it("throws TrustchainEjected on getMembers for an unknown member", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    const stranger = await makeSdk("stranger").initMemberCredentials();

    await expect(sdk.getMembers(trustchain, stranger)).rejects.toBeInstanceOf(TrustchainEjected);
  });

  it("addMember is idempotent and lets the added member restore", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    const bob = makeSdk("bob");
    const bobCredentials = await bob.initMemberCredentials();
    const member = { id: bobCredentials.pubkey, name: "bob", permissions: Permissions.OWNER };

    await sdk.addMember(trustchain, credentials, member);
    await sdk.addMember(trustchain, credentials, member);

    expect(await sdk.getMembers(trustchain, credentials)).toHaveLength(2);
    await expect(bob.restoreTrustchain(trustchain, bobCredentials)).resolves.toEqual(trustchain);
  });

  it("addMember creates the application when it does not exist yet", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    const other = makeSdk("alice-other-app", 17);
    const otherCredentials = await other.initMemberCredentials();
    const member = { id: otherCredentials.pubkey, name: "o", permissions: Permissions.OWNER };

    await other.addMember(trustchain, otherCredentials, member);

    await expect(other.getMembers(trustchain, otherCredentials)).resolves.toEqual([member]);
  });

  it("throws TrustchainEjected on restore when the trustchain is gone", async () => {
    const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
    await sdk.destroyTrustchain(trustchain, credentials);

    await expect(sdk.restoreTrustchain(trustchain, credentials)).rejects.toBeInstanceOf(
      TrustchainEjected,
    );
  });

  describe("removeMember", () => {
    it("refuses to remove itself", async () => {
      const { owner, ownerCredentials, trustchain } = await setupWithBob();
      await expect(
        owner.removeMember("", trustchain, ownerCredentials, {
          id: ownerCredentials.pubkey,
          name: "owner",
          permissions: Permissions.OWNER,
        }),
      ).rejects.toThrow("cannot remove self");
      await owner.destroyTrustchain(trustchain, ownerCredentials);
    });

    it("rotates the application, drops the member and runs the lifecycle hooks", async () => {
      const afterRotation = jest.fn().mockResolvedValue(undefined);
      const onTrustchainRotation = jest.fn().mockResolvedValue(afterRotation);
      const { owner, ownerCredentials, trustchain, bob } = await setupWithBob({
        onTrustchainRotation,
      });
      const callbacks = {
        onStartRequestUserInteraction: jest.fn(),
        onEndRequestUserInteraction: jest.fn(),
      };

      const rotated = await owner.removeMember("", trustchain, ownerCredentials, bob, callbacks);

      expect(rotated.applicationPath).toBe("m/0'/16'/1'");
      expect(rotated.walletSyncEncryptionKey).toBe("2".padStart(64, "0"));
      expect(onTrustchainRotation).toHaveBeenCalledWith(owner, trustchain, ownerCredentials);
      expect(afterRotation).toHaveBeenCalledWith(rotated);
      expect(callbacks.onStartRequestUserInteraction).toHaveBeenCalledTimes(3);
      const members = await owner.getMembers(rotated, ownerCredentials);
      expect(members.map(m => m.id)).toEqual([ownerCredentials.pubkey]);
      await owner.destroyTrustchain(trustchain, ownerCredentials);
    });
  });

  describe("destroyApplication", () => {
    it("destroys the whole trustchain when it is the last open application", async () => {
      const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);

      await expect(sdk.destroyApplication(trustchain, credentials)).resolves.toEqual({
        trustchainDestroyed: true,
      });
      await expect(sdk.restoreTrustchain(trustchain, credentials)).rejects.toBeInstanceOf(
        TrustchainEjected,
      );
    });

    it("only closes the application when another one is open, then reopens on next index", async () => {
      const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
      const other = makeSdk("alice-2", 17);
      const otherCredentials = await other.initMemberCredentials();
      await other.getOrCreateTrustchain("", otherCredentials);

      await expect(sdk.destroyApplication(trustchain, credentials)).resolves.toEqual({
        trustchainDestroyed: false,
      });
      await expect(sdk.destroyApplication(trustchain, credentials)).resolves.toEqual({
        trustchainDestroyed: false,
      });

      const reopened = await sdk.getOrCreateTrustchain("", credentials);
      expect(reopened.trustchain.applicationPath).toBe("m/0'/16'/1'");
      await other.destroyTrustchain(trustchain, otherCredentials);
    });

    it("throws TrustchainEjected for a non-member", async () => {
      const { trustchain } = await sdk.getOrCreateTrustchain("", credentials);
      const stranger = await makeSdk("stranger").initMemberCredentials();

      await expect(sdk.destroyApplication(trustchain, stranger)).rejects.toBeInstanceOf(
        TrustchainEjected,
      );
    });
  });
});
