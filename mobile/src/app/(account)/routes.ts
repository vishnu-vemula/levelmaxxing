import Add from './add.tsx';
import CheckIn from './check-in.tsx';
import Coach from './coach.tsx';
import ExportData from './export-data.tsx';
import Food from './food.tsx';
import Groceries from './groceries.tsx';
import History from './history.tsx';
import Today from './index.tsx';
import Library from './library.tsx';
import More from './more.tsx';
import Nutrition from './nutrition.tsx';
import Onboarding from './onboarding.tsx';
import Program from './program.tsx';
import Progress from './progress.tsx';
import Recipes from './recipes.tsx';
import Settings from './settings.tsx';
import Workout from './workout.tsx';

export const routes = {
  '/': Today, '/add': Add, '/check-in': CheckIn, '/coach': Coach, '/export-data': ExportData,
  '/food': Food, '/groceries': Groceries, '/history': History, '/library': Library, '/more': More,
  '/nutrition': Nutrition, '/onboarding': Onboarding, '/program': Program, '/progress': Progress,
  '/recipes': Recipes, '/settings': Settings, '/workout': Workout,
};
