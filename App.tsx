/**
 * Mobile Babysitter
 * P2P baby monitor app — privacy-first, no cloud dependency.
 *
 * @format
 */

import { useState } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ErrorBoundary from './src/components/ErrorBoundary';
import RootNavigator from './src/navigation/RootNavigator';
import { useHideBootSplash } from './src/components/Splash';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  // DMY-58: hide the native (PLACEHOLDER) bootsplash once the root navigator has
  // mounted and laid out. NavigationContainer fires `onReady` at exactly that
  // point; flipping this flag drives the one-shot fade-out in useHideBootSplash.
  const [navReady, setNavReady] = useState(false);
  useHideBootSplash(navReady);

  // ErrorBoundary sits INSIDE SafeAreaProvider but OUTSIDE NavigationContainer:
  //  - inside SafeAreaProvider so the themed ErrorFallback (which relies on
  //    safe-area context-aware layout) renders correctly even after a crash;
  //  - outside NavigationContainer so a crash thrown by the navigator or any
  //    screen is still caught and replaced by the fallback rather than tearing
  //    down the whole tree.
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ErrorBoundary>
        <NavigationContainer onReady={() => setNavReady(true)}>
          <RootNavigator />
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default App;
