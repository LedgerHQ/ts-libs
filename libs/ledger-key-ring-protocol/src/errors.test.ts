import * as errors from "./errors";

const simpleErrors = [
  errors.ScannedOldImportQrCode,
  errors.ScannedNewImportQrCode,
  errors.ScannedInvalidQrCode,
  errors.InvalidDigitsError,
  errors.InvalidEncryptionKeyError,
  errors.TrustchainEjected,
  errors.TrustchainNotAllowed,
  errors.TrustchainOutdated,
  errors.TrustchainNotFound,
  errors.NoTrustchainInitialized,
  errors.TrustchainAlreadyInitialized,
  errors.TrustchainAlreadyInitializedWithOtherSeed,
  errors.QRCodeWSClosed,
  errors.QRCodeProtocolError,
];

describe("errors", () => {
  describe.each(simpleErrors.map(E => [E.name, E] as const))("%s", (name, ErrorClass) => {
    it("defaults its message to its name", () => {
      const error = new ErrorClass();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.name).toBe(name);
      expect(error.message).toBe(name);
    });

    it("keeps a custom message", () => {
      const error = new ErrorClass("custom");
      expect(error.name).toBe(name);
      expect(error.message).toBe("custom");
    });
  });

  describe("QRCodeWSClosed", () => {
    it("assigns the given fields onto the error", () => {
      const error = new errors.QRCodeWSClosed("closed", { time: 42, extra: "x" });
      expect(error.time).toBe(42);
      expect(error).toMatchObject({ extra: "x" });
    });

    it("leaves time undefined without fields", () => {
      expect(new errors.QRCodeWSClosed().time).toBeUndefined();
    });
  });
});
