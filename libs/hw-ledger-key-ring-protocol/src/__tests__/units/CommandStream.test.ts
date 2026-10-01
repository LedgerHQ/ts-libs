import { device, DerivationPath, Permissions, StreamTree } from "../..";
import { AddMember, CloseStream, createCommandBlock, Derive, Seed } from "../../CommandBlock";
import CommandStream from "../../CommandStream";
import { ISSUER_PLACEHOLDER } from "../../Device";

const PATH_STRING = "m/0'/16'/0'";
const PATH = DerivationPath.toIndexArray(PATH_STRING);

function emptySeed() {
  return new Seed(null, 0, new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array());
}

describe("CommandStream", () => {
  it("has no path and no public key when empty", async () => {
    const stream = new CommandStream();
    expect(stream.getStreamPath()).toBeNull();
    await expect(stream.getStreamPublicKey()).rejects.toThrow("Empty CommandStream");
  });

  it("uses the empty path for a seed stream and exposes its group key", async () => {
    const tree = await StreamTree.createNewTree(device.software());
    const root = tree.getRoot();
    expect(root.getStreamPath()).toBe("");
    expect((await root.getStreamPublicKey()).length).toBe(33);
    expect(root.getRootHash()).toHaveLength(32);
  });

  it("uses the derivation path for a derived stream and exposes its group key", async () => {
    const alice = device.software();
    const bobKey = (await device.software().getPublicKey()).publicKey;
    let tree = await StreamTree.createNewTree(alice);
    tree = await tree.share(PATH_STRING, alice, bobKey, "Bob", Permissions.OWNER);
    const stream = tree.getChild(PATH);
    if (!stream) throw new Error("missing stream");
    expect(stream.getStreamPath()).toBe(PATH_STRING);
    expect((await stream.getStreamPublicKey()).length).toBe(33);
    expect(stream.getRootHash()).not.toEqual(tree.getRoot().getRootHash());
  });

  it("rejects a stream that starts with something else than a seed or a derive", async () => {
    const block = createCommandBlock(ISSUER_PLACEHOLDER, [new CloseStream()]);
    const stream = new CommandStream([block]);
    expect(() => stream.getStreamPath()).toThrow("Malformed CommandStream");
    await expect(stream.getStreamPublicKey()).rejects.toThrow("Malformed CommandStream");
  });

  it("rejects a stream whose first block has no command", async () => {
    const stream = new CommandStream([createCommandBlock(ISSUER_PLACEHOLDER, [])]);
    await expect(stream.getStreamPublicKey()).rejects.toThrow("Empty CommandStream");
  });

  it("refuses to push an empty block", async () => {
    const block = createCommandBlock(ISSUER_PLACEHOLDER, []);
    await expect(new CommandStream().push(block, device.software(), null)).rejects.toThrow(
      "Attempts to create an empty block",
    );
  });

  it("refuses to issue a non seed block without a tree", async () => {
    await expect(new CommandStream().issue(device.software(), [new CloseStream()])).rejects.toThrow(
      "Null or empty tree cannot be used to sign the new block",
    );
  });

  it("issues a seed block on an empty stream and chains further blocks", async () => {
    const alice = device.software();
    const bobKey = (await device.software().getPublicKey()).publicKey;
    const stream = await new CommandStream().issue(alice, [emptySeed()]);
    expect(stream.blocks).toHaveLength(1);
    const tree = StreamTree.from(stream);
    const next = await stream.issue(
      alice,
      [new AddMember("Bob", bobKey, Permissions.KEY_READER)],
      tree,
    );
    expect(next.blocks).toHaveLength(2);
    const resolved = await next.resolve();
    expect(resolved.getMembers()).toHaveLength(2);
  });

  it("does not mutate the original stream when issuing", async () => {
    const alice = device.software();
    const stream = await seedStream(alice);
    const tree = StreamTree.from(stream);
    await stream.issue(alice, [new CloseStream()], tree);
    expect(stream.blocks).toHaveLength(1);
  });
});

async function seedStream(owner = device.software()) {
  return new CommandStream().issue(owner, [emptySeed()]);
}

describe("CommandStreamIssuer", () => {
  it("chains all steps in a single block", async () => {
    const alice = device.software();
    const bobKey = (await device.software().getPublicKey()).publicKey;
    const tree = await StreamTree.createNewTree(alice);
    const stream = await tree
      .getRoot()
      .edit()
      .addMember("Bob", bobKey, Permissions.KEY_READER, false)
      .publishKey(bobKey)
      .issue(alice, tree);
    expect(stream.blocks).toHaveLength(2);
    expect(stream.blocks[1].commands.map(c => c.getType())).toEqual([0x11, 0x12]);
    const resolved = await stream.resolve();
    expect(resolved.ownsKey(bobKey)).toBe(true);
  });

  it("adds a member together with its key by default", async () => {
    const alice = device.software();
    const bobKey = (await device.software().getPublicKey()).publicKey;
    const tree = await StreamTree.createNewTree(alice);
    const stream = await tree
      .getRoot()
      .edit()
      .addMember("Bob", bobKey, Permissions.KEY_READER)
      .issue(alice, tree);
    expect(stream.blocks[1].commands).toHaveLength(2);
    expect((await stream.resolve()).ownsKey(bobKey)).toBe(true);
  });

  it("closes a stream", async () => {
    const alice = device.software();
    const tree = await StreamTree.createNewTree(alice);
    const stream = await tree.getRoot().edit().close().issue(alice, tree);
    expect((await stream.resolve()).isClosed()).toBe(true);
  });

  it("chains onto an explicit parent hash for a derived stream", async () => {
    const alice = device.software();
    const bobKey = (await device.software().getPublicKey()).publicKey;
    const tree = await StreamTree.createNewTree(alice);
    const root = tree.getRoot().getRootHash();
    const stream = await new CommandStream()
      .edit()
      .derive(PATH)
      .addMember("Bob", bobKey, Permissions.OWNER, true)
      .issue(alice, tree, root);
    expect(stream.blocks[0].commands[0]).toBeInstanceOf(Derive);
    expect(stream.blocks[0].parent).toEqual(root);
  });

  it("resolves an incomplete flag like a normal resolve", async () => {
    const stream = await seedStream();
    expect((await stream.resolve(true)).isCreated()).toBe(true);
  });
});
