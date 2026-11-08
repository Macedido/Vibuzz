import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Platform, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '@/lib/theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

/** Wide screens get a left sidebar (like desktop chat apps); phones keep the bottom bar. */
const SIDEBAR_MIN_WIDTH = 900;

function icon(active: Icon, inactive: Icon) {
  return ({ color, focused }: { color: unknown; focused: boolean }) => <Ionicons name={focused ? active : inactive} size={23} color={String(color ?? colors.muted)} />;
}

function CreateIcon({ focused, wide }: { focused: boolean; wide: boolean }) {
  return (
    <View
      style={{
        width: wide ? 30 : 44,
        height: 30,
        borderRadius: 10,
        backgroundColor: focused || wide ? colors.accent : colors.raised,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: focused || wide ? colors.accent : colors.border,
      }}
    >
      <Ionicons name="add" size={22} color={focused || wide ? colors.accentInk : colors.text} />
    </View>
  );
}

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= SIDEBAR_MIN_WIDTH;
  const bottom = useSafeAreaInsets().bottom;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: wide ? colors.raised : undefined,
        tabBarStyle: wide
          ? { backgroundColor: colors.surface, borderRightColor: colors.borderSoft, borderRightWidth: 1, width: 232, minWidth: 232, paddingTop: 12 }
          : { backgroundColor: 'rgba(10,10,15,0.97)', borderTopColor: colors.borderSoft, height: Platform.OS === 'web' ? 64 : 58 + bottom, paddingBottom: Platform.OS === 'web' ? undefined : bottom },
        tabBarItemStyle: wide ? { borderRadius: 12, marginHorizontal: 10, marginVertical: 2, height: 48 } : undefined,
        tabBarLabelStyle: wide ? { fontSize: 15, fontWeight: '700' } : { fontSize: 11, fontWeight: '600' },
        tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="discover" options={{ title: 'Descobrir', tabBarIcon: icon('compass', 'compass-outline') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Criar',
          tabBarIcon: ({ focused }) => <CreateIcon focused={focused} wide={wide} />,
          tabBarLabel: wide ? ({ color }) => <Text style={{ color: String(color), fontSize: 15, fontWeight: '700', marginLeft: 12 }}>Criar</Text> : undefined,
        }}
      />
      <Tabs.Screen name="chats" options={{ title: 'Conversas', tabBarIcon: icon('chatbubbles', 'chatbubbles-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
