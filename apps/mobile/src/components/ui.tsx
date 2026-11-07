import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaUrl } from '@/lib/supabase';
import { colors, radius, space, type } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

/* ------------------------------- Layout -------------------------------- */

export function Screen({
  children,
  scroll = true,
  padded = true,
  refreshControl,
  style,
  keyboard = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
  style?: StyleProp<ViewStyle>;
  keyboard?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && { padding: space.lg }, { paddingBottom: insets.bottom + 96 }, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: space.lg }, style]}>{children}</View>
  );
  const body = keyboard ? (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>{body}</View>;
}

/** Top bar for tab roots (stack screens use the native header). */
export function TopBar({ title, right, subtitle }: { title: string; subtitle?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
      <View style={{ flex: 1 }}>
        <Text style={type.h1}>{title}</Text>
        {subtitle ? <Text style={[type.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Section({ title, action, onAction, children, style }: { title: string; action?: string; onAction?: () => void; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: space.xl }, style]}>
      <View style={styles.sectionHead}>
        <Text style={type.h2}>{title}</Text>
        {action && onAction ? (
          <Pressable onPress={onAction} hitSlop={10}>
            <Text style={{ color: colors.accent, fontWeight: '600' }}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ------------------------------- Controls ------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  small,
  style,
  label,
}: {
  title: string;
  label?: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = { primary: colors.accent, secondary: colors.raised, ghost: 'transparent', danger: colors.dangerSoft }[variant];
  const fg = { primary: colors.accentInk, secondary: colors.text, ghost: colors.textSoft, danger: colors.danger }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? colors.border : 'transparent' },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Row gap={6} style={{ justifyContent: 'center' }}>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={fg} /> : null}
          {title ? <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }}>{title}</Text> : null}
        </Row>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, color = colors.text, size = 22, badge, label }: { icon: IconName; onPress?: () => void; color?: string; size?: number; badge?: boolean; label?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={size} color={color} />
      {badge ? <View style={styles.badgeDot} /> : null}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  multiline,
  style,
  right,
  ...props
}: TextInputProps & { label?: string; hint?: string; error?: string | null; right?: ReactNode }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? (
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={styles.label}>
            {label}
            {hint ? <Text style={{ color: colors.faint, fontWeight: '400' }}>  · {hint}</Text> : null}
          </Text>
          {right}
        </Row>
      ) : null}
      <TextInput
        placeholderTextColor={colors.faint}
        selectionColor={colors.accent}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }, error ? { borderColor: colors.danger } : null, style]}
        {...props}
      />
      {error ? <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
      <Row gap={4}>
        {icon ? <Ionicons name={icon} size={13} color={active ? colors.accentInk : colors.textSoft} /> : null}
        <Text style={{ color: active ? colors.accentInk : colors.textSoft, fontWeight: '600', fontSize: 13 }}>{label}</Text>
      </Row>
    </Pressable>
  );
}

export function ChipScroller({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}>
      {children}
    </ScrollView>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segment, value === o.value && { backgroundColor: colors.overlay }]}>
          <Text style={{ color: value === o.value ? colors.text : colors.muted, fontWeight: '600', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ToggleRow({ title, subtitle, value, onChange, disabled }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row style={{ paddingVertical: space.md, opacity: disabled ? 0.5 : 1 }} gap={space.md}>
      <View style={{ flex: 1 }}>
        <Text style={type.h3}>{title}</Text>
        {subtitle ? <Text style={[type.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.overlay }}
        thumbColor={value ? colors.accentInk : colors.muted}
        {...({ activeThumbColor: colors.accentInk, activeTrackColor: colors.accent } as object)}
      />
    </Row>
  );
}

export function ListItem({ icon, title, subtitle, onPress, danger, right }: { icon?: IconName; title: string; subtitle?: string; onPress?: () => void; danger?: boolean; right?: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: colors.raised }]}>
      {icon ? <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.textSoft} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.h3, { fontWeight: '600' }, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null)}
    </Pressable>
  );
}

/* ------------------------------- Media --------------------------------- */

export function Avatar({ path, uri, name, size = 44, ring }: { path?: string | null; uri?: string | null; name?: string; size?: number; ring?: boolean }) {
  const src = uri ?? mediaUrl(path);
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.overlay }, ring && { borderWidth: 2, borderColor: colors.accent }]}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} />
      ) : (
        <LinearGradient colors={[colors.signal, '#3B2F7A']} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.36 }}>{initials}</Text>
        </LinearGradient>
      )}
    </View>
  );
}

/* ------------------------------- States -------------------------------- */

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[type.small, { marginTop: space.sm }]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = 'sparkles-outline', title, message, action, onAction }: { icon?: IconName; title: string; message?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={[styles.center, { paddingVertical: space.xxl }]}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={[type.h3, { textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[type.small, { textAlign: 'center', marginTop: 4, maxWidth: 280 }]}>{message}</Text> : null}
      {action && onAction ? <Button title={action} onPress={onAction} small style={{ marginTop: space.lg }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.center, { paddingVertical: space.xxl }]}>
      <Ionicons name="cloud-offline-outline" size={28} color={colors.danger} />
      <Text style={[type.body, { textAlign: 'center', marginTop: space.sm, maxWidth: 300 }]}>{message}</Text>
      {onRetry ? <Button title="Tentar de novo" variant="secondary" small onPress={onRetry} style={{ marginTop: space.md }} /> : null}
    </View>
  );
}

export function Banner({ tone = 'info', text, icon }: { tone?: 'info' | 'warning' | 'danger'; text: string; icon?: IconName }) {
  const c = { info: colors.signal, warning: colors.warning, danger: colors.danger }[tone];
  return (
    <Row style={[styles.banner, { borderColor: c + '55', backgroundColor: c + '14' }]} gap={space.sm}>
      <Ionicons name={icon ?? (tone === 'info' ? 'information-circle-outline' : 'warning-outline')} size={18} color={c} />
      <Text style={[type.small, { color: colors.textSoft, flex: 1 }]}>{text}</Text>
    </Row>
  );
}

/* ------------------------------- Sheets -------------------------------- */

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onPress: () => void;
}

/** Bottom action sheet (works the same on iOS, Android and web). */
export function ActionSheet({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title?: string; actions: SheetAction[] }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]} onPress={() => {}}>
          <View style={styles.grabber} />
          {title ? <Text style={[type.tiny, { marginBottom: space.sm, paddingHorizontal: space.lg }]}>{title}</Text> : null}
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => {
                onClose();
                setTimeout(a.onPress, 50);
              }}
              style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: colors.overlay }]}
            >
              {a.icon ? <Ionicons name={a.icon} size={20} color={a.danger ? colors.danger : colors.textSoft} /> : null}
              <Text style={{ color: a.danger ? colors.danger : colors.text, fontSize: 16, fontWeight: '500' }}>{a.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Generic modal panel with a title and arbitrary content. */
export function Panel({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space.lg, maxHeight: '88%' }]} onPress={() => {}}>
            <View style={styles.grabber} />
            <Row style={{ paddingHorizontal: space.lg, marginBottom: space.md, justifyContent: 'space-between' }}>
              <Text style={type.h2}>{title}</Text>
              <IconButton icon="close" onPress={onClose} label="Fechar" />
            </Row>
            <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function BackButton() {
  const router = useRouter();
  return <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} label="Voltar" />;
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: colors.bg, gap: space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSoft, padding: space.lg },
  button: { height: 50, borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  buttonSmall: { height: 38, paddingHorizontal: space.md, borderRadius: radius.sm + 2 },
  iconBtn: { padding: 6 },
  badgeDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  label: { color: colors.textSoft, fontWeight: '600', fontSize: 13 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: space.md,
    minHeight: 48,
    fontSize: 15,
  },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center' },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.borderSoft },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm + 1 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14, paddingHorizontal: space.sm, borderRadius: radius.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.sm, borderWidth: 1, borderColor: colors.border, width: '100%', maxWidth: 640, alignSelf: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.md },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14, paddingHorizontal: space.lg },
});
