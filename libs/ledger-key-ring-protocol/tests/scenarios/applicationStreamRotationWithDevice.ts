import { Permissions } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { ScenarioOptions } from "../test-helpers/types";

// The application stream rotation of agent-intent-frontend: the device opens the next stream with
// the retained member, which replaces the previous one, restoreTrustchain moves to it, and a
// member added to the application with the device lands on that latest stream.
export async function scenario(deviceId: string, { sdkForName }: ScenarioOptions) {
  const sdk = sdkForName("Retained member");
  const creds = await sdk.initMemberCredentials();
  const { trustchain } = await sdk.getOrCreateTrustchain(deviceId, creds);
  expect(trustchain.applicationPath).toBe("m/0'/16'/0'");

  const nextPath = "m/0'/16'/1'";
  const retained = { name: "Retained member", id: creds.pubkey, permissions: Permissions.OWNER };
  const prepared = await sdk.prepareApplicationStreamRotationWithDevice(
    deviceId,
    trustchain,
    creds,
    retained,
  );
  expect(prepared.applicationPath).toBe(nextPath);

  const rotated = await sdk.restoreTrustchain(trustchain, creds);
  expect(rotated).toEqual(prepared);
  expect(rotated.walletSyncEncryptionKey).not.toBe(trustchain.walletSyncEncryptionKey);
  expect(await sdk.closeApplicationStreamWithDevice(deviceId, trustchain)).toBe(false);

  const remoteCreds = await sdkForName("Remote agent").initMemberCredentials();
  const remote = { name: "Remote agent", id: remoteCreds.pubkey, permissions: Permissions.OWNER };
  expect(await sdk.addMemberToApplicationWithDevice(deviceId, rotated, remote)).toBe(nextPath);

  const stream = await sdk.getApplicationStream(rotated, creds);
  expect(stream?.path).toBe(nextPath);
  expect(stream?.closed).toBe(false);
  expect(stream?.members.map(m => m.id)).toEqual([creds.pubkey, remoteCreds.pubkey]);

  await sdk.destroyTrustchain(rotated, creds);
}
