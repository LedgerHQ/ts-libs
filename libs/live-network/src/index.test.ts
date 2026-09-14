import network, {
  getNetworkState,
  LedgerAPI4xx,
  LedgerAPI5xx,
  NetworkDown,
  setNetworkState,
} from "./index";
import { newImplementation } from "./network";

jest.mock("axios");

it("re-exports the public API", () => {
  expect(network).toBe(newImplementation);
  expect([getNetworkState(), setNetworkState({})]).toEqual([expect.any(Object), undefined]);
  expect([LedgerAPI4xx, LedgerAPI5xx, NetworkDown].map(E => new E().name)).toEqual([
    "LedgerAPI4xx",
    "LedgerAPI5xx",
    "NetworkDown",
  ]);
});
