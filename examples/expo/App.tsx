import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStrait, fromPlayInstallReferrer, type LinkEvent } from '@straitlink/react-native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Button, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { PlayInstallReferrer } from 'react-native-play-install-referrer';

const publishableKey = process.env.EXPO_PUBLIC_STRAIT_PUBLISHABLE_KEY ?? '';
const endpoint = process.env.EXPO_PUBLIC_STRAIT_ENDPOINT ?? '';
const configured = !!endpoint && !!publishableKey && !publishableKey.includes('REPLACE_ME');

// One client for the app's lifetime. AsyncStorage keeps the once-per-install deferred flag and unsent reports.
// The Play Install Referrer gives Android its exact deferred match (iOS ignores it).
const strait = configured
  ? createStrait({ publishableKey, endpoint, storage: AsyncStorage, installReferrer: fromPlayInstallReferrer(PlayInstallReferrer) })
  : null;
// React Native's New Architecture (Fabric renderer, bridgeless), shown so a build proves which one it ran on.
const g = globalThis as { RN$Bridgeless?: boolean; nativeFabricUIManager?: unknown };
const architecture =
  Platform.OS === 'web' ? 'web (react-native-web)' : `${g.nativeFabricUIManager ? 'Fabric' : 'Paper'}, ${g.RN$Bridgeless ? 'bridgeless' : 'bridge'}`;

// The screen a link path opens. A real app would call its router here (Expo Router: router.push(e.path)).
function screenFor(path?: string) {
  const product = path?.match(/^\/p\/(\d+)$/);
  return product ? `Product ${product[1]}` : 'Home';
}

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [screen, setScreen] = useState('Home');
  const add = (line: string) => setLog((l) => [...l, line]);

  useEffect(() => {
    if (!strait) return add('Set EXPO_PUBLIC_STRAIT_PUBLISHABLE_KEY in .env (copy .env.example), then restart.');
    // Direct links (straitexample://… or your verified links) and the deferred link after an install arrive here.
    const off = strait.onLink((e: LinkEvent) => {
      add(`${e.kind} link (${e.route}, ${e.appState}): matched=${e.matched} path=${e.path ?? '-'}`);
      if (e.matched && e.path) setScreen(screenFor(e.path));
    });
    if (Platform.OS === 'android') {
      // Shows the referrer module answers (a sideloaded build has no Strait link in it: "none" or Play's organic value).
      fromPlayInstallReferrer(PlayInstallReferrer)().then((r) => add(`Play install referrer read: ${r ?? 'none'}`));
    }
    strait.start(); // reads the launch link, listens for new ones, runs the deferred check once per install
    return () => {
      off();
      strait.stop();
    };
  }, []);

  const purchase = async () => {
    if (!strait) return add('Set your publishable key first.');
    const ok = await strait.trackEvent('purchase', { value: 4.99, currency: 'USD' });
    add(`event purchase sent: ${ok}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Strait example (Expo)</Text>
      <Text style={styles.screen}>Screen: {screen}</Text>
      <Text style={styles.line}>Architecture: {architecture}</Text>
      <Button title="Log a purchase event" onPress={purchase} />
      {log.map((line, i) => (
        <Text key={i} style={styles.line}>
          {line}
        </Text>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  screen: { fontSize: 28, fontWeight: '700' },
  line: { fontFamily: 'Courier', fontSize: 12 },
});
