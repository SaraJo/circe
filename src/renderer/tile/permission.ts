const PREVIEW_LINES = 10;

export function commandPreview(
  command: string,
  maxLines = PREVIEW_LINES,
): { lines: string[]; overflow: number } {
  const trimmed = command.replace(/\n+$/, '');
  const all = trimmed.split('\n');
  return {
    lines: all.slice(0, maxLines),
    overflow: Math.max(0, all.length - maxLines),
  };
}

export function permissionOutcomeLabel(outcome: unknown): string {
  switch (outcome) {
    case 'allow_once':
      return 'Allowed once';
    case 'allow_session':
      return 'Allowed for this session';
    case 'deny':
      return 'Denied';
    case 'expired':
      return 'Expired; the agent stopped waiting';
    default:
      return 'Resolved';
  }
}
