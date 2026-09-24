export type EIP712MessageDomain = Partial<{
  name: string;
  chainId: number;
  version: string;
  verifyingContract: string;
  salt: string;
}>;

export type EIP712MessageTypesEntry = {
  name: string;
  type: string;
};

export type EIP712MessageTypes = {
  EIP712Domain: EIP712MessageTypesEntry[];
  [key: string]: EIP712MessageTypesEntry[];
};

export type EIP712Message = {
  domain: EIP712MessageDomain;
  types: EIP712MessageTypes;
  primaryType: string;
  message: Record<string, unknown>;
};

export type FieldFiltersV1 = {
  label: string;
  path: string;
  signature: string;
  format?: never;
  coin_ref?: never;
};

export type FieldFiltersV2 = {
  format: "raw" | "token" | "amount" | "datetime";
  label: string;
  path: string;
  signature: string;
} & (
  | {
      format: "raw" | "datetime";
      coin_ref?: never;
    }
  | {
      format: "token" | "amount";
      coin_ref: number;
    }
);

export type MessageFilters = {
  contractName: {
    label: string;
    signature: string;
  };
  fields: FieldFiltersV1[] | FieldFiltersV2[];
};

export type CALServiceEIP712Response = {
  eip712_signatures: {
    [contractAddress: string]: { [schemaHash: string]: MessageFilters };
  };
}[];
