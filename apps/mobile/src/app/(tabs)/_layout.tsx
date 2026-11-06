import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { colors } from '@/lib/theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

function icon(active: Icon, inactive: Icon) {
  return ({ color, focused }: { color: unknown; focused: boolean }) => <Ionicons name={focused ? active : inactive} size={23} color={String(color ?? colors.muted)} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: 'rgba(10,10,15,0.97)',
          borderTopColor: colors.borderSoft,
          height: Platform.OS === 'web' ? 64 : undefined,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarLabelPosition: 'below-icon',
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="discover" options={{ title: 'Descobrir', tabBarIcon: icon('compass', 'compass-outline') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Criar',
          tabBarIcon: ({ focused }) => (
            <View
              style={{
                width: 44,
                height: 30,
                borderRadius: 10,
                backgroundColor: focused ? colors.accent : colors.raised,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: focused ? colors.accent : colors.border,
              }}
            >
              <Ionicons name="add" size={22} color={focused ? colors.accentInk : colors.text} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="chats" options={{ title: 'Conversas', tabBarIcon: icon('chatbubbles', 'chatbubbles-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
