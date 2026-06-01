/**
 * PairingScreen — mode-selection / pairing entry point (initial route).
 *
 * Skeleton for DMY-35: renders a title and two buttons that route to the Baby
 * and Parent units so navigation can be exercised. The actual pairing flow
 * (QR / mDNS discovery, WebRTC handshake) is implemented in later issues.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { RootStackScreenProps } from '../navigation/types';

function PairingScreen({ navigation }: RootStackScreenProps<'Pairing'>) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.xl,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}>
        Mobile Babysitter
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
        onPress={() => navigation.navigate('Baby')}>
        <Text style={[styles.buttonLabel, { color: theme.colors.onPrimary }]}>
          Use as Baby unit
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.colors.primary }]}
        onPress={() => navigation.navigate('Parent')}>
        <Text style={[styles.buttonLabel, { color: theme.colors.onPrimary }]}>
          Use as Parent unit
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    marginBottom: 32,
  },
  button: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PairingScreen;
