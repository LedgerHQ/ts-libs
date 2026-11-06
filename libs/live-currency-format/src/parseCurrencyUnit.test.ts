import BigNumber from "bignumber.js";
import type { Unit } from "./types";
import { parseCurrencyUnit } from "./parseCurrencyUnit";

const unit: Unit = {
  name: "Test Unit",
  code: "TST",
  magnitude: 2,
  showAllDigits: false,
  prefixCode: false,
};

describe("parseCurrencyUnit", () => {
  test("parses dot decimals", () => {
    expect(parseCurrencyUnit(unit, "1.23")).toEqual(new BigNumber(123));
  });

  test("parses comma decimals", () => {
    expect(parseCurrencyUnit(unit, "1,23")).toEqual(new BigNumber(123));
  });

  test.each([
    ["0", "0"],
    ["42", "4200"],
    ["-1,5", "-150"],
    ["+1", "100"],
    ["1.", "100"],
    [".5", "50"],
    [" 1.5 ", "150"],
    ["1e3", "100000"],
    ["1.5E-1", "15"],
    ["1e-7", "0"],
    ["1e300", `1${"0".repeat(302)}`],
    ["0.005", "1"],
    ["0.004", "0"],
    ["123456789012345678.99", "12345678901234567899"],
  ])("parses %j", (input, expected) => {
    expect(parseCurrencyUnit(unit, input).toFixed()).toBe(expected);
  });

  test.each([
    "",
    " ",
    "\t\n",
    "invalid",
    "12abc",
    "1.2.3",
    "1,2.3",
    "1 000",
    "-",
    ".",
    ",",
    "1_000",
    "1_5",
    "NaN",
    "Infinity",
    "-Infinity",
    "1e9999999999",
  ])("returns zero on invalid input %j", input => {
    expect(parseCurrencyUnit(unit, input)).toEqual(new BigNumber(0));
  });

  test("does not depend on DECIMAL_PLACES for large magnitudes", () => {
    expect(parseCurrencyUnit({ ...unit, magnitude: 45 }, `0.${"0".repeat(44)}1`).toFixed()).toBe(
      "1",
    );
  });

  test("rejects long garbage input quickly", () => {
    const start = Date.now();
    expect(parseCurrencyUnit(unit, `${"1".repeat(100000)}x`)).toEqual(new BigNumber(0));
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
