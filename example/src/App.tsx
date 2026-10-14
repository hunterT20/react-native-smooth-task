/**
 * Example app — reference wiring for react-native-smooth-task.
 *
 * Navigation tree (matches docs/architecture.md examples):
 *
 *   RootStack '<root>'       → [ MainTabs, Settings(modal) ]
 *   MainTabs                 → [ Home, Orders ]
 *   HomeStack  'tab:Home'    → [ Feed(HeavyScreen), Post(DetailScreen) ]
 *   OrdersStack 'tab:Orders' → [ OrdersList(OrdersScreen), OrderDetail ]
 *
 * Wiring recipe:
 *   1. <SmoothTaskProvider> wraps everything (diagnostics in __DEV__).
 *   2. useSmoothNavigationContainer({ navigationRef }) → spread onto
 *      <NavigationContainer> so the coordinator receives the state tree.
 *   3. useSmoothStackListeners({ id }) → screenListeners on EVERY stack
 *      navigator (Root + Home + Orders). Tabs need no listeners — their
 *      focus ancestry is derived from the state tree's index.
 */

import 'react-native-gesture-handler';

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator, type StackNavigationProp } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SmoothTaskProvider, useSmoothNavigationContainer } from 'react-native-smooth-task';
import { useSmoothStackListeners } from 'react-native-smooth-task/stack';

import { HeavyScreen } from './screens/HeavyScreen';
import { DetailScreen } from './screens/DetailScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SettingsScreen } from './screens/SettingsScreen';

// --- Param lists --------------------------------------------------------------

export type RootStackParamList = {
  MainTabs: undefined;
  Settings: undefined;
};

export type MainTabsParamList = {
  Home: undefined;
  Orders: undefined;
};

export type HomeStackParamList = {
  Feed: undefined;
  Post: { postId: string };
};

export type OrdersStackParamList = {
  OrdersList: undefined;
  OrderDetail: { orderId: string };
};

// --- Navigators ---------------------------------------------------------------

const navigationRef = createNavigationContainerRef<RootStackParamList>();

const RootStack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();
const HomeStack = createStackNavigator<HomeStackParamList>();
const OrdersStack = createStackNavigator<OrdersStackParamList>();

type HomeNav = StackNavigationProp<HomeStackParamList, 'Feed'>;
type OrdersNav = StackNavigationProp<OrdersStackParamList, 'OrdersList'>;

function FeedRoute({ navigation }: { navigation: HomeNav }) {
  return <HeavyScreen onOpenPost={(postId) => navigation.navigate('Post', { postId })} />;
}

function OrdersListRoute({ navigation }: { navigation: OrdersNav }) {
  return (
    <OrdersScreen onOpenOrder={(orderId) => navigation.navigate('OrderDetail', { orderId })} />
  );
}

function OrderDetailRoute({ route }: { route: { params: { orderId: string } } }) {
  return <DetailScreen title={`Order ${route.params.orderId}`} seed={route.params.orderId} />;
}

function PostRoute({ route }: { route: { params: { postId: string } } }) {
  return <DetailScreen title={`Post ${route.params.postId}`} seed={route.params.postId} />;
}

function HomeStackScreen() {
  // One listener hook per stack navigator. `id` is a diagnostics label.
  const listeners = useSmoothStackListeners({ id: 'home' });
  return (
    <HomeStack.Navigator screenListeners={listeners}>
      <HomeStack.Screen name="Feed" component={FeedRoute} />
      <HomeStack.Screen name="Post" component={PostRoute} />
    </HomeStack.Navigator>
  );
}

function OrdersStackScreen() {
  const listeners = useSmoothStackListeners({ id: 'orders' });
  return (
    <OrdersStack.Navigator screenListeners={listeners}>
      <OrdersStack.Screen name="OrdersList" component={OrdersListRoute} />
      <OrdersStack.Screen name="OrderDetail" component={OrderDetailRoute} />
    </OrdersStack.Navigator>
  );
}

function MainTabs() {
  // No listeners on the tab navigator: focus ancestry comes from the
  // navigation state tree, so tab switches are tracked automatically.
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeStackScreen} />
      <Tab.Screen name="Orders" component={OrdersStackScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const listeners = useSmoothStackListeners({ id: 'root' });
  return (
    <RootStack.Navigator screenListeners={listeners}>
      <RootStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ presentation: 'modal', title: 'Settings' }}
      />
    </RootStack.Navigator>
  );
}

// --- App entry -----------------------------------------------------------------

/**
 * useSmoothNavigationContainer reads the SmoothTask context, so it must run
 * INSIDE <SmoothTaskProvider> — keep the container wiring in a child
 * component, never in the component that renders the provider.
 */
function AppNavigation() {
  // Spreads { onReady, onStateChange } onto NavigationContainer.
  // `navigationRef` lets the hook deliver the INITIAL state on ready via
  // navigationRef.current.getRootState() — without it the coordinator waits
  // for the first onStateChange (and emits a `missing-nav-ref` warning).
  const observers = useSmoothNavigationContainer({ navigationRef });

  return (
    <NavigationContainer ref={navigationRef} {...observers}>
      <Root />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SmoothTaskProvider diagnostics={__DEV__}>
      <SafeAreaProvider>
        <AppNavigation />
      </SafeAreaProvider>
    </SmoothTaskProvider>
  );
}
