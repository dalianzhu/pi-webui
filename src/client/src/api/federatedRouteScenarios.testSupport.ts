import { FEDERATED_HTTP_ROUTES } from "../../../shared/federatedRoutes";
import { piWebUiApi } from "./clients";

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

/** PI WEBUI runtime and system status calls; every row must stay allowlisted on the federated proxy. */
export const piWebUiScenarios = {
  piWebUiStatus: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/status" },
    args: (machineId: string) => [machineId],
  }],
  checkForUpdates: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/status" },
    args: (machineId: string) => [machineId],
  }],
  piWebUiRuntime: [{
    kind: "gateway",
    httpMethod: "GET",
    endpoint: "api/pi-webui/runtime",
    args: () => [],
  }],
  systemInfo: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/system-info" },
    args: (machineId: string) => [machineId],
  }],
  systemMetrics: [{
    kind: "machine",
    route: { method: "GET", path: "/pi-webui/system-metrics" },
    args: (machineId: string) => [machineId],
  }],
} as const satisfies ScenarioTable<typeof piWebUiApi>;

/** Client namespaces converted to typed scenarios so far; later conversions extend this registry. */
export const MACHINE_SCOPED_CLIENT_APIS = {
  piWebUiApi,
} as const;

type StagedClientApiKey = keyof typeof MACHINE_SCOPED_CLIENT_APIS;
type StagedClientMethodKey<K extends StagedClientApiKey> = keyof (typeof MACHINE_SCOPED_CLIENT_APIS)[K];

/** Methods of each staged namespace that must reach the gateway instead of a selected machine. */
export const GATEWAY_ADDRESSED_METHODS = {
  piWebUiApi: ["piWebUiRuntime"],
} as const satisfies { readonly [K in StagedClientApiKey]: readonly StagedClientMethodKey<K>[] };

/** Complete scenario table per staged namespace, checked against that namespace's own API type. */
export const FEDERATED_ROUTE_SCENARIOS = {
  piWebUiApi: piWebUiScenarios,
} as const satisfies { readonly [K in StagedClientApiKey]: ScenarioTable<(typeof MACHINE_SCOPED_CLIENT_APIS)[K]> };
