/**
 * Jest mock for `react-native-qrcode-svg` (DMY-6).
 *
 * The real component renders via `react-native-svg`, which is a native module
 * with no JS fallback under Jest. This mock renders a plain RN `View` that
 * surfaces the encoded `value` through `testID="mock-qrcode"` and the
 * `accessibilityLabel` prop, so screen tests can assert the QR is rendered with
 * a non-empty payload WITHOUT touching native SVG.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

export interface MockQRCodeProps {
  value?: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
}

function QRCode({ value }: MockQRCodeProps) {
  return (
    <View
      testID="mock-qrcode"
      accessibilityLabel={value}
      style={styles.dot}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 1, height: 1 },
});

export default QRCode;
