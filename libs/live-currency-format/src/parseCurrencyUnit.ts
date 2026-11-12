import type { Unit } from "./types";
import BigNumber from "bignumber.js";

const decimal = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d{1,3})?$/i;

// parse a value that was formatted with formatCurrencyUnit
// NB this function parse a subset of formats because it it locale independant.
// make sure you have at least following options set on the formatter:
// - useGrouping: true
// - showCode: false
export const parseCurrencyUnit = (unit: Unit, valueString: string): BigNumber => {
  const str = valueString.replace(/,/g, ".").trim();
  if (!decimal.test(str)) return new BigNumber(0);
  return new BigNumber(str).shiftedBy(unit.magnitude).integerValue(BigNumber.ROUND_HALF_UP);
};
