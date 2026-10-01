import {
  INITIAL_STATE,
  getInitialStore,
  memberCredentialsSelector,
  setMemberCredentials,
  setTrustchain,
  trustchainHandlers,
  trustchainSelector,
  trustchainStoreSelector,
  type TrustchainStore,
} from "../../store";

const trustchain = {
  rootId: "root-id",
  walletSyncEncryptionKey: "wallet-sync-encryption-key",
  applicationPath: "m/0'/16'/0'",
};
const memberCredentials = { pubkey: "pub", privatekey: "priv" };
const state: TrustchainStore = { trustchain, memberCredentials };

describe("trustchain store (actions, handlers and selectors)", () => {
  it("returns the initial store", () => {
    expect(getInitialStore()).toEqual({ trustchain: null, memberCredentials: null });
    expect(getInitialStore()).toBe(INITIAL_STATE);
  });

  it("builds a set trustchain action", () => {
    expect(setTrustchain(trustchain)).toEqual({
      type: "TRUSTCHAIN_STORE_SET_TRUSTCHAIN",
      payload: { trustchain },
    });
  });

  it("builds a set member credentials action", () => {
    expect(setMemberCredentials(memberCredentials)).toEqual({
      type: "TRUSTCHAIN_STORE_SET_MEMBER_CREDENTIALS",
      payload: { memberCredentials },
    });
  });

  it("replaces the whole state on import", () => {
    const imported: TrustchainStore = { trustchain: null, memberCredentials };
    expect(
      trustchainHandlers.TRUSTCHAIN_STORE_IMPORT_STATE(state, {
        payload: { trustchain: imported },
      }),
    ).toBe(imported);
  });

  it("sets the trustchain while keeping the credentials", () => {
    const next = trustchainHandlers.TRUSTCHAIN_STORE_SET_TRUSTCHAIN(
      { trustchain: null, memberCredentials },
      setTrustchain(trustchain),
    );
    expect(next).toEqual({ trustchain, memberCredentials });
  });

  it("sets the member credentials while keeping the trustchain", () => {
    const next = trustchainHandlers.TRUSTCHAIN_STORE_SET_MEMBER_CREDENTIALS(
      { trustchain, memberCredentials: null },
      setMemberCredentials(memberCredentials),
    );
    expect(next).toEqual({ trustchain, memberCredentials });
  });

  it("selects from the root state", () => {
    const root = { trustchain: state };
    expect(trustchainStoreSelector(root)).toBe(state);
    expect(trustchainSelector(root)).toBe(trustchain);
    expect(memberCredentialsSelector(root)).toBe(memberCredentials);
  });
});
