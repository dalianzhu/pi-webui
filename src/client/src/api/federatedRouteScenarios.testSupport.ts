import { FEDERATED_HTTP_ROUTES } from "../../../shared/federatedRoutes";

// Distribute over the tuple union; preserve method/path correlation, omit policy.
type AllowlistedRouteKey = (typeof FEDERATED_HTTP_ROUTES)[number] extends infer R
  ? R extends { readonly method: infer M; readonly path: infer P }
    ? { readonly method: M; readonly path: P }
    : never
  : never;

type GatewayEndpoint = "api/pi-webui/runtime";

type MethodOf<Api, K extends keyof Api> = Extract<Api[K], (...args: never[]) => unknown>;
type ParamsOf<M> = M extends (...args: infer A) => unknown ? A : never;
type NonEmpty<T> = readonly [T, ...T[]];

export type Fixture<M> =
  | {
      readonly kind: "machine";
      readonly route: AllowlistedRouteKey;
      readonly httpMethod?: never;
      readonly endpoint?: never;
      readonly args: (machineId: string) => ParamsOf<M>;
    }
  | {
      readonly kind: "gateway";
      readonly httpMethod: "GET";
      readonly endpoint: GatewayEndpoint;
      readonly route?: never;
      readonly args: (machineId: string) => ParamsOf<M>;
    };

export type ScenarioTable<Api extends object> = {
  readonly [K in keyof Api as Api[K] extends infer T
    ? T extends (...args: never[]) => unknown ? K : never
    : never]-?: NonEmpty<Fixture<MethodOf<Api, K>>>;
};
