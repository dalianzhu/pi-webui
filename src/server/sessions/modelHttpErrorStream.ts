import {
  createAssistantMessageEventStream,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  isHttpErrorStatus,
  readModelHttpErrorStatus,
} from "../../shared/modelHttpError.js";

const MODEL_HTTP_ERROR_WRAPPED = Symbol("pi-webui.modelHttpErrorWrapped");
const SUPPORTED_FETCH_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "mistral-conversations",
  "pi-messages",
  "openai-codex-responses",
]);

const wrappedDelegates = new WeakMap<StreamFn, StreamFn>();
const wrappedRuntimes = new WeakMap<ModelRuntime, ModelRuntime>();

type CaptureObservation =
  | { kind: "unobserved" }
  | { kind: "pending"; attempt: number }
  | { kind: "response"; attempt: number; status: unknown }
  | { kind: "rejected"; attempt: number }
  | { kind: "ambiguous" };

interface CaptureState {
  observeFetch(
    fetch: typeof globalThis.fetch,
    receiver: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response>;
  freeze(): CaptureObservation;
}

/**
 * Wraps one session-agent stream dispatch with invocation-local HTTP observation.
 * The returned stream is live immediately; the forwarding pump owns delegate startup
 * so result-only consumers receive the same final message as event consumers.
 */
export function withModelHttpErrorStatus(delegate: StreamFn): StreamFn {
  if (isWrappedDelegate(delegate)) return delegate;
  const existing = wrappedDelegates.get(delegate);
  if (existing !== undefined) return existing;

  const wrapped: StreamFn = (model, context, options) => {
    const output = createAssistantMessageEventStream();
    const capture = shouldCaptureModel(model) ? createCaptureState() : undefined;
    const delegatedOptions = capture === undefined ? options : observedOptions(options, capture);
    void pumpStream(delegate, output, model, context, delegatedOptions, capture);
    return output;
  };

  Object.defineProperty(wrapped, MODEL_HTTP_ERROR_WRAPPED, { value: true, enumerable: false });
  wrappedDelegates.set(delegate, wrapped);
  return wrapped;
}

/**
 * Decorates only the runtime's recursive `streamSimple` boundary. Other runtime
 * methods stay bound to the original instance, while a virtual model's recursive
 * physical dispatch re-enters this proxy.
 */
export function withModelHttpErrorStatusRuntime(modelRuntime: ModelRuntime): ModelRuntime {
  const existing = wrappedRuntimes.get(modelRuntime);
  if (existing !== undefined) return existing;

  const decorated = new Proxy(modelRuntime, {
    get(target, property, receiver) {
      if (property === "streamSimple") {
        const original = target.streamSimple.bind(receiver);
        const streamSimple: ModelRuntime["streamSimple"] = (model, context, options) => {
          if (!shouldCaptureModel(model)) {
            return original.call(receiver, model, context, options);
          }

          const delegate: StreamFn = (routedModel, routedContext, routedOptions) =>
            original.call(receiver, routedModel, routedContext, routedOptions);
          const transcript = normalizeContext(context);
          const wrapped = withModelHttpErrorStatus(delegate);
          const result = wrapped(model, transcript, options);
          if (result instanceof Promise) {
            const output = createAssistantMessageEventStream();
            void pumpStream(
              () => result,
              output,
              model,
              transcript,
              options,
              undefined,
            );
            return output;
          }
          return result;
        };
        return streamSimple;
      }

      const value: unknown = Reflect.get(target, property, target);
      if (typeof value === "function") {
        return (...args: never[]) => {
          // Reflect.apply is typed as `any` for a dynamically reflected function.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return Reflect.apply(value, target, args);
        };
      }
      return value;
    },
  });
  wrappedRuntimes.set(modelRuntime, decorated);
  wrappedRuntimes.set(decorated, decorated);
  return decorated;
}

function shouldCaptureModel(model: Model<Api>): boolean {
  return SUPPORTED_FETCH_APIS.has(model.api);
}

function observedOptions(options: SimpleStreamOptions | undefined, capture: CaptureState): SimpleStreamOptions {
  const suppliedFetch = options?.fetch;
  const originalFetch = suppliedFetch ?? globalThis.fetch;
  const useGlobalReceiver = suppliedFetch === undefined;
  const observedFetch = function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const receiver = useGlobalReceiver ? globalThis : this;
    return capture.observeFetch(originalFetch, receiver, input, init);
  };
  return { ...(options ?? {}), fetch: observedFetch };
}

function createCaptureState(): CaptureState {
  let nextAttempt = 0;
  let latestAttempt = 0;
  let activeAttempts = new Set<number>();
  let observation: CaptureObservation = { kind: "unobserved" };
  let finalized = false;
  let frozenObservation: CaptureObservation | undefined;

  const updateAttempt = (attempt: number, next: CaptureObservation): void => {
    activeAttempts.delete(attempt);
    if (finalized || observation.kind === "ambiguous") return;
    if (attempt !== latestAttempt) return;
    observation = next;
  };

  return {
    observeFetch: (fetch, receiver, input, init) => {
      if (finalized) return Reflect.apply(fetch, receiver, [input, init]);

      const attempt = ++nextAttempt;
      latestAttempt = attempt;
      if (activeAttempts.size > 0 || observation.kind === "ambiguous") {
        observation = { kind: "ambiguous" };
      } else {
        observation = { kind: "pending", attempt };
      }
      activeAttempts.add(attempt);

      let result: Promise<Response>;
      try {
        result = Reflect.apply(fetch, receiver, [input, init]);
      } catch (error) {
        updateAttempt(attempt, { kind: "rejected", attempt });
        throw error;
      }

      return Promise.resolve(result).then(
        (response) => {
          let status: unknown;
          try {
            status = response.status;
          } catch {
            status = undefined;
          }
          updateAttempt(attempt, { kind: "response", attempt, status });
          return response;
        },
        (error: unknown) => {
          updateAttempt(attempt, { kind: "rejected", attempt });
          throw error;
        },
      );
    },
    freeze: () => {
      if (frozenObservation !== undefined) return frozenObservation;
      finalized = true;
      frozenObservation = observation;
      activeAttempts = new Set();
      return frozenObservation;
    },
  };
}

async function pumpStream(
  delegate: StreamFn,
  output: AssistantMessageEventStream,
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  capture: CaptureState | undefined,
): Promise<void> {
  let latestPartial: AssistantMessage | undefined;
  let outputEnded = false;
  let frozenObservation: CaptureObservation | undefined;

  const beginFinalization = (): CaptureObservation => {
    if (frozenObservation !== undefined) return frozenObservation;
    frozenObservation = capture?.freeze() ?? { kind: "unobserved" };
    return frozenObservation;
  };

  const publish = (
    message: AssistantMessage,
    observation: CaptureObservation,
    escapingError?: unknown,
  ): void => {
    if (outputEnded) return;
    const final = finalizeMessage(message, observation, escapingError);
    const terminal = terminalEvent(final);
    output.push(terminal);
    output.end(final);
    outputEnded = true;
  };

  try {
    const source = await delegate(model, context, options);
    for await (const event of source) {
      if (event.type === "done" || event.type === "error") {
        const observation = beginFinalization();
        try {
          const result = await source.result();
          publish(result, observation);
        } catch (error) {
          publish(syntheticFailure(model, latestPartial ?? terminalSource(event), error, options?.signal), observation, error);
        }
        return;
      }

      latestPartial = event.partial;
      output.push(event);
    }

    const observation = beginFinalization();
    try {
      const result = await source.result();
      publish(result, observation);
    } catch (error) {
      publish(syntheticFailure(model, latestPartial, error, options?.signal), observation, error);
    }
  } catch (error) {
    const observation = beginFinalization();
    publish(syntheticFailure(model, latestPartial, error, options?.signal), observation, error);
  }
}

function terminalSource(event: Extract<AssistantMessageEvent, { type: "done" | "error" }>): AssistantMessage {
  return event.type === "done" ? event.message : event.error;
}

function finalizeMessage(
  message: AssistantMessage,
  observation: CaptureObservation,
  escapingError?: unknown,
): AssistantMessage {
  const mutable = message;

  if (message.stopReason !== "error") {
    Reflect.deleteProperty(mutable, "piWebUiHttpStatus");
    return message;
  }

  let status: number | undefined;
  if (observation.kind === "response") {
    status = isHttpErrorStatus(observation.status) ? observation.status : undefined;
  } else if (observation.kind === "unobserved") {
    status = escapingError === undefined
      ? readModelHttpErrorStatus(message)
      : readEscapingErrorStatus(escapingError);
  }

  if (status === undefined) Reflect.deleteProperty(mutable, "piWebUiHttpStatus");
  else Reflect.set(mutable, "piWebUiHttpStatus", status);
  return message;
}

function readEscapingErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;

  const directCandidates = [error["statusCode"], error["status"]];
  for (const candidate of directCandidates) {
    if (typeof candidate === "number") return isHttpErrorStatus(candidate) ? candidate : undefined;
  }

  const metadata = error["$metadata"];
  if (isRecord(metadata) && typeof metadata["httpStatusCode"] === "number") {
    return isHttpErrorStatus(metadata["httpStatusCode"]) ? metadata["httpStatusCode"] : undefined;
  }

  const response = error["$response"];
  if (isRecord(response) && typeof response["statusCode"] === "number") {
    return isHttpErrorStatus(response["statusCode"]) ? response["statusCode"] : undefined;
  }

  return undefined;
}

function syntheticFailure(
  model: Model<Api>,
  partial: AssistantMessage | undefined,
  error: unknown,
  signal: AbortSignal | undefined,
): AssistantMessage {
  const stopReason = signal?.aborted === true ? "aborted" : "error";
  const errorMessage = signal?.aborted === true ? "Request was aborted" : errorMessageFor(error);
  if (partial !== undefined) {
    return { ...partial, stopReason, errorMessage };
  }
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

function terminalEvent(message: AssistantMessage): AssistantMessageEvent {
  switch (message.stopReason) {
    case "error":
      return { type: "error", reason: "error", error: message };
    case "aborted":
      return { type: "error", reason: "aborted", error: message };
    case "length":
      return { type: "done", reason: "length", message };
    case "toolUse":
      return { type: "done", reason: "toolUse", message };
    case "deferred":
      return { type: "done", reason: "deferred", message };
    case "pending":
      return { type: "done", reason: "stop", message };
    case "stop":
    default:
      return { type: "done", reason: "stop", message };
  }
}

function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWrappedDelegate(delegate: StreamFn): boolean {
  return Reflect.get(delegate, MODEL_HTTP_ERROR_WRAPPED) === true;
}
