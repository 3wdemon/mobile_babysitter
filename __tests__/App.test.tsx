/**
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from '../App';

// SafeAreaProvider waits for a native layout event before rendering its
// children, which never fires under react-test-renderer. Providing
// `initialMetrics` makes it render synchronously so the app tree mounts.
const TEST_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderApp() {
  let tree: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={TEST_METRICS}>
        <App />
      </SafeAreaProvider>,
    );
  });
  // @ts-expect-error assigned inside act()
  return tree;
}

test('renders without crashing', () => {
  const tree = renderApp();
  expect(tree.toJSON()).toBeTruthy();
});

test('renders the "Mobile Babysitter" title', () => {
  const tree = renderApp();

  const titles = tree.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .filter((child): child is string => typeof child === 'string');

  expect(titles).toContain('Mobile Babysitter');
});
