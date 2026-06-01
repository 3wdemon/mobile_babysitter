/**
 * BabyScreen — baby unit (camera/mic streaming side).
 *
 * Skeleton for DMY-35. Streaming, mic capture and the foreground service are
 * implemented in later issues (DMY-6/7/14/17/18).
 */
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { RootStackScreenProps } from '../navigation/types';

function BabyScreen(_props: RootStackScreenProps<'Baby'>) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text
        style={[
          styles.title,
          {
            color: theme.colors.text,
            fontSize: theme.typography.fontSizes.lg,
            fontWeight: theme.typography.fontWeights.semibold,
          },
        ]}>
        Baby unit
      </Text>
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
  title: {},
});

export default BabyScreen;
