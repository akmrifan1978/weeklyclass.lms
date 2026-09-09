import React from 'react';
import { Stack } from 'expo-router';

/**
 * The public website.
 *
 * Pages anybody may read, signed in or not: what the centre teaches, who
 * teaches it, when it meets and how to reach it. Each one draws its own bar
 * and hero through PublicPage, so the navigator supplies no header of its own.
 *
 * Nothing here is a way in. Registering and signing in stay under `(auth)`,
 * which is what keeps the sign-in flow one place rather than two.
 */
export default function PublicLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
