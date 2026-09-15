export type SupportedRegistries = "ens";

export type DomainServiceResolution = {
  registry: SupportedRegistries;
  domain: string;
  address: string;
  type: "forward" | "reverse";
};

export type Registry = {
  name: SupportedRegistries;
  resolvers: {
    forward: string;
    reverse: string;
  };
  signatures: {
    forward: string;
    reverse: string;
  };
  patterns: {
    forward: RegExp;
    reverse: RegExp;
  };
  coinTypes: number[];
};

interface PromiseResolution<T> {
  status: "fulfilled";
  value: T;
}
interface PromiseRejection<E> {
  status: "rejected";
  reason: E;
}
export type PromiseResult<T, E = unknown> = PromiseResolution<T> | PromiseRejection<E>;
