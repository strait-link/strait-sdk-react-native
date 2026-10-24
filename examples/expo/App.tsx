import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStrait, type LinkEvent } from '@straitlink/react-native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';

const publishableKey = process.env.EXPO_PUBLIC_STRAIT_PUBLISHABLE_KEY ?? '';
const endpoint = process.env.EXPO_PUBLIC_STRAIT_ENDPOINT ?? '';
const configured = !!endpoint && !!publishableKey && !publishableKey.includes('REPLACE_ME');

// One client for the app's lifetime. AsyncStorage keeps the once-per-install deferred flag and unsent reports.
const strait = configured ? createStrait({ publishableKey, endpoint, storage: AsyncStorage }) : null;

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((l) => [...l, line]);

  useEffect(() => {
    if (!strait) return add('Set EXPO_PUBLIC_STRAIT_PUBLISHABLE_KEY in .env (copy .env.example), then restart.');
    // Direct links (straitexample://… or your verified links) and the deferred link after an install arrive here.
    const off = strait.onLink((e: LinkEvent) =>
      add(`${e.kind} link (${e.route}, ${e.appState}): matched=${e.matched} path=${e.path ?? '-'}`),
    );
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
  line: { fontFamily: 'Courier', fontSize: 12 },
});
