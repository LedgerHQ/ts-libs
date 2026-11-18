import { Permissions } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { ScenarioOptions } from "../test-helpers/types";

// The application stream rotation of agent-intent-frontend: the device opens the next stream with
// the retained member, which replaces the previous one, restoreTrustchain moves to it, and a
// member added with the device without a path lands on that latest stream.
export async function scenario(deviceId: string, { sdkForName }: ScenarioOptions) {
  const sdk = sdkForName("Retained member");
  const creds = await sdk.initMemberCredentials();
  const { trustchain } = await sdk.getOrCreateTrustchain(deviceId, creds);
  expect(trustchain.applicationPath).toBe("m/0'/16'/0'");

  const nextPath = "m/0'/16'/1'";
  const retained = { name: "Retained member", id: creds.pubkey, permissions: Permissions.OWNER };
  await sdk.createStreamWithDevice(deviceId, trustchain, nextPath, retained);

  const rotated = await sdk.restoreTrustchain(trustchain, creds);
  expect(rotated.applicationPath).toBe(nextPath);
  expect(rotated.walletSyncEncryptionKey).not.toBe(trustchain.walletSyncEncryptionKey);
  expect(await sdk.closeStreamWithDevice(deviceId, trustchain, trustchain.applicationPath)).toBe(
    false,
  );

  const remoteCreds = await sdkForName("Remote agent").initMemberCredentials();
  const remote = { name: "Remote agent", id: remoteCreds.pubkey, permissions: Permissions.OWNER };
  await sdk.addMember(rotated, creds, remote, { deviceId });

  const streams = await sdk.getStreams(rotated, creds, { pathPrefix: "m/0'/16'/" });
  expect(
    streams.map(({ path, closed, members }) => [path, closed, members.map(m => m.id)]),
  ).toEqual([[nextPath, false, [creds.pubkey, remoteCreds.pubkey]]]);

  await sdk.destroyTrustchain(rotated, creds);
}
