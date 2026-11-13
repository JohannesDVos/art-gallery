export interface Work {
  id: string;
  title: string;
  artist: string;
  description: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  mediaUrl: string;
  previewUrl: string | null;
}

export const worksPerRoom = 8;

export async function request<T>(path = '', options?: RequestInit): Promise<T> {
  const response = await fetch('/api/works' + path, options);
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw new Error(data?.error ?? 'Der Galerie-Server konnte die Anfrage nicht beantworten.');
  }
  return data;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Der Vorgang konnte nicht abgeschlossen werden.';
}
