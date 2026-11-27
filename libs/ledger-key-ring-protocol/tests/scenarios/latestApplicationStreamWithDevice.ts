import { Permissions } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { ScenarioOptions } from "../test-helpers/types";

// The App-16 agent enrollment of agent-intent-frontend: an App-18 SDK with only the device login
// adds the agent to the latest App-16 stream, after another client rotated it.
export async function scenario(deviceId: string, { sdkForName }: ScenarioOptions) {
  const sdkSync = sdkForName("Ledger Sync member");
  const syncCreds = await sdkSync.initMemberCredentials();
  const { trustchain } = await sdkSync.getOrCreateTrustchain(deviceId, syncCreds);
  const retained = {
    name: "Ledger Sync member",
    id: syncCreds.pubkey,
    permissions: Permissions.OWNER,
  };
  const rotated = await sdkSync.prepareApplicationStreamRotationWithDevice(
    deviceId,
    trustchain,
    syncCreds,
    retained,
  );
  expect(await sdkSync.restoreTrustchain(trustchain, syncCreds)).toEqual(rotated);

  const sdk = sdkForName("App 18 runtime", { applicationId: 18 });
  const agentCreds = await sdkForName("Agent").initMemberCredentials();
  const agent = {
    name: "Agent",
    id: agentCreds.pubkey,
    permissions: (Permissions.OWNER & ~0x4) >>> 0,
  };
  expect(await sdk.addMemberToApplicationWithDevice(deviceId, trustchain, agent)).toBe(
    rotated.applicationPath,
  );

  const members = await sdkSync.getMembers(rotated, syncCreds);
  expect(members.map(({ id, permissions }) => [id, permissions])).toEqual([
    [syncCreds.pubkey, Permissions.OWNER],
    [agentCreds.pubkey, agent.permissions],
  ]);

  await sdkSync.destroyTrustchain(rotated, syncCreds);
}
