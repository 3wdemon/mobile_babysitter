/**
 * @format
 */

// Polyfill crypto.getRandomValues before anything else so the pairing service
// (DMY-6) has a cryptographically-strong RNG available. Must be the first
// import — it patches the global `crypto` on load.
import 'react-native-get-random-values';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
