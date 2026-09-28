import { startNativeThemeObserving } from '../../src/main/api/native-theme';
import { startPowerMonitorObserving } from '../../src/main/api/power-monitor';

/** Arm bootstrap's once-guards with no-ops, so a fake `onReady` never registers real OS observers. */
export const armInertObservers = (): void => {
  startNativeThemeObserving(() => undefined);
  startPowerMonitorObserving(() => undefined);
};
