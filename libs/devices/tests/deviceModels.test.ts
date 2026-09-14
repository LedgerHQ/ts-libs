import {
  DeviceModelId,
  getBluetoothServiceUuids,
  getDeviceModel,
  getInfosForServiceUuid,
  identifyProductName,
  identifyUSBProductId,
} from "../src";

const nanoXServiceUuid = "13d63400-2c97-0004-0000-4c6564676572";

describe("getBlockSize", () => {
  it.each([
    [DeviceModelId.blue, "1.0.0", 4096],
    [DeviceModelId.nanoS, "1.6.1", 4096],
    [DeviceModelId.nanoS, "2.1.0", 2048],
    [DeviceModelId.nanoX, "2.2.3", 4096],
    [DeviceModelId.nanoSP, "1.1.1", 512],
    [DeviceModelId.stax, "1.3.0", 512],
    [DeviceModelId.europa, "1.1.0", 512],
    [DeviceModelId.apex, "1.0.0", 512],
  ])("%s on firmware %s uses a %i bytes block", (id, firmware, expected) => {
    expect(getDeviceModel(id).getBlockSize(firmware)).toBe(expected);
  });

  it("throws when the nanoS firmware version cannot be coerced", () => {
    expect(() => getDeviceModel(DeviceModelId.nanoS).getBlockSize("not-a-version")).toThrow(
      "Invalid Version",
    );
  });
});

describe("identifyUSBProductId", () => {
  it.each([
    [0x0000, DeviceModelId.blue],
    [0x0001, DeviceModelId.nanoS],
    [0x0004, DeviceModelId.nanoX],
    [0x0008, DeviceModelId.apex],
    [0x1011, DeviceModelId.nanoS],
    [0x4015, DeviceModelId.nanoX],
    [0x6011, DeviceModelId.stax],
    [0x7011, DeviceModelId.europa],
    [0x9000, undefined],
  ])("maps %i", (usbProductId, expected) => {
    expect(identifyUSBProductId(usbProductId)?.id).toBe(expected);
  });
});

describe("identifyProductName", () => {
  it.each([
    ["Nano X", DeviceModelId.nanoX],
    ["Nano S Plus", DeviceModelId.nanoSP],
    ["Europa", DeviceModelId.europa],
    ["Nano Gen5", undefined],
  ])("maps %s", (productName, expected) => {
    expect(identifyProductName(productName)?.id).toBe(expected);
  });
});

describe("bluetooth services", () => {
  it("exposes the service uuid of every bluetooth capable device", () => {
    expect(getBluetoothServiceUuids()).toEqual([
      nanoXServiceUuid,
      "13d63400-2c97-8004-0000-4c6564676572",
      "13d63400-2c97-6004-0000-4c6564676572",
      "13d63400-2c97-3004-0000-4c6564676572",
    ]);
  });

  it.each([nanoXServiceUuid, nanoXServiceUuid.replace(/-/g, ""), nanoXServiceUuid.toUpperCase()])(
    "resolves the infos of %s",
    uuid => {
      expect(getInfosForServiceUuid(uuid)).toMatchObject({
        deviceModel: { id: DeviceModelId.nanoX },
        notifyUuid: "13d63400-2c97-0004-0001-4c6564676572",
        writeUuid: "13d63400-2c97-0004-0002-4c6564676572",
        writeCmdUuid: "13d63400-2c97-0004-0003-4c6564676572",
      });
    },
  );

  it("returns undefined for an unknown service uuid", () => {
    expect(getInfosForServiceUuid("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});
