import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, Screen, TopBar, type IconName } from '@/components/ui';
import { colors, radius, space, type } from '@/lib/theme';

function Option({ icon, title, text, onPress, highlight }: { icon: IconName; title: string; text: string; onPress: () => void; highlight?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, highlight && { borderColor: colors.accent + '66' }, pressed && { opacity: 0.85 }]}>
      {highlight ? <LinearGradient colors={['rgba(200,255,77,0.10)', 'rgba(157,140,255,0.06)']} style={StyleSheet.absoluteFill} /> : null}
      <View style={[styles.icon, highlight && { backgroundColor: colors.accent }]}>
        <Ionicons name={icon} size={22} color={highlight ? colors.accentInk : colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.h3}>{title}</Text>
        <Text style={[type.small, { marginTop: 2 }]}>{text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

export default function Create() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Criar" subtitle="Dê vida a alguém novo" />
      <Screen>
        <View style={{ gap: space.md, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Option highlight icon="sparkles" title="Criar com IA" text="Descreva uma ideia (e envie imagens). A IA monta a ficha completa para você revisar." onPress={() => router.push('/create/ai')} />
          <Option icon="create-outline" title="Criar manualmente" text="Controle total sobre cada campo da ficha." onPress={() => router.push('/create/editor')} />
          <Option icon="people-outline" title="Criar grupo" text="Vários integrantes, cada um com personalidade e memória próprias." onPress={() => router.push({ pathname: '/create/editor', params: { kind: 'group' } })} />
          <Option icon="happy-outline" title="Minhas personas" text="Identidades fictícias que você usa nas conversas." onPress={() => router.push('/personas')} />
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, overflow: 'hidden' },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
