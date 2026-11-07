import {
  CATEGORIES,
  characterSheetSchema,
  diffSheets,
  emptySheet,
  PORTRAIT_STYLE_IDS,
  SHEET_FIELDS,
  type CharacterSheet,
  type Maturity,
  type Relation,
  type Visibility,
} from '@vibuzz/shared';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  ChipScroller,
  Field,
  IconButton,
  Ionicons,
  Loading,
  Panel,
  Row,
  Screen,
  Section,
  Segmented,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { takeDraft } from '@/lib/draft';
import { mediaUrl } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';
import { timeAgo } from '@/lib/types';
import { pickImage, uploadImage } from '@/lib/upload';
import { speak } from '@/lib/voice';

const VOICE_PITCH: [string, number][] = [['Grave', 0.8], ['Tom normal', 1], ['Aguda', 1.25]];
const VOICE_RATE: [string, number][] = [['Devagar', 0.85], ['Ritmo normal', 1], ['Rápida', 1.2]];
const PORTRAIT_LABELS: Record<(typeof PORTRAIT_STYLE_IDS)[number], string> = { anime: 'Anime', realista: 'Realista', '3d': '3D', fantasia: 'Fantasia' };

type SheetKey = keyof CharacterSheet;
const fieldMeta = new Map(SHEET_FIELDS.map((f) => [f.key, f]));
const blank = (): CharacterSheet => ({ ...emptySheet('x'), name: '' });

const GROUPS: { title: string; keys: SheetKey[] }[] = [
  { title: 'Identidade', keys: ['appearance', 'personality', 'biography', 'backstory'] },
  { title: 'Voz e comportamento', keys: ['speechStyle', 'likes', 'dislikes', 'fears', 'goals', 'habits', 'behaviors'] },
  { title: 'Mundo e início', keys: ['universe', 'scenario', 'userRole', 'firstMessage'] },
  { title: 'Avançado', keys: ['instructions'] },
];
const MEMBER_KEYS: SheetKey[] = ['gender', 'age', 'tagline', 'appearance', 'personality', 'biography', 'speechStyle', 'likes', 'dislikes', 'fears', 'goals'];

interface Member {
  id?: string;
  sheet: CharacterSheet;
  avatarPath: string | null;
}

interface EditData {
  id: string;
  kind: 'single' | 'group';
  sheet: CharacterSheet;
  visibility: Visibility;
  maturity: Maturity;
  categorySlug: string | null;
  avatarPath: string | null;
  tags: string[];
  imagePaths: string[];
  members: Member[];
  versions: { id: string; version: number; note: string; created_at: string }[];
  currentVersion: number;
}

function confirm(message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (globalThis.confirm?.(message)) onYes();
    return;
  }
  Alert.alert('Confirmar', message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', style: 'destructive', onPress: onYes },
  ]);
}

export default function Editor() {
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const router = useRouter();
  const { isAdult } = useAuth();
  const editingId = params.id ?? null;

  const [loading, setLoading] = useState(Boolean(editingId));
  const [kind, setKind] = useState<'single' | 'group'>(params.kind === 'group' ? 'group' : 'single');
  const [sheet, setSheet] = useState<CharacterSheet>(blank());
  const [original, setOriginal] = useState<CharacterSheet | null>(null);
  const [members, setMembers] = useState<Member[]>(params.kind === 'group' ? [{ sheet: blank(), avatarPath: null }, { sheet: blank(), avatarPath: null }] : []);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [maturity, setMaturity] = useState<Maturity>('general');
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState('');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [versions, setVersions] = useState<EditData['versions']>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({ Identidade: true });
  const [openMember, setOpenMember] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [portraitStyle, setPortraitStyle] = useState<(typeof PORTRAIT_STYLE_IDS)[number]>('anime');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const draft = takeDraft();
    if (draft && !editingId) {
      setKind(draft.kind);
      setSheet(characterSheetSchema.parse(draft.sheet));
      setMembers((draft.members ?? []).map((s) => ({ sheet: characterSheetSchema.parse(s), avatarPath: null })));
      setAvatarPath(draft.avatarPath ?? null);
      setGallery(draft.imagePaths ?? []);
      setNotes(draft.notes ?? []);
      if (draft.tags?.length) setTags(draft.tags.join(', '));
      setOpen({ Identidade: true, 'Voz e comportamento': true, 'Mundo e início': true });
    }
    if (!editingId) return;
    api<EditData>(`/v1/characters/${editingId}/edit`)
      .then((d) => {
        setKind(d.kind);
        setSheet(d.sheet);
        setOriginal(d.sheet);
        setMembers(d.members.map((m) => ({ id: m.id, sheet: m.sheet, avatarPath: m.avatarPath })));
        setVisibility(d.visibility);
        setMaturity(d.maturity);
        setCategory(d.categorySlug);
        setTags(d.tags.join(', '));
        setAvatarPath(d.avatarPath);
        setGallery(d.imagePaths);
        setVersions(d.versions);
        setCurrentVersion(d.currentVersion);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [editingId]);

  useEffect(() => {
    if (sheet.mode === 'narrator') setOpen((o) => (o['Mundo e início'] ? o : { ...o, 'Mundo e início': true }));
  }, [sheet.mode]);

  const set = (key: SheetKey) => (value: string) => setSheet((s) => ({ ...s, [key]: value }));
  const setMember = (i: number, patch: Partial<Member> | ((m: Member) => Member)) =>
    setMembers((list) => list.map((m, j) => (j === i ? (typeof patch === 'function' ? patch(m) : { ...m, ...patch }) : m)));

  const changed = useMemo(() => (original ? diffSheets(original, sheet) : []), [original, sheet]);

  const upload = async (target: string, apply: (path: string) => void, square = true) => {
    setError(null);
    try {
      const img = await pickImage({ square });
      if (!img) return;
      setUploading(target);
      apply(await uploadImage('media', 'characters', img));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(null);
    }
  };

  const generatePortrait = async () => {
    if (!sheet.name.trim()) return setError('Dê um nome ao personagem antes de gerar a imagem.');
    setError(null);
    setUploading('portrait');
    try {
      const out = await api<{ path: string }>('/v1/creator/portrait', { body: { sheet: { ...sheet, name: sheet.name.trim() }, style: portraitStyle } });
      setAvatarPath(out.path);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(null);
    }
  };

  const regenerate = async (key: SheetKey) => {
    if (!sheet.name.trim()) return setError('Dê um nome ao personagem antes de usar a IA.');
    setRegenerating(key);
    setError(null);
    try {
      const res = await api<{ value: unknown }>('/v1/creator/regenerate-field', { body: { sheet: { ...sheet, name: sheet.name.trim() }, field: key } });
      setSheet((s) => ({ ...s, [key]: res.value as never }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRegenerating(null);
    }
  };

  const payload = () => ({
    kind,
    sheet: { ...sheet, name: sheet.name.trim(), relations: sheet.relations.filter((r) => r.name.trim()) },
    visibility,
    maturity,
    categorySlug: category,
    tags: tags
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 12),
    avatarPath,
    imagePaths: gallery,
    members: members.map((m) => ({ id: m.id, sheet: { ...m.sheet, name: m.sheet.name.trim() }, avatarPath: m.avatarPath })),
  });

  const save = async () => {
    setPreview(false);
    setError(null);
    if (!sheet.name.trim()) return setError('O nome é obrigatório.');
    if (kind === 'group' && (members.length < 2 || members.some((m) => !m.sheet.name.trim()))) return setError('Um grupo precisa de pelo menos 2 integrantes com nome.');
    setSaving(true);
    try {
      if (editingId) {
        await api(`/v1/characters/${editingId}`, { method: 'PATCH', body: payload() });
        router.back();
      } else {
        const res = await api<{ id: string }>('/v1/characters', { body: payload() });
        router.replace(`/character/${res.id}`);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const restore = async (versionId: string) => {
    if (!editingId) return;
    try {
      await api(`/v1/characters/${editingId}/versions/${versionId}/restore`, { body: {} });
      const d = await api<EditData>(`/v1/characters/${editingId}/edit`);
      setSheet(d.sheet);
      setOriginal(d.sheet);
      setVersions(d.versions);
      setCurrentVersion(d.currentVersion);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = () =>
    confirm('Apagar este personagem? Se outras pessoas conversam com ele, ele só deixa de ser público.', async () => {
      try {
        await api(`/v1/characters/${editingId}`, { method: 'DELETE' });
        router.replace('/profile');
      } catch (e) {
        setError(errorMessage(e));
      }
    });

  if (loading) return <Loading />;

  const sheetField = (key: SheetKey, value: string, onChange: (v: string) => void, withAi = true) => {
    const f = fieldMeta.get(key)!;
    return (
      <Field
        key={key}
        label={f.label}
        hint={f.hint}
        value={value}
        onChangeText={onChange}
        multiline={f.size !== 'short'}
        maxLength={f.size === 'short' ? (key === 'tagline' ? 160 : 120) : f.size === 'medium' ? 1200 : 6000}
        right={
          withAi && key !== 'name' ? (
            regenerating === key ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Pressable onPress={() => regenerate(key)} hitSlop={8}>
                <Row gap={3}>
                  <Ionicons name="sparkles" size={13} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>IA</Text>
                </Row>
              </Pressable>
            )
          ) : undefined
        }
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: editingId ? `Editar · v${currentVersion}` : kind === 'group' ? 'Novo grupo' : 'Novo personagem' }} />
      <Screen keyboard>
        <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          {notes.map((n) => (
            <Banner key={n} text={n} />
          ))}
          {error ? <Banner tone="danger" text={error} /> : null}

          <Row gap={space.lg} style={{ marginBottom: space.lg }}>
            <Pressable onPress={() => upload('avatar', setAvatarPath)}>
              <View>
                <Avatar path={avatarPath} name={sheet.name || '?'} size={96} />
                <View style={styles.camera}>{uploading === 'avatar' ? <ActivityIndicator size="small" color={colors.accentInk} /> : <Ionicons name="camera" size={16} color={colors.accentInk} />}</View>
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Field label={kind === 'group' ? 'Nome do grupo' : 'Nome'} value={sheet.name} onChangeText={set('name')} maxLength={120} placeholder="Obrigatório" />
            </View>
          </Row>
          {kind === 'single' ? (
            <View style={styles.portraitBox}>
              <Row style={{ alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={type.h3}>Imagem com IA</Text>
                  <Text style={type.small}>Cria um retrato a partir da aparência (ou do cenário, no modo história). Grátis.</Text>
                </View>
                <Button title={avatarPath ? 'Gerar outra' : 'Gerar imagem'} icon="sparkles" small onPress={generatePortrait} loading={uploading === 'portrait'} />
              </Row>
              <View style={{ marginTop: space.sm }}>
                <ChipScroller>
                  {PORTRAIT_STYLE_IDS.map((st) => (
                    <Chip key={st} label={PORTRAIT_LABELS[st]} active={portraitStyle === st} onPress={() => setPortraitStyle(st)} />
                  ))}
                </ChipScroller>
              </View>
              {uploading === 'portrait' ? <Text style={[type.small, { marginTop: space.sm }]}>Desenhando… pode levar até 30 segundos.</Text> : null}
            </View>
          ) : null}
          {sheetField('tagline', sheet.tagline, set('tagline'))}
          {kind === 'single' ? (
            <View style={{ marginBottom: space.md }}>
              <Text style={[type.tiny, { marginBottom: space.sm }]}>Quem a IA interpreta</Text>
              <Segmented
                value={sheet.mode}
                onChange={(mode) => setSheet((s) => ({ ...s, mode }))}
                options={[
                  { value: 'character', label: 'Este personagem' },
                  { value: 'narrator', label: 'Narrador da história' },
                ]}
              />
              <Text style={[type.small, { marginTop: space.xs }]}>
                {sheet.mode === 'narrator'
                  ? 'A IA narra e dá voz a todos os personagens. Você interpreta o papel descrito em “Seu papel na história” (em Mundo e início).'
                  : 'A IA vira este personagem e conversa com você.'}
              </Text>
            </View>
          ) : null}
          {kind === 'single' ? (
            <View style={{ marginBottom: space.md }}>
              <Text style={[type.tiny, { marginBottom: space.sm }]}>Voz</Text>
              <Segmented
                value={sheet.voice?.gender ?? 'auto'}
                onChange={(g) => setSheet((s) => ({ ...s, voice: { ...s.voice, gender: g } }))}
                options={[
                  { value: 'auto', label: 'Automática' },
                  { value: 'feminina', label: 'Feminina' },
                  { value: 'masculina', label: 'Masculina' },
                ]}
              />
              <Row gap={space.xs} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
                {VOICE_PITCH.map(([label, v]) => (
                  <Chip key={label} label={label} active={Math.abs((sheet.voice?.pitch ?? 1) - v) < 0.05} onPress={() => setSheet((s) => ({ ...s, voice: { ...s.voice, pitch: v } }))} />
                ))}
                {VOICE_RATE.map(([label, v]) => (
                  <Chip key={label} label={label} active={Math.abs((sheet.voice?.rate ?? 1) - v) < 0.05} onPress={() => setSheet((s) => ({ ...s, voice: { ...s.voice, rate: v } }))} />
                ))}
                <Chip label="Ouvir" icon="volume-high-outline" onPress={() => void speak(sheet.firstMessage || `Oi, eu sou ${sheet.name || 'seu personagem'}.`, { characterId: editingId ?? sheet.name, style: sheet.voice })} />
              </Row>
            </View>
          ) : null}
          {kind === 'single' && sheet.mode !== 'narrator' ? (
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>{sheetField('gender', sheet.gender, set('gender'), false)}</View>
              <View style={{ flex: 1 }}>{sheetField('age', sheet.age, set('age'), false)}</View>
            </Row>
          ) : null}

          {GROUPS.map((g) => (
            <View key={g.title} style={{ marginTop: space.sm }}>
              <Pressable onPress={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))} style={styles.groupHead}>
                <Text style={type.h3}>{g.title}</Text>
                <Ionicons name={open[g.title] ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {open[g.title] ? (
                <View style={{ paddingTop: space.sm }}>
                  {g.keys
                    .filter((k) => kind === 'single' || !['personality', 'speechStyle', 'likes', 'dislikes', 'fears', 'habits', 'behaviors', 'appearance'].includes(k))
                    .map((k) => sheetField(k, sheet[k] as string, set(k)))}
                  {g.title === 'Mundo e início' ? (
                    <Text style={[type.small, { marginTop: -4, marginBottom: space.md }]}>Dica: use {'{{user}}'} para o nome da persona e *asteriscos* para ações.</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}

          {kind === 'single' ? (
            <RelationsEditor relations={sheet.relations} onChange={(relations) => setSheet((s) => ({ ...s, relations }))} />
          ) : null}

          {kind === 'group' ? (
            <Section title={`Integrantes · ${members.length}`}>
              {members.map((m, i) => (
                <Card key={m.id ?? `new-${i}`} style={{ marginBottom: space.sm, padding: space.md }}>
                  <Row>
                    <Pressable onPress={() => upload(`member-${i}`, (p) => setMember(i, { avatarPath: p }))}>
                      <Avatar path={m.avatarPath} name={m.sheet.name || '?'} size={44} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Field value={m.sheet.name} onChangeText={(v) => setMember(i, (x) => ({ ...x, sheet: { ...x.sheet, name: v } }))} placeholder={`Integrante ${i + 1}`} style={{ minHeight: 40 }} />
                    </View>
                    <IconButton icon={openMember === i ? 'chevron-up' : 'chevron-down'} onPress={() => setOpenMember(openMember === i ? null : i)} label="Detalhes" />
                    {members.length > 2 ? <IconButton icon="trash-outline" color={colors.danger} size={18} onPress={() => setMembers((l) => l.filter((_, j) => j !== i))} label="Remover" /> : null}
                  </Row>
                  {uploading === `member-${i}` ? <ActivityIndicator color={colors.accent} /> : null}
                  {openMember === i ? (
                    <View style={{ marginTop: space.sm }}>
                      {MEMBER_KEYS.map((k) => sheetField(k, m.sheet[k] as string, (v) => setMember(i, (x) => ({ ...x, sheet: { ...x.sheet, [k]: v } })), false))}
                    </View>
                  ) : null}
                </Card>
              ))}
              {members.length < 8 ? (
                <Button title="Adicionar integrante" icon="person-add-outline" variant="secondary" small onPress={() => setMembers((l) => [...l, { sheet: blank(), avatarPath: null }])} />
              ) : null}
            </Section>
          ) : null}

          <Section title="Galeria">
            <Row style={{ flexWrap: 'wrap' }}>
              {gallery.map((p) => (
                <View key={p}>
                  <Image source={{ uri: mediaUrl(p)! }} style={styles.thumb} />
                  <Pressable onPress={() => setGallery((g) => g.filter((x) => x !== p))} style={styles.removeThumb}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {gallery.length < 8 ? (
                <Pressable onPress={() => upload('gallery', (p) => setGallery((g) => [...g, p]), false)} style={[styles.thumb, styles.addThumb]}>
                  {uploading === 'gallery' ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="add" size={26} color={colors.muted} />}
                </Pressable>
              ) : null}
            </Row>
          </Section>

          <Section title="Publicação">
            <Text style={[type.tiny, { marginBottom: space.sm }]}>Visibilidade</Text>
            <Segmented
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'private', label: 'Privado' },
                { value: 'unlisted', label: 'Por link' },
                { value: 'public', label: 'Público' },
              ]}
            />
            <Text style={[type.tiny, { marginTop: space.lg, marginBottom: space.sm }]}>Classificação</Text>
            <Segmented
              value={maturity}
              onChange={(v) => (v === 'mature' && !isAdult ? setError('Classificação 18+ é só para contas adultas.') : setMaturity(v))}
              options={[
                { value: 'general', label: 'Livre' },
                { value: 'teen', label: '13+' },
                { value: 'mature', label: '18+' },
              ]}
            />
            {maturity === 'mature' ? (
              <Text style={[type.small, { marginTop: space.xs }]}>Personagens 18+ só aparecem para adultos que ligaram o conteúdo 18+ em Ajustes. Para todo mundo ver, use Livre ou 13+.</Text>
            ) : null}
            <Text style={[type.tiny, { marginTop: space.lg, marginBottom: space.sm }]}>Categoria</Text>
            <Row style={{ flexWrap: 'wrap' }}>
              {CATEGORIES.map((c) => (
                <Chip key={c.slug} label={c.name} active={category === c.slug} onPress={() => setCategory(category === c.slug ? null : c.slug)} />
              ))}
            </Row>
            <View style={{ marginTop: space.lg }}>
              <Field label="Tags" hint="separe por vírgula" value={tags} onChangeText={setTags} placeholder="hacker, cyberpunk, sarcástico" autoCapitalize="none" />
            </View>
          </Section>

          <Button
            title={editingId ? 'Salvar alterações' : visibility === 'public' ? 'Publicar' : 'Salvar'}
            icon="checkmark"
            loading={saving}
            onPress={() => (editingId && changed.length ? setPreview(true) : save())}
            style={{ marginTop: space.xl }}
          />

          {editingId && versions.length ? (
            <Section title="Versões">
              {versions.map((v) => (
                <Row key={v.id} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.borderSoft }}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>v{v.version}{v.version === currentVersion ? ' · atual' : ''}</Text>
                    <Text style={type.small}>
                      {v.note || 'Edição'} · {timeAgo(v.created_at)}
                    </Text>
                  </View>
                  {v.version !== currentVersion ? <Button title="Restaurar" small variant="secondary" onPress={() => restore(v.id)} /> : null}
                </Row>
              ))}
            </Section>
          ) : null}

          {editingId ? <Button title="Apagar personagem" variant="danger" icon="trash-outline" onPress={remove} style={{ marginTop: space.xl }} /> : null}
        </View>
      </Screen>

      <Panel visible={preview} onClose={() => setPreview(false)} title="Revisar alterações">
        <Text style={[type.body, { marginBottom: space.md }]}>Uma nova versão (v{currentVersion + 1}) será criada. As próximas respostas usam a ficha nova; memórias das conversas são preservadas.</Text>
        {changed.map((k) => (
          <View key={k} style={{ marginBottom: space.md }}>
            <Text style={type.tiny}>{fieldMeta.get(k)?.label ?? (k === 'relations' ? 'Relações' : k)}</Text>
            {typeof sheet[k] === 'string' ? (
              <>
                <Text style={[type.small, { textDecorationLine: 'line-through' }]} numberOfLines={3}>
                  {(original?.[k] as string) || '(vazio)'}
                </Text>
                <Text style={[type.body, { color: colors.text }]} numberOfLines={4}>
                  {(sheet[k] as string) || '(vazio)'}
                </Text>
              </>
            ) : (
              <Text style={type.small}>Alterado</Text>
            )}
          </View>
        ))}
        <Button title="Confirmar e salvar" onPress={save} loading={saving} style={{ marginBottom: space.lg }} />
      </Panel>
    </View>
  );
}

function RelationsEditor({ relations, onChange }: { relations: Relation[]; onChange: (r: Relation[]) => void }) {
  const update = (i: number, patch: Partial<Relation>) => onChange(relations.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Section title="Relações">
      {relations.map((r, i) => (
        <Card key={i} style={{ padding: space.md, marginBottom: space.sm }}>
          <Row style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Field placeholder="Nome" value={r.name} onChangeText={(v) => update(i, { name: v })} maxLength={120} />
            </View>
            <View style={{ flex: 1 }}>
              <Field placeholder="Tipo (irmã, rival…)" value={r.kind} onChangeText={(v) => update(i, { kind: v })} maxLength={120} />
            </View>
            <IconButton icon="close" size={18} color={colors.muted} onPress={() => onChange(relations.filter((_, j) => j !== i))} label="Remover relação" />
          </Row>
          <Field placeholder="Descrição" value={r.description} onChangeText={(v) => update(i, { description: v })} multiline maxLength={1200} />
        </Card>
      ))}
      <Button title="Adicionar relação" variant="secondary" small icon="add" onPress={() => onChange([...relations, { name: '', kind: '', description: '' }])} />
    </Section>
  );
}

const styles = StyleSheet.create({
  portraitBox: { padding: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, marginBottom: space.lg },
  camera: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  thumb: { width: 88, height: 88, borderRadius: radius.md },
  addThumb: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  removeThumb: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
});
