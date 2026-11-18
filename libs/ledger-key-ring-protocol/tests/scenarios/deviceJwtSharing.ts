import { HWDeviceProvider } from "../../src/HWDeviceProvider";
import { TRUSTCHAIN_API_STAGING } from "../test-helpers/config";
import { ScenarioOptions } from "../test-helpers/types";

// agent-intent-frontend gets a device login from another Ledger Sync client and hands it to its
// SDK, so getOrCreateTrustchain does not log the device in again.
export async function scenario(deviceId: string, { sdkForName, withDevice }: ScenarioOptions) {
  const otherClient = new HWDeviceProvider(TRUSTCHAIN_API_STAGING, withDevice);
  const deviceLogin = await otherClient.withJwt(deviceId, async jwt => jwt);

  const sdk = sdkForName("Shared login member");
  const creds = await sdk.initMemberCredentials();
  sdk.useDeviceJwt(deviceLogin);
  const { trustchain } = await sdk.getOrCreateTrustchain(deviceId, creds);
  expect(sdk.hasOwnDeviceJwt()).toBe(false);

  const members = await sdk.getMembers(trustchain, creds);
  expect(members.map(m => m.id)).toEqual([creds.pubkey]);

  await sdk.destroyTrustchain(trustchain, creds);
}
