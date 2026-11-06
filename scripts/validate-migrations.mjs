// Applies every Supabase migration to an in-memory Postgres (PGlite + pgvector)
// with a minimal stub of Supabase's auth/storage schemas, then checks the
// behaviour that matters: signup trigger, RLS isolation, column grants,
// conversation tree, memory retrieval, discovery and the job queue.
//
// Run: npm run test:db
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { vector } from '@electric-sql/pglite-pgvector';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');

const db = await PGlite.create({ extensions: { vector, pg_trgm, unaccent } });

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
`;

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}
async function expectError(name, fn, match) {
  try {
    await fn();
    check(name, false, '(expected an error)');
  } catch (e) {
    check(name, !match || String(e.message).includes(match), `(got: ${e.message})`);
  }
}
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const vec = (seed) => `[${Array.from({ length: 1536 }, (_, i) => Math.sin(seed * (i + 1)).toFixed(5)).join(',')}]`;

console.log('Applying migrations');
await db.exec(STUB);
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    check(file, true);
  } catch (e) {
    check(file, false, e.message);
    console.error(e);
    process.exit(1);
  }
}

try {
console.log('Signup trigger');
const alice = (await one(`insert into auth.users (email, raw_user_meta_data) values ('a@x.com', '{"birthdate":"1998-04-10","username":"alice","display_name":"Alice"}') returning id`)).id;
const bob = (await one(`insert into auth.users (email, raw_user_meta_data) values ('b@x.com', '{"birthdate":"2000-01-01","username":"bob"}') returning id`)).id;
const teen = (await one(`insert into auth.users (email, raw_user_meta_data) values ('t@x.com', '{"birthdate":"${new Date().getFullYear() - 15}-01-01","username":"teen"}') returning id`)).id;
check('profile created', (await one(`select username from user_profiles where id = $1`, [alice])).username === 'alice');
await expectError('under 13 rejected', () => db.query(`insert into auth.users (email, raw_user_meta_data) values ('k@x.com', '{"birthdate":"${new Date().getFullYear() - 10}-01-01"}')`), 'underage');
await expectError('birthdate required', () => db.query(`insert into auth.users (email, raw_user_meta_data) values ('n@x.com', '{}')`), 'birthdate_required');
const dup = (await one(`insert into auth.users (email, raw_user_meta_data) values ('d@x.com', '{"birthdate":"1990-01-01","username":"alice"}') returning id`)).id;
check('duplicate username gets fallback', (await one(`select username from user_profiles where id = $1`, [dup])).username.startsWith('user_'));
await expectError('teen cannot enable mature', () => db.query(`update users set allow_mature = true where id = $1`, [teen]), 'mature_requires_adult');
await db.query(`update users set allow_mature = true where id = $1`, [alice]);

console.log('Characters & RLS');
const pub = (await one(`insert into characters (creator_id, name, tagline, visibility, category_slug, search_text, published_at) values ($1, 'Kael Voss', 'Gênio arrogante', 'public', 'ficcao-cientifica', 'cidade futurista hacker', now()) returning id`, [bob])).id;
const priv = (await one(`insert into characters (creator_id, name, visibility) values ($1, 'Segredo', 'private') returning id`, [bob])).id;
const mature = (await one(`insert into characters (creator_id, name, visibility, maturity, published_at) values ($1, 'Noir', 'public', 'mature', now()) returning id`, [bob])).id;
const v1 = (await one(`insert into character_versions (character_id, version, sheet) values ($1, 1, '{"name":"Kael Voss"}') returning id`, [pub])).id;
await db.query(`update characters set current_version_id = $1, current_version = 1, embedding = $2 where id = $3`, [v1, vec(1), pub]);
const grp = (await one(`insert into characters (creator_id, kind, name, visibility, published_at) values ($1, 'group', 'Os Quatro', 'public', now()) returning id`, [bob])).id;
await db.query(`insert into character_groups (character_id) values ($1)`, [grp]);
const lucas = (await one(`insert into characters (creator_id, kind, parent_group_id, name, visibility) values ($1, 'member', $2, 'Lucas', 'private') returning id`, [bob, grp])).id;
await db.query(`insert into group_members (group_id, member_id) values ($1, $2)`, [grp, lucas]);
const tag = (await one(`insert into tags (slug, name) values ('hacker', 'hacker') returning id`)).id;
await db.query(`insert into character_tags values ($1, $2)`, [pub, tag]);

await as(alice, async () => {
  const ids = (await all(`select id from characters`)).map((r) => r.id);
  check('alice sees public', ids.includes(pub));
  check('alice cannot see bob private', !ids.includes(priv));
  check('adult w/ mature sees mature', ids.includes(mature));
  check('group member visible through group', ids.includes(lucas));
  check('alice cannot read bob sheet versions', (await all(`select * from character_versions`)).length === 0);
  await expectError('client cannot insert characters', () => db.query(`insert into characters (creator_id, name) values ($1, 'x')`, [alice]), 'permission denied');
  const found = await all(`select * from discover_characters(p_query => 'futurista')`);
  check('full-text discovery', found.some((r) => r.id === pub));
  const fuzzy = await all(`select * from discover_characters(p_query => 'kael')`);
  check('name discovery', fuzzy.some((r) => r.id === pub));
  const tagged = await all(`select * from discover_characters(p_tags => array['hacker'])`);
  check('tag filter', tagged.length === 1 && tagged[0].tags.includes('hacker'));
  const groups = await all(`select * from discover_characters(p_kind => 'group')`);
  check('group filter + member_count', groups.length === 1 && groups[0].member_count === 1);
  for (const s of ['popular', 'recent', 'most_chatted', 'trending', 'most_liked']) {
    await db.query(`select * from discover_characters(p_sort => $1)`, [s]);
  }
  check('all sorts run', true);
  await db.query(`insert into likes (user_id, character_id) values ($1, $2)`, [alice, pub]);
  await db.query(`insert into follows (follower_id, following_id) values ($1, $2)`, [alice, bob]);
  await expectError('cannot like invisible character', () => db.query(`insert into likes (user_id, character_id) values ($1, $2)`, [alice, priv]));
});
await as(teen, async () => {
  const ids = (await all(`select id from characters`)).map((r) => r.id);
  check('teen cannot see mature', !ids.includes(mature) && ids.includes(pub));
});
check('like counter', (await one(`select like_count from characters where id = $1`, [pub])).like_count === 1);
check('follow counters', (await one(`select follower_count from user_profiles where id = $1`, [bob])).follower_count === 1);
check('follow notification', (await all(`select * from notifications where user_id = $1 and type = 'follow'`, [bob])).length === 1);
await db.query(`insert into blocks values ($1, $2)`, [bob, alice]);
await as(alice, async () => {
  const ids = (await all(`select id from characters`)).map((r) => r.id);
  check('blocked user content hidden', !ids.includes(pub));
});
await db.query(`delete from blocks`);

console.log('Conversations, tree and branches');
const conv = (await one(`insert into conversations (user_id, character_id) values ($1, $2) returning id`, [alice, pub])).id;
check('conversation counter', (await one(`select conversation_count from characters where id = $1`, [pub])).conversation_count === 1);
const m0 = (await one(`insert into messages (conversation_id, role, speaker_character_id, content, depth) values ($1, 'assistant', $2, 'Olá.', 0) returning id`, [conv, pub])).id;
const m1 = (await one(`insert into messages (conversation_id, parent_id, role, content, depth) values ($1, $2, 'user', 'Meu nome é Ana e adoro chuva.', 1) returning id`, [conv, m0])).id;
const m2 = (await one(`insert into messages (conversation_id, parent_id, role, content, depth, speaker_character_id) values ($1, $2, 'assistant', 'Prazer, Ana.', 2, $3) returning id`, [conv, m1, pub])).id;
const m1b = (await one(`insert into messages (conversation_id, parent_id, role, content, depth) values ($1, $2, 'user', 'Meu nome é Bia.', 1) returning id`, [conv, m0])).id;
await db.query(`update conversations set active_leaf_id = $1 where id = $2`, [m2, conv]);
await db.query(`insert into conversations (user_id, character_id) values ($1, $2)`, [bob, pub]);

await as(alice, async () => {
  const path = await all(`select * from conversation_path($1)`, [conv]);
  check('path root→leaf', path.map((r) => r.id).join() === [m0, m1, m2].join());
  check('siblings listed', path[1].sibling_ids.length === 2);
  const alt = await all(`select * from conversation_path($1, $2)`, [conv, m1b]);
  check('alternate branch path', alt.length === 2 && alt[1].id === m1b);
  check('only own conversations', (await all(`select * from conversations`)).length === 1);
  await db.query(`update conversations set title = 'Teste', is_favorite = true where id = $1`, [conv]);
  await expectError('cannot change conversation owner', () => db.query(`update conversations set user_id = $1 where id = $2`, [bob, conv]), 'permission denied');
  await expectError('cannot edit message content directly', () => db.query(`update messages set content = 'x' where id = $1`, [m1]), 'permission denied');
  await db.query(`update messages set is_pinned = true where id = $1`, [m2]);
  check('search history', (await all(`select * from search_messages($1, 'chuva')`, [conv])).length === 1);
});
await as(bob, async () => {
  await expectError('bob cannot read alice path', () => db.query(`select * from conversation_path($1)`, [conv]), 'not_found');
  check('bob cannot read alice messages', (await all(`select * from messages where conversation_id = $1`, [conv])).length === 0);
});

// Deleted message disappears from path but walk continues.
await db.query(`update messages set deleted_at = now(), hidden_reason = 'deleted' where id = $1`, [m1]);
await as(alice, async () => {
  const path = await all(`select * from conversation_path($1)`, [conv]);
  check('deleted message hidden, path intact', path.map((r) => r.id).join() === [m0, m2].join());
});
await db.query(`update messages set deleted_at = null, hidden_reason = null where id = $1`, [m1]);
check('message_path_ids', (await one(`select message_path_ids($1) as p`, [m2])).p.join() === [m0, m1, m2].join());
check('deepest_leaf', (await one(`select deepest_leaf($1) as l`, [m0])).l === m1b);

console.log('Memory');
const mem = (await one(
  `insert into memories (user_id, conversation_id, character_id, category, content, importance, embedding) values ($1, $2, $3, 'personal', 'O nome da usuária é Ana e ela adora chuva', 0.9, $4) returning id`,
  [alice, conv, pub, vec(2)],
)).id;
await db.query(`insert into memory_sources values ($1, $2)`, [mem, m1]);
const other = (await one(
  `insert into memories (user_id, conversation_id, character_id, category, content, importance, embedding) values ($1, $2, $3, 'personal', 'O nome da usuária é Bia', 0.9, $4) returning id`,
  [alice, conv, pub, vec(3)],
)).id;
await db.query(`insert into memory_sources values ($1, $2)`, [other, m1b]);
const pathIds = [m0, m1, m2];
const matched = await all(`select * from match_memories($1, null, $2, $3, 'chuva', 10)`, [conv, pathIds, vec(2)]);
check('memory on branch retrieved', matched.length === 1 && matched[0].id === mem && matched[0].score > 0.5);
const core = await all(`select * from core_memories($1, null, $2, 8)`, [conv, [m0, m1b]]);
check('branch isolation of memories', core.length === 1 && core[0].id === other);
await as(alice, async () => {
  check('owner sees own memories', (await all(`select * from memories`)).length === 2);
  await expectError('client cannot call match_memories', () => db.query(`select * from match_memories($1, null, $2, null, '', 5)`, [conv, pathIds]), 'permission denied');
});
await as(bob, async () => {
  check('other user cannot see memories', (await all(`select * from memories`)).length === 0);
});

const rel = (await one(`insert into relationships (conversation_id, user_id, subject_character_id, target_label, target_is_user) values ($1, $2, $3, 'Ana', true) returning id`, [conv, alice, pub])).id;
await db.query(`insert into relationship_events (relationship_id, message_id, kind, state) values ($1, $2, 'acquaintance', 'Acabaram de se conhecer')`, [rel, m2]);
const rs = await all(`select * from relationship_states($1, $2)`, [conv, pathIds]);
check('relationship state on path', rs.length === 1 && rs[0].kind === 'acquaintance');
check('relationship absent on other branch', (await all(`select * from relationship_states($1, $2)`, [conv, [m0, m1b]])).length === 0);

console.log('Recommendations');
const sim = (await one(`insert into characters (creator_id, name, visibility, category_slug, published_at, embedding) values ($1, 'Nova', 'public', 'ficcao-cientifica', now(), $2) returning id`, [bob, vec(1.01)])).id;
await db.query(`insert into characters (creator_id, name, visibility, category_slug, published_at, embedding) values ($1, 'Fazendeiro', 'public', 'vida-cotidiana', now(), $2)`, [bob, vec(9)]);
await as(alice, async () => {
  const rec = await all(`select * from recommend_characters(10)`);
  check('recommendation excludes chatted', !rec.some((r) => r.id === pub));
  check('recommendation ranks similar first', rec[0]?.id === sim, JSON.stringify(rec.map((r) => r.name)));
});

console.log('Jobs');
const j1 = (await one(`select enqueue_job('consolidate_memory', '{"c":1}', 'mem:1') as id`)).id;
const j2 = (await one(`select enqueue_job('consolidate_memory', '{"c":1}', 'mem:1') as id`)).id;
check('dedupe pending jobs', j1 && j2 === null);
const claimed = await all(`select * from claim_jobs('w1', 5)`);
check('claim job', claimed.length === 1 && claimed[0].status === 'running');
check('claimed job not re-claimed', (await all(`select * from claim_jobs('w2', 5)`)).length === 0);
await as(alice, async () => {
  await expectError('client cannot enqueue', () => db.query(`select enqueue_job('x', '{}')`), 'permission denied');
});

console.log('Storage');
await as(alice, async () => {
  await db.query(`insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${alice}/avatar.png`]);
  await expectError('cannot write in other user folder', () => db.query(`insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${bob}/x.png`]));
});


console.log('Server helpers');
{
  const c2 = (await one(`insert into conversations (user_id, character_id) values ($1, $2) returning id`, [bob, grp])).id;
  const a = (await one(`insert into messages (conversation_id, role, content, depth) values ($1, 'user', 'oi grupo', 0) returning id`, [c2])).id;
  const b = (await one(`insert into messages (conversation_id, parent_id, role, content, depth, speaker_character_id, audience_character_id) values ($1, $2, 'assistant', 'psiu', 1, $3, $3) returning id`, [c2, a, lucas])).id;
  const c = (await one(`insert into messages (conversation_id, parent_id, role, content, depth) values ($1, $2, 'user', 'e aí', 2) returning id`, [c2, b])).id;
  await db.query(`update conversations set active_leaf_id = $1 where id = $2`, [c, c2]);
  const pm = await all(`select id from path_messages($1)`, [c]);
  check('path_messages root→leaf', pm.map((r) => r.id).join() === [a, b, c].join());
  const st = (await one(`select subtree_ids($1) as ids`, [a])).ids;
  check('subtree_ids', st.length === 3);
  await as(bob, async () => {
    const p = await all(`select * from conversation_path($1)`, [c2]);
    check('conversation_path exposes audience', p[1].audience_character_id === lucas);
  });
  const mm = (await one(`insert into memories (user_id, conversation_id, character_id, holder_character_id, category, content, embedding) values ($1, $2, $3, $4, 'personal', 'Segredo só do Lucas', $5) returning id`, [bob, c2, grp, lucas, vec(5)])).id;
  await db.query(`insert into memory_sources values ($1, $2)`, [mm, b]);
  await db.query(`insert into memory_summaries (conversation_id, start_message_id, end_message_id, message_ids, content) values ($1, $2, $3, $4, 'resumo')`, [c2, a, b, [a, b]]);
  const der = await all(`select * from derived_from_messages($1)`, [[b]]);
  check('derived_from_messages finds memory + summary', der.some((d) => d.kind === 'memory') && der.some((d) => d.kind === 'summary'));
  const ps = await all(`select * from path_summaries($1, $2)`, [c2, [a, b, c]]);
  check('path_summaries index', ps.length === 1 && ps[0].end_index === 2);
  const nn = await all(`select * from nearest_memories($1, $2, 3)`, [c2, vec(5)]);
  check('nearest_memories similarity', nn[0]?.id === mm && nn[0].similarity > 0.99);
  const holderOnly = await all(`select * from match_memories($1, $2, $3, null, 'segredo', 5)`, [c2, grp, [a, b, c]]);
  check('private member memory hidden from other holder', holderOnly.length === 0);
  const forLucas = await all(`select * from match_memories($1, $2, $3, null, 'segredo', 5)`, [c2, lucas, [a, b, c]]);
  check('private member memory visible to its holder', forLucas.length === 1);
  await db.query(`insert into usage_records (user_id, kind, provider, model, cost_usd) values ($1, 'chat', 'anthropic', 'm', 0.01), ($1, 'memory_extract', 'anthropic', 'm', 0.02)`, [bob]);
  const u = await one(`select * from usage_today($1)`, [bob]);
  check('usage_today', Number(u.chat_messages) === 1 && Number(u.cost_usd) > 0.029);
  await as(bob, async () => {
    await expectError('client cannot call path_messages', () => db.query(`select * from path_messages($1)`, [c]), 'permission denied');
  });
}

console.log('Cascade delete account');
await db.query(`delete from auth.users where id = $1`, [alice]);
check('user data removed', (await all(`select * from conversations where user_id = $1`, [alice])).length === 0 && (await all(`select * from memories where user_id = $1`, [alice])).length === 0);

} catch (e) {
  failures++;
  console.error(`  ✗ unexpected error: ${e.message}\n    query: ${e.query ?? ''}\n    where: ${e.where ?? ''}`);
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
