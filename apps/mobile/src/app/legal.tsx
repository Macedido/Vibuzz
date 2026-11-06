import { Text, View } from 'react-native';
import { Screen, Section } from '@/components/ui';
import { LEGAL_SECTIONS } from '@/lib/legal';
import { type } from '@/lib/theme';

export default function Legal() {
  return (
    <Screen>
      <View style={{ maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {LEGAL_SECTIONS.map((s, i) => (
          <Section key={s.title} title={s.title} style={i === 0 ? { marginTop: 0 } : undefined}>
            <Text style={type.body}>{s.body}</Text>
          </Section>
        ))}
      </View>
    </Screen>
  );
}
