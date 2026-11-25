import type { ProfileData } from '@levelmaxing/contracts';

export const emptyProfile: ProfileData = {
  name: '', goal: '', experience: '', equipment: [], weekdays: [], minutes: 0,
  muscles: [], calories: null, units: 'kg', onboarded: false,
};

export function profileFields(profile: ProfileData): string {
  const { name, goal, experience, equipment, weekdays, minutes, muscles, calories, onboarded } = profile;
  return JSON.stringify([name, goal, experience, equipment, weekdays, minutes, muscles, calories, onboarded]);
}

export function onboardingStep(profile: ProfileData): number {
  if (profile.onboarded || onboardingError(0, profile)) return 0;
  if (onboardingError(1, profile)) return 1;
  return profile.muscles.length ? 3 : 2;
}

export function onboardingError(step: number, profile: ProfileData, rawCalories = ''): string | undefined {
  if (step === 0 && (!profile.name.trim() || !profile.goal.trim() || !profile.experience.trim())) {
    return 'Enter a name and choose a goal and experience level.';
  }
  if (step === 1 && (!profile.equipment.length || !profile.weekdays.length || profile.minutes <= 0)) {
    return 'Choose equipment, at least one training day, and a session length.';
  }
  const target = rawCalories.trim();
  if (step === 3 && target && (!/^\d{1,5}$/.test(target) || Number(target) < 1 || Number(target) > 20_000)) {
    return 'Enter a daily calorie target between 1 and 20,000, or leave it blank.';
  }
}

export function profileAfterStep(saved: ProfileData, form: ProfileData, step: number, rawCalories: string): ProfileData | undefined {
  if (step !== 3 && saved.onboarded) return;
  if (step === 0) return { ...saved, name: form.name.trim(), goal: form.goal, experience: form.experience };
  if (step === 1) return { ...saved, equipment: form.equipment, weekdays: form.weekdays, minutes: form.minutes };
  if (step === 2) return { ...saved, muscles: form.muscles };
  const target = rawCalories.trim();
  return { ...form, name: form.name.trim(), units: saved.units, calories: target ? Number(target) : null, onboarded: true };
}
