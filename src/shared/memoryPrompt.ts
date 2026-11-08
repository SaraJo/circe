const PREFIX = '[circe-personal-context-v1:';
const USER = '\n\nCurrent user message:\n';

/** Length framing keeps quoted marker text inside a saved fact from hiding user text. */
export function withPersonalContext(text: string, context: string): string {
  return context ? `${PREFIX}${context.length}]\n${context}${USER}${text}` : text;
}

export function originalUserMessage(text: string): string {
  if (!text.startsWith(PREFIX)) return text;
  const header = /^\[circe-personal-context-v1:(\d{1,6})\]\n/.exec(text);
  if (!header) return text;
  const end = header[0].length + Number(header[1]);
  return text.slice(end, end + USER.length) === USER ? text.slice(end + USER.length) : text;
}
