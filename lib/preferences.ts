import { useSyncExternalStore } from 'react';
const changeEvent = 'voltlog-preference-change';
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changeEvent, listener);
  };
}
export function useDevicePreference(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );
  const save = (next: string) => {
    try {
      localStorage.setItem(key, next);
      window.dispatchEvent(new Event(changeEvent));
      return true;
    } catch { return false; }
  };
  return [value, save] as const;
}
