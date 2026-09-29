import Transport from "@ledgerhq/hw-transport";
import { APDU, ApduDevice, TRUSTCHAIN_APP_NAME, createApduDevice } from "../../ApduDevice";
import {
  AddMember,
  CloseStream,
  CommandBlock,
  Derive,
  EditMember,
  Permissions,
  PublishKey,
  Seed,
  createCommandBlock,
} from "../../CommandBlock";
import { KeyPair, crypto } from "../../Crypto";
import { PubKeyCredential } from "../../SeedId";
import { StreamTree } from "../../StreamTree";
import { TLV } from "../../tlv";
import { device as devices } from "../..";

const softwareDevice = () => devices.software();

const IV = 0x00;
const ISSUER_PUBLIC_KEY = 0x81;
const XPRIV = 0x82;
const EPHEMERAL_PUBLIC_KEY = 0x03;
const COMMAND_IV = 0x04;
const GROUP_KEY = 0x05;
const TRUSTED_MEMBER = 0x86;

const INS_GET_PUBLIC_KEY = 0x05;
const INS_INIT = 0x06;
const INS_SIGN_BLOCK = 0x07;
const INS_PARSE_STREAM = 0x08;
const INS_SET_TRUSTED_MEMBER = 0x09;

const SW_OK = Buffer.from([0x90, 0x00]);

function tlv(type: number, value: Uint8Array): Uint8Array {
  return TLV.pushTLV(new Uint8Array(), type, value.length, value);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return parts.reduce((acc, part) => TLV.push(acc, part), new Uint8Array());
}

function bytes(length: number, fill: number): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

function withStatus(data: Uint8Array, sw: Buffer = SW_OK): Buffer {
  return Buffer.concat([Buffer.from(data), sw]);
}

type Apdu = { ins: number; p1: number; p2: number; data: Buffer };

class FakeTransport extends Transport {
  apdus: Apdu[] = [];
  closed = false;
  handler: (apdu: Apdu) => Buffer = () => withStatus(new Uint8Array());

  async exchange(apdu: Buffer): Promise<Buffer> {
    const parsed = {
      ins: apdu[1],
      p1: apdu[2],
      p2: apdu[3],
      data: apdu.subarray(5),
    };
    this.apdus.push(parsed);
    return this.handler(parsed);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  inses(): number[] {
    return this.apdus.map(a => a.ins);
  }
}

class SimulatedDevice {
  keyPair: KeyPair = crypto.randomKeypair();
  secret: Uint8Array = new Uint8Array();
  signResponses: Uint8Array[] = [];
  signature = bytes(70, 0xab);
  issuerIv = bytes(16, 0x11);
  issuerPlain = crypto.randomKeypair().publicKey;
  parseResponse: Uint8Array = new Uint8Array();

  encrypt(iv: Uint8Array, message: Uint8Array): Uint8Array {
    return crypto.encrypt(this.secret, iv, message);
  }

  handle = (apdu: Apdu): Buffer => {
    switch (apdu.ins) {
      case INS_INIT:
        this.secret = crypto.ecdh(this.keyPair, apdu.data);
        return withStatus(new Uint8Array());
      case INS_PARSE_STREAM:
        return withStatus(apdu.p1 === 1 ? this.parseResponse : new Uint8Array());
      case INS_SIGN_BLOCK:
        if (apdu.p1 === 0) {
          return withStatus(
            concat(
              tlv(IV, this.issuerIv),
              tlv(ISSUER_PUBLIC_KEY, this.encrypt(this.issuerIv, this.issuerPlain)),
            ),
          );
        }
        if (apdu.p1 === 1) {
          return withStatus(this.signResponses.shift() ?? new Uint8Array());
        }
        return withStatus(
          concat(
            new Uint8Array([this.signature.length]),
            this.signature,
            new Uint8Array([0]),
            this.keyPair.publicKey,
          ),
        );
      default:
        return withStatus(new Uint8Array());
    }
  };
}

function setup() {
  const transport = new FakeTransport();
  const simulated = new SimulatedDevice();
  transport.handler = simulated.handle;
  const device = new ApduDevice(transport);
  return { transport, simulated, device };
}

function signed(block: CommandBlock): CommandBlock {
  return { ...block, signature: new Uint8Array([1, 2, 3]) };
}

describe("ApduDevice basic operations", () => {
  it("createApduDevice returns an ApduDevice without exposing a public key upfront", () => {
    const device = createApduDevice(new FakeTransport());
    expect(device.isPublicKeyAvailable()).toBe(false);
  });

  it("getPublicKey sends GET_PUBLIC_KEY and strips the status word", async () => {
    const { transport, device } = setup();
    const key = bytes(33, 2);
    transport.handler = () => withStatus(key);
    const result = await device.getPublicKey();
    expect(result.publicKey).toEqual(key);
    expect(transport.apdus).toEqual([
      { ins: INS_GET_PUBLIC_KEY, p1: 0, p2: 0, data: Buffer.alloc(0) },
    ]);
  });

  it("getSeedId sends the challenge and parses the seed id result", async () => {
    const { transport, device } = setup();
    const credential = new PubKeyCredential({
      version: 0,
      curveId: 0x21,
      signAlgorithm: 1,
      publicKey: bytes(0x21, 7),
    });
    const signature = bytes(4, 9);
    const attestation = bytes(5, 8);
    const payload = concat(
      credential.toBytes(),
      new Uint8Array([signature.length]),
      signature,
      new Uint8Array([3]),
      credential.toBytes(),
      new Uint8Array([attestation.length]),
      attestation,
    );
    transport.handler = () => withStatus(payload);
    const challenge = bytes(8, 5);

    const result = await device.getSeedId(challenge);

    expect(transport.apdus[0]).toEqual({
      ins: INS_GET_PUBLIC_KEY,
      p1: 0,
      p2: 0,
      data: Buffer.from(challenge),
    });
    expect(result.pubkeyCredential.toJSON()).toEqual(credential.toJSON());
    expect(Array.from(result.signature)).toEqual(Array.from(signature));
    expect(result.attestationType).toBe(3);
    expect(Array.from(result.attestation)).toEqual(Array.from(attestation));
  });

  it("readKey is not supported", async () => {
    const { device } = setup();
    await expect(
      device.readKey(await StreamTree.createNewTree(await softwareDevice()), []),
    ).rejects.toThrow("readKey is not supported on hardware devices");
  });

  it("close closes the transport", async () => {
    const { transport, device } = setup();
    await device.close();
    expect(transport.closed).toBe(true);
  });

  describe("isConnected", () => {
    it("is true when the Ledger Sync app answers 0x9000", async () => {
      const { transport, device } = setup();
      transport.handler = () => withStatus(Buffer.from(TRUSTCHAIN_APP_NAME));
      expect(await device.isConnected()).toBe(true);
      expect(transport.apdus[0]).toMatchObject({ ins: 0x04, p1: 0, p2: 0 });
    });

    it("is false for another app name", async () => {
      const { transport, device } = setup();
      transport.handler = () => withStatus(Buffer.from("Bitcoin"));
      expect(await device.isConnected()).toBe(false);
    });

    it("is false when the status word is not 0x9000", async () => {
      const { transport, device } = setup();
      transport.handler = () =>
        withStatus(Buffer.from(TRUSTCHAIN_APP_NAME), Buffer.from([0x90, 0x01]));
      await transport.send(0xe0, 0x04, 0, 0, Buffer.alloc(0), [0x9001]);
      const spy = jest
        .spyOn(transport, "send")
        .mockResolvedValue(withStatus(Buffer.from(TRUSTCHAIN_APP_NAME), Buffer.from([0x90, 0x01])));
      expect(await device.isConnected()).toBe(false);
      spy.mockRestore();
    });
  });
});

describe("APDU static helpers", () => {
  it("getResponseData and getStatusWord split the response", () => {
    const response = Buffer.from([1, 2, 3, 0x69, 0x85]);
    expect(Array.from(APDU.getResponseData(response))).toEqual([1, 2, 3]);
    expect(APDU.getStatusWord(response)).toBe(0x6985);
  });

  it("setTrustedMember encodes IV and trusted member as TLV", async () => {
    const transport = new FakeTransport();
    const iv = bytes(3, 1);
    const data = bytes(4, 2);
    await APDU.setTrustedMember(transport, { iv, data });
    expect(transport.apdus).toEqual([
      {
        ins: INS_SET_TRUSTED_MEMBER,
        p1: 0,
        p2: 0,
        data: Buffer.from([0, 3, 1, 1, 1, TRUSTED_MEMBER, 4, 2, 2, 2, 2]),
      },
    ]);
  });

  it("parseBlockHeader, parseCommand and parseSignature use the expected modes", async () => {
    const transport = new FakeTransport();
    const payload = new Uint8Array([9, 9]);
    await APDU.parseBlockHeader(transport, payload);
    await APDU.parseCommand(transport, payload);
    await APDU.parseCommand(transport, payload, true);
    await APDU.parseSignature(transport, payload);
    await APDU.parseEmptyStream(transport);
    await APDU.initFlow(transport, payload);
    expect(transport.apdus.map(a => [a.ins, a.p1, a.p2, a.data.length])).toEqual([
      [INS_PARSE_STREAM, 0, 0, 2],
      [INS_PARSE_STREAM, 1, 0, 2],
      [INS_PARSE_STREAM, 1, 1, 2],
      [INS_PARSE_STREAM, 2, 0, 2],
      [INS_PARSE_STREAM, 3, 0, 0],
      [INS_INIT, 0, 0, 2],
    ]);
  });

  it("signBlockHeader extracts IV and issuer", async () => {
    const transport = new FakeTransport();
    const iv = bytes(4, 1);
    const issuer = bytes(5, 2);
    transport.handler = () => withStatus(concat(tlv(IV, iv), tlv(ISSUER_PUBLIC_KEY, issuer)));
    expect(await APDU.signBlockHeader(transport, new Uint8Array([1]))).toEqual({ iv, issuer });
  });

  it("signBlockHeader rejects when IV or issuer is missing", async () => {
    const transport = new FakeTransport();
    transport.handler = () => withStatus(tlv(ISSUER_PUBLIC_KEY, bytes(2, 1)));
    await expect(APDU.signBlockHeader(transport, new Uint8Array())).rejects.toThrow(
      "No IV in response",
    );
    transport.handler = () => withStatus(tlv(IV, bytes(2, 1)));
    await expect(APDU.signBlockHeader(transport, new Uint8Array())).rejects.toThrow(
      "No issuer in response",
    );
  });

  it("signCommand returns the response data", async () => {
    const transport = new FakeTransport();
    transport.handler = () => withStatus(new Uint8Array([5, 6]));
    expect(Array.from(await APDU.signCommand(transport, new Uint8Array([1])))).toEqual([5, 6]);
  });

  it("finalizeSignature splits signature and session key", async () => {
    const transport = new FakeTransport();
    transport.handler = () => withStatus(new Uint8Array([2, 0xa, 0xb, 0, 0xc, 0xd]));
    const result = await APDU.finalizeSignature(transport);
    expect(Array.from(result.signature)).toEqual([0xa, 0xb]);
    expect(Array.from(result.sessionKey)).toEqual([0xc, 0xd]);
  });

  describe("parseTrustedProperties", () => {
    const seedTlvs = concat(
      tlv(IV, bytes(2, 1)),
      tlv(XPRIV, bytes(2, 2)),
      tlv(EPHEMERAL_PUBLIC_KEY, bytes(2, 3)),
      tlv(COMMAND_IV, bytes(2, 4)),
      tlv(GROUP_KEY, bytes(2, 5)),
    );
    const seed = new Seed(
      null,
      0,
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
    );
    const derive = new Derive(
      [1],
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
    );

    it("parses Seed and Derive responses, trusted member being optional", () => {
      const expected = {
        iv: bytes(2, 1),
        xpriv: bytes(2, 2),
        ephemeralPublicKey: bytes(2, 3),
        commandIv: bytes(2, 4),
        groupKey: bytes(2, 5),
        trustedMember: null,
      };
      expect(APDU.parseTrustedProperties(seed, seedTlvs)).toEqual(expected);
      expect(APDU.parseTrustedProperties(derive, seedTlvs)).toEqual(expected);
      const withMember = concat(seedTlvs, tlv(TRUSTED_MEMBER, bytes(2, 6)));
      expect(APDU.parseTrustedProperties(seed, withMember)).toEqual({
        ...expected,
        trustedMember: bytes(2, 6),
      });
    });

    it("rejects unknown properties and reports each missing seed field", () => {
      expect(() => APDU.parseTrustedProperties(seed, tlv(0x7f, bytes(1, 1)))).toThrow(
        "Unknown trusted property",
      );
      const fields = [
        [IV, "No IV in response"],
        [XPRIV, "No xpriv in response"],
        [EPHEMERAL_PUBLIC_KEY, "No ephemeral public key in response"],
        [COMMAND_IV, "No command IV in response"],
        [GROUP_KEY, "No group key in response"],
      ] as const;
      for (const [missing, message] of fields) {
        const partial = concat(
          ...fields.filter(([type]) => type !== missing).map(([type]) => tlv(type, bytes(2, 1))),
        );
        expect(() => APDU.parseTrustedProperties(seed, partial)).toThrow(message);
      }
    });

    it("parses AddMember responses", () => {
      const addMember = new AddMember("bob", bytes(33, 2), Permissions.KEY_READER);
      const raw = concat(tlv(IV, bytes(2, 1)), tlv(TRUSTED_MEMBER, bytes(2, 2)));
      expect(APDU.parseTrustedProperties(addMember, raw)).toEqual({
        iv: bytes(2, 1),
        trustedMember: bytes(2, 2),
      });
      expect(() =>
        APDU.parseTrustedProperties(addMember, tlv(TRUSTED_MEMBER, bytes(1, 1))),
      ).toThrow("No IV in response");
      expect(() => APDU.parseTrustedProperties(addMember, tlv(IV, bytes(1, 1)))).toThrow(
        "No trusted member in response",
      );
    });

    it("parses PublishKey responses, ignoring unknown properties", () => {
      const publish = new PublishKey(
        new Uint8Array(),
        new Uint8Array(),
        bytes(33, 2),
        new Uint8Array(),
      );
      const fields = [
        [IV, "No IV in response"],
        [EPHEMERAL_PUBLIC_KEY, "No ephemeral public key in response"],
        [COMMAND_IV, "No command IV in response"],
        [XPRIV, "No xpriv in response"],
      ] as const;
      const full = concat(
        tlv(0x7f, bytes(1, 1)),
        tlv(TRUSTED_MEMBER, bytes(2, 9)),
        ...fields.map(([type]) => tlv(type, bytes(2, type & 0x7f))),
      );
      expect(APDU.parseTrustedProperties(publish, full)).toEqual({
        iv: bytes(2, 0),
        ephemeralPublicKey: bytes(2, 3),
        commandIv: bytes(2, 4),
        xpriv: bytes(2, 2),
        trustedMember: bytes(2, 9),
      });
      for (const [missing, message] of fields) {
        const partial = concat(
          ...fields.filter(([type]) => type !== missing).map(([type]) => tlv(type, bytes(2, 1))),
        );
        expect(() => APDU.parseTrustedProperties(publish, partial)).toThrow(message);
      }
    });

    it("returns an empty response for CloseStream and rejects other types", () => {
      expect(APDU.parseTrustedProperties(new CloseStream(), new Uint8Array())).toEqual({});
      const edit = new EditMember(bytes(33, 2), "x", null);
      expect(() => APDU.parseTrustedProperties(edit, new Uint8Array())).toThrow(
        "Unsupported command type",
      );
    });
  });
});

describe("ApduDevice.sign", () => {
  it("rejects streams without exactly one block to sign", async () => {
    const { transport, device } = setup();
    const issuer = crypto.randomKeypair().publicKey;
    const unsigned = createCommandBlock(issuer, [new CloseStream()]);
    await expect(device.sign([])).rejects.toThrow(
      "Stream must contain exactly one block to sign. Found 0 blocks to sign.",
    );
    await expect(device.sign([unsigned, unsigned])).rejects.toThrow(
      "Stream must contain exactly one block to sign. Found 2 blocks to sign.",
    );
    expect(transport.apdus).toEqual([]);
  });

  it("signs a Seed block, injecting decrypted issuer and trusted properties", async () => {
    const { transport, simulated, device } = setup();
    const block = createCommandBlock(bytes(33, 0), [
      new Seed(null, 0, new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array()),
    ]);
    const xpriv = bytes(64, 0x42);
    const xprivIv = bytes(16, 0x22);
    const ephemeral = bytes(33, 3);
    const commandIv = bytes(16, 4);
    const groupKey = bytes(33, 5);
    transport.handler = apdu => {
      const response = simulated.handle(apdu);
      if (apdu.ins === INS_SIGN_BLOCK && apdu.p1 === 1) {
        return withStatus(
          concat(
            tlv(IV, xprivIv),
            tlv(XPRIV, simulated.encrypt(xprivIv, xpriv)),
            tlv(EPHEMERAL_PUBLIC_KEY, ephemeral),
            tlv(COMMAND_IV, commandIv),
            tlv(GROUP_KEY, groupKey),
          ),
        );
      }
      return response;
    };

    const result = await device.sign([block]);

    expect(transport.inses()).toEqual([INS_INIT, INS_SIGN_BLOCK, INS_SIGN_BLOCK, INS_SIGN_BLOCK]);
    expect(result).toBe(block);
    expect(result.issuer).toEqual(simulated.issuerPlain);
    expect(result.signature).toEqual(simulated.signature);
    const seed = result.commands[0] as Seed;
    expect(seed.encryptedXpriv).toEqual(xpriv);
    expect(seed.ephemeralPublicKey).toEqual(ephemeral);
    expect(seed.initializationVector).toEqual(commandIv);
    expect(seed.groupKey).toEqual(groupKey);
  });

  it("signs a Derive block", async () => {
    const { simulated } = setup();
    const block = createCommandBlock(bytes(33, 0), [
      new Derive(
        [0x8000_0001],
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array(),
      ),
    ]);
    const xpriv = bytes(64, 0x43);
    const iv = bytes(16, 0x23);
    const transport = new FakeTransport();
    transport.handler = apdu => {
      if (apdu.ins === INS_SIGN_BLOCK && apdu.p1 === 1) {
        return withStatus(
          concat(
            tlv(IV, iv),
            tlv(XPRIV, simulated.encrypt(iv, xpriv)),
            tlv(EPHEMERAL_PUBLIC_KEY, bytes(33, 3)),
            tlv(COMMAND_IV, bytes(16, 4)),
            tlv(GROUP_KEY, bytes(33, 5)),
          ),
        );
      }
      return simulated.handle(apdu);
    };
    const result = await new ApduDevice(transport).sign([block]);
    const derive = result.commands[0] as Derive;
    expect(derive.encryptedXpriv).toEqual(xpriv);
    expect(derive.groupKey).toEqual(bytes(33, 5));
    expect(derive.initializationVector).toEqual(bytes(16, 4));
  });

  it("signs PublishKey, AddMember and CloseStream blocks", async () => {
    const { transport, simulated, device } = setup();
    const recipient = crypto.randomKeypair().publicKey;
    const block = createCommandBlock(bytes(33, 0), [
      new AddMember("bob", recipient, Permissions.KEY_READER),
      new PublishKey(new Uint8Array(), new Uint8Array(), recipient, new Uint8Array()),
      new CloseStream(),
    ]);
    const xpriv = bytes(64, 0x44);
    const iv = bytes(16, 0x24);
    let call = 0;
    transport.handler = apdu => {
      if (apdu.ins === INS_SIGN_BLOCK && apdu.p1 === 1) {
        call += 1;
        if (call === 1) {
          return withStatus(concat(tlv(IV, iv), tlv(TRUSTED_MEMBER, bytes(4, 1))));
        }
        if (call === 2) {
          return withStatus(
            concat(
              tlv(IV, iv),
              tlv(XPRIV, simulated.encrypt(iv, xpriv)),
              tlv(EPHEMERAL_PUBLIC_KEY, bytes(33, 3)),
              tlv(COMMAND_IV, bytes(16, 4)),
            ),
          );
        }
        return withStatus(new Uint8Array());
      }
      return simulated.handle(apdu);
    };

    const result = await device.sign([block]);

    expect(result.commands[0]).toBeInstanceOf(AddMember);
    const publish = result.commands[1] as PublishKey;
    expect(publish.encryptedXpriv).toEqual(xpriv);
    expect(publish.ephemeralPublicKey).toEqual(bytes(33, 3));
    expect(publish.initializationVector).toEqual(bytes(16, 4));
    expect(result.commands[2]).toBeInstanceOf(CloseStream);
  });

  it("rejects EditMember in the block to sign as unsupported", async () => {
    const { device } = setup();
    const block = createCommandBlock(bytes(33, 0), [new EditMember(bytes(33, 2), "x", null)]);
    await expect(device.sign([block])).rejects.toThrow("Unsupported command type");
  });

  it("parses previous blocks on device and re-sends trusted members only when needed", async () => {
    const { transport, simulated, device } = setup();
    const alice = crypto.randomKeypair().publicKey;
    const bob = crypto.randomKeypair().publicKey;
    const trustedIv = bytes(16, 0x33);
    simulated.parseResponse = concat(tlv(IV, trustedIv), tlv(TRUSTED_MEMBER, bytes(8, 0x55)));

    const seedBlock = signed(
      createCommandBlock(alice, [
        new Seed(null, 0, new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array()),
      ]),
    );
    const addBlock = signed(
      createCommandBlock(
        alice,
        [new AddMember("bob", bob, Permissions.KEY_READER)],
        undefined,
        bytes(32, 1),
      ),
    );
    const laterBlock = signed(
      createCommandBlock(
        alice,
        [
          new PublishKey(new Uint8Array(), new Uint8Array(), bob, new Uint8Array()),
          new EditMember(bob, "bobby", null),
          new Derive([1], new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array()),
        ],
        undefined,
        bytes(32, 2),
      ),
    );
    const last = createCommandBlock(alice, [new CloseStream()], undefined, bytes(32, 3));

    await device.sign([seedBlock, addBlock, laterBlock, last]);

    const inses = transport.inses();
    expect(inses[0]).toBe(INS_INIT);
    expect(inses.filter(ins => ins === INS_SET_TRUSTED_MEMBER).length).toBeGreaterThan(0);
    const setCall = transport.apdus.find(a => a.ins === INS_SET_TRUSTED_MEMBER);
    expect(setCall?.data).toEqual(
      Buffer.from(concat(tlv(IV, trustedIv), tlv(TRUSTED_MEMBER, bytes(8, 0x55)))),
    );
    const parsedBlocks = transport.apdus.filter(a => a.ins === INS_PARSE_STREAM && a.p1 === 0);
    expect(parsedBlocks).toHaveLength(3);
    const signatures = transport.apdus.filter(a => a.ins === INS_PARSE_STREAM && a.p1 === 2);
    expect(signatures).toHaveLength(3);
  });

  it("ignores device responses without a trusted member when parsing previous blocks", async () => {
    const { transport, simulated, device } = setup();
    const alice = crypto.randomKeypair().publicKey;
    simulated.parseResponse = new Uint8Array();
    const previous = signed(createCommandBlock(alice, [new AddMember("x", alice, 1)]));
    const last = createCommandBlock(alice, [new CloseStream()], undefined, bytes(32, 3));
    await device.sign([previous, last]);
    expect(transport.inses()).not.toContain(INS_SET_TRUSTED_MEMBER);
  });

  it("does not record trusted members for the device itself (no compressed public key)", async () => {
    const { transport, simulated, device } = setup();
    simulated.parseResponse = concat(tlv(IV, bytes(16, 1)), tlv(TRUSTED_MEMBER, bytes(4, 1)));
    const selfIssuer = bytes(33, 0);
    const first = signed(
      createCommandBlock(selfIssuer, [
        new Seed(null, 0, new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array()),
      ]),
    );
    const second = signed(
      createCommandBlock(selfIssuer, [new CloseStream()], undefined, bytes(32, 1)),
    );
    const last = createCommandBlock(selfIssuer, [new CloseStream()], undefined, bytes(32, 2));
    await device.sign([first, second, last]);
    expect(transport.inses()).not.toContain(INS_SET_TRUSTED_MEMBER);
  });
});
