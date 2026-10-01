import { DerivationPath, Permissions, StreamTree } from "../..";
import { AddMember, createCommandBlock, PublishKey, Derive, Seed } from "../../CommandBlock";
import CommandStream from "../../CommandStream";
import { crypto } from "../../Crypto";
import { createDevice, ISSUER_PLACEHOLDER, SoftwareDevice } from "../../Device";

const PATH_STRING = "m/0'/16'/0'";
const PATH = DerivationPath.toIndexArray(PATH_STRING);

function emptySeed() {
  return new Seed(null, 0, new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array());
}

describe("SoftwareDevice", () => {
  it("is created with a random key pair and exposes its public key", async () => {
    const a = createDevice();
    const b = createDevice();
    const keyA = (await a.getPublicKey()).publicKey;
    expect(keyA).toHaveLength(33);
    expect(keyA).not.toEqual((await b.getPublicKey()).publicKey);
    expect(a.isPublicKeyAvailable()).toBe(true);
  });

  it("exposes a 33 bytes issuer placeholder", () => {
    expect(ISSUER_PLACEHOLDER).toHaveLength(33);
  });

  it("refuses to sign an empty stream", async () => {
    await expect(createDevice().sign([])).rejects.toThrow("Cannot sign an empty stream");
  });

  it("refuses to sign an empty block", async () => {
    const block = createCommandBlock(ISSUER_PLACEHOLDER, []);
    await expect(createDevice().sign([block])).rejects.toThrow("Cannot sign an empty block");
  });

  it("sets itself as issuer and injects a key when signing a seed", async () => {
    const owner = createDevice();
    const block = createCommandBlock(ISSUER_PLACEHOLDER, [emptySeed()]);
    const signed = await owner.sign([block]);
    expect(signed.issuer).toEqual((await owner.getPublicKey()).publicKey);
    expect(signed.signature.length).toBeGreaterThan(0);
    const seed = signed.commands[0] as Seed;
    expect(seed.groupKey).not.toEqual(new Uint8Array(33));
    expect(seed.encryptedXpriv).not.toEqual(new Uint8Array(64));
  });

  it("refuses to sign a derive block without a tree", async () => {
    const block = createCommandBlock(ISSUER_PLACEHOLDER, [
      new Derive(PATH, new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array()),
    ]);
    await expect(createDevice().sign([block])).rejects.toThrow(
      "Cannot derive a key without a tree",
    );
  });

  it("refuses to derive a key it does not own in the tree", async () => {
    const tree = await StreamTree.createNewTree(createDevice());
    const stranger = createDevice();
    await expect(
      new CommandStream()
        .edit()
        .derive(PATH)
        .issue(stranger, tree, await tree.getRoot().getRootHash()),
    ).rejects.toThrow("Cannot find key in the tree for the current device");
  });

  it("refuses to publish the seed key from another device", async () => {
    const alice = createDevice();
    const bob = createDevice();
    const tree = await StreamTree.createNewTree(alice);
    const bobKey = (await bob.getPublicKey()).publicKey;
    const block = createCommandBlock(
      ISSUER_PLACEHOLDER,
      [new PublishKey(new Uint8Array(), new Uint8Array(), bobKey, new Uint8Array())],
      new Uint8Array(),
      crypto.randomBytes(32),
    );
    await expect(bob.sign(tree.getRoot().blocks.concat([block]))).rejects.toThrow(
      "Cannot read the seed key from another device",
    );
  });

  it("refuses to publish a derived stream key without owning any key of the tree", async () => {
    const alice = createDevice();
    const bob = createDevice();
    const carol = createDevice();
    const bobKey = (await bob.getPublicKey()).publicKey;
    const carolKey = (await carol.getPublicKey()).publicKey;
    let tree = await StreamTree.createNewTree(alice);
    tree = await tree.share(PATH_STRING, alice, bobKey, "Bob", Permissions.OWNER);
    const stream = tree.getChild(PATH);
    if (!stream) throw new Error("missing stream");
    const block = createCommandBlock(
      ISSUER_PLACEHOLDER,
      [new PublishKey(new Uint8Array(), new Uint8Array(), carolKey, new Uint8Array())],
      new Uint8Array(),
      crypto.randomBytes(32),
    );
    await expect(carol.sign(stream.blocks.concat([block]), tree)).rejects.toThrow(
      "Cannot find key in the tree for the current device",
    );
  });

  it("publishes a key for a new member so that the member can read it", async () => {
    const alice = createDevice();
    const bob = createDevice();
    const bobKey = (await bob.getPublicKey()).publicKey;
    const tree = await StreamTree.createNewTree(alice);
    const stream = await tree
      .getRoot()
      .edit()
      .addMember("Bob", bobKey, Permissions.MEMBER, false)
      .publishKey(bobKey)
      .issue(alice, tree);
    const resolved = await stream.resolve();
    expect(resolved.ownsKey(bobKey)).toBe(true);
    const updated = StreamTree.from(stream);
    expect((await bob.readKey(updated, [])).length).toBe(64);
  });

  it("reads the same key for every member of a stream", async () => {
    const alice = createDevice();
    const bob = createDevice();
    const bobKey = (await bob.getPublicKey()).publicKey;
    let tree = await StreamTree.createNewTree(alice);
    tree = await tree.share(PATH_STRING, alice, bobKey, "Bob", Permissions.OWNER);
    expect(await alice.readKey(tree, PATH)).toEqual(await bob.readKey(tree, PATH));
  });

  it("refuses to read a key that is not in the tree", async () => {
    const tree = await StreamTree.createNewTree(createDevice());
    await expect(new SoftwareDevice(crypto.randomKeypair()).readKey(tree, [])).rejects.toThrow(
      "Cannot find key in the tree for the current device",
    );
  });

  it("does not need a tree to sign an AddMember in an existing stream", async () => {
    const alice = createDevice();
    const tree = await StreamTree.createNewTree(alice);
    const member = crypto.randomKeypair().publicKey;
    const parent = tree.getRoot().blocks[0];
    const block = createCommandBlock(
      ISSUER_PLACEHOLDER,
      [new AddMember("M", member, Permissions.KEY_READER)],
      new Uint8Array(),
      crypto.hash(new Uint8Array()),
    );
    const signed = await alice.sign([parent, block]);
    expect(signed.signature.length).toBeGreaterThan(0);
  });
});
