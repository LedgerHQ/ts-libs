import { DefaultBodyType, http, HttpResponse, PathParams, StrictRequest } from "msw";
import { setupServer } from "msw/node";
import {
  CommandStreamDecoder,
  crypto,
  DerivationPath,
  Permissions,
  SoftwareDevice,
  StreamTree,
} from "@ledgerhq/hw-ledger-key-ring-protocol";
import { CommandType } from "@ledgerhq/hw-ledger-key-ring-protocol/CommandBlock";
import { TRUSTCHAIN_API_STAGING } from "../../../tests/test-helpers/config";
import { PutCommandsRequest } from "../../api";
import { TrustchainEjected } from "../../errors";
import { HWDeviceProvider } from "../../HWDeviceProvider";
import { SDK } from "../../sdk";
import { AddMemberOptions, GetStreamsOptions, Trustchain, TrustchainMember } from "../../types";
import { CHALLENGE } from "../../__mocks__/challenge";

const APP = "m/0'/18'/0'";
const NEXT_APP = "m/0'/18'/1'";
const SUBTREE = `${APP}/1'/0'`;
const OTHER_SUBTREE = `${APP}/2'/0'`;
const AGENT = `${APP}/7'/0'`;

const aliceKeyPair = crypto.randomKeypair();
const ALICE = {
  pubkey: crypto.to_hex(aliceKeyPair.publicKey),
  privatekey: crypto.to_hex(aliceKeyPair.privateKey),
};
const device = new SoftwareDevice(aliceKeyPair);
const alice: TrustchainMember = { id: ALICE.pubkey, name: "alice", permissions: Permissions.OWNER };
const agentA = agentMember("agent-a");
const agentB = agentMember("agent-b");
const trustchain: Trustchain = {
  rootId: "ROOTID",
  walletSyncEncryptionKey: "",
  applicationPath: APP,
};

const api = {
  getTrustchains: jest.fn(),
  getTrustchain: jest.fn(),
  authenticate: jest.fn(),
  postDerivation: jest.fn<object, [StrictRequest<string>]>(),
  putCommands: jest.fn<object, [StrictRequest<PutCommandsRequest>]>(),
};
const server = setupServer(
  http.get("*/v1/trustchains", () => HttpResponse.json(api.getTrustchains())),
  http.get("*/v1/trustchain/ROOTID", () => HttpResponse.json(api.getTrustchain())),
  http.get("*/v1/challenge", () => HttpResponse.json({ json: {}, tlv: CHALLENGE.tlv })),
  http.post("*/v1/authenticate", () => HttpResponse.json(api.authenticate())),
  http.post<PathParams, string>("*/v1/trustchain/ROOTID/derivation", ({ request }) =>
    HttpResponse.json(api.postDerivation(request)),
  ),
  http.put<PathParams, PutCommandsRequest>("*/v1/trustchain/ROOTID/commands", ({ request }) =>
    HttpResponse.json(api.putCommands(request)),
  ),
);

const hw = {
  withJwt: jest.fn(),
  withHw: jest.fn(),
  refreshJwt: jest.fn(),
  clearJwt: jest.fn(),
} satisfies Partial<HWDeviceProvider>;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  Object.values(hw).forEach(mock => mock.mockReset());
  api.authenticate.mockReturnValue({
    access_token: "SOFTWARE JWT",
    permissions: { ROOTID: { [APP]: "ffffffff" } },
  });
  hw.withJwt.mockImplementation((_deviceId, job) => job({ accessToken: "DEVICE JWT" }));
  hw.withHw.mockImplementation((_deviceId, job) => job(device));
});

describe("getOrCreateTrustchain softwareMemberPermissions", () => {
  it.each([
    ["Permissions.OWNER by default", undefined, Permissions.OWNER],
    ["the requested permissions", Permissions.KEY_READER, Permissions.KEY_READER],
  ])("gives the software member %s", async (_name, softwareMemberPermissions, expected) => {
    const tree = await buildTree();
    api.getTrustchains.mockReturnValue({ ROOTID: { "m/": ["owner"] } });
    api.getTrustchain.mockReturnValue(tree.serialize());

    const { trustchain: created } = await createSdk().getOrCreateTrustchain("device", ALICE, {
      softwareMemberPermissions,
    });

    expect(created.applicationPath).toBe(APP);
    expect(await postedMembers(tree, APP)).toEqual([{ ...alice, permissions: expected }]);
  });
});

describe("getOrCreateTrustchain softwareMemberPermissions range", () => {
  it("refuses permissions that do not fit in 32 bits before any request", async () => {
    await expect(
      createSdk().getOrCreateTrustchain("device", ALICE, {
        softwareMemberPermissions: 2 ** 32 + 1,
      }),
    ).rejects.toThrow(`permissions ${2 ** 32 + 1} do not fit in 32 bits`);
    expect(hw.withJwt).not.toHaveBeenCalled();
  });
});

describe("getStreams", () => {
  it("lists the stream at the prefix and every stream below it", async () => {
    serve(
      await buildTree(
        share(APP, alice),
        share("m/0'/16'/0'", alice),
        share(SUBTREE, agentA),
        share(OTHER_SUBTREE, agentB),
        close(OTHER_SUBTREE),
      ),
    );

    await expect(createSdk().getStreams(trustchain, ALICE, { pathPrefix: APP })).resolves.toEqual([
      { path: APP, members: [alice], closed: false },
      { path: SUBTREE, members: [agentA], closed: false },
      { path: OTHER_SUBTREE, members: [agentB], closed: true },
    ]);
  });

  it("reports a closed stream", async () => {
    serve(await buildTree(share(APP, alice), close(APP)));

    await expect(createSdk().getStreams(trustchain, ALICE, { pathPrefix: APP })).resolves.toEqual([
      { path: APP, members: [alice], closed: true },
    ]);
  });

  it("lists every stream but the root for the m/ prefix", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await expect(createSdk().getStreams(trustchain, ALICE, { pathPrefix: "m/" })).resolves.toEqual([
      { path: APP, members: [alice], closed: false },
      { path: SUBTREE, members: [agentA], closed: false },
    ]);
  });

  it("reads with the device login when given a device", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await expect(
      createSdk().getStreams(trustchain, ALICE, {
        pathPrefix: `${APP}/`,
        deviceId: "device",
        callbacks,
      }),
    ).resolves.toEqual([{ path: SUBTREE, members: [agentA], closed: false }]);
    expect(hw.withJwt).toHaveBeenCalledWith("device", expect.any(Function), "cache", callbacks);
    expect(hw.withJwt).toHaveBeenCalledTimes(1);
    expect(api.authenticate).not.toHaveBeenCalled();
  });

  it("compares the prefix by whole path components", async () => {
    const ledgerSync = "m/0'/16'/0'";
    serve(await buildTree(share(APP, alice), share(ledgerSync, alice)));

    await expect(
      createSdk().getStreams(trustchain, ALICE, { pathPrefix: "m/0'/1" }),
    ).resolves.toEqual([]);
    await expect(
      createSdk().getStreams(trustchain, ALICE, { pathPrefix: "m/0'/16'" }),
    ).resolves.toEqual([{ path: ledgerSync, members: [alice], closed: false }]);
  });

  it("does not type the options it would ignore", () => {
    const options: GetStreamsOptions[] = [
      // @ts-expect-error the device login has no permission check to skip
      { pathPrefix: APP, deviceId: "device", ignorePermissionsChecks: true },
      // @ts-expect-error callbacks are for the device
      { pathPrefix: APP, callbacks: {} },
    ];
    expect(options).toHaveLength(2);
  });

  it("returns an empty list when no stream matches", async () => {
    serve(await buildTree(share(APP, alice)));

    await expect(
      createSdk().getStreams(trustchain, ALICE, { pathPrefix: NEXT_APP }),
    ).resolves.toEqual([]);
  });

  it("skips the permission check only when asked to", async () => {
    serve(await buildTree(share(APP, alice)));
    api.authenticate.mockReturnValue({ access_token: "SOFTWARE JWT", permissions: {} });

    await expect(createSdk().getStreams(trustchain, ALICE, { pathPrefix: APP })).rejects.toThrow(
      "permissions not available for current trustchain",
    );
    await expect(
      createSdk().getStreams(trustchain, ALICE, { pathPrefix: APP, ignorePermissionsChecks: true }),
    ).resolves.toHaveLength(1);
  });
});

describe("addMember", () => {
  it("signs with the member credentials when no device is given", async () => {
    serve(await buildTree(share(APP, alice)));

    await createSdk().addMember(trustchain, ALICE, agentA);

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: APP, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentA.id);
    expect(api.authenticate).toHaveBeenCalledTimes(1);
    expect(hw.withJwt).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("with a device, adds the member to the latest stream of the application", async () => {
    serve(await buildTree(share(APP, alice), close(APP), share(NEXT_APP, alice)));

    await createSdk().addMember(trustchain, ALICE, agentA, { deviceId: "device" });

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: NEXT_APP, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentA.id);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
    expect(api.authenticate).not.toHaveBeenCalled();
  });

  it("with a device, adds the member to the existing stream at the given path", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await createSdk().addMember(trustchain, ALICE, agentB, { deviceId: "device", path: SUBTREE });

    expect(api.postDerivation).not.toHaveBeenCalled();
    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: SUBTREE, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentB.id);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the same id", agentA.id],
    ["its id in upper case", agentA.id.toUpperCase()],
  ])("does nothing when the member is already there with %s", async (_name, id) => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await createSdk().addMember(
      trustchain,
      ALICE,
      { ...agentA, id },
      { deviceId: "device", path: SUBTREE },
    );

    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("does nothing when the member is already there with the same permissions as a signed mask", async () => {
    // OWNER & ~KEY_REVOKER is -5 in JS, the stream stores 0xfffffffb
    const signed = { ...agentA, permissions: Permissions.OWNER & ~Permissions.KEY_REVOKER };
    serve(await buildTree(share(APP, alice), share(SUBTREE, signed)));

    await createSdk().addMember(trustchain, ALICE, signed, { deviceId: "device", path: SUBTREE });

    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each([2 ** 32 + 1, 1.5, -(2 ** 31) - 1])(
    "refuses permissions %s that do not fit in 32 bits before any request",
    async permissions => {
      await expect(
        createSdk().addMember(
          trustchain,
          ALICE,
          { ...agentA, permissions },
          { deviceId: "device" },
        ),
      ).rejects.toThrow(`permissions ${permissions} do not fit in 32 bits`);
      expect(hw.withJwt).not.toHaveBeenCalled();
    },
  );

  it("refuses an existing stream below a closed ancestor stream before asking the device", async () => {
    const below = `${AGENT}/3'/0'`;
    serve(
      await buildTree(share(APP, alice), share(AGENT, agentA), share(below, agentA), close(AGENT)),
    );

    await expect(
      createSdk().addMember(trustchain, ALICE, agentB, { deviceId: "device", path: below }),
    ).rejects.toThrow(
      `stream ${below} must be below open streams of the latest generation (${AGENT})`,
    );
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("names the newer generation to a member without a device too", async () => {
    serve(await buildTree(share(APP, alice), share(`${APP}/7'/1'`, agentA)));

    await expect(
      createSdk().addMember(trustchain, ALICE, agentB, { path: `${APP}/7'/0'` }),
    ).rejects.toThrow(`stream ${APP}/7'/0' was replaced by ${APP}/7'/1'`);
  });

  it.each<[string, TrustchainStep[], string, AddMemberOptions | undefined]>([
    ["the application stream", [share(APP, alice), share(APP, agentA)], APP, undefined],
    [
      "the stream at the given path",
      [share(APP, alice), share(SUBTREE, agentA)],
      SUBTREE,
      { deviceId: "device", path: SUBTREE },
    ],
  ])(
    "refuses a member already in %s with other permissions",
    async (_name, steps, path, options) => {
      serve(await buildTree(...steps));

      await expect(
        createSdk().addMember(
          trustchain,
          ALICE,
          { ...agentA, permissions: Permissions.OWNER },
          options,
        ),
      ).rejects.toThrow(
        `member ${agentA.id} is already in ${path} with permissions ${Permissions.KEY_READER}`,
      );
      expect(api.putCommands).not.toHaveBeenCalled();
      expect(hw.withHw).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["the application stream", [share(NEXT_APP, alice)], APP, NEXT_APP],
    [
      "an agent stream",
      [share(APP, alice), share(`${APP}/7'/1'`, agentA)],
      `${APP}/7'/0'`,
      `${APP}/7'/1'`,
    ],
    [
      "an agent stream still listed beside it",
      [share(APP, alice), share(AGENT, agentA), share(`${APP}/7'/1'`, agentA)],
      AGENT,
      `${APP}/7'/1'`,
    ],
  ])(
    "refuses a generation of %s replaced by a newer one before asking the device",
    async (_name, steps, replaced, newer) => {
      serve(await buildTree(...steps));

      await expect(
        createSdk().addMember(trustchain, ALICE, agentB, { deviceId: "device", path: replaced }),
      ).rejects.toThrow(`stream ${replaced} was replaced by ${newer}`);
      expect(api.postDerivation).not.toHaveBeenCalled();
      expect(hw.withHw).not.toHaveBeenCalled();
    },
  );

  it("signs with a member that is only in the stream at the given path", async () => {
    const agentKeyPair = crypto.randomKeypair();
    const agent = {
      id: crypto.to_hex(agentKeyPair.publicKey),
      name: "agent",
      permissions: Permissions.OWNER,
    };
    serve(await buildTree(share(APP, alice), share(SUBTREE, agent)));
    api.authenticate.mockReturnValue({
      access_token: "SOFTWARE JWT",
      permissions: { ROOTID: { [SUBTREE]: "ffffffff" } },
    });
    const agentCredentials = {
      pubkey: agent.id,
      privatekey: crypto.to_hex(agentKeyPair.privateKey),
    };

    await createSdk().addMember(trustchain, agentCredentials, agentB, { path: SUBTREE });

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: SUBTREE, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentB.id);
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it.each<[string, AddMemberOptions]>([
    ["without a device", { path: SUBTREE }],
    ["with a device", { path: SUBTREE, deviceId: "device" }],
  ])("refuses a missing stream %s", async (_name, options) => {
    serve(await buildTree(share(APP, alice)));

    await expect(createSdk().addMember(trustchain, ALICE, agentA, options)).rejects.toThrow(
      `stream ${SUBTREE} is missing, create it with createStreamWithDevice`,
    );
    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each([
    ["a new member", agentB],
    ["a member already in it", agentA],
  ])("refuses a closed stream for %s", async (_name, member) => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA), close(SUBTREE)));

    await expect(
      createSdk().addMember(trustchain, ALICE, member, { deviceId: "device", path: SUBTREE }),
    ).rejects.toThrow(`stream ${SUBTREE} is closed`);
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a closed application stream without options, as restoreTrustchain", async () => {
    serve(await buildTree(share(APP, alice), close(APP)));

    const added = createSdk().addMember(trustchain, ALICE, agentA);

    await expect(added).rejects.toBeInstanceOf(TrustchainEjected);
    await expect(added).rejects.toThrow(`application stream ${APP} is closed`);
    expect(api.putCommands).not.toHaveBeenCalled();
  });

  it("does not type callbacks without a device", () => {
    // @ts-expect-error callbacks are for the device
    const options: AddMemberOptions = { path: SUBTREE, callbacks: {} };
    expect(options.path).toBe(SUBTREE);
  });

  it("passes the device callbacks to the device", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await createSdk().addMember(trustchain, ALICE, agentB, {
      deviceId: "device",
      path: SUBTREE,
      callbacks,
    });

    expect(hw.withJwt.mock.calls).toEqual([
      ["device", expect.any(Function), "cache", callbacks],
      ["device", expect.any(Function), "cache", callbacks],
    ]);
    expect(hw.withHw).toHaveBeenCalledWith("device", expect.any(Function), callbacks);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
  });

  it.each([
    "m/",
    "m/0'",
    "m/0'/18'",
    "m/0'/18'/",
    "m/0'/18'/0'/",
    "m/0'/18'/0'/7'x",
    "m/0'/18'/0'/7/0",
    "m/0'/18'/abc",
    "m/0'/018'/0'",
    "m/0'/18'/0'/7'",
    "m/0'/18'/0'/7'/0'/3'",
    "m/0'/18'/0'/7'/2147483648'",
    "m/0'/18'/0'/7'/4294967296'",
  ])("rejects the path %s", async path => {
    await expect(
      createSdk().addMember(trustchain, ALICE, agentA, { deviceId: "device", path }),
    ).rejects.toThrow(
      `path ${path} must be m/0'/<application>'/<generation>' followed by any number of hardened <object>'/<generation>' pairs`,
    );
    expect(hw.withJwt).not.toHaveBeenCalled();
  });
});

describe("createStreamWithDevice", () => {
  it("creates the stream with the member, signed by the device", async () => {
    const tree = await buildTree(share(APP, alice));
    serve(tree);

    await createSdk().createStreamWithDevice("device", trustchain, SUBTREE, agentA);

    expect(api.putCommands).not.toHaveBeenCalled();
    expect(await postedMembers(tree, SUBTREE)).toEqual([agentA]);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
    expect(api.authenticate).not.toHaveBeenCalled();
  });

  it("creates a stream below open ancestor streams of the latest generation", async () => {
    const tree = await buildTree(share(APP, alice), share(AGENT, agentA));
    serve(tree);

    await createSdk().createStreamWithDevice("device", trustchain, `${AGENT}/3'/0'`, agentB);

    expect(await postedMembers(tree, `${AGENT}/3'/0'`)).toEqual([agentB]);
  });

  it("passes the callbacks to the device", async () => {
    serve(await buildTree(share(APP, alice)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await createSdk().createStreamWithDevice("device", trustchain, SUBTREE, agentA, callbacks);

    expect(hw.withJwt.mock.calls).toEqual([
      ["device", expect.any(Function), "cache", callbacks],
      ["device", expect.any(Function), "cache", callbacks],
    ]);
    expect(hw.withHw).toHaveBeenCalledWith("device", expect.any(Function), callbacks);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an open stream", [share(APP, alice), share(SUBTREE, agentA)]],
    ["a closed stream", [share(APP, alice), share(SUBTREE, agentA), close(SUBTREE)]],
  ])("refuses %s that already exists before asking the device", async (_name, steps) => {
    serve(await buildTree(...steps));

    await expect(
      createSdk().createStreamWithDevice("device", trustchain, SUBTREE, agentB),
    ).rejects.toThrow(`stream ${SUBTREE} already exists`);
    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a generation replaced by a newer one before asking the device", async () => {
    serve(await buildTree(share(APP, alice), share(`${APP}/7'/1'`, agentA)));

    await expect(
      createSdk().createStreamWithDevice("device", trustchain, AGENT, agentB),
    ).rejects.toThrow(`stream ${AGENT} was replaced by ${APP}/7'/1'`);
    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each<[string, TrustchainStep[], string, string]>([
    [
      "an application stream replaced by a newer one",
      [share(APP, alice), share(NEXT_APP, alice)],
      AGENT,
      APP,
    ],
    ["a closed application stream", [share(APP, alice), close(APP)], AGENT, APP],
    ["a missing application stream", [share(APP, alice)], "m/0'/18'/5'/7'/0'", "m/0'/18'/5'"],
    [
      "an agent stream replaced by a newer one",
      [share(APP, alice), share(AGENT, agentA), share(`${APP}/7'/1'`, agentA)],
      `${AGENT}/3'/0'`,
      AGENT,
    ],
    [
      "a closed agent stream",
      [share(APP, alice), share(AGENT, agentA), close(AGENT)],
      `${AGENT}/3'/0'`,
      AGENT,
    ],
    ["a missing agent stream", [share(APP, alice)], `${AGENT}/3'/0'`, AGENT],
  ])("refuses a stream below %s before asking the device", async (_name, steps, path, ancestor) => {
    serve(await buildTree(...steps));

    await expect(
      createSdk().createStreamWithDevice("device", trustchain, path, agentB),
    ).rejects.toThrow(
      `stream ${path} must be below open streams of the latest generation (${ancestor})`,
    );
    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses permissions that do not fit in 32 bits before any request", async () => {
    await expect(
      createSdk().createStreamWithDevice("device", trustchain, SUBTREE, {
        ...agentA,
        permissions: 2 ** 32,
      }),
    ).rejects.toThrow(`permissions ${2 ** 32} do not fit in 32 bits`);
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it.each(["m/0'/18'", "m/0'/18'/0'/7'"])("rejects the path %s", async path => {
    await expect(
      createSdk().createStreamWithDevice("device", trustchain, path, agentA),
    ).rejects.toThrow(
      `path ${path} must be m/0'/<application>'/<generation>' followed by any number of hardened <object>'/<generation>' pairs`,
    );
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it("lets restoreTrustchain return the next application stream after a rotation", async () => {
    const tree = await buildTree(share(APP, alice), share(APP, agentA));
    serve(tree);

    await createSdk().createStreamWithDevice("device", trustchain, NEXT_APP, alice);
    const rotated = await postedTree(tree, NEXT_APP);
    serve(rotated);

    const restored = await createSdk().restoreTrustchain(trustchain, ALICE);
    const key = await device.readKey(rotated, DerivationPath.toIndexArray(NEXT_APP));
    expect(restored).toEqual({
      rootId: "ROOTID",
      applicationPath: NEXT_APP,
      walletSyncEncryptionKey: crypto.to_hex(key.slice(0, 32)),
    });
  });
});

describe("closeStreamWithDevice", () => {
  it("closes an open stream with the device", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await expect(createSdk().closeStreamWithDevice("device", trustchain, SUBTREE)).resolves.toBe(
      true,
    );

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: SUBTREE, blocks: [expect.any(String)] }]);
    expect(commandTypes(requests[0].blocks[0])).toEqual([CommandType.CloseStream]);
    expect(hw.refreshJwt).toHaveBeenCalledTimes(1);
  });

  it("reports the close when refreshing the device login afterwards fails", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));
    hw.refreshJwt.mockRejectedValue(new Error("UserRefusedOnDevice"));

    await expect(createSdk().closeStreamWithDevice("device", trustchain, SUBTREE)).resolves.toBe(
      true,
    );

    expect(api.putCommands).toHaveBeenCalledTimes(1);
    expect(hw.refreshJwt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["already closed", [share(APP, alice), share(SUBTREE, agentA), close(SUBTREE)]],
    ["missing", [share(APP, alice)]],
  ])("does nothing when the stream is %s", async (_name, steps) => {
    serve(await buildTree(...steps));

    await expect(createSdk().closeStreamWithDevice("device", trustchain, SUBTREE)).resolves.toBe(
      false,
    );

    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
    expect(hw.refreshJwt).not.toHaveBeenCalled();
  });

  it("accepts the largest hardened index", async () => {
    serve(await buildTree(share(APP, alice)));

    await expect(
      createSdk().closeStreamWithDevice("device", trustchain, "m/0'/18'/0'/7'/2147483647'"),
    ).resolves.toBe(false);
  });

  it.each([
    "m/",
    "m/0'/18'",
    "m/0'/18'/0'/",
    "m/0'/18'/0'/7'x",
    "m/0'/18'/0'/7'",
    "m/0'/18'/0'/7'/2147483648'",
  ])("rejects the path %s", async path => {
    await expect(createSdk().closeStreamWithDevice("device", trustchain, path)).rejects.toThrow(
      `path ${path} must be m/0'/<application>'/<generation>' followed by any number of hardened <object>'/<generation>' pairs`,
    );
    expect(hw.withJwt).not.toHaveBeenCalled();
  });
});

function createSdk(): SDK {
  return new SDK(
    { applicationId: 18, name: "alice", apiBaseUrl: TRUSTCHAIN_API_STAGING },
    hw as unknown as HWDeviceProvider,
  );
}

function agentMember(name: string): TrustchainMember {
  const { publicKey } = crypto.randomKeypair();
  return { id: crypto.to_hex(publicKey), name, permissions: Permissions.KEY_READER };
}

type TrustchainStep = (tree: StreamTree) => Promise<StreamTree>;

function buildTree(...steps: TrustchainStep[]): Promise<StreamTree> {
  return steps.reduce<Promise<StreamTree>>(
    (tree, step) => tree.then(step),
    StreamTree.createNewTree(device),
  );
}

function share(path: string, member: TrustchainMember): TrustchainStep {
  return tree =>
    tree.share(path, device, crypto.from_hex(member.id), member.name, member.permissions);
}

function close(path: string): TrustchainStep {
  return tree => tree.close(path, device);
}

function serve(tree: StreamTree): void {
  api.getTrustchain.mockReturnValue(tree.serialize());
}

function requestBodies<T extends DefaultBodyType>(
  mock: jest.Mock<object, [StrictRequest<T>]>,
): Promise<T[]> {
  return Promise.all(mock.mock.calls.map(([request]) => request.json()));
}

async function postedTree(tree: StreamTree, path: string): Promise<StreamTree> {
  const [posted] = await requestBodies(api.postDerivation);
  return StreamTree.deserialize({ ...tree.serialize(), [path]: posted });
}

async function postedMembers(tree: StreamTree, path: string): Promise<TrustchainMember[]> {
  const stream = (await postedTree(tree, path)).getChild(path);
  if (!stream) throw new Error(`no stream was posted at ${path}`);
  return (await stream.resolve()).getMembersData();
}

function commandTypes(block: string): CommandType[] {
  return CommandStreamDecoder.decode(crypto.from_hex(block)).flatMap(decoded =>
    decoded.commands.map(command => command.getType()),
  );
}
