import { NobleCryptoSecp256k1 } from "./NobleCrypto";

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface KeyPairWithChainCode extends KeyPair {
  chainCode: Uint8Array;
}

/**
 *
 */
export interface Crypto {
  randomKeypair(): KeyPair;
  keypairFromSecretKey(secretKey: Uint8Array): KeyPair;
  sign(message: Uint8Array, keyPair: KeyPair): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  encrypt(secret: Uint8Array, nonce: Uint8Array, message: Uint8Array): Uint8Array;
  decrypt(secret: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array;
  randomBytes(size: number): Uint8Array;
  ecdh(keyPair: KeyPair, publicKey: Uint8Array): Uint8Array;
  hash(message: Uint8Array): Uint8Array;
  computeSymmetricKey(privateKey: Uint8Array, extra: Uint8Array): Uint8Array;
  from_hex(hex: string): Uint8Array;
  to_hex(bytes?: Uint8Array): string;
  derivePrivate(xpriv: Uint8Array, path: number[]): KeyPairWithChainCode;
}

export class DerivationPath {
  private constructor() {}

  static hardenedIndex(index: number): number {
    return index + 0x80000000;
  }

  static reverseHardenedIndex(index: number): number {
    return index - 0x80000000;
  }

  static toIndexArray(path: string | number[]): number[] {
    if (Array.isArray(path)) {
      return path;
    }
    const components = path === "m" || path.startsWith("m/") ? path.substring(2) : path;
    if (components === "") {
      return [];
    }
    return components.split("/").map(s => {
      const match = /^(\d+)(['h]?)$/.exec(s);
      const index = match ? Number(match[1]) : NaN;
      if (!match || index > 0x7fffffff) {
        throw new Error(`Invalid derivation path component "${s}" in "${path}"`);
      }
      return match[2] ? index + 0x80000000 : index;
    });
  }

  static toString(path: number[] | string): string {
    if (typeof path === "string") {
      return path;
    }
    return (
      "m/" +
      path
        .map(s => {
          if (s >= 0x80000000) {
            return s - 0x80000000 + "'";
          }
          return s;
        })
        .join("/")
    );
  }
}

/**
 *
 */
export const crypto = new NobleCryptoSecp256k1();
