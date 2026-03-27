export type LangfuseTraceContext = {
  traceId: string | null;
  enabled: boolean;
};

export class LangfuseTracer {
  createTraceContext(): LangfuseTraceContext {
    return {
      traceId: null,
      enabled: false
    };
  }
}
