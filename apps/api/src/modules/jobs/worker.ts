import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../lib/db';

export interface Job {
  id: number;
  type: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (payload: Record<string, any>) => Promise<unknown>;

/** Exponential backoff in seconds for a failed attempt. */
export function backoffSeconds(attempt: number): number {
  return Math.min(3600, 10 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Postgres-backed job worker (claim_jobs uses FOR UPDATE SKIP LOCKED, so several
 * API instances can run workers safely). Runs memory consolidation, summaries,
 * scene tracking, rebuilds, embeddings and maintenance asynchronously.
 */
export class JobWorker {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastMaintenance = 0;
  private readonly id = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private db: Db,
    private handlers: Record<string, JobHandler>,
    private log: FastifyBaseLogger,
    private concurrency = 3,
    private maintenance?: () => Promise<void>,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.log.info({ worker: this.id }, 'job worker started');
    void this.loop();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop() {
    while (this.running) {
      let claimed = 0;
      try {
        claimed = await this.tick();
        if (this.maintenance && Date.now() - this.lastMaintenance > 3600_000) {
          this.lastMaintenance = Date.now();
          await this.maintenance().catch((e) => this.log.error({ err: e }, 'maintenance failed'));
        }
      } catch (e) {
        this.log.error({ err: e }, 'worker tick failed');
      }
      await new Promise<void>((r) => {
        this.timer = setTimeout(r, claimed ? 100 : 1500);
      });
    }
  }

  async tick(): Promise<number> {
    const { data, error } = await this.db.rpc('claim_jobs', { p_worker: this.id, p_limit: this.concurrency });
    if (error) throw new Error(error.message);
    const jobs = (data as Job[]) ?? [];
    await Promise.all(jobs.map((j) => this.run(j)));
    return jobs.length;
  }

  private async run(job: Job) {
    const handler = this.handlers[job.type];
    const started = Date.now();
    try {
      if (!handler) throw new Error(`no handler for ${job.type}`);
      await handler(job.payload);
      await this.db.from('jobs').update({ status: 'done', last_error: null }).eq('id', job.id);
      this.log.debug({ job: job.type, ms: Date.now() - started }, 'job done');
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 1000);
      const final = job.attempts >= job.max_attempts;
      const { error } = await this.db
        .from('jobs')
        .update({
          status: final ? 'failed' : 'pending',
          last_error: message,
          locked_at: null,
          run_at: new Date(Date.now() + backoffSeconds(job.attempts) * 1000).toISOString(),
        })
        .eq('id', job.id);
      // A newer pending job with the same dedupe key already covers this work.
      if (error) await this.db.from('jobs').update({ status: 'done', last_error: `superseded: ${message}` }).eq('id', job.id);
      this.log.warn({ job: job.type, attempts: job.attempts, err: message }, final ? 'job failed permanently' : 'job failed, will retry');
    }
  }
}
