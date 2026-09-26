export function cloudLoadErrorHint(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('list cloud accounts') ||
    lower.includes('cloud_accounts') ||
    lower.includes('relation') ||
    lower.includes('does not exist')
  ) {
    return 'If this persists after retry, your API host may need the latest backend deploy and database migration (cloud_accounts table).';
  }
  if (lower.includes('failed to resolve teams')) {
    return 'Your DevOps user may not belong to a DevOps team yet. Ask a manager to add you, then refresh.';
  }
  return 'Check the DevOps API URL and your session, then retry.';
}
