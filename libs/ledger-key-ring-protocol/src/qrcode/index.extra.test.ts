import type { AddressInfo } from "net";
import WebSocket from "ws";
import { crypto } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { createQRCodeCandidateInstance, createQRCodeHostInstance, isOldBase64Import } from ".";
import { makeCipher, makeMessageCipher } from "./cipher";
import { NoTrustchainInitialized, QRCodeWSClosed, TrustchainAlreadyInitialized } from "../errors";
import { convertKeyPairToLiveCredentials } from "../utils";

const TRUSTCHAIN = {
  rootId: "test-root-id",
  walletSyncEncryptionKey: "11".repeat(32),
  applicationPath: "m/0'/16'/0'",
};

const createRelay = async () => {
  const server = new WebSocket.Server({ port: 0 });
  await new Promise<void>(resolve => server.on("listening", () => resolve()));
  const sockets: WebSocket[] = [];
  server.on("connection", ws => {
    sockets.push(ws);
    ws.on("message", message => {
      for (const peer of sockets) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(message);
      }
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `ws://localhost:${port}`,
    terminateSockets: () => sockets.forEach(ws => ws.terminate()),
    close: () =>
      new Promise<void>(resolve => {
        sockets.forEach(ws => ws.terminate());
        server.close(() => resolve());
      }),
  };
};

const credentials = () => convertKeyPairToLiveCredentials(crypto.randomKeypair());

describe("Trustchain QR Code (extra)", () => {
  let relay: Awaited<ReturnType<typeof createRelay>>;
  let consoleError: jest.SpyInstance;

  beforeEach(async () => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    relay = await createRelay();
  });

  afterEach(async () => {
    consoleError.mockRestore();
    await relay.close();
  });

  describe("candidate receiving a Failure from the host", () => {
    it.each([
      ["UNEXPECTED_SHARE_CREDENTIAL", "boom", NoTrustchainInitialized, "boom"],
      ["UNEXPECTED_REQUEST_CREDENTIAL", "root", TrustchainAlreadyInitialized, "root"],
    ])("maps %s to its error", async (type, message, ErrorClass, expectedMessage) => {
      const hostKey = crypto.randomKeypair();
      const hostPublisher = crypto.to_hex(hostKey.publicKey);
      const scannedUrl = `${relay.baseUrl}/v1/qr?host=${hostPublisher}`;
      const host = new WebSocket(scannedUrl);
      await new Promise<void>(resolve => host.on("open", () => resolve()));
      const send = (msg: Record<string, unknown>) =>
        host.send(JSON.stringify({ version: 1, publisher: hostPublisher, ...msg }));
      host.on("message", raw => {
        const frame = JSON.parse(raw.toString());
        if (frame.message === "InitiateHandshake") {
          const cipher = makeMessageCipher(
            makeCipher(crypto.ecdh(hostKey, crypto.from_hex(frame.payload.ephemeral_public_key))),
          );
          send({
            message: "HandshakeChallenge",
            payload: cipher.encryptMessagePayload({ digits: 3, connected: false }),
          });
        } else if (frame.message === "CompleteHandshakeChallenge") {
          send({ message: "Failure", payload: { type, message } });
        }
      });

      const candidateP = createQRCodeCandidateInstance({
        memberCredentials: credentials(),
        memberName: "foo",
        addMember: jest.fn(() => Promise.resolve(TRUSTCHAIN)),
        scannedUrl,
        onRequestQRCodeInput: (_config, callback) => callback("123"),
      });

      const error = await candidateP.catch(e => e);
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.message).toBe(expectedMessage);
      host.close();
    });

    it("maps an unknown failure type to a named generic error", async () => {
      const hostKey = crypto.randomKeypair();
      const hostPublisher = crypto.to_hex(hostKey.publicKey);
      const scannedUrl = `${relay.baseUrl}/v1/qr?host=${hostPublisher}`;
      const host = new WebSocket(scannedUrl);
      await new Promise<void>(resolve => host.on("open", () => resolve()));
      const send = (msg: Record<string, unknown>) =>
        host.send(JSON.stringify({ version: 1, publisher: hostPublisher, ...msg }));
      host.on("message", raw => {
        const frame = JSON.parse(raw.toString());
        if (frame.message === "InitiateHandshake") {
          const cipher = makeMessageCipher(
            makeCipher(crypto.ecdh(hostKey, crypto.from_hex(frame.payload.ephemeral_public_key))),
          );
          send({
            message: "HandshakeChallenge",
            payload: cipher.encryptMessagePayload({ digits: 3, connected: false }),
          });
        } else if (frame.message === "CompleteHandshakeChallenge") {
          send({ message: "Failure", payload: { type: "SOMETHING_ELSE", message: "nope" } });
        }
      });

      const candidateP = createQRCodeCandidateInstance({
        memberCredentials: credentials(),
        memberName: "foo",
        addMember: jest.fn(() => Promise.resolve(TRUSTCHAIN)),
        scannedUrl,
        onRequestQRCodeInput: (_config, callback) => callback("123"),
      });

      const error = await candidateP.catch(e => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("TrustchainQRCode-SOMETHING_ELSE");
      expect(error.message).toBe("nope");
      host.close();
    });
  });

  it("rejects the host with QRCodeWSClosed when the socket closes before the end", async () => {
    let resolveUrl: (url: string) => void;
    const urlPromise = new Promise<string>(resolve => {
      resolveUrl = resolve;
    });
    const hostP = createQRCodeHostInstance({
      trustchainApiBaseUrl: relay.baseUrl,
      onDisplayQRCode: url => resolveUrl(url),
      onDisplayDigits: jest.fn(),
      addMember: jest.fn(() => Promise.resolve(TRUSTCHAIN)),
      memberCredentials: credentials(),
      memberName: "foo",
    });
    hostP.catch(() => {});
    await urlPromise;
    await new Promise(resolve => setTimeout(resolve, 100));

    relay.terminateSockets();

    const error = await hostP.catch(e => e);
    expect(error).toBeInstanceOf(QRCodeWSClosed);
    expect(typeof error.time).toBe("number");
  });

  it("rejects the candidate when the socket closes before the end", async () => {
    const hostPublisher = crypto.to_hex(crypto.randomKeypair().publicKey);
    const candidateP = createQRCodeCandidateInstance({
      memberCredentials: credentials(),
      memberName: "foo",
      addMember: jest.fn(() => Promise.resolve(TRUSTCHAIN)),
      scannedUrl: `${relay.baseUrl}/v1/qr?host=${hostPublisher}`,
      onRequestQRCodeInput: jest.fn(),
    });
    candidateP.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 100));

    relay.terminateSockets();

    await expect(candidateP).rejects.toThrow("qrcode websocket prematurely closed");
  });

  describe("isOldBase64Import", () => {
    it.each([
      ["an empty string", ""],
      ["a too short string", "AAAA"],
      ["a string that is not base64", "!".repeat(120)],
      ["a well-formed base64 without the legacy header", "A".repeat(120)],
    ])("returns false for %s", (_, input) => {
      expect(isOldBase64Import(input)).toBe(false);
    });
  });
});
