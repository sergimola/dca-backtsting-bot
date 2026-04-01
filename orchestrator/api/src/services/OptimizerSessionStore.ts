/**
 * OptimizerSessionStore — Ephemeral in-memory session store for optimizer sweeps.
 *
 * Sessions are NOT persisted to any database (FR-034).
 * Each session tracks the full lifecycle of an optimizer sweep.
 */

import type { OptimizerSession, BatchRunResult } from '../types/optimizer.js';

export class OptimizerSessionStore {
  private sessions: Map<string, OptimizerSession> = new Map();

  create(session: OptimizerSession): void {
    this.sessions.set(session.sessionId, session);
  }

  get(sessionId: string): OptimizerSession | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, patch: Partial<OptimizerSession>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    Object.assign(session, patch);
  }

  addResult(sessionId: string, result: BatchRunResult): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.results.push(result);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Returns true if any session is currently in the 'running' phase. */
  hasRunningSession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.phase === 'running') return true;
    }
    return false;
  }

  /** Get all sessions (for debug/admin use only). */
  all(): OptimizerSession[] {
    return Array.from(this.sessions.values());
  }
}
