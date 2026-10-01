import { DerivationPath, Permissions, StreamTree } from "../..";
import {
  AddMember,
  CloseStream,
  Command,
  CommandBlock,
  createCommandBlock,
  hashCommandBlock,
  PublishKey,
  signCommandBlock,
} from "../../CommandBlock";
import CommandStream from "../../CommandStream";
import { crypto, KeyPair } from "../../Crypto";
import { SoftwareDevice } from "../../Device";

function member() {
  const keyPair = crypto.randomKeypair();
  return { keyPair, device: new SoftwareDevice(keyPair), publicKey: keyPair.publicKey };
}

function forge(issuer: KeyPair, commands: Command[], parent: Uint8Array): CommandBlock {
  const block = createCommandBlock(issuer.publicKey, commands, new Uint8Array(), parent);
  return signCommandBlock(block, issuer.publicKey, issuer.privateKey);
}

function append(stream: CommandStream, issuer: KeyPair, commands: Command[]) {
  const parent = hashCommandBlock(stream.blocks[stream.blocks.length - 1]);
  return new CommandStream(stream.blocks.concat([forge(issuer, commands, parent)]));
}

describe("ResolvedCommandStream accessors", () => {
  it("exposes creation state, members, topic, group key and keys", async () => {
    const alice = member();
    const bob = member();
    const topic = crypto.randomBytes(8);
    let tree = await StreamTree.createNewTree(alice.device, { topic });
    const root = await tree
      .getRoot()
      .edit()
      .addMember("Bob", bob.publicKey, Permissions.KEY_READER)
      .issue(alice.device, tree);
    const resolved = await root.resolve();
    expect(resolved.isCreated()).toBe(true);
    expect(resolved.isClosed()).toBe(false);
    expect(resolved.getTopic()).toEqual(topic);
    expect(resolved.getMembers()).toHaveLength(2);
    expect(resolved.getMembersData()).toEqual([
      { id: crypto.to_hex(bob.publicKey), name: "Bob", permissions: Permissions.KEY_READER },
    ]);
    expect(resolved.getGroupPublicKey()).toHaveLength(33);
    expect(resolved.getStreamDerivationPath()).toEqual([]);
    expect(resolved.keyCount()).toBe(2);
    expect(resolved.ownsKey(bob.publicKey)).toBe(true);
    expect(resolved.getEncryptedKey(bob.publicKey)?.issuer).toEqual(alice.publicKey);
    expect(resolved.getEncryptedKey(member().publicKey)).toBeNull();
  });

  it("reports permissions per member", async () => {
    const alice = member();
    const bob = member();
    const carol = member();
    let tree = await StreamTree.createNewTree(alice.device);
    const root = await tree
      .getRoot()
      .edit()
      .addMember("Bob", bob.publicKey, Permissions.KEY_READER)
      .addMember("Carol", carol.publicKey, Permissions.KEY_CREATOR | Permissions.ADD_MEMBER)
      .issue(alice.device, tree);
    const resolved = await root.resolve();
    expect(resolved.isOwner(alice.publicKey)).toBe(true);
    expect(resolved.isOwner(bob.publicKey)).toBe(false);
    expect(resolved.isKeyCreator(alice.publicKey)).toBe(true);
    expect(resolved.isKeyCreator(bob.publicKey)).toBe(false);
    expect(resolved.isKeyCreator(carol.publicKey)).toBe(true);
    expect(resolved.isMemberAdder(alice.publicKey)).toBe(true);
    expect(resolved.isMemberAdder(bob.publicKey)).toBe(false);
    expect(resolved.isMemberAdder(carol.publicKey)).toBe(true);
  });

  it("exposes the derivation path of a derived stream", async () => {
    const alice = member();
    let tree = await StreamTree.createNewTree(alice.device);
    const path = tree.getApplicationRootPath(16);
    tree = await tree.share(path, alice.device, member().publicKey, "Bob", Permissions.OWNER);
    const stream = tree.getChild(path);
    if (!stream) throw new Error("missing stream");
    expect((await stream.resolve()).getStreamDerivationPath()).toEqual(
      DerivationPath.toIndexArray(path),
    );
  });

  it("resolves an empty stream as not created", async () => {
    const resolved = await new CommandStream().resolve();
    expect(resolved.isCreated()).toBe(false);
    expect(resolved.getMembers()).toEqual([]);
  });
});

describe("CommandStreamResolver rejections", () => {
  it("rejects a command on a stream that was never created", async () => {
    const alice = member();
    const genesis = forge(alice.keyPair, [new CloseStream()], crypto.randomBytes(32));
    await expect(new CommandStream([genesis]).resolve()).rejects.toThrow(
      "The stream is not created at height 0",
    );
    const add = forge(
      alice.keyPair,
      [new AddMember("A", member().publicKey, 1)],
      crypto.randomBytes(32),
    );
    await expect(new CommandStream([add]).resolve()).rejects.toThrow("The stream is not created");
    const publish = forge(
      alice.keyPair,
      [
        new PublishKey(
          crypto.randomBytes(16),
          crypto.randomBytes(64),
          alice.publicKey,
          crypto.randomKeypair().publicKey,
        ),
      ],
      crypto.randomBytes(32),
    );
    await expect(new CommandStream([publish]).resolve()).rejects.toThrow(
      "The stream is not created",
    );
  });

  it("rejects a block signed by another key than its issuer", async () => {
    const alice = member();
    const attacker = member();
    const tree = await StreamTree.createNewTree(alice.device);
    const parent = hashCommandBlock(tree.getRoot().blocks[0]);
    const block = createCommandBlock(
      alice.publicKey,
      [new CloseStream()],
      new Uint8Array(),
      parent,
    );
    const forged = signCommandBlock(block, attacker.publicKey, attacker.keyPair.privateKey);
    const tampered = new CommandStream(tree.getRoot().blocks.concat([forged]));
    await expect(tampered.resolve()).rejects.toThrow("Invalid block signature at height 1");
  });

  it("rejects a block whose parent hash does not match", async () => {
    const alice = member();
    const tree = await StreamTree.createNewTree(alice.device);
    const block = forge(alice.keyPair, [new CloseStream()], crypto.randomBytes(32));
    const tampered = new CommandStream(tree.getRoot().blocks.concat([block]));
    await expect(tampered.resolve()).rejects.toThrow(/invalid parent hash\) at height 1/);
  });

  it("ignores blocks that are not signed yet", async () => {
    const alice = member();
    const tree = await StreamTree.createNewTree(alice.device);
    const parent = hashCommandBlock(tree.getRoot().blocks[0]);
    const unsigned = createCommandBlock(
      alice.publicKey,
      [new CloseStream()],
      new Uint8Array(),
      parent,
    );
    const stream = new CommandStream(tree.getRoot().blocks.concat([unsigned]));
    expect((await stream.resolve()).isClosed()).toBe(false);
  });

  it("rejects an AddMember from a member without the add member permission", async () => {
    const alice = member();
    const bob = member();
    let tree = await StreamTree.createNewTree(alice.device);
    const root = await tree
      .getRoot()
      .edit()
      .addMember("Bob", bob.publicKey, Permissions.KEY_READER)
      .issue(alice.device, tree);
    const tampered = append(root, bob.keyPair, [
      new AddMember("Bob2", member().publicKey, Permissions.KEY_READER),
    ]);
    await expect(tampered.resolve()).rejects.toThrow(/does not have permission to add members/);
  });

  it("rejects a PublishKey from a member with neither a key nor the key creator permission", async () => {
    const alice = member();
    const bob = member();
    const tree = await StreamTree.createNewTree(alice.device);
    const withBob = append(tree.getRoot(), alice.keyPair, [
      new AddMember("Bob", bob.publicKey, Permissions.MEMBER),
    ]);
    const tampered = append(withBob, bob.keyPair, [
      new PublishKey(
        crypto.randomBytes(16),
        crypto.randomBytes(64),
        bob.publicKey,
        crypto.randomKeypair().publicKey,
      ),
    ]);
    await expect(tampered.resolve()).rejects.toThrow(/does not have a key to publish/);
  });

  it("lets a member with the key creator permission publish without owning a key", async () => {
    const alice = member();
    const bob = member();
    const tree = await StreamTree.createNewTree(alice.device);
    const withBob = append(tree.getRoot(), alice.keyPair, [
      new AddMember("Bob", bob.publicKey, Permissions.KEY_CREATOR),
    ]);
    const published = append(withBob, bob.keyPair, [
      new PublishKey(
        crypto.randomBytes(16),
        crypto.randomBytes(64),
        bob.publicKey,
        crypto.randomKeypair().publicKey,
      ),
    ]);
    expect((await published.resolve()).ownsKey(bob.publicKey)).toBe(true);
  });

  it("does not let a member owner-less reseed a created stream", async () => {
    const alice = member();
    const tree = await StreamTree.createNewTree(alice.device);
    const closed = append(tree.getRoot(), alice.keyPair, [new CloseStream()]);
    expect((await closed.resolve()).isClosed()).toBe(true);
  });
});
