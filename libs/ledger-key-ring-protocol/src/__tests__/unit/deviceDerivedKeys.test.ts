import fs from "fs";
import path from "path";
import {
  crypto,
  DerivationPath,
  SoftwareDevice,
  StreamTree,
} from "@ledgerhq/hw-ledger-key-ring-protocol";

type Recording = {
  http: {
    transactions: { request: { method: string; url: string }; response: { body: string } }[];
  };
  crypto: { randomKeypairOutputs: string[] };
};

const APP_18 = "m/0'/18'/0'";

// recorded with the Ledger Sync app: the device derived each agent stream from its root
const recording: Recording = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../../mocks/scenarios/agentStreamsWithDevice.json"),
    "utf8",
  ),
);

const recordedTrees = recording.http.transactions
  .filter(({ request }) => request.method === "GET" && /\/trustchain\/[0-9a-f]+$/.test(request.url))
  .map(({ response }) => StreamTree.deserialize(JSON.parse(response.body)));

async function app18Member(tree: StreamTree): Promise<SoftwareDevice> {
  const members = (await tree.getChild(APP_18)!.resolve()).getMembersData().map(m => m.id);
  const secret = recording.crypto.randomKeypairOutputs.find(hex =>
    members.includes(crypto.to_hex(crypto.keypairFromSecretKey(crypto.from_hex(hex)).publicKey)),
  );
  if (!secret) throw new Error("the recording has no key of an App-18 member");
  return new SoftwareDevice(crypto.keypairFromSecretKey(crypto.from_hex(secret)));
}

describe("SoftwareDevice keys of the streams below its own stream, against the device", () => {
  it("reads the key the device derived for every recorded agent stream", async () => {
    const checked = new Set<string>();
    for (const tree of recordedTrees) {
      const agentStreams = Object.keys(tree.serialize()).filter(p => p.startsWith(`${APP_18}/`));
      if (agentStreams.length === 0) continue;
      const member = await app18Member(tree);
      const memberKey = (await member.getPublicKey()).publicKey;
      for (const streamPath of agentStreams) {
        const indexes = DerivationPath.toIndexArray(streamPath);
        // the member must reach the key through APP_18, or nothing is derived
        const holder = (await tree.getPublishKeyEvent(memberKey, indexes))?.streamPath;
        const xpriv = await member.readKey(tree, indexes);
        const readPublicKey = crypto.keypairFromSecretKey(xpriv.slice(0, 32)).publicKey;
        const deviceGroupKey = (await tree.getChild(streamPath)!.resolve()).getGroupPublicKey();
        expect([streamPath, holder, crypto.to_hex(readPublicKey)]).toEqual([
          streamPath,
          DerivationPath.toIndexArray(APP_18),
          crypto.to_hex(deviceGroupKey),
        ]);
        checked.add(streamPath);
      }
    }
    expect(checked).toEqual(new Set([`${APP_18}/7'/0'`, `${APP_18}/7'/1'`, `${APP_18}/9'/0'`]));
  });
});
