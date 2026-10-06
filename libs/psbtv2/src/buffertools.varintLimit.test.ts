import { BufferReader } from "./buffertools";

describe("readVarInt above Number.MAX_SAFE_INTEGER", () => {
  it.each(["ff0000000000002000", "ffffffffffffffffff"])(
    "throws a descriptive error for %s",
    encoded => {
      expect(() => new BufferReader(Buffer.from(encoded, "hex")).readVarInt()).toThrow(
        "VarInt exceeds MAX_SAFE_INTEGER",
      );
    },
  );
});
