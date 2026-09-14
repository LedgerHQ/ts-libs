import Transport from "@ledgerhq/hw-transport";
import {
  aTransportBuilder,
  createTransportRecorder,
  createTransportReplayer,
  MockTransport,
  openTransportReplayer,
  RecordStore,
  TransportReplayer,
} from "../src";

const APDU = "e016000000";
const RES = "000000050107426974636f696e034254439000";
const buf = (hex: string) => Buffer.from(hex, "hex");
const aStore = () => RecordStore.fromString(`=> ${APDU}\n<= ${RES}`);
const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

class Fake extends MockTransport {
  static open = () => Promise.resolve(new Fake(buf(RES)));
}

test("MockTransport answers its canned response until it is replaced", async () => {
  const t = new MockTransport(buf(RES));
  expect(await t.send(0xe0, 0x16, 0, 0)).toEqual(buf(RES));
  t.setNewResponse(buf("9000"));
  expect(await t.exchange(buf(APDU))).toEqual(buf("9000"));
});

test("aTransportBuilder overrides only the given props", () => {
  const t = aTransportBuilder({ exchangeTimeout: 1 });
  expect(t.exchangeTimeout).toBe(1);
  expect(t.unresponsiveTimeout).toBe(15000);
});

test("createTransportRecorder records what the decorated transport answers", async () => {
  const store = new RecordStore();
  const Recorder = createTransportRecorder(
    new Fake(buf(RES)),
    store,
  ) as unknown as typeof Transport;
  const t = await Recorder.open();
  expect(await t.exchange(buf(APDU))).toEqual(buf(RES));
  expect(t.setScrambleKey("BTC")).toBeUndefined();
  await expect(t.close()).resolves.toBeUndefined();
  expect(store.toString()).toBe(`=> ${APDU}\n<= ${RES}\n`);
});

test("createTransportReplayer warns it is deprecated", () => {
  createTransportReplayer(aStore());
  expect(warn).toHaveBeenCalledWith("TO BE DEPRECATED: use openTransportReplayer instead");
});

const replayers: [string, (s: RecordStore) => typeof Transport][] = [
  ["createTransportReplayer", s => createTransportReplayer(s) as unknown as typeof Transport],
  ["TransportReplayer", () => TransportReplayer as unknown as typeof Transport],
];

describe.each(replayers)("%s", (_name, make) => {
  const open = (s = aStore()) => make(s).open(s);

  test("replays the store, then rejects on a mismatch and on eof", async () => {
    const t = await open();
    expect(await t.send(0xe0, 0x16, 0, 0)).toEqual(buf(RES));
    await expect(t.exchange(buf(APDU))).rejects.toThrow("EOF: no more APDU to replay");
    await expect((await open()).exchange(buf("b001000000"))).rejects.toThrow(
      `wrong apdu to replay line 0. Expected ${APDU}, Got b001000000`,
    );
  });

  test("is always supported, lists one null descriptor and closes", async () => {
    const C = make(aStore());
    expect(await C.isSupported()).toBe(true);
    expect(await C.list()).toEqual([null]);
    const t = await open();
    expect(t.setScrambleKey("BTC")).toBeUndefined();
    await expect(t.close()).resolves.toBeUndefined();
  });

  test("listen emits one add event, unless unsubscribed first", async () => {
    const C = make(aStore());
    const next = jest.fn();
    await new Promise<void>(done => C.listen({ next, error: () => {}, complete: done }));
    expect(next).toHaveBeenCalledWith({ type: "add", descriptor: null });
    C.listen({ next, error: jest.fn(), complete: jest.fn() }).unsubscribe();
    await new Promise(done => setTimeout(done, 1));
    expect(next).toHaveBeenCalledTimes(1);
  });
});

test("TransportReplayer delays the exchange then resets the delay", async () => {
  jest.useFakeTimers();
  const t = await openTransportReplayer(aStore());
  t.setArtificialExchangeDelay(500);
  const exchange = t.exchange(buf(APDU));
  jest.advanceTimersByTime(500);
  expect(await exchange).toEqual(buf(RES));
  expect(t.artificialExchangeDelay).toBe(0);
  jest.useRealTimers();
});

test("TransportReplayer holds the exchange until unblocked", async () => {
  const t = await openTransportReplayer(aStore());
  t.enableExchangeBlocker();
  const exchange = t.exchange(buf(APDU));
  t.unblockExchange();
  expect(await exchange).toEqual(buf(RES));
  expect(t.exchangeBlocker).toBeNull();
  t.unblockExchange();
});
