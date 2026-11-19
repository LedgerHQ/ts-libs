import { Permissions } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { ScenarioOptions } from "../test-helpers/types";

// The App-16 agent enrollment of agent-intent-frontend: an App-18 SDK with only the device login
// reads the latest App-16 stream, after another client rotated it, and adds the agent there.
export async function scenario(deviceId: string, { sdkForName }: ScenarioOptions) {
  const sdkSync = sdkForName("Ledger Sync member");
  const syncCreds = await sdkSync.initMemberCredentials();
  const { trustchain } = await sdkSync.getOrCreateTrustchain(deviceId, syncCreds);
  const retained = {
    name: "Ledger Sync member",
    id: syncCreds.pubkey,
    permissions: Permissions.OWNER,
  };
  await sdkSync.createStreamWithDevice(deviceId, trustchain, "m/0'/16'/1'", retained);
  const rotated = await sdkSync.restoreTrustchain(trustchain, syncCreds);

  const sdk = sdkForName("App 18 runtime", { applicationId: 18 });
  const unusedCreds = await sdk.initMemberCredentials();
  const streams = await sdk.getStreams(trustchain, unusedCreds, {
    pathPrefix: "m/0'/16'/",
    deviceId,
  });
  expect(streams.map(({ path, closed }) => [path, closed])).toEqual([["m/0'/16'/1'", false]]);

  const agentCreds = await sdkForName("Agent").initMemberCredentials();
  const agent = {
    name: "Agent",
    id: agentCreds.pubkey,
    permissions: (Permissions.OWNER & ~0x4) >>> 0,
  };
  await sdk.addMember(trustchain, unusedCreds, agent, { path: streams[0].path, deviceId });

  const members = await sdkSync.getMembers(rotated, syncCreds);
  expect(members.map(({ id, permissions }) => [id, permissions])).toEqual([
    [syncCreds.pubkey, Permissions.OWNER],
    [agentCreds.pubkey, agent.permissions],
  ]);

  await sdkSync.destroyTrustchain(rotated, syncCreds);
}
