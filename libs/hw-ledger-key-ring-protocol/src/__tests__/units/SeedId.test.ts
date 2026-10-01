import { crypto } from "../../Crypto";
import { TLV } from "../../tlv";
import { Challenge, PubKeyCredential, parseSeedIdResult } from "../../SeedId";

const PUBKEY = "02b2c29ab36022219967cc21a306599ecaf51ce9f2998da6982388d52c8c69a6a5";

function credential(overrides: Partial<ConstructorParameters<typeof PubKeyCredential>[0]> = {}) {
  return new PubKeyCredential({
    version: 0,
    curveId: 0x21,
    signAlgorithm: 0x01,
    publicKey: crypto.from_hex(PUBKEY),
    ...overrides,
  });
}

function makeChallenge() {
  return new Challenge({
    payloadType: 0x07,
    version: 0,
    protocolVersion: { major: 1, minor: 2, patch: 3 },
    challengeData: crypto.from_hex("53cafde60e5395b164eb867213bc05f6"),
    challengeExpiry: new Date(1708678950000),
    host: "localhost",
    rpCredential: credential(),
    rpSignature: crypto.from_hex("3045022025d130d7ae5c48a6cf09781d04a08e9a"),
  });
}

describe("PubKeyCredential", () => {
  it("fromBytes honors the offset and reports the consumed length", () => {
    const bytes = credential().toBytes();
    const padded = new Uint8Array([0xaa, 0xbb, ...bytes, 0xcc]);
    const [parsed, length] = PubKeyCredential.fromBytes(padded, 2);
    expect(length).toBe(bytes.length);
    expect(parsed).toEqual(credential());
  });

  it.each([
    [{ version: 1 }, "PubKeyCredential: Wrong version: 1"],
    [{ curveId: 0x22 }, "PubKeyCredential: Wrong curve id: 34"],
    [{ signAlgorithm: 2 }, "PubKeyCredential: Wrong sign algorithm: 2"],
    [{ publicKey: new Uint8Array(20) }, "PubKeyCredential: Wrong pubkey len: 20"],
  ])("assertValidity rejects %j", (overrides, message) => {
    expect(() => credential(overrides).assertValidity()).toThrow(message);
  });
});

describe("Challenge", () => {
  it("roundtrips through toBytes and fromBytes", () => {
    const challenge = makeChallenge();
    const bytes = challenge.toBytes();
    const [parsed, length] = Challenge.fromBytes(bytes);
    expect(length).toBe(bytes.length);
    expect(parsed).toEqual(challenge);
  });

  it("fromBytes honors the offset", () => {
    const challenge = makeChallenge();
    const bytes = challenge.toBytes();
    const padded = new Uint8Array([0xff, 0xff, ...bytes]);
    const [parsed, length] = Challenge.fromBytes(padded, 2);
    expect(length).toBe(bytes.length);
    expect(parsed).toEqual(challenge);
  });

  it.each([
    [0x01, "Missing payloadType"],
    [0x02, "Missing version"],
    [0x60, "Missing protocolVersion"],
    [0x12, "Missing challengeData"],
    [0x16, "Missing challengeExpiry"],
    [0x20, "Missing host"],
    [0x14, "Missing signAlgorithm"],
    [0x33, "Missing rpCredential"],
    [0x32, "Missing curveId"],
    [0x15, "Missing rpSignature"],
  ])("fromBytes throws when TLV 0x%s is absent", (type, message) => {
    const kept = TLV.readAllTLV(makeChallenge().toBytes(), 0).filter(t => t.type !== type);
    const bytes = kept.reduce(
      (acc, t) => TLV.pushTLV(acc, t.type, t.value.length, t.value),
      new Uint8Array(),
    );
    expect(() => Challenge.fromBytes(bytes)).toThrow(message);
  });

  it("getUnsignedTLV omits the signature, algorithm and credential fields", () => {
    const types = TLV.readAllTLV(makeChallenge().getUnsignedTLV(), 0).map(t => t.type);
    expect(types).toEqual([0x01, 0x02, 0x12, 0x16, 0x20, 0x60]);
  });

  it("getProtocolVersionData appends a zero byte", () => {
    expect(Array.from(makeChallenge().getProtocolVersionData())).toEqual([1, 2, 3, 0]);
  });

  it("getChallengeExpireValue returns unix seconds", () => {
    expect(makeChallenge().getChallengeExpireValue()).toBe(1708678950);
  });

  it("toJSON serializes challenge, host and relying party", () => {
    expect(makeChallenge().toJSON()).toEqual({
      payloadType: 7,
      version: 0,
      protocolVersion: { major: 1, minor: 2, patch: 3 },
      challenge: {
        data: "53cafde60e5395b164eb867213bc05f6",
        expiry: "2024-02-23T09:02:30.000Z",
      },
      host: "localhost",
      rp: [
        {
          credential: credential().toJSON(),
          signature: "3045022025d130d7ae5c48a6cf09781d04a08e9a",
        },
      ],
    });
  });
});

describe("parseSeedIdResult", () => {
  const signature = crypto.from_hex("3044022011223344");
  const attestation = crypto.from_hex("aabbccddeeff");
  const attestationCredential = credential({ publicKey: crypto.from_hex(`03${PUBKEY.slice(2)}`) });

  function buildResult(): Uint8Array {
    return new Uint8Array([
      ...credential().toBytes(),
      signature.length,
      ...signature,
      0x02,
      ...attestationCredential.toBytes(),
      attestation.length,
      ...attestation,
    ]);
  }

  it("parses credentials, signature and attestation", () => {
    const result = parseSeedIdResult(buildResult());
    expect(result.pubkeyCredential).toEqual(credential());
    expect(crypto.to_hex(result.signature)).toBe(crypto.to_hex(signature));
    expect(result.attestationType).toBe(0x02);
    expect(result.attestationPubkeyCredential).toEqual(attestationCredential);
    expect(crypto.to_hex(result.attestation)).toBe(crypto.to_hex(attestation));
    expect(crypto.to_hex(result.attestationResult)).toBe(
      crypto.to_hex(
        new Uint8Array([
          0x02,
          ...attestationCredential.toBytes(),
          attestation.length,
          ...attestation,
        ]),
      ),
    );
  });

  it("throws when the first credential is invalid", () => {
    const bytes = buildResult();
    bytes[0] = 1;
    expect(() => parseSeedIdResult(bytes)).toThrow("PubKeyCredential: Wrong version: 1");
  });

  it("throws when the attestation credential is invalid", () => {
    const bytes = buildResult();
    bytes[credential().toBytes().length + 1 + signature.length + 1 + 1] = 9;
    expect(() => parseSeedIdResult(bytes)).toThrow("PubKeyCredential: Wrong curve id: 9");
  });
});
