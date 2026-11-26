import { NativeModules } from 'react-native';

export type SqlValue = string | number | null;

type StorageModule = {
  appVersion: string;
  randomUUID(): string;
  digest(value: string): Promise<string>;
  readSecret(id: string): Promise<string | null>;
  writeSecret(id: string, value: string): Promise<void>;
  deleteSecret(id: string): Promise<void>;
  open(namespace: string): Promise<string>;
  execute(connection: string, sql: string): Promise<void>;
  run(connection: string, sql: string, values: SqlValue[]): Promise<void>;
  query(connection: string, sql: string, values: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  close(connection: string): Promise<void>;
};

export function nativeStorage(): StorageModule {
  const module = NativeModules.LevelmaxingStorage as StorageModule | undefined;
  if (!module) throw new Error('This build requires native encrypted storage.');
  return module;
}

export const randomUUID = () => nativeStorage().randomUUID();
export const sha256 = (value: string) => nativeStorage().digest(value);
