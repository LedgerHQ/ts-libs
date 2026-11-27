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
import { TrustchainEjected, TrustchainOutdated } from "../../errors";
import { HWDeviceProvider } from "../../HWDeviceProvider";
import { SDK } from "../../sdk";
import { Trustchain, TrustchainMember } from "../../types";
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

  it("lists only the streams below the prefix when it ends with /", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await expect(
      createSdk().getStreams(trustchain, ALICE, { pathPrefix: `${APP}/` }),
    ).resolves.toEqual([{ path: SUBTREE, members: [agentA], closed: false }]);
    expect(hw.withJwt).not.toHaveBeenCalled();
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

describe("getApplicationStream", () => {
  it("returns the stream at the application path of the trustchain", async () => {
    serve(await buildTree(share(APP, alice), share(APP, agentA), share(SUBTREE, agentB)));

    await expect(createSdk().getApplicationStream(trustchain, ALICE)).resolves.toEqual({
      path: APP,
      members: [alice, agentA],
      closed: false,
    });
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it("reports a closed application stream", async () => {
    serve(await buildTree(share(APP, alice), close(APP)));

    await expect(createSdk().getApplicationStream(trustchain, ALICE)).resolves.toEqual({
      path: APP,
      members: [alice],
      closed: true,
    });
  });

  it("returns undefined for a replaced stream only without the permission check", async () => {
    // the backend lists and logs in only the latest generation
    serve(await buildTree(share(NEXT_APP, alice)));
    api.authenticate.mockReturnValue({
      access_token: "SOFTWARE JWT",
      permissions: { ROOTID: { [NEXT_APP]: "ffffffff" } },
    });

    await expect(createSdk().getApplicationStream(trustchain, ALICE)).rejects.toBeInstanceOf(
      TrustchainOutdated,
    );
    await expect(
      createSdk().getApplicationStream(trustchain, ALICE, { ignorePermissionsChecks: true }),
    ).resolves.toBeUndefined();
  });

  it("skips the permission check only when asked to", async () => {
    serve(await buildTree(share(APP, alice)));
    api.authenticate.mockReturnValue({ access_token: "SOFTWARE JWT", permissions: {} });

    await expect(createSdk().getApplicationStream(trustchain, ALICE)).rejects.toThrow(
      "permissions not available for current trustchain",
    );
    await expect(
      createSdk().getApplicationStream(trustchain, ALICE, { ignorePermissionsChecks: true }),
    ).resolves.toEqual({ path: APP, members: [alice], closed: false });
  });

  it.each([SUBTREE, "m/0'/18'"])(
    "rejects the application path %s before any request",
    async applicationPath => {
      await expect(
        createSdk().getApplicationStream({ ...trustchain, applicationPath }, ALICE),
      ).rejects.toThrow(`path ${applicationPath} must be m/0'/<application>'/<generation>'`);
      expect(api.authenticate).not.toHaveBeenCalled();
    },
  );
});

describe("addMember", () => {
  it("signs with the member credentials", async () => {
    serve(await buildTree(share(APP, alice)));

    await createSdk().addMember(trustchain, ALICE, agentA);

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: APP, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentA.id);
    expect(api.authenticate).toHaveBeenCalledTimes(1);
    expect(hw.withJwt).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each([
    ["the same id", agentA.id],
    ["its id in upper case", agentA.id.toUpperCase()],
  ])("does nothing when the member is already there with %s", async (_name, id) => {
    serve(await buildTree(share(APP, alice), share(APP, agentA)));

    await createSdk().addMember(trustchain, ALICE, { ...agentA, id });

    expect(api.putCommands).not.toHaveBeenCalled();
  });

  it("does nothing when the member is already there with the same permissions as a signed mask", async () => {
    // OWNER & ~KEY_REVOKER is -5 in JS, the stream stores 0xfffffffb
    const signed = { ...agentA, permissions: Permissions.OWNER & ~Permissions.KEY_REVOKER };
    serve(await buildTree(share(APP, alice), share(APP, signed)));

    await createSdk().addMember(trustchain, ALICE, signed);

    expect(api.putCommands).not.toHaveBeenCalled();
  });

  it.each([2 ** 32 + 1, 1.5, -(2 ** 31) - 1])(
    "refuses permissions %s that do not fit in 32 bits before any request",
    async permissions => {
      await expect(
        createSdk().addMember(trustchain, ALICE, { ...agentA, permissions }),
      ).rejects.toThrow(`permissions ${permissions} do not fit in 32 bits`);
      expect(api.authenticate).not.toHaveBeenCalled();
    },
  );

  it("refuses a member already in the application stream with other permissions", async () => {
    serve(await buildTree(share(APP, alice), share(APP, agentA)));

    await expect(
      createSdk().addMember(trustchain, ALICE, { ...agentA, permissions: Permissions.OWNER }),
    ).rejects.toThrow(
      `member ${agentA.id} is already in ${APP} with permissions ${Permissions.KEY_READER}`,
    );
    expect(api.putCommands).not.toHaveBeenCalled();
  });

  it("refuses a closed application stream, as restoreTrustchain", async () => {
    serve(await buildTree(share(APP, alice), close(APP)));

    const added = createSdk().addMember(trustchain, ALICE, agentA);

    await expect(added).rejects.toBeInstanceOf(TrustchainEjected);
    await expect(added).rejects.toThrow(`application stream ${APP} is closed`);
    expect(api.putCommands).not.toHaveBeenCalled();
  });
});

describe("addMemberToApplicationWithDevice", () => {
  it("adds the member to the latest stream of the application, signed by the device", async () => {
    serve(await buildTree(share(APP, alice), close(APP), share(NEXT_APP, alice)));

    await expect(
      createSdk().addMemberToApplicationWithDevice("device", trustchain, agentA),
    ).resolves.toBe(NEXT_APP);

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: NEXT_APP, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentA.id);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
    expect(api.authenticate).not.toHaveBeenCalled();
  });

  it("uses the application of the trustchain, not the one of the SDK", async () => {
    const ledgerSync = "m/0'/16'/0'";
    serve(await buildTree(share(APP, alice), share(ledgerSync, alice)));

    await expect(
      createSdk().addMemberToApplicationWithDevice(
        "device",
        { ...trustchain, applicationPath: ledgerSync },
        agentA,
      ),
    ).resolves.toBe(ledgerSync);

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: ledgerSync, blocks: [expect.any(String)] }]);
  });

  it("resolves to the stream without a device signature when the member is already there", async () => {
    serve(await buildTree(share(APP, alice), share(APP, agentA)));

    await expect(
      createSdk().addMemberToApplicationWithDevice("device", trustchain, agentA),
    ).resolves.toBe(APP);

    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a closed latest stream before asking the device", async () => {
    serve(await buildTree(share(APP, alice), close(APP)));

    const added = createSdk().addMemberToApplicationWithDevice("device", trustchain, agentA);

    await expect(added).rejects.toThrow(`stream ${APP} is closed`);
    await expect(added).rejects.not.toBeInstanceOf(TrustchainEjected);
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a member already there with other permissions before asking the device", async () => {
    serve(await buildTree(share(APP, alice), share(APP, agentA)));

    await expect(
      createSdk().addMemberToApplicationWithDevice("device", trustchain, {
        ...agentA,
        permissions: Permissions.OWNER,
      }),
    ).rejects.toThrow(
      `member ${agentA.id} is already in ${APP} with permissions ${Permissions.KEY_READER}`,
    );
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses an application without a stream", async () => {
    serve(await buildTree(share(APP, alice)));

    await expect(
      createSdk().addMemberToApplicationWithDevice(
        "device",
        { ...trustchain, applicationPath: "m/0'/16'/0'" },
        agentA,
      ),
    ).rejects.toThrow("stream m/0'/16'/0' is missing, create it with createStreamWithDevice");
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses permissions that do not fit in 32 bits before any request", async () => {
    await expect(
      createSdk().addMemberToApplicationWithDevice("device", trustchain, {
        ...agentA,
        permissions: 2 ** 32,
      }),
    ).rejects.toThrow(`permissions ${2 ** 32} do not fit in 32 bits`);
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it.each([SUBTREE, "m/0'/18'"])(
    "rejects the application path %s before any request",
    async applicationPath => {
      await expect(
        createSdk().addMemberToApplicationWithDevice(
          "device",
          { ...trustchain, applicationPath },
          agentA,
        ),
      ).rejects.toThrow(`path ${applicationPath} must be m/0'/<application>'/<generation>'`);
      expect(hw.withJwt).not.toHaveBeenCalled();
    },
  );

  it("passes the callbacks to the device", async () => {
    serve(await buildTree(share(APP, alice)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await createSdk().addMemberToApplicationWithDevice("device", trustchain, agentA, callbacks);

    expect(hw.withJwt.mock.calls).toEqual([
      ["device", expect.any(Function), "cache", callbacks],
      ["device", expect.any(Function), "cache", callbacks],
    ]);
    expect(hw.withHw).toHaveBeenCalledWith("device", expect.any(Function), callbacks);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
  });
});

describe("addMemberToStreamWithDevice", () => {
  it("adds the member to the existing stream at the given path", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, agentB);

    expect(api.postDerivation).not.toHaveBeenCalled();
    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: SUBTREE, blocks: [expect.any(String)] }]);
    expect(requests[0].blocks[0]).toContain(agentB.id);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
    expect(api.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ["the same id", agentA.id],
    ["its id in upper case", agentA.id.toUpperCase()],
  ])("does nothing when the member is already there with %s", async (_name, id) => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, {
      ...agentA,
      id,
    });

    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("does nothing when the member is already there with the same permissions as a signed mask", async () => {
    // OWNER & ~KEY_REVOKER is -5 in JS, the stream stores 0xfffffffb
    const signed = { ...agentA, permissions: Permissions.OWNER & ~Permissions.KEY_REVOKER };
    serve(await buildTree(share(APP, alice), share(SUBTREE, signed)));

    await createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, signed);

    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each([2 ** 32 + 1, 1.5, -(2 ** 31) - 1])(
    "refuses permissions %s that do not fit in 32 bits before any request",
    async permissions => {
      await expect(
        createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, {
          ...agentA,
          permissions,
        }),
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
      createSdk().addMemberToStreamWithDevice("device", trustchain, below, agentB),
    ).rejects.toThrow(
      `stream ${below} must be below open streams of the latest generation (${AGENT})`,
    );
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a member already in the stream with other permissions", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await expect(
      createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, {
        ...agentA,
        permissions: Permissions.OWNER,
      }),
    ).rejects.toThrow(
      `member ${agentA.id} is already in ${SUBTREE} with permissions ${Permissions.KEY_READER}`,
    );
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

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
        createSdk().addMemberToStreamWithDevice("device", trustchain, replaced, agentB),
      ).rejects.toThrow(`stream ${replaced} was replaced by ${newer}`);
      expect(api.postDerivation).not.toHaveBeenCalled();
      expect(hw.withHw).not.toHaveBeenCalled();
    },
  );

  it("refuses a missing stream", async () => {
    serve(await buildTree(share(APP, alice)));

    await expect(
      createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, agentA),
    ).rejects.toThrow(`stream ${SUBTREE} is missing, create it with createStreamWithDevice`);
    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each([
    ["a new member", agentB],
    ["a member already in it", agentA],
  ])("refuses a closed stream for %s", async (_name, member) => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA), close(SUBTREE)));

    const added = createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, member);

    await expect(added).rejects.toThrow(`stream ${SUBTREE} is closed`);
    await expect(added).rejects.not.toBeInstanceOf(TrustchainEjected);
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("passes the callbacks to the device", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await createSdk().addMemberToStreamWithDevice("device", trustchain, SUBTREE, agentB, callbacks);

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
      createSdk().addMemberToStreamWithDevice("device", trustchain, path, agentA),
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

describe("prepareApplicationStreamRotationWithDevice", () => {
  it("creates the next generation with only the retained member and returns the trustchain on it", async () => {
    const tree = await buildTree(share(APP, alice), share(APP, agentA));
    serve(tree);

    const rotated = await createSdk().prepareApplicationStreamRotationWithDevice(
      "device",
      trustchain,
      ALICE,
      alice,
    );

    const next = await postedTree(tree, NEXT_APP);
    expect((await next.getChild(NEXT_APP)?.resolve())?.getMembersData()).toEqual([alice]);
    const key = await device.readKey(next, DerivationPath.toIndexArray(NEXT_APP));
    expect(rotated).toEqual({
      rootId: "ROOTID",
      applicationPath: NEXT_APP,
      walletSyncEncryptionKey: crypto.to_hex(key.slice(0, 32)),
    });
    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).toHaveBeenCalledTimes(1);
    expect(api.authenticate).not.toHaveBeenCalled();
  });

  it("returns the next generation a previous call created without a device signature", async () => {
    const tree = await buildTree(share(APP, alice), share(NEXT_APP, alice));
    serve(tree);

    const rotated = await createSdk().prepareApplicationStreamRotationWithDevice(
      "device",
      trustchain,
      ALICE,
      { ...alice, id: alice.id.toUpperCase() },
    );

    const key = await device.readKey(tree, DerivationPath.toIndexArray(NEXT_APP));
    expect(rotated).toEqual({
      rootId: "ROOTID",
      applicationPath: NEXT_APP,
      walletSyncEncryptionKey: crypto.to_hex(key.slice(0, 32)),
    });
    expect(api.postDerivation).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it.each([
    ["another member too", [share(NEXT_APP, alice), share(NEXT_APP, agentA)]],
    ["the retained member with other permissions", [share(NEXT_APP, { ...alice, permissions: 1 })]],
  ])("refuses a next generation holding %s before asking the device", async (_name, steps) => {
    serve(await buildTree(share(APP, alice), ...steps));

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, alice),
    ).rejects.toThrow(`stream ${NEXT_APP} must hold only the retained member`);
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a closed next generation", async () => {
    serve(await buildTree(share(APP, alice), share(NEXT_APP, alice), close(NEXT_APP)));

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, alice),
    ).rejects.toThrow(`stream ${NEXT_APP} is closed`);
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a retained member other than the member of the credentials before any request", async () => {
    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, agentA),
    ).rejects.toThrow("the retained member must be the member of memberCredentials");
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it("refuses a retained member with other permissions than in the current generation", async () => {
    serve(await buildTree(share(APP, alice)));
    const retained = { ...alice, permissions: Permissions.KEY_READER };

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, retained),
    ).rejects.toThrow(
      `the retained member must be in ${APP} with permissions ${Permissions.KEY_READER}`,
    );
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a closed current generation before asking the device", async () => {
    serve(await buildTree(share(APP, alice), close(APP)));

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, alice),
    ).rejects.toThrow(`stream ${APP} is closed`);
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a missing current generation before asking the device", async () => {
    serve(await buildTree(share(APP, alice)));

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice(
        "device",
        { ...trustchain, applicationPath: NEXT_APP },
        ALICE,
        alice,
      ),
    ).rejects.toThrow(`stream ${NEXT_APP} is missing`);
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses a next generation already replaced by a newer one before asking the device", async () => {
    serve(await buildTree(share(APP, alice), share("m/0'/18'/2'", alice)));

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, alice),
    ).rejects.toThrow(`stream ${NEXT_APP} was replaced by m/0'/18'/2'`);
    expect(hw.withHw).not.toHaveBeenCalled();
  });

  it("refuses permissions that do not fit in 32 bits before any request", async () => {
    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice("device", trustchain, ALICE, {
        ...alice,
        permissions: 2 ** 32,
      }),
    ).rejects.toThrow(`permissions ${2 ** 32} do not fit in 32 bits`);
    expect(hw.withJwt).not.toHaveBeenCalled();
  });

  it.each([SUBTREE, "m/0'/18'"])(
    "rejects the application path %s before any request",
    async applicationPath => {
      await expect(
        createSdk().prepareApplicationStreamRotationWithDevice(
          "device",
          { ...trustchain, applicationPath },
          ALICE,
          alice,
        ),
      ).rejects.toThrow(`path ${applicationPath} must be m/0'/<application>'/<generation>'`);
      expect(hw.withJwt).not.toHaveBeenCalled();
    },
  );

  it("passes the callbacks to the device", async () => {
    serve(await buildTree(share(APP, alice)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await createSdk().prepareApplicationStreamRotationWithDevice(
      "device",
      trustchain,
      ALICE,
      alice,
      callbacks,
    );

    expect(hw.withJwt.mock.calls).toEqual([
      ["device", expect.any(Function), "cache", callbacks],
      ["device", expect.any(Function), "cache", callbacks],
    ]);
    expect(hw.withHw).toHaveBeenCalledWith("device", expect.any(Function), callbacks);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
  });

  it("drops the member login of the current generation", async () => {
    const tree = await buildTree(share(APP, alice));
    serve(tree);
    const sdk = createSdk();
    await sdk.getApplicationStream(trustchain, ALICE);

    const rotated = await sdk.prepareApplicationStreamRotationWithDevice(
      "device",
      trustchain,
      ALICE,
      alice,
    );
    serve(await postedTree(tree, NEXT_APP));
    api.authenticate.mockReturnValue({
      access_token: "SOFTWARE JWT",
      permissions: { ROOTID: { [NEXT_APP]: "ffffffff" } },
    });

    await expect(sdk.getApplicationStream(rotated, ALICE)).resolves.toEqual({
      path: NEXT_APP,
      members: [alice],
      closed: false,
    });
    expect(api.authenticate).toHaveBeenCalledTimes(2);
  });

  it("refuses a next generation past the largest hardened index before any request", async () => {
    const applicationPath = "m/0'/18'/2147483647'";

    await expect(
      createSdk().prepareApplicationStreamRotationWithDevice(
        "device",
        { ...trustchain, applicationPath },
        ALICE,
        alice,
      ),
    ).rejects.toThrow("path m/0'/18'/2147483648' must be m/0'/<application>'/<generation>'");
    expect(hw.withJwt).not.toHaveBeenCalled();
  });
});

describe("closeApplicationStreamWithDevice", () => {
  it("closes the application stream of the trustchain with the device", async () => {
    serve(await buildTree(share(APP, alice), share(SUBTREE, agentA)));

    await expect(createSdk().closeApplicationStreamWithDevice("device", trustchain)).resolves.toBe(
      true,
    );

    const requests = await requestBodies(api.putCommands);
    expect(requests).toEqual([{ path: APP, blocks: [expect.any(String)] }]);
    expect(commandTypes(requests[0].blocks[0])).toEqual([CommandType.CloseStream]);
    expect(hw.refreshJwt).toHaveBeenCalledTimes(1);
  });

  it("passes the callbacks to the device", async () => {
    serve(await buildTree(share(APP, alice)));
    const callbacks = { onStartRequestUserInteraction: jest.fn() };

    await createSdk().closeApplicationStreamWithDevice("device", trustchain, callbacks);

    expect(hw.withJwt.mock.calls).toEqual([
      ["device", expect.any(Function), "cache", callbacks],
      ["device", expect.any(Function), "cache", callbacks],
    ]);
    expect(hw.withHw).toHaveBeenCalledWith("device", expect.any(Function), callbacks);
    expect(hw.withHw).toHaveBeenCalledTimes(1);
    expect(hw.refreshJwt).toHaveBeenCalledWith("device", callbacks);
  });

  it.each([
    ["already closed", [share(APP, alice), close(APP)], APP],
    ["missing", [share(APP, alice)], NEXT_APP],
  ])("does nothing when the stream is %s", async (_name, steps, applicationPath) => {
    serve(await buildTree(...steps));

    await expect(
      createSdk().closeApplicationStreamWithDevice("device", { ...trustchain, applicationPath }),
    ).resolves.toBe(false);

    expect(api.putCommands).not.toHaveBeenCalled();
    expect(hw.withHw).not.toHaveBeenCalled();
    expect(hw.refreshJwt).not.toHaveBeenCalled();
  });

  it.each([SUBTREE, "m/0'/18'"])(
    "rejects the application path %s before any request",
    async applicationPath => {
      await expect(
        createSdk().closeApplicationStreamWithDevice("device", { ...trustchain, applicationPath }),
      ).rejects.toThrow(`path ${applicationPath} must be m/0'/<application>'/<generation>'`);
      expect(hw.withJwt).not.toHaveBeenCalled();
    },
  );
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
