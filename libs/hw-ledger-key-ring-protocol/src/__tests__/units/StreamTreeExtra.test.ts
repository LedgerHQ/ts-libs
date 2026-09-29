import { device, Permissions, StreamTree } from "../..";
import {
  CloseStream,
  createCommandBlock,
  hashCommandBlock,
  signCommandBlock,
} from "../../CommandBlock";
import CommandStream from "../../CommandStream";
import { crypto } from "../../Crypto";
import { SoftwareDevice } from "../../Device";

const APP = 16;

async function appTree() {
  const alice = device.software();
  const bob = device.software();
  const bobKey = (await bob.getPublicKey()).publicKey;
  let tree = await StreamTree.createNewTree(alice);
  const path = tree.getApplicationRootPath(APP);
  tree = await tree.share(path, alice, bobKey, "Bob", Permissions.OWNER);
  return { alice, bob, bobKey, tree, path };
}

describe("StreamTree structure", () => {
  it("rejects a tree whose root is null", () => {
    expect(() => StreamTree.deserialize({})).toThrow(
      "StreamTree.from requires the root of the tree",
    );
  });

  it("requires the root when building a tree from streams", async () => {
    const { tree, path } = await appTree();
    const stream = tree.getChild(path);
    if (!stream) throw new Error("missing stream");
    expect(() => StreamTree.from(stream)).toThrow("StreamTree.from requires the root of the tree");
  });

  it("rejects an empty stream in from and update", async () => {
    const { tree } = await appTree();
    expect(() => StreamTree.from(new CommandStream())).toThrow("Stream path cannot be null");
    expect(() => tree.update(new CommandStream())).toThrow("Stream path cannot be null");
  });

  it("computes application root paths with increments", async () => {
    const { tree, path } = await appTree();
    expect(path).toBe("m/0'/16'/0'");
    expect(tree.getApplicationRootPath(16, 1)).toBe("m/0'/16'/1'");
    expect(tree.getApplicationRootPath(99)).toBe("m/0'/99'/0'");
    expect(tree.getApplicationRootPath(99, 2)).toBe("m/0'/99'/2'");
  });

  it("returns null for an unknown child and accepts string or index paths", async () => {
    const { tree, path } = await appTree();
    expect(tree.getChild("m/0'/77'/0'")).toBeNull();
    expect(tree.getChild(path)).not.toBeNull();
    expect(tree.getChild([0x80000000, 0x80000010, 0x80000000])).toBe(tree.getChild(path));
  });

  it("round trips through serialize and deserialize", async () => {
    const { tree, path } = await appTree();
    const restored = StreamTree.deserialize(tree.serialize());
    expect(restored.getRoot().getRootHash()).toEqual(tree.getRoot().getRootHash());
    const original = tree.getChild(path);
    const copy = restored.getChild(path);
    if (!original || !copy) throw new Error("missing stream");
    expect(copy.getRootHash()).toEqual(original.getRootHash());
    expect(copy.blocks).toHaveLength(original.blocks.length);
  });
});

describe("StreamTree.getPublishKeyEvent", () => {
  it("finds the event of a member on the stream", async () => {
    const { tree, bobKey, path } = await appTree();
    const stream = tree.getChild(path);
    const indexes = [0x80000000, 0x80000010, 0x80000000];
    const event = await tree.getPublishKeyEvent(bobKey, indexes);
    expect(event?.stream).toBe(stream);
    expect(event?.groupPublicKey).toHaveLength(33);
    expect(event?.encryptedXpriv.length).toBeGreaterThan(0);
  });

  it("falls back on the closest ancestor when the path does not exist", async () => {
    const { alice, tree } = await appTree();
    const key = (await alice.getPublicKey()).publicKey;
    const event = await tree.getPublishKeyEvent(key, [0x80000000, 0x80000010, 0x80000000, 5]);
    expect(event?.stream.getStreamPath()).toBe("m/0'/16'/0'");
    const missingBranch = await tree.getPublishKeyEvent(key, [0x80000000, 0x80000063, 0x80000000]);
    expect(missingBranch?.stream).toBe(tree.getRoot());
  });

  it("returns null for a member that has no key anywhere on the path", async () => {
    const { tree } = await appTree();
    const stranger = crypto.randomKeypair().publicKey;
    expect(
      await tree.getPublishKeyEvent(stranger, [0x80000000, 0x80000010, 0x80000000]),
    ).toBeNull();
    expect(await tree.getPublishKeyEvent(stranger, [])).toBeNull();
  });
});

describe("StreamTree.hasAnotherOpenApplication", () => {
  it("skips the given application and treats an unresolvable stream as open", async () => {
    const { alice, tree, path } = await appTree();
    expect(await tree.hasAnotherOpenApplication(APP)).toBe(false);

    const stream = tree.getChild(path);
    if (!stream) throw new Error("missing stream");
    const issuer = crypto.randomKeypair();
    const bad = signCommandBlock(
      createCommandBlock(
        issuer.publicKey,
        [new CloseStream()],
        new Uint8Array(),
        hashCommandBlock(stream.blocks[stream.blocks.length - 1]),
      ),
      issuer.publicKey,
      issuer.privateKey,
    );
    const broken = tree.update(new CommandStream(stream.blocks.concat([bad])));
    expect(await broken.hasAnotherOpenApplication(APP)).toBe(false);
    expect(await broken.hasAnotherOpenApplication(99)).toBe(true);
    expect(alice).toBeInstanceOf(SoftwareDevice);
  });

  it("reports false once every other application is closed", async () => {
    const { alice, bobKey, tree } = await appTree();
    const otherPath = tree.getApplicationRootPath(17);
    let next = await tree.share(otherPath, alice, bobKey, "Bob", Permissions.OWNER);
    next = await next.close(otherPath, alice);
    expect(await next.hasAnotherOpenApplication(APP)).toBe(false);
    expect(await next.hasAnotherOpenApplication(17)).toBe(true);
  });
});

describe("StreamTree.share", () => {
  it("adds a member to an already created application stream", async () => {
    const { alice, tree, path } = await appTree();
    const carol = crypto.randomKeypair().publicKey;
    const next = await tree.share(path, alice, carol, "Carol", Permissions.KEY_READER);
    const stream = next.getChild(path);
    if (!stream) throw new Error("missing stream");
    const resolved = await stream.resolve();
    expect(resolved.ownsKey(carol)).toBe(true);
    expect(resolved.getMembersData().map(m => m.name)).toEqual(["Bob", "Carol"]);
  });

  it("accepts index array paths and can close through them", async () => {
    const { alice, tree } = await appTree();
    const indexes = [0x80000000, 0x80000010, 0x80000000];
    const closed = await tree.close(indexes, alice);
    const stream = closed.getChild(indexes);
    if (!stream) throw new Error("missing stream");
    expect((await stream.resolve()).isClosed()).toBe(true);
  });
});
