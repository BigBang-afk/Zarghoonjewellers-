import { redact } from "./redact.js";

/**
 * Structured JSON logger. Fields such as requestId, conversationId,
 * customerId and actionId are carried as bound context; every payload passes
 * through `redact` so secrets never reach log storage.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogSink = (line: string) => void;

export function createLogger(bound: LogFields = {}, sink: LogSink = (line) => process.stdout.write(`${line}\n`)): Logger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}) => {
    const entry = redact({ ts: new Date().toISOString(), level, message, ...bound, ...fields });
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger({ ...bound, ...fields }, sink),
  };
}
