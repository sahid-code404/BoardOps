export interface SystemRepository {
  pingDatabase(): Promise<boolean>;
}
