import { createHash } from "crypto";
import CommandStreamJsonifier from "../../CommandStreamJsonifier";
import { CommandStreamEncoder } from "../../CommandStreamEncoder";
import {
  AddMember,
  CloseStream,
  Command,
  CommandBlock,
  Derive,
  EditMember,
  Permissions,
  PublishKey,
  Seed,
} from "../../CommandBlock";
import { crypto } from "../../Crypto";

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const hex = (n: number, fill: number) => crypto.to_hex(bytes(n, fill));

function block(commands: Command[]): CommandBlock {
  return {
    version: 1,
    parent: bytes(32, 1),
    issuer: bytes(33, 2),
    commands,
    signature: bytes(70, 3),
  };
}

describe("CommandStreamJsonifier", () => {
  it("returns an empty array for an empty stream", () => {
    expect(CommandStreamJsonifier.jsonify([])).toEqual([]);
  });

  it("jsonifies block metadata and the sha256 of the encoded block", () => {
    const b = block([new CloseStream()]);
    const [json] = CommandStreamJsonifier.jsonify([b]) as Record<string, unknown>[];
    const expectedHash = createHash("sha256")
      .update(CommandStreamEncoder.encode([b]))
      .digest("hex");
    expect(json).toEqual({
      parent: hex(32, 1),
      issuer: hex(33, 2),
      hash: expectedHash,
      command: [{ type: "CloseStream" }],
      signature: hex(70, 3),
    });
  });

  it("jsonifies a Seed command", () => {
    const b = block([
      new Seed(bytes(16, 4), 0, bytes(33, 5), bytes(16, 6), bytes(64, 7), bytes(33, 8)),
    ]);
    const [json] = CommandStreamJsonifier.jsonify([b]) as { command: unknown[] }[];
    expect(json.command).toEqual([
      {
        type: "Seed",
        topic: hex(16, 4),
        groupKey: hex(33, 5),
        encryptedXpriv: hex(64, 7),
        ephemeralPublicKey: hex(33, 8),
        initializationVector: hex(16, 6),
      },
    ]);
  });

  it("jsonifies an AddMember command", () => {
    const b = block([new AddMember("alice", bytes(33, 9), Permissions.OWNER)]);
    const [json] = CommandStreamJsonifier.jsonify([b]) as { command: unknown[] }[];
    expect(json.command).toEqual([
      { type: "AddMember", name: "alice", publicKey: hex(33, 9), permissions: Permissions.OWNER },
    ]);
  });

  it("jsonifies an EditMember command", () => {
    const b = block([new EditMember(bytes(33, 10), "bob", Permissions.KEY_CREATOR)]);
    const [json] = CommandStreamJsonifier.jsonify([b]) as { command: unknown[] }[];
    expect(json.command).toEqual([
      {
        type: "EditMember",
        member: hex(33, 10),
        name: "bob",
        permissions: Permissions.KEY_CREATOR,
      },
    ]);
  });

  it("jsonifies a Derive command with a hardened path", () => {
    const b = block([
      new Derive([0x80000010, 3], bytes(33, 11), bytes(16, 12), bytes(64, 13), bytes(33, 14)),
    ]);
    const [json] = CommandStreamJsonifier.jsonify([b]) as { command: unknown[] }[];
    expect(json.command).toEqual([
      {
        type: "Derive",
        path: "m/16'/3",
        groupKey: hex(33, 11),
        encryptedXpriv: hex(64, 13),
        ephemeralPublicKey: hex(33, 14),
        initializationVector: hex(16, 12),
      },
    ]);
  });

  it("jsonifies a PublishKey command", () => {
    const b = block([new PublishKey(bytes(16, 15), bytes(64, 16), bytes(33, 17), bytes(33, 18))]);
    const [json] = CommandStreamJsonifier.jsonify([b]) as { command: unknown[] }[];
    expect(json.command).toEqual([
      {
        type: "PublishKey",
        encryptedXpriv: hex(64, 16),
        initializationVector: hex(16, 15),
        ephemeralPublicKey: hex(33, 18),
        recipient: hex(33, 17),
      },
    ]);
  });

  it("jsonifies several blocks in order", () => {
    const b1 = block([new CloseStream()]);
    const b2 = block([new AddMember("carol", bytes(33, 19), Permissions.KEY_READER)]);
    const json = CommandStreamJsonifier.jsonify([b1, b2]) as { command: { type: string }[] }[];
    expect(json.map(j => j.command[0].type)).toEqual(["CloseStream", "AddMember"]);
  });
});
