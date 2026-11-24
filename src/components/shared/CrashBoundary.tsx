import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Catches a screen that fails while drawing, and says so.
 *
 * WHY THIS EXISTS. Until now the app had no error boundary anywhere. A single
 * exception thrown while React was rendering unmounted the whole tree, and on
 * the web that leaves a blank white page: no title, no back arrow, no message,
 * nothing in the interface to suggest anything had gone wrong. Twice in one
 * week a screen was reported as "not displaying", and there was no way to tell
 * from the outside whether it had crashed, been refused by a guard, or simply
 * never been reached. A blank page is the one failure that cannot be diagnosed
 * remotely, so it must never be what a person sees.
 *
 * DELIBERATELY NOT TRANSLATED, and deliberately plain. If the thing that threw
 * was the translation layer, the theme, or a context provider, then `t()` and
 * the palette would throw again inside this very component and the boundary
 * would take the screen down with it. Hard-coded English and hard-coded hex is
 * the one version that cannot fail twice.
 *
 * It shows the message rather than hiding it. "Something went wrong" sends the
 * reader to ask an admin; the actual sentence, which they can read out or
 * screenshot, is what gets it fixed.
 */
export class CrashBoundary extends React.Component<
  { children: React.ReactNode; where?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Logged whole, because the on-screen copy is necessarily short and the
    // stack is what actually locates the fault.
    console.error(
      `[WeeklyClass] screen crashed${this.props.where ? ` in ${this.props.where}` : ''}:`,
      error,
      info?.componentStack
    );
  }

  private retry = () => {
    // On the web a reload is the honest reset: the module that threw may hold
    // bad state that remounting alone would keep. On a phone there is nothing
    // to reload, so clearing the error remounts the subtree.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return <>{this.props.children}</>;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.title}>This screen could not be drawn</Text>
          <Text style={styles.lead}>
            Nothing is lost and no data has been changed. Please send this message to whoever
            maintains the app — it says exactly what failed.
          </Text>
          {this.props.where ? <Text style={styles.where}>Screen: {this.props.where}</Text> : null}
          <View style={styles.box}>
            <Text style={styles.message} selectable>
              {String(error?.message || error)}
            </Text>
          </View>
          <Pressable onPress={this.retry} style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

/*
 * Fixed colours, for the reason given above: a theme that threw must not be
 * asked for a palette to draw the apology in.
 */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { padding: 24, gap: 12, maxWidth: 560, alignSelf: 'center', width: '100%' },
  title: { fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginTop: 24 },
  lead: { fontSize: 14, color: '#555555', lineHeight: 21 },
  where: { fontSize: 12, color: '#777777' },
  box: {
    backgroundColor: '#FBEAEA',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8C4C4',
    padding: 12,
  },
  message: { fontSize: 13, color: '#7A1F1F', lineHeight: 19 },
  button: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#1A6B54',
  },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
