import { Permissions } from "@ledgerhq/hw-ledger-key-ring-protocol";
import { ScenarioOptions } from "../test-helpers/types";

// The agent flow of agent-intent-frontend: an App-18 member with limited permissions, and one
// stream per agent generation below the App-18 stream (`<app>/<object>'/<generation>'`), which
// the device creates and closes. The backend returns those streams with their parent, and only
// the latest generation of each object.
export async function scenario(deviceId: string, { sdkForName }: ScenarioOptions) {
  const sdkSync = sdkForName("Ledger Sync member");
  const syncCreds = await sdkSync.initMemberCredentials();
  const { trustchain: syncTrustchain } = await sdkSync.getOrCreateTrustchain(deviceId, syncCreds);

  const sdk = sdkForName("App 18 member", { applicationId: 18 });
  const creds = await sdk.initMemberCredentials();
  const memberPermissions = Permissions.KEY_READER | Permissions.KEY_CREATOR;
  const { trustchain } = await sdk.getOrCreateTrustchain(deviceId, creds, {
    softwareMemberPermissions: memberPermissions,
  });
  const app = trustchain.applicationPath;
  expect(app).toBe("m/0'/18'/0'");

  const agentCreds = await sdkForName("Agent").initMemberCredentials();
  const agent = { name: "Agent", id: agentCreds.pubkey, permissions: Permissions.MEMBER };
  const otherCreds = await sdkForName("Other agent").initMemberCredentials();
  const other = { name: "Other agent", id: otherCreds.pubkey, permissions: Permissions.MEMBER };
  const readStreams = async (pathPrefix: string) => {
    const streams = await sdk.getStreams(trustchain, creds, {
      pathPrefix,
      ignorePermissionsChecks: true,
    });
    return streams
      .map(({ path, closed, members }) => ({
        path,
        closed,
        members: members.map(m => [m.id, m.permissions]),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  };

  await sdk.createStreamWithDevice(deviceId, trustchain, `${app}/7'/0'`, agent);
  await sdk.createStreamWithDevice(deviceId, trustchain, `${app}/9'/0'`, other);
  expect(await readStreams(app)).toEqual([
    { path: app, closed: false, members: [[creds.pubkey, memberPermissions]] },
    { path: `${app}/7'/0'`, closed: false, members: [[agentCreds.pubkey, Permissions.MEMBER]] },
    { path: `${app}/9'/0'`, closed: false, members: [[otherCreds.pubkey, Permissions.MEMBER]] },
  ]);
  expect((await readStreams(`${app}/7'`)).map(s => s.path)).toEqual([`${app}/7'/0'`]);

  expect(await sdk.closeStreamWithDevice(deviceId, trustchain, `${app}/7'/0'`)).toBe(true);
  expect((await readStreams(`${app}/7'`)).map(s => [s.path, s.closed])).toEqual([
    [`${app}/7'/0'`, true],
  ]);
  expect(await sdk.closeStreamWithDevice(deviceId, trustchain, `${app}/7'/0'`)).toBe(false);

  await sdk.createStreamWithDevice(deviceId, trustchain, `${app}/7'/1'`, agent);
  expect((await readStreams(app)).map(s => [s.path, s.closed])).toEqual([
    [app, false],
    [`${app}/7'/1'`, false],
    [`${app}/9'/0'`, false],
  ]);
  expect(await sdk.closeStreamWithDevice(deviceId, trustchain, `${app}/7'/0'`)).toBe(false);

  await sdkSync.destroyTrustchain(syncTrustchain, syncCreds);
}
