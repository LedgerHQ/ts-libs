import { device, DerivationPath, Permissions, StreamTree, StreamTreeCipher } from "../..";
import { Device, SoftwareDevice } from "../../Device";
import { StreamTreeCipherMode } from "../../StreamTreeCipher";
import { crypto } from "../../Crypto";

const PATH_STRING = "m/0'/16'/0'";
const PATH = DerivationPath.toIndexArray(PATH_STRING);

async function sharedTree() {
  const alice = device.software();
  const bob = device.software();
  const bobKey = (await bob.getPublicKey()).publicKey;
  let tree = await StreamTree.createNewTree(alice);
  tree = await tree.share(PATH_STRING, alice, bobKey, "Bob", Permissions.OWNER);
  return { alice, bob, tree };
}

const message = new TextEncoder().encode("hello ring");

describe("StreamTreeCipher", () => {
  it("defaults to the GCM mode and exposes its mode", async () => {
    const cipher = StreamTreeCipher.create(device.software());
    expect(cipher.mode).toBe(StreamTreeCipherMode.AES_256_GCM);
    expect(new StreamTreeCipher(StreamTreeCipherMode.AES_256_CBC, device.software()).mode).toBe(
      StreamTreeCipherMode.AES_256_CBC,
    );
  });

  it("lets every member of the stream decrypt what another member encrypted", async () => {
    const { alice, bob, tree } = await sharedTree();
    const encrypted = await StreamTreeCipher.create(alice).encrypt(tree, PATH, message);
    expect(await StreamTreeCipher.create(alice).decrypt(tree, PATH, encrypted)).toEqual(message);
    expect(await StreamTreeCipher.create(bob).decrypt(tree, PATH, encrypted)).toEqual(message);
  });

  it("prepends the mode, ephemeral key and nonce to the ciphertext", async () => {
    const { alice, tree } = await sharedTree();
    const nonce = crypto.randomBytes(16);
    const encrypted = await StreamTreeCipher.create(alice).encrypt(tree, PATH, message, nonce);
    expect(encrypted[0]).toBe(StreamTreeCipherMode.AES_256_GCM);
    expect(encrypted.slice(34, 50)).toEqual(nonce);
    expect(await StreamTreeCipher.create(alice).decrypt(tree, PATH, encrypted)).toEqual(message);
  });

  it("uses a fresh nonce and ephemeral key on every encryption", async () => {
    const { alice, tree } = await sharedTree();
    const cipher = StreamTreeCipher.create(alice);
    const a = await cipher.encrypt(tree, PATH, message);
    const b = await cipher.encrypt(tree, PATH, message);
    expect(a).not.toEqual(b);
    expect(a.slice(1, 34)).not.toEqual(b.slice(1, 34));
  });

  it("encrypts on the root path", async () => {
    const { alice, tree } = await sharedTree();
    const cipher = StreamTreeCipher.create(alice);
    const encrypted = await cipher.encrypt(tree, [], message);
    expect(await cipher.decrypt(tree, [], encrypted)).toEqual(message);
  });

  it("refuses a device that has no key in the tree", async () => {
    const { tree } = await sharedTree();
    const stranger = StreamTreeCipher.create(device.software());
    await expect(stranger.encrypt(tree, PATH, message)).rejects.toThrow(
      "Cannot find key in the tree for the current device",
    );
  });

  it("refuses devices whose public key is not directly available", async () => {
    const { alice, tree } = await sharedTree();
    const hardware: Device = {
      getPublicKey: () => alice.getPublicKey(),
      isPublicKeyAvailable: () => false,
      sign: (stream, t) => alice.sign(stream, t),
      readKey: (t, path) => alice.readKey(t, path),
    };
    const cipher = StreamTreeCipher.create(hardware);
    await expect(cipher.encrypt(tree, PATH, message)).rejects.toThrow(
      "Stream tree cipher is only available for software devices",
    );
    await expect(cipher.decrypt(tree, PATH, new Uint8Array(80))).rejects.toThrow(
      "Stream tree cipher is only available for software devices",
    );
  });

  it("rejects an unknown cipher mode", async () => {
    const { alice, tree } = await sharedTree();
    const unknown: number = 0x7f;
    const cipher = new StreamTreeCipher(unknown, alice);
    await expect(cipher.encrypt(tree, PATH, message)).rejects.toThrow("Unknown cipher mode");
    const encrypted = await StreamTreeCipher.create(alice).encrypt(tree, PATH, message);
    await expect(cipher.decrypt(tree, PATH, encrypted)).rejects.toThrow("Unknown cipher mode");
  });

  it("fails to decrypt a tampered ciphertext", async () => {
    const { alice, tree } = await sharedTree();
    const cipher = StreamTreeCipher.create(alice);
    const encrypted = await cipher.encrypt(tree, PATH, message);
    encrypted[55] ^= 0xff;
    await expect(cipher.decrypt(tree, PATH, encrypted)).rejects.toThrow(/invalid ghash tag/);
  });

  it("fails to decrypt with a device that is not part of the stream", async () => {
    const { alice, tree } = await sharedTree();
    const encrypted = await StreamTreeCipher.create(alice).encrypt(tree, PATH, message);
    const outsider = new SoftwareDevice(crypto.randomKeypair());
    await expect(StreamTreeCipher.create(outsider).decrypt(tree, PATH, encrypted)).rejects.toThrow(
      "Cannot find key in the tree for the current device",
    );
  });
});
