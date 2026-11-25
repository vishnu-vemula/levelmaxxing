import { useEffect, useRef, useState } from 'react';
import type { NutritionData } from '@levelmaxing/contracts';

export function useNutritionSave(save: (value: NutritionData) => Promise<void>) {
  const savingNow = useRef(false);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  async function write(value: NutritionData, after?: () => void) {
    if (savingNow.current) return;
    savingNow.current = true;
    setBusy(true);
    setError('');
    try {
      await save(value);
      if (active.current) after?.();
    } catch (reason) {
      if (active.current) setError(reason instanceof Error && knownFailureMessages.has(reason.message)
        ? reason.message : 'Could not save your change. Try again.');
    } finally {
      savingNow.current = false;
      if (active.current) setBusy(false);
    }
  }
  return { busy, error, write };
}

const knownFailureMessages = new Set([
  'This entry contains values outside the supported range.',
  'This section is full. Remove older entries before adding more.',
  'Device storage is unavailable. Open the app again to retry.',
]);
