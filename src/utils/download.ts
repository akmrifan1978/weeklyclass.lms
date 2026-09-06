import { Platform } from 'react-native';

/**
 * Handing a generated file to the person who asked for it.
 *
 * Two different acts wearing one name. On the web the browser owns the
 * filesystem, so the file is offered as a download. On a phone there is no file
 * picker without another dependency, so it is shared instead — which puts it
 * wherever the person actually wants it, usually WhatsApp or Drive.
 */
export async function saveTextFile(
  filename: string,
  contents: string,
  mimeType = 'text/csv;charset=utf-8;'
): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const { File, Paths } = await import('expo-file-system');
  const Sharing = await import('expo-sharing');
  const file = new File(Paths.cache, filename);
  // Rewritten each time rather than appended to: an export is a snapshot of the
  // list as it stands now, not an accumulating log.
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  await Sharing.shareAsync(file.uri, { mimeType: mimeType.split(';')[0] });
}

/**
 * A filename that survives every filesystem it might land on.
 *
 * Arabic and Tamil are kept — an organiser naming an event in Tamil should get
 * a Tamil filename — while the punctuation Windows refuses is not.
 */
export function safeFilename(name: string, extension: string): string {
  const base = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${base || 'export'}.${extension}`;
}
