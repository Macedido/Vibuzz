import { describe, expect, it, vi } from 'vitest';
import { ConversationService } from '../src/modules/conversations/service';

// Tiny in-memory stand-in for the supabase query builder used by deleteMessage.
type Row = { id: string; conversation_id: string; parent_id: string | null; role: string; deleted_at: string | null; content: string };
function fakeDb(rows: Row[], conv: { id: string; active_leaf_id: string | null }) {
  const updates: { table: string; patch: Record<string, unknown>; ids: string[] }[] = [];
  const db = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      let ids: string[] = [];
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (k: string, v: unknown) => (table === 'conversations' ? (ids = [String(v)]) : filters.push((r) => (r as never)[k] === v), q),
        in: (k: string, v: unknown[]) => (k === 'id' ? (ids = v.map(String)) : filters.push((r) => v.includes((r as never)[k])), q),
        is: (k: string, v: unknown) => (filters.push((r) => (r as never)[k] === v), q),
        then: (resolve: (x: unknown) => void) => {
          if (patch) {
            updates.push({ table, patch, ids });
            if (table === 'messages') rows.filter((r) => ids.includes(r.id) && r.deleted_at === null).forEach((r) => Object.assign(r, patch));
            if (table === 'conversations') Object.assign(conv, patch);
            return resolve({ data: null, error: null });
          }
          resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return q;
    },
  };
  return { db, updates };
}

function setup(rows: Row[], leaf: string) {
  const conv = { id: 'c', user_id: 'u', active_leaf_id: leaf };
  const { db } = fakeDb(rows, conv);
  const repo = {
    db,
    message: async (id: string) => rows.find((r) => r.id === id)!,
    conversation: async () => conv,
    pathMessages: async (leafId: string | null) => {
      const out: Row[] = [];
      let cur = rows.find((r) => r.id === leafId);
      while (cur) {
        if (!cur.deleted_at) out.unshift(cur);
        cur = rows.find((r) => r.id === cur!.parent_id);
      }
      return out;
    },
  };
  const memory = { invalidateForMessages: vi.fn(async () => {}) };
  const svc = new ConversationService({} as never, repo as never, {} as never, memory as never, {} as never, {} as never, { remove: async () => {} } as never);
  return { svc, conv, memory };
}

const row = (id: string, parent: string | null, role: string): Row => ({ id, conversation_id: 'c', parent_id: parent, role, deleted_at: null, content: id });

describe('deleting a message', () => {
  it('also deletes every reply to it and moves the conversation back', async () => {
    const rows = [row('u1', null, 'user'), row('a1', 'u1', 'assistant'), row('u2', 'a1', 'user'), row('a2', 'u2', 'assistant'), row('a2b', 'u2', 'assistant')];
    const { svc, conv, memory } = setup(rows, 'a2');
    const out = await svc.deleteMessage('u', 'u2', false);
    expect(out.ids.sort()).toEqual(['a2', 'a2b', 'u2']);
    expect(rows.filter((r) => r.deleted_at).map((r) => r.id).sort()).toEqual(['a2', 'a2b', 'u2']);
    expect(conv.active_leaf_id).toBe('a1');
    expect(memory.invalidateForMessages).toHaveBeenCalledWith(expect.arrayContaining(['u2', 'a2', 'a2b']), { purge: false });
  });

  it('follows group replies (member after member) but stops at the next user message', async () => {
    const rows = [row('u1', null, 'user'), row('m1', 'u1', 'assistant'), row('m2', 'm1', 'assistant'), row('u2', 'm2', 'user'), row('m3', 'u2', 'assistant')];
    const { svc, conv } = setup(rows, 'm3');
    const out = await svc.deleteMessage('u', 'u1', false);
    expect(out.ids.sort()).toEqual(['m1', 'm2', 'u1']);
    expect(rows.find((r) => r.id === 'u2')!.deleted_at).toBeNull();
    expect(conv.active_leaf_id).toBe('m3');
  });

  it('deleting a character message removes only that message', async () => {
    const rows = [row('u1', null, 'user'), row('a1', 'u1', 'assistant')];
    const { svc, conv } = setup(rows, 'a1');
    const out = await svc.deleteMessage('u', 'a1', false);
    expect(out.ids).toEqual(['a1']);
    expect(conv.active_leaf_id).toBe('u1');
  });
});
