/**
 * Example app — runnable Expo project for react-native-smooth-task.
 *
 * Navigation tree (matches docs/architecture.md examples):
 *
 *   RootStack  '<root>'      → [ MainTabs, Settings(modal) ]    — JS stack
 *   MainTabs                 → [ Home, Orders ]                 — tabs (no adapter)
 *   HomeStack  'tab:Home'    → [ Feed(HeavyScreen), Post ]      — JS stack
 *   OrdersStack 'tab:Orders' → [ OrdersList, OrderDetail ]      — native stack
 *
 * The mixed JS-stack + native-stack + unadorned-tabs layout exists to
 * exercise both adapters and state-tree-only focus on one device:
 *
 *   1. <SmoothTaskProvider> wraps everything (diagnostics in __DEV__).
 *   2. useSmoothNavigationContainer({ navigationRef }) spreads onto
 *      <NavigationContainer> so the coordinator receives the state tree.
 *   3. One listener hook per stack navigator — useSmoothStackListeners for
 *      JS stacks, useSmoothNativeStackListeners for native stacks. Tabs need
 *      no listeners; focus ancestry comes from the state tree's index.
 *   4. The bottom overlay records every observed event (state change, focus,
 *      blur, transitionStart/End, gestureCancel, coordinator diagnostics)
 *      with ms timestamps — use it to verify event ordering on-device.
 */

import 'react-native-gesture-handler';

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';
import { createStackNavigator, type StackNavigationProp } from '@react-navigation/stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  SmoothTaskProvider,
  useSmoothNavigationContainer,
  type NavigationContainerObservers,
} from 'react-native-smooth-task';
import { useSmoothStackListeners } from 'react-native-smooth-task/stack';
import { useSmoothNativeStackListeners } from 'react-native-smooth-task/native-stack';

import { HeavyScreen } from './screens/HeavyScreen';
import { DetailScreen } from './screens/DetailScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LabScreen } from './screens/LabScreen';
import { BenchmarkScreen, type BenchmarkMode } from './screens/BenchmarkScreen';
import {
  TimelineOverlay,
  shortRouteKey,
  timelineLog,
  wrapScreenListeners,
} from './timeline';

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
  Lab: undefined;
  Feed: undefined;
  Post: { postId: string };
  Benchmark: { mode: BenchmarkMode };
};

export type OrdersStackParamList = {
  OrdersList: undefined;
  OrderDetail: { orderId: string };
  OrderDetailStatic: { orderId: string };
};

// --- Navigators ---------------------------------------------------------------

const navigationRef = createNavigationContainerRef<RootStackParamList>();

const RootStack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabsParamList>();
const HomeStack = createStackNavigator<HomeStackParamList>();
const OrdersStack = createNativeStackNavigator<OrdersStackParamList>();

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

function BenchmarkRoute({ route }: { route: { params: { mode: BenchmarkMode } } }) {
  return <BenchmarkScreen route={route} />;
}

function PostRoute({ route }: { route: { params: { postId: string } } }) {
  return <DetailScreen title={`Post ${route.params.postId}`} seed={route.params.postId} />;
}

function HomeStackScreen() {
  // One listener hook per stack navigator. `id` is a diagnostics label.
  const listeners = useSmoothStackListeners({ id: 'home' });
  const timedListeners = useMemo(() => wrapScreenListeners('home', listeners), [listeners]);
  return (
    <HomeStack.Navigator screenListeners={timedListeners} initialRouteName="Lab">
      <HomeStack.Screen name="Lab" component={LabScreen} options={{ title: 'Lab' }} />
      <HomeStack.Screen name="Feed" component={FeedRoute} />
      <HomeStack.Screen name="Post" component={PostRoute} />
      <HomeStack.Screen name="Benchmark" component={BenchmarkRoute} />
    </HomeStack.Navigator>
  );
}

function OrdersStackScreen() {
  const listeners = useSmoothNativeStackListeners({ id: 'orders' });
  const timedListeners = useMemo(() => wrapScreenListeners('orders', listeners), [listeners]);
  return (
    <OrdersStack.Navigator screenListeners={timedListeners}>
      <OrdersStack.Screen name="OrdersList" component={OrdersListRoute} />
      <OrdersStack.Screen name="OrderDetail" component={OrderDetailRoute} />
      {/* animation:'none' exercises the never-animated settling tier inside
          a native-stack that is otherwise observed as animated */}
      <OrdersStack.Screen
        name="OrderDetailStatic"
        component={OrderDetailRoute}
        options={{ animation: 'none', title: 'Order (no animation)' }}
      />
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
  const timedListeners = useMemo(() => wrapScreenListeners('root', listeners), [listeners]);
  return (
    <RootStack.Navigator screenListeners={timedListeners}>
      <RootStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <RootStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ presentation: 'modal', title: 'Settings' }}
      />
    </RootStack.Navigator>
  );
}

// --- Timeline helpers ----------------------------------------------------------

type NavStateLike = NavigationState | PartialState<NavigationState> | undefined;
/** The coordinator's structural state-tree shape (PartialRoute keys are
 *  optional in React Navigation's types but always present at runtime). */
type NavTreeState = Parameters<NavigationContainerObservers['onStateChange']>[0];

/** Walk the focused branch to a readable path like "MainTabs › Orders › OrderDetail". */
function focusedRoutePath(state: NavStateLike): string {
  const names: string[] = [];
  let s = state;
  while (s && s.routes.length > 0) {
    const route = s.routes[s.index ?? s.routes.length - 1];
    if (!route) break;
    names.push(route.name);
    s = route.state as NavStateLike;
  }
  return names.join(' › ');
}

// --- App entry -----------------------------------------------------------------

/**
 * useSmoothNavigationContainer reads the SmoothTask context, so it must run
 * INSIDE <SmoothTaskProvider> — keep the container wiring in a child
 * component, never in the component that renders the provider.
 */
function AppNavigation() {
  // Spreads { onReady, onStateChange } onto NavigationContainer.
  // `getRootState` lets the hook deliver the INITIAL state on ready —
  // without it the coordinator waits for the first onStateChange (and emits
  // a `missing-nav-ref` warning). The cast bridges React Navigation's
  // PartialRoute types (key optional) to the coordinator's state tree.
  const observers = useSmoothNavigationContainer({
    getRootState: () => navigationRef.getRootState() as NavTreeState,
  });

  const timedObservers = useMemo(
    () => ({
      onReady: () => {
        timelineLog('container ready');
        observers.onReady?.();
      },
      onStateChange: (state: Readonly<NavigationState> | undefined) => {
        timelineLog(`state-change → ${focusedRoutePath(state)}`);
        observers.onStateChange?.(state as NavTreeState);
      },
    }),
    [observers]
  );

  return (
    <NavigationContainer ref={navigationRef} {...timedObservers}>
      <Root />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    // Custom diagnostics sink → the timeline recorder. In record-only mode
    // timelineLog skips both re-render notifications and console writes, so
    // benchmarks get a genuinely silent runtime.
    <SmoothTaskProvider
      diagnostics={{
        emit: (event) => {
          const target = shortRouteKey(event.routeKey ?? event.scopeId);
          timelineLog(`${event.code}${target ? ` ${target}` : ''}`);
        },
      }}
    >
      <SafeAreaProvider>
        <View style={styles.root}>
          <AppNavigation />
          <TimelineOverlay />
        </View>
      </SafeAreaProvider>
    </SmoothTaskProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
