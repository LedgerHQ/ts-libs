import { CommandStreamDecoder, CommandStreamEncoder, crypto } from "../..";
import {
  AddMember,
  CloseStream,
  Command,
  CommandBlock,
  CommandType,
  createCommandBlock,
  Derive,
  EditMember,
  hashCommandBlock,
  PublishKey,
  Seed,
  signCommandBlock,
  verifyCommandBlock,
} from "../../CommandBlock";
import { TLVCommandStreamDecoder } from "../../CommandStreamDecoder";
import { TLVCommandStreamEncoder } from "../../CommandStreamEncoder";
import { DerivationPath } from "../../Crypto";

function pubkey() {
  return crypto.randomKeypair().publicKey;
}

function roundTrip(commands: Command[]): CommandBlock {
  const issuer = crypto.randomKeypair();
  const block = signCommandBlock(
    createCommandBlock(issuer.publicKey, commands),
    issuer.publicKey,
    issuer.privateKey,
  );
  const decoded = CommandStreamDecoder.decode(CommandStreamEncoder.encode([block]));
  expect(decoded).toHaveLength(1);
  expect(decoded[0].version).toBe(block.version);
  expect(decoded[0].parent).toEqual(block.parent);
  expect(decoded[0].issuer).toEqual(block.issuer);
  expect(decoded[0].signature).toEqual(block.signature);
  return decoded[0];
}

describe("CommandBlock helpers", () => {
  it("creates a block with a random 32 bytes parent when none is given", () => {
    const a = createCommandBlock(pubkey(), []);
    const b = createCommandBlock(pubkey(), []);
    expect(a.version).toBe(1);
    expect(a.parent).toHaveLength(32);
    expect(a.parent).not.toEqual(b.parent);
    expect(a.signature).toHaveLength(0);
  });

  it("keeps the given parent and signature", () => {
    const parent = crypto.randomBytes(32);
    const block = createCommandBlock(pubkey(), [], new Uint8Array([1, 2]), parent);
    expect(block.parent).toBe(parent);
    expect(block.signature).toEqual(new Uint8Array([1, 2]));
  });

  it("reports the type of each command", () => {
    expect(
      new Seed(
        null,
        0,
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array(),
        new Uint8Array(),
      ).getType(),
    ).toBe(CommandType.Seed);
    expect(new Derive([], pubkey(), new Uint8Array(), new Uint8Array(), pubkey()).getType()).toBe(
      CommandType.Derive,
    );
    expect(new AddMember("a", pubkey(), 1).getType()).toBe(CommandType.AddMember);
    expect(new PublishKey(new Uint8Array(), new Uint8Array(), pubkey(), pubkey()).getType()).toBe(
      CommandType.PublishKey,
    );
    expect(new EditMember(pubkey(), null, null).getType()).toBe(CommandType.EditMember);
    expect(new CloseStream().getType()).toBe(CommandType.CloseStream);
  });

  it("fills empty Seed fields with zeroed placeholders", () => {
    const seed = new Seed(
      null,
      0,
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
      new Uint8Array(),
    );
    expect(seed.groupKey).toEqual(new Uint8Array(33));
    expect(seed.initializationVector).toEqual(new Uint8Array(16));
    expect(seed.encryptedXpriv).toEqual(new Uint8Array(64));
    expect(seed.ephemeralPublicKey).toEqual(new Uint8Array(33));
  });

  it("signs and verifies a block, and detects tampering", () => {
    const issuer = crypto.randomKeypair();
    const block = createCommandBlock(issuer.publicKey, [new CloseStream()]);
    const signed = signCommandBlock(block, issuer.publicKey, issuer.privateKey);
    expect(signed.signature.length).toBeGreaterThan(0);
    expect(verifyCommandBlock(signed)).toBe(true);
    expect(verifyCommandBlock(block)).toBe(false);
    expect(verifyCommandBlock({ ...signed, parent: crypto.randomBytes(32) })).toBe(false);
  });

  it("hashes deterministically and depends on the content", () => {
    const parent = crypto.randomBytes(32);
    const issuer = pubkey();
    const a = createCommandBlock(issuer, [new CloseStream()], new Uint8Array(), parent);
    const b = createCommandBlock(issuer, [new CloseStream()], new Uint8Array(), parent);
    const c = createCommandBlock(
      issuer,
      [new AddMember("x", pubkey(), 1)],
      new Uint8Array(),
      parent,
    );
    expect(hashCommandBlock(a)).toEqual(hashCommandBlock(b));
    expect(hashCommandBlock(a)).not.toEqual(hashCommandBlock(c));
  });
});

describe("CommandStream codec", () => {
  it("round trips a Seed command", () => {
    const topic = crypto.randomBytes(8);
    const seed = new Seed(
      topic,
      3,
      pubkey(),
      crypto.randomBytes(16),
      crypto.randomBytes(64),
      pubkey(),
    );
    const [command] = roundTrip([seed]).commands;
    expect(command).toEqual(seed);
  });

  it("round trips a Seed command without topic as a null topic", () => {
    const seed = new Seed(
      null,
      0,
      pubkey(),
      crypto.randomBytes(16),
      crypto.randomBytes(64),
      pubkey(),
    );
    const [command] = roundTrip([seed]).commands;
    expect(command).toBeInstanceOf(Seed);
    expect(command).toMatchObject({ groupKey: seed.groupKey, protocolVersion: 0 });
  });

  it("round trips a Derive command", () => {
    const path = DerivationPath.toIndexArray("m/0'/16'/1'");
    const derive = new Derive(
      path,
      pubkey(),
      crypto.randomBytes(16),
      crypto.randomBytes(64),
      pubkey(),
    );
    expect(roundTrip([derive]).commands[0]).toEqual(derive);
  });

  it("round trips AddMember, PublishKey and CloseStream in one block", () => {
    const member = pubkey();
    const commands: Command[] = [
      new AddMember("Alice", member, 0x0b),
      new PublishKey(crypto.randomBytes(16), crypto.randomBytes(64), member, pubkey()),
      new CloseStream(),
    ];
    expect(roundTrip(commands).commands).toEqual(commands);
  });

  it("round trips an EditMember command with a name and permissions", () => {
    const edit = new EditMember(pubkey(), "Renamed", 0x03);
    expect(roundTrip([edit]).commands[0]).toEqual(edit);
  });

  it("round trips an EditMember command with only a name", () => {
    const edit = new EditMember(pubkey(), "Renamed", null);
    expect(roundTrip([edit]).commands[0]).toEqual(edit);
  });

  it("round trips an EditMember command with only permissions", () => {
    const edit = new EditMember(pubkey(), null, 0x03);
    expect(roundTrip([edit]).commands[0]).toEqual(edit);
  });

  it("round trips several blocks", () => {
    const issuer = crypto.randomKeypair();
    const first = signCommandBlock(
      createCommandBlock(issuer.publicKey, [new AddMember("A", pubkey(), 1)]),
      issuer.publicKey,
      issuer.privateKey,
    );
    const second = signCommandBlock(
      createCommandBlock(
        issuer.publicKey,
        [new CloseStream()],
        new Uint8Array(),
        hashCommandBlock(first),
      ),
      issuer.publicKey,
      issuer.privateKey,
    );
    const decoded = CommandStreamDecoder.decode(CommandStreamEncoder.encode([first, second]));
    expect(decoded).toEqual([first, second]);
  });

  it("decodes an empty buffer into an empty stream", () => {
    expect(CommandStreamDecoder.decode(new Uint8Array())).toEqual([]);
  });

  it("rejects an unknown command type when decoding", () => {
    expect(() =>
      TLVCommandStreamDecoder.readCommand({ type: 0x99, value: new Uint8Array() }),
    ).toThrow("Unknown command type");
  });

  it("decodes an empty close stream payload", () => {
    expect(TLVCommandStreamDecoder.readCloseStreamCommand(new Uint8Array())).toBeInstanceOf(
      CloseStream,
    );
    expect(TLVCommandStreamEncoder.packCloseStream(new CloseStream())).toEqual(new Uint8Array());
  });
});

describe("CommandStreamEncoder", () => {
  const block = createCommandBlock(pubkey(), [new CloseStream(), new CloseStream()]);

  it("encodes the block header with the number of commands", () => {
    const header = CommandStreamEncoder.encodeBlockHeader(block);
    expect(header.length).toBeGreaterThan(0);
    expect(header[header.length - 1]).toBe(2);
  });

  it("encodes a single command by index", () => {
    expect(CommandStreamEncoder.encodeCommand(block, 0)[0]).toBe(CommandType.CloseStream);
  });

  it("rejects an out of range command index", () => {
    expect(() => CommandStreamEncoder.encodeCommand(block, 2)).toThrow("Index out of range");
    expect(() => CommandStreamEncoder.encodeCommand(block, -1)).toThrow("Index out of range");
  });

  it("encodes no signature for an unsigned block", () => {
    expect(CommandStreamEncoder.encodeSignature(block)).toEqual(new Uint8Array());
  });

  it("encodes the signature of a signed block", () => {
    const issuer = crypto.randomKeypair();
    const signed = signCommandBlock(block, issuer.publicKey, issuer.privateKey);
    expect(CommandStreamEncoder.encodeSignature(signed).length).toBeGreaterThan(
      signed.signature.length,
    );
  });

  it("packs a Seed without topic like a Seed with an empty topic", () => {
    const args = [0, pubkey(), crypto.randomBytes(16), crypto.randomBytes(64), pubkey()] as const;
    const noTopic = new Seed(null, ...args);
    const emptyTopic = new Seed(new Uint8Array(), ...args);
    expect(TLVCommandStreamEncoder.packSeed(noTopic)).toEqual(
      TLVCommandStreamEncoder.packSeed(emptyTopic),
    );
  });
});
