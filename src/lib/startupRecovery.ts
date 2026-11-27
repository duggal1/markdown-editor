/** A healthy local workspace must never wait for a missing cloud record. */
export type StartupRecoveryMode = 'none' | 'blocking' | 'background';
export function startupRecoveryMode(
  documentCount: number, workspaceCount: number, needsRecovery: boolean,
  explicitRecovery: boolean, localReadFailed: boolean,
): StartupRecoveryMode {
  if (!needsRecovery) return 'none';
  if (explicitRecovery || localReadFailed || !documentCount || !workspaceCount) return 'blocking';
  return 'background';
}
