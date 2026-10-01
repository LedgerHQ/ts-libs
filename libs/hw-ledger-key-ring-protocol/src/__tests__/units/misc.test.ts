import BigEndian from "../../BigEndian";
import { DerivationPath, crypto } from "../../Crypto";
import { IndexedTree } from "../../IndexedTree";
import { TLV, TLVTypes } from "../../tlv";
import { NobleCryptoSecp256k1, eccWrapper, to_hex } from "../../NobleCrypto";
import * as api from "../../index";

const hex = (bytes: Uint8Array | null | undefined) => Buffer.from(bytes ?? []).toString("hex");

describe("index exports", () => {
  it("exposes the public API", () => {
    expect(api.crypto).toBe(crypto);
    expect(api.TRUSTCHAIN_APP_NAME).toBe("Ledger Sync");
    expect(api.DerivationPath).toBe(DerivationPath);
    const exported = [
      api.StreamTree,
      api.StreamTreeCipher,
      api.CommandStreamEncoder,
      api.CommandStreamDecoder,
      api.CommandStream,
      api.CommandStreamJsonifier,
      api.SoftwareDevice,
      api.Challenge,
      api.PubKeyCredential,
      api.PublicKey,
      api.Permissions,
      api.AddMember,
      api.CloseStream,
      api.Derive,
      api.EditMember,
      api.PublishKey,
      api.Seed,
    ];
    expect(exported.every(e => e !== undefined)).toBe(true);
  });

  it("device.software creates a software device", () => {
    expect(api.device.software()).toBeInstanceOf(api.SoftwareDevice);
  });

  it("device.apdu is the ApduDevice factory", () => {
    expect(typeof api.device.apdu).toBe("function");
  });

  it("CommandStreamJsonifier subclass jsonifies an empty stream", () => {
    expect(api.CommandStreamJsonifier.jsonify([])).toEqual([]);
  });
});

describe("BigEndian", () => {
  it("roundtrips shorts", () => {
    expect(Array.from(BigEndian.shortToArray(0x1234))).toEqual([0x12, 0x34]);
    expect(BigEndian.arrayToShort(new Uint8Array([0x12, 0x34]))).toBe(0x1234);
  });

  it("roundtrips 32-bit numbers", () => {
    expect(Array.from(BigEndian.numberToArray(0xdeadbeef))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(BigEndian.arrayToNumber(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe(0xdeadbeef);
  });
});

describe("DerivationPath", () => {
  it("converts hardened indexes", () => {
    expect(DerivationPath.hardenedIndex(1)).toBe(0x80000001);
    expect(DerivationPath.reverseHardenedIndex(0x80000001)).toBe(1);
  });

  it("parses string paths with ' and h hardening and optional m/ prefix", () => {
    expect(DerivationPath.toIndexArray("m/16'/3h/2")).toEqual([0x80000010, 0x80000003, 2]);
    expect(DerivationPath.toIndexArray("1/2")).toEqual([1, 2]);
  });

  it("returns array paths unchanged", () => {
    const path = [1, 2];
    expect(DerivationPath.toIndexArray(path)).toBe(path);
  });

  it("formats paths and passes strings through", () => {
    expect(DerivationPath.toString([0x80000010, 3])).toBe("m/16'/3");
    expect(DerivationPath.toString("m/1/2")).toBe("m/1/2");
  });
});

describe("crypto helpers", () => {
  it("to_hex returns an empty string for missing bytes", () => {
    expect(to_hex()).toBe("");
    expect(to_hex(null)).toBe("");
    expect(crypto.to_hex(undefined)).toBe("");
  });

  it("from_hex and to_hex roundtrip", () => {
    expect(crypto.to_hex(crypto.from_hex("00ff10"))).toBe("00ff10");
  });

  it("hash is sha256", () => {
    expect(crypto.to_hex(crypto.hash(new Uint8Array()))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("computeSymmetricKey is deterministic and depends on both inputs", () => {
    const key = crypto.randomBytes(32);
    const a = crypto.computeSymmetricKey(key, new Uint8Array([1]));
    expect(hex(crypto.computeSymmetricKey(key, new Uint8Array([1])))).toBe(hex(a));
    expect(hex(crypto.computeSymmetricKey(key, new Uint8Array([2])))).not.toBe(hex(a));
  });

  it("derivePrivate is deterministic and yields distinct children", () => {
    const seed = crypto.randomBytes(64);
    const a = crypto.derivePrivate(seed, [0x80000000, 1]);
    const b = crypto.derivePrivate(seed, [0x80000000, 1]);
    const c = crypto.derivePrivate(seed, [0x80000000, 2]);
    expect(hex(a.privateKey)).toBe(hex(b.privateKey));
    expect(hex(a.privateKey)).not.toBe(hex(c.privateKey));
    expect(a.chainCode).toHaveLength(32);
  });

  it("sign and verify roundtrip, and reject a wrong message", () => {
    const kp = crypto.randomKeypair();
    const message = crypto.hash(new Uint8Array([1, 2, 3]));
    const signature = crypto.sign(message, kp);
    expect(crypto.verify(message, signature, kp.publicKey)).toBe(true);
    expect(crypto.verify(crypto.hash(new Uint8Array([4])), signature, kp.publicKey)).toBe(false);
  });

  it("randomBytes returns the requested size", () => {
    expect(crypto.randomBytes(7)).toHaveLength(7);
    expect(new NobleCryptoSecp256k1().randomBytes(0)).toHaveLength(0);
  });
});

describe("eccWrapper edge cases", () => {
  it("isPrivate rejects wrong length, zero and values >= curve order", () => {
    expect(eccWrapper.isPrivate(new Uint8Array(31).fill(1))).toBe(false);
    expect(eccWrapper.isPrivate(new Uint8Array(32))).toBe(false);
    expect(eccWrapper.isPrivate(new Uint8Array(32).fill(0xff))).toBe(false);
    expect(eccWrapper.isPrivate(Buffer.alloc(32, 1))).toBe(true);
  });

  it("isPoint rejects garbage", () => {
    expect(eccWrapper.isPoint(new Uint8Array(33).fill(5))).toBe(false);
    expect(eccWrapper.isPoint(new Uint8Array(0))).toBe(false);
  });

  it("pointFromScalar returns null for an invalid scalar", () => {
    expect(eccWrapper.pointFromScalar(new Uint8Array(32))).toBeNull();
  });

  it("privateAdd returns null for invalid inputs and for a zero sum", () => {
    const one = new Uint8Array(32);
    one[31] = 1;
    expect(eccWrapper.privateAdd(new Uint8Array(32), one)).toBeNull();
    expect(eccWrapper.privateAdd(one, new Uint8Array(32))).toBeNull();
    const nMinusOne = Buffer.from(
      "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140",
      "hex",
    );
    expect(eccWrapper.privateAdd(nMinusOne, one)).toBeNull();
  });

  it("privateAdd adds scalars modulo the curve order", () => {
    const one = new Uint8Array(32);
    one[31] = 1;
    const two = new Uint8Array(32);
    two[31] = 2;
    expect(hex(eccWrapper.privateAdd(one, one))).toBe(hex(two));
  });
});

const field = (type: number, value: number[]) => ({
  tlv: { type, value: new Uint8Array(value) },
  offset: 10,
});

describe("TLV", () => {
  it("readTLV/readAllTLV parse consecutive fields", () => {
    const buffer = new Uint8Array([1, 2, 0xaa, 0xbb, 5, 1, 0xcc]);
    expect(TLV.readTLV(buffer, 0)).toEqual({
      tlv: { type: 1, value: new Uint8Array([0xaa, 0xbb]) },
      offset: 4,
    });
    expect(TLV.readAllTLV(buffer, 0)).toEqual([
      { type: 1, value: new Uint8Array([0xaa, 0xbb]) },
      { type: 5, value: new Uint8Array([0xcc]) },
    ]);
    expect(TLV.readAllTLV(buffer, 4)).toHaveLength(1);
  });

  it("readVarInt left-pads short values", () => {
    expect(TLV.readVarInt(field(TLVTypes.VarInt, [0x01, 0x02]))).toEqual({
      value: 0x0102,
      offset: 10,
    });
    expect(TLV.readVarInt(field(TLVTypes.VarInt, [0x01, 0x02, 0x03, 0x04])).value).toBe(0x01020304);
  });

  it.each([
    ["readVarInt", "var int"],
    ["readBytes", "bytes"],
    ["readString", "string"],
    ["readHash", "hash"],
    ["readSignature", "signature"],
    ["readPublicKey", "public key"],
  ] as const)("%s throws on a wrong type", (fn, label) => {
    expect(() => TLV[fn](field(99, [1, 2, 3]))).toThrow(`Invalid type for ${label} (at offset 5))`);
  });

  it("typed readers return the value of matching fields", () => {
    expect(hex(TLV.readBytes(field(TLVTypes.Bytes, [1, 2])).value)).toBe("0102");
    expect(hex(TLV.readHash(field(TLVTypes.Hash, [3])).value)).toBe("03");
    expect(hex(TLV.readSignature(field(TLVTypes.Signature, [4])).value)).toBe("04");
    expect(hex(TLV.readPublicKey(field(TLVTypes.PublicKey, [5])).value)).toBe("05");
    expect(TLV.readString(field(TLVTypes.String, [0x68, 0x69])).value).toBe("hi");
  });

  it("readDerivationPath decodes 32-bit big endian indexes", () => {
    const read = field(TLVTypes.Bytes, [0x80, 0, 0, 1, 0, 0, 0, 2]);
    expect(TLV.readDerivationPath(read)).toEqual({ value: [0x80000001, 2], offset: 10 });
  });

  it("readNullOr returns null for Null fields and delegates otherwise", () => {
    expect(TLV.readNullOr(field(TLVTypes.Null, []), TLV.readBytes)).toEqual({
      value: null,
      offset: 10,
    });
    expect(hex(TLV.readNullOr(field(TLVTypes.Bytes, [7]), TLV.readBytes).value)).toBe("07");
  });

  it("push helpers encode type and length prefixes", () => {
    const empty = new Uint8Array();
    expect(hex(TLV.push(new Uint8Array([1]), new Uint8Array([2])))).toBe("0102");
    expect(hex(TLV.pushString(empty, "hi"))).toBe("04026869");
    expect(hex(TLV.pushByte(empty, 9))).toBe("010109");
    expect(hex(TLV.pushInt16(empty, 0x0102))).toBe("01020102");
    expect(hex(TLV.pushInt32(empty, 0x01020304))).toBe("010401020304");
    expect(hex(TLV.pushHash(empty, new Uint8Array([1])))).toBe("020101");
    expect(hex(TLV.pushSignature(empty, new Uint8Array([1])))).toBe("030101");
    expect(hex(TLV.pushBytes(empty, new Uint8Array([1])))).toBe("050101");
    expect(hex(TLV.pushNull(empty))).toBe("0000");
    expect(hex(TLV.pushPublicKey(empty, new Uint8Array([1])))).toBe("060101");
    expect(hex(TLV.pushDerivationPath(empty, [1, 0x80000002]))).toBe("05080000000180000002");
  });
});

describe("IndexedTree edge cases", () => {
  it("addChild with an empty path returns the same tree", () => {
    const tree = new IndexedTree<string>("root");
    expect(tree.addChild([], new IndexedTree("x"))).toBe(tree);
  });

  it("addChild creates missing intermediate nodes with null values", () => {
    const leaf = new IndexedTree("leaf");
    const tree = new IndexedTree<string>("root").addChild([1, 2], leaf);
    expect(tree.findChild([1])?.getValue()).toBeNull();
    expect(tree.findChild([1, 2])).toBe(leaf);
  });

  it("addChild replaces an existing subtree without mutating the original", () => {
    const original = new IndexedTree<string>("root").updateChild([1, 2], "old");
    const replaced = original.addChild([1, 2], new IndexedTree("new"));
    expect(original.findChild([1, 2])?.getValue()).toBe("old");
    expect(replaced.findChild([1, 2])?.getValue()).toBe("new");
  });

  it("getHighestIndex is 0 for a leaf and the max child index otherwise", () => {
    const tree = new IndexedTree<string>("root");
    expect(tree.getHighestIndex()).toBe(0);
    expect(tree.updateChild([3], "a").updateChild([7], "b").getHighestIndex()).toBe(7);
  });

  it("findChild returns undefined for unknown paths", () => {
    expect(new IndexedTree<string>("root").findChild([1])).toBeUndefined();
  });

  it("updateChild with an empty path replaces the node value and keeps children", () => {
    const tree = new IndexedTree<string>("root").updateChild([1], "child");
    const updated = tree.updateChild([], "new-root");
    expect(updated.getValue()).toBe("new-root");
    expect(updated.getChild(1)?.getValue()).toBe("child");
    expect(updated.getChildren().size).toBe(1);
  });
});
