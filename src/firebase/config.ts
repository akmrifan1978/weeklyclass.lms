import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  inMemoryPersistence,
  connectAuthEmulator,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

const isWeb = Platform.OS === 'web';

function requireEnv(key: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[WeeklyClass LMS] Missing environment variable ${key}. ` +
        `Copy .env.example to .env and fill in your Firebase web config.`
    );
  }
  return value;
}

export const firebaseConfig = {
  apiKey: requireEnv('EXPO_PUBLIC_FIREBASE_API_KEY', process.env.EXPO_PUBLIC_FIREBASE_API_KEY),
  authDomain: requireEnv(
    'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
  ),
  projectId: requireEnv(
    'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
  ),
  storageBucket: requireEnv(
    'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
  ),
  messagingSenderId: requireEnv(
    'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  ),
  appId: requireEnv('EXPO_PUBLIC_FIREBASE_APP_ID', process.env.EXPO_PUBLIC_FIREBASE_APP_ID),
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * React Native auth persistence.
 *
 * The `firebase/auth` entry point is a thin `export *` over `@firebase/auth`,
 * which Metro resolves to its `react-native` build — that build exports
 * `getReactNativePersistence`. The umbrella *type* declarations only describe
 * the web build, so the symbol is resolved dynamically and narrowed here.
 */
function nativePersistence(): Persistence {
  try {
    const authModule = require('firebase/auth') as {
      getReactNativePersistence?: (storage: unknown) => Persistence;
    };
    if (typeof authModule.getReactNativePersistence === 'function') {
      return authModule.getReactNativePersistence(AsyncStorage);
    }
  } catch {
    // fall through to memory persistence
  }
  console.warn(
    '[WeeklyClass LMS] AsyncStorage auth persistence unavailable — ' +
      'sessions will not survive an app restart.'
  );
  return inMemoryPersistence;
}

function createAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: isWeb ? browserLocalPersistence : nativePersistence(),
    });
  } catch {
    // initializeAuth throws if auth was already initialised (Fast Refresh).
    return getAuth(app);
  }
}

export const auth: Auth = createAuth();

function createFirestore(): Firestore {
  try {
    return initializeFirestore(app, {
      // Offline cache keeps the app usable on poor connections. Multi-tab
      // persistence only exists on web; native uses the in-memory cache plus
      // Firestore's own listener cache.
      localCache: isWeb
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
      // React Native networking does not always support gRPC streaming.
      experimentalAutoDetectLongPolling: !isWeb,
    });
  } catch {
    return getFirestore(app);
  }
}

export const db: Firestore = createFirestore();
export const storage: FirebaseStorage = getStorage(app);

// ---------------------------------------------------------------------------
// Local Emulator Suite (opt-in via EXPO_PUBLIC_USE_FIREBASE_EMULATOR=true)
// ---------------------------------------------------------------------------

let emulatorsConnected = false;

if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === 'true' && !emulatorsConnected) {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || 'localhost';
  try {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectStorageEmulator(storage, host, 9199);
    emulatorsConnected = true;
    console.log(`[WeeklyClass LMS] Connected to Firebase emulators at ${host}`);
  } catch (error) {
    console.warn('[WeeklyClass LMS] Could not connect to Firebase emulators', error);
  }
}

export const IS_WEB = isWeb;
