// the stream stores 32 bits, so a larger or fractional value would be signed as other permissions
export function assertPermissions(permissions: number): void {
  if (!Number.isInteger(permissions) || permissions < -0x80000000 || permissions > 0xffffffff) {
    throw new Error(`permissions ${permissions} do not fit in 32 bits`);
  }
}

// a mask built with JS bitwise operators is signed, the stored value is not
export function samePermissions(a: number, b: number): boolean {
  return a >>> 0 === b >>> 0;
}
