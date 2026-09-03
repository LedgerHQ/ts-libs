import axios, { AxiosHeaders } from "axios";
import { getNetworkState } from "./state";
import network, {
  errorInterceptor,
  newImplementation,
  requestInterceptor,
  responseInterceptor,
  setNetworkState,
} from "./network";
import type { LiveNetworkRequest } from "./network";
import { LedgerAPI4xx, LedgerAPI5xx } from "./errors";
import * as logs from "@ledgerhq/logs";

jest.mock("axios");

const mockedAxios = jest.mocked(axios);

describe("network", () => {
  const DEFAULT_STATE = {
    enableNetworkLogs: getNetworkState().enableNetworkLogs,
    debugHttpResponse: getNetworkState().debugHttpResponse,
    ledgerClientVersion: getNetworkState().ledgerClientVersion,
    getCallsTimeout: getNetworkState().getCallsTimeout,
    getCallsRetry: getNetworkState().getCallsRetry,
  };

  afterEach(() => {
    jest.clearAllMocks();
    setNetworkState(DEFAULT_STATE);
  });

  describe("requestInterceptor", () => {
    test("should return provided request unchanged when network logs are disabled", () => {
      const request = {
        baseURL: "baseURL",
        url: "url",
        data: "data",
        headers: new AxiosHeaders(),
      };
      const req = requestInterceptor(request);
      expect(req).toEqual(request);
    });

    test("should attach request metadata when network logs are enabled", () => {
      setNetworkState({ enableNetworkLogs: true });

      const request = {
        baseURL: "baseURL",
        url: "url",
        data: "data",
        headers: new AxiosHeaders(),
      };
      const req = requestInterceptor(request);
      expect(req).toEqual({
        ...request,
        metadata: { startTime: expect.any(Number) },
      });
    });

    test("should call log when network logs are enabled", () => {
      const spy = jest.spyOn(logs, "log");

      setNetworkState({ enableNetworkLogs: true });

      const request = {
        baseURL: "baseURL",
        url: "url",
        data: "data",
        headers: new AxiosHeaders(),
      };
      requestInterceptor(request);

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("responseInterceptor", () => {
    test("should return provided response unchanged when network logs are disabled", () => {
      const response = {
        config: {
          baseURL: "baseURL",
          url: "url",
          data: "data",
          headers: new AxiosHeaders(),
        },
        data: "data",
        status: 200,
        statusText: "OK",
        headers: new AxiosHeaders(),
      };
      const res = responseInterceptor(response);
      expect(res).toEqual(response);
    });

    test("should return provided response when network logs are enabled", () => {
      setNetworkState({ enableNetworkLogs: true });

      const response = {
        config: {
          baseURL: "baseURL",
          url: "url",
          data: "data",
          headers: new AxiosHeaders(),
        },
        headers: new AxiosHeaders(),
        data: "data",
        status: 200,
        statusText: "OK",
      };
      const res = responseInterceptor(response);
      expect(res).toEqual(response);
    });

    test("should call log when network logs are enabled", () => {
      const spy = jest.spyOn(logs, "log");

      setNetworkState({ enableNetworkLogs: true });

      const response = {
        config: {
          baseURL: "baseURL",
          url: "url",
          data: "data",
          headers: new AxiosHeaders(),
        },
        headers: new AxiosHeaders(),
        data: "data",
        status: 200,
        statusText: "OK",
      };
      responseInterceptor(response);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    test("should retry request when unsuccessful and response status is not 422", async () => {
      const response = {
        config: {
          baseURL: "baseURL",
          url: "url",
          data: "data",
          headers: new AxiosHeaders(),
        },
        data: "data",
        status: 500,
        statusText: "Error",
        headers: new AxiosHeaders(),
      };

      try {
        mockedAxios.mockImplementation(() => Promise.reject(response));
        await network({
          method: "GET",
          url: "https://google.com",
        });
        // eslint-disable-next-line no-empty
      } catch {}
      expect(mockedAxios).toHaveBeenCalledTimes(DEFAULT_STATE.getCallsRetry + 1);
    });

    test("should not retry request when response status is 422", async () => {
      const response = {
        config: {
          baseURL: "baseURL",
          url: "url",
          data: "data",
        },
        data: "data",
        status: 422,
        statusText: "Error",
        headers: {},
      };
      mockedAxios.mockImplementation(() => Promise.reject(response));

      try {
        await network({
          method: "GET",
          url: "https://google.com",
        });
        // eslint-disable-next-line no-empty
      } catch {}
      expect(mockedAxios).toHaveBeenCalledTimes(1);
    });
  });

  describe("ledger client version headers", () => {
    test("should set ledger client version as axios client headers", () => {
      setNetworkState({ ledgerClientVersion: "wallet-cli/0.1.1" });

      expect(axios.defaults.headers.common["X-Ledger-Client-Version"]).toBe("wallet-cli/0.1.1");
      expect(axios.defaults.headers.common["User-Agent"]).toBe("wallet-cli/0.1.1");
    });

    test("should clear ledger client version headers when ledgerClientVersion is empty", () => {
      setNetworkState({ ledgerClientVersion: "wallet-cli/0.1.1" });
      setNetworkState({ ledgerClientVersion: "" });

      expect(axios.defaults.headers.common["X-Ledger-Client-Version"]).toBeUndefined();
      expect(axios.defaults.headers.common["User-Agent"]).toBeUndefined();
    });
  });
});

type InterceptedError = Parameters<typeof errorInterceptor>[0];

const PRISTINE = { ...getNetworkState() };

const asError = (props: Partial<InterceptedError> = {}): InterceptedError =>
  Object.assign(
    new Error("failed"),
    { isAxiosError: true, toJSON: () => ({}), cause: undefined },
    props,
  );

const failing = (
  status: number,
  data: unknown,
  config: { baseURL?: string; method?: string; metadata?: { startTime: number } } = {},
): InterceptedError =>
  asError({
    response: {
      status,
      statusText: "",
      data,
      headers: {},
      config: { url: "/u", method: "get", headers: new AxiosHeaders(), ...config },
    },
  });

const settle = async (promise: Promise<unknown>): Promise<unknown> => {
  const settled = promise.catch(e => e);
  await jest.runAllTimersAsync();
  return settled;
};

describe("interceptors", () => {
  afterEach(() => {
    jest.clearAllMocks();
    setNetworkState(PRISTINE);
  });

  it("rethrows an error carrying no response config", () => {
    const error = asError();
    expect(() => errorInterceptor(error)).toThrow(error);
  });

  it.each<[number, jest.Constructable]>([
    [404, LedgerAPI4xx],
    [500, LedgerAPI5xx],
    [0, LedgerAPI5xx],
  ])("maps status %i to the matching typed error", (status, Expected) => {
    expect(() => errorInterceptor(failing(status, { message: "m" }))).toThrow(Expected);
  });

  it.each<[unknown, string]>([
    [{ message: "m" }, "m"],
    [{ error_message: "em" }, "em"],
    [{ error: "e" }, "e"],
    [{ msg: "s" }, "s"],
    [{ errors: [{ message: "nested" }] }, "nested"],
    [{ errors: ["plain"] }, "plain"],
    [{ errors: [] }, "API HTTP 400 /u"],
    [null, "API HTTP 400 /u"],
    [{ unknown: 1 }, "API HTTP 400 /u"],
    [JSON.stringify({ message: JSON.stringify({ message: "deep" }) }), "deep"],
    [
      JSON.stringify({ message: `JsDefined(${JSON.stringify({ message: "wrapped" })})` }),
      "wrapped",
    ],
    [JSON.stringify({ message: JSON.stringify({ message: { message: "twice" } }) }), "twice"],
    [JSON.stringify([{ message: JSON.stringify({ message: "first" }) }]), "first"],
    [JSON.stringify({ message: '{"code":1}' }), '{"code":1}'],
    [JSON.stringify({ message: { notAString: true } }), "API HTTP 400 /u"],
    [JSON.stringify({ message: JSON.stringify({ message: "" }) }), "API HTTP 400 /u"],
    ["<html>not json</html>", "API HTTP 400 /u"],
  ])("derives the message of %j", (data, message) => {
    expect(() => errorInterceptor(failing(400, data))).toThrow(message);
  });

  it("logs the failure, including the body only when debugHttpResponse is on", () => {
    const spy = jest.spyOn(logs, "log");
    const data = { message: "boom" };
    const throwing = () =>
      errorInterceptor(
        failing(500, data, {
          baseURL: "https://api",
          method: undefined,
          metadata: { startTime: Date.now() - 1234 },
        }),
      );

    expect(throwing).toThrow("boom");
    expect(spy).toHaveBeenLastCalledWith(
      "network-error",
      expect.stringMatching(/^500 {2}https:\/\/api\/u \(1[0-9]{3}ms\): boom$/),
      {},
    );

    setNetworkState({ debugHttpResponse: true });
    expect(throwing).toThrow("boom");
    expect(spy).toHaveBeenLastCalledWith("network-error", expect.any(String), { data });
  });

  it("logs a request and its response without a baseURL", () => {
    const spy = jest.spyOn(logs, "log");
    setNetworkState({ enableNetworkLogs: true });
    const config = { url: "/u", headers: new AxiosHeaders() };

    requestInterceptor(config);
    responseInterceptor({ config, data: "d", status: 200, statusText: "", headers: {} });

    expect(spy.mock.calls.map(call => call[1])).toEqual([
      " /u",
      expect.stringMatching(/^200 undefined \/u \(\d+ms\)$/),
    ]);
  });

  it("never sets a User-Agent header outside of node", () => {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });

    setNetworkState({ ledgerClientVersion: "web/1" });
    expect(axios.defaults.headers.common).toMatchObject({ "X-Ledger-Client-Version": "web/1" });
    expect(axios.defaults.headers.common["User-Agent"]).toBeUndefined();

    setNetworkState({ ledgerClientVersion: "" });
    expect(axios.defaults.headers.common["X-Ledger-Client-Version"]).toBeUndefined();

    Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });
  });
});

describe("request implementations", () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    setNetworkState(PRISTINE);
  });

  it("defaults to GET with the configured timeout and returns the response essentials", async () => {
    setNetworkState({ getCallsTimeout: 42 });
    const headers = new AxiosHeaders();
    mockedAxios.mockResolvedValue({ data: "d", status: 200, headers });

    await expect(newImplementation({ url: "/u" })).resolves.toEqual({
      data: "d",
      status: 200,
      headers,
    });
    expect(mockedAxios).toHaveBeenCalledWith({ url: "/u", method: "GET", timeout: 42 });
  });

  it.each<[LiveNetworkRequest<never>, unknown, number]>([
    [{ method: "POST" }, new Error("x"), 1],
    [{ method: "GET", timeout: 1 }, { status: 404 }, 1],
    [{ method: "GET", timeout: 1 }, { status: 503 }, 3],
    [{ method: "GET", timeout: 1 }, new Error("x"), 3],
  ])("issues %j on %j exactly %i time(s)", async (request, error, calls) => {
    mockedAxios.mockRejectedValue(error);

    await expect(settle(newImplementation({ url: "/u", ...request }))).resolves.toBe(error);
    expect(mockedAxios).toHaveBeenCalledTimes(calls);
  });

  it.each<["GET" | "POST", number]>([
    ["POST", 1],
    ["GET", 3],
  ])("retries a status-less %s through the deprecated export %i time(s)", async (method, calls) => {
    const error = new Error("x");
    mockedAxios.mockRejectedValue(error);

    await expect(settle(network({ url: "/u", method, timeout: 1 }))).resolves.toBe(error);
    expect(mockedAxios).toHaveBeenCalledTimes(calls);
  });
});
