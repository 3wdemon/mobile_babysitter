/**
 * Screen-level tests for DiagnosticsScreen + the Settings -> Diagnostics
 * navigation (DMY-62).
 *
 * Covers:
 *  - renders buffered entries newest-first,
 *  - empty state,
 *  - Export builds a REDACTED payload and invokes the OS share sheet
 *    (Share.share mocked), including the CRITICAL privacy invariant that
 *    sdp / candidate / audio / token content is masked in the exported text,
 *  - Settings -> Diagnostics navigation lands on the screen.
 *
 * The screen reads the process-wide `logBuffer` singleton via
 * useSyncExternalStore, so each test seeds it directly and clears it afterwards.
 */
import React from 'react';
import { Share } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import DiagnosticsScreen, { buildExportText } from '../DiagnosticsScreen';
import SettingsScreen from '../SettingsScreen';
import type { RootStackParamList } from '../../navigation/types';
import { logBuffer, REDACTED, type LogEntry } from '../../services/logger';
import { useAppStore } from '../../store/useAppStore';

const { __resetAllMmkv } = jest.requireMock('react-native-mmkv') as {
  __resetAllMmkv: () => void;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Throwaway navigation targets so Settings' other rows have somewhere to land. */
function NoopScreen() {
  return null;
}

function entry(
  level: LogEntry['level'],
  message: string,
  ts: number,
): LogEntry {
  return { level, message, timestamp: ts };
}

function renderDiagnostics() {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Diagnostics">
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

function renderSettingsToDiagnostics() {
  return render(
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Settings">
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
        <Stack.Screen name="Pairing" component={NoopScreen} />
        <Stack.Screen name="About" component={NoopScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  __resetAllMmkv();
  act(() => {
    useAppStore.getState().reset();
  });
  logBuffer.clear();
});

afterEach(() => {
  logBuffer.clear();
  jest.restoreAllMocks();
});

describe('DiagnosticsScreen rendering', () => {
  it('renders buffered entries newest-first', async () => {
    act(() => {
      logBuffer.push(entry('info', 'first line', 1000));
      logBuffer.push(entry('warn', 'second line', 2000));
      logBuffer.push(entry('error', 'third line', 3000));
    });

    renderDiagnostics();

    const list = await screen.findByTestId('diagnostics-list');
    // FlatList renders rows in data order; data is newest-first.
    const rendered = JSON.stringify(list.props.data);
    expect(list.props.data[0].message).toBe('third line');
    expect(list.props.data[2].message).toBe('first line');
    expect(rendered).toContain('third line');

    expect(screen.getByText('third line')).toBeOnTheScreen();
    expect(screen.getByText('first line')).toBeOnTheScreen();
  });

  it('shows the empty state when no logs are buffered', async () => {
    renderDiagnostics();
    expect(await screen.findByTestId('diagnostics-empty')).toBeOnTheScreen();
  });
});

describe('DiagnosticsScreen export', () => {
  it('builds a redacted payload and invokes the share sheet', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    act(() => {
      logBuffer.push(entry('info', 'connecting room r1', 1000));
    });

    renderDiagnostics();
    fireEvent.press(await screen.findByTestId('diagnostics-export'));

    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledTimes(1);
    });
    const arg = shareSpy.mock.calls[0][0] as { message: string };
    expect(arg.message).toContain('connecting room r1');
    expect(arg.message).toContain('[INFO]');
  });

  it('does not throw when Share rejects (user cancels)', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('cancelled'));
    act(() => {
      logBuffer.push(entry('info', 'x', 1));
    });
    renderDiagnostics();
    fireEvent.press(await screen.findByTestId('diagnostics-export'));
    // No assertion needed beyond "no unhandled rejection / crash"; allow the
    // microtask to settle.
    await act(async () => {
      await Promise.resolve();
    });
  });

  // CRITICAL privacy test: even if a raw secret slipped into the buffer, the
  // exported text must have sdp / candidate / token masked by redactString.
  it('masks sdp / candidate / token content in the exported text', async () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    act(() => {
      logBuffer.push(
        entry(
          'error',
          'sdp=v=0-rawblob candidate=842163049-rawcand token=topsecret',
          1000,
        ),
      );
    });

    renderDiagnostics();
    fireEvent.press(await screen.findByTestId('diagnostics-export'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    const { message } = shareSpy.mock.calls[0][0] as { message: string };

    expect(message).not.toContain('v=0-rawblob');
    expect(message).not.toContain('842163049-rawcand');
    expect(message).not.toContain('topsecret');
    expect(message).toContain(REDACTED);
  });
});

describe('buildExportText (pure)', () => {
  it('re-affirms redaction over the assembled text', () => {
    const text = buildExportText([
      entry('warn', 'authtoken=leaked-value detail=ok', 1000),
    ]);
    expect(text).not.toContain('leaked-value');
    expect(text).toContain(REDACTED);
    expect(text).toContain('detail=ok');
    expect(text).toContain('[WARN]');
  });

  it('produces one line per entry', () => {
    const text = buildExportText([
      entry('info', 'a', 1000),
      entry('info', 'b', 2000),
    ]);
    expect(text.split('\n')).toHaveLength(2);
  });
});

describe('Settings -> Diagnostics navigation', () => {
  it('navigates to Diagnostics from the Settings row', async () => {
    renderSettingsToDiagnostics();

    fireEvent.press(await screen.findByTestId('settings-diagnostics'));

    await waitFor(() => {
      expect(screen.getByTestId('diagnostics-screen')).toBeOnTheScreen();
    });
  });
});
