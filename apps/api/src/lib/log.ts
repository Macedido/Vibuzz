/** Minimal structured logger that works in Node and Deno (JSON lines on stdout). */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

function serialize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack?.split('\n').slice(0, 5).join('\n') } : v;
  }
  return out;
}

export function createLogger(level = 'info'): Logger {
  const min = LEVELS[level as keyof typeof LEVELS] ?? LEVELS.info;
  const write = (lvl: keyof typeof LEVELS, obj: Record<string, unknown>, msg?: string) => {
    if (LEVELS[lvl] < min) return;
    const line = JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...serialize(obj) });
    if (lvl === 'error') console.error(line);
    else console.log(line);
  };
  return {
    debug: (o, m) => write('debug', o, m),
    info: (o, m) => write('info', o, m),
    warn: (o, m) => write('warn', o, m),
    error: (o, m) => write('error', o, m),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
