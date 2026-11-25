import type { NutritionData } from '@levelmaxing/contracts';
import { Notice, Screen } from '../../shared/ui.tsx';

export const emptyNutrition: NutritionData = { meals: [], recipes: [], groceries: [] };

export function NutritionLoading({ title, unavailable = false }: { title: string; unavailable?: boolean }) {
  return <Screen title={title}>
    <Notice kind={unavailable ? 'error' : 'info'}>
      {unavailable ? 'Food storage is unavailable. Reopen the app and try again.' : 'Loading your food data…'}
    </Notice>
  </Screen>;
}
