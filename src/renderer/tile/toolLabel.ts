/**
 * What the tile's single "⚙ …" bubble says while the agent works.
 *
 * Its own module, separate from `main.ts`, for the reason `copy.ts` is on the
 * wizard side: `main.ts` touches the DOM at module load, so nothing in it can
 * be imported under the `node` test environment. The decision about what text
 * a user sees is the part worth testing, so it lives where a test can reach it.
 *
 * ## Why this is not a one-liner
 *
 * ACP requires `title` on `tool_call` and makes every field except `toolCallId`
 * optional on `tool_call_update`: "only the fields being changed need to be
 * included". A tool that is merely reporting a status change therefore sends no
 * title, and that is the ordinary case rather than a malformed message.
 *
 * The renderer used to answer a missing title with the `toolCallId`, inherited
 * from the prototype (`~/Code/circe/renderer.js:398`, `u.title || u.toolCallId`).
 * So the bubble named the tool correctly when the call opened and then replaced
 * that name with a raw `toolu_01VsyAkmt8QqNFMnbPNhP96g` the instant the call
 * completed. Seen in the Phase 2 walkthrough and recorded there.
 *
 * The rule is the one the re-theme path already follows a few lines away: an
 * update that carries nothing leaves what is showing alone. Losing an update
 * costs nothing; applying an empty one costs the label.
 */

/** Shown when a bubble exists but no tool has ever named itself. */
export const WORKING = 'Working…';

/**
 * The title to show after `update`, given what is showing now. Returns
 * `remembered` unchanged whenever the update has no usable title of its own,
 * which is every status-only `tool_call_update`.
 */
export function nextToolTitle(update: unknown, remembered: string): string {
  const title = (update as { title?: unknown } | null | undefined)?.title;
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return trimmed || remembered;
}

/**
 * The bubble's text. An unnamed tool still gets a label, because the bubble's
 * whole job is to show that a long turn is working rather than frozen, and a
 * blank one reads as broken.
 */
export function toolLabel(title: string): string {
  return `⚙ ${title || WORKING}`;
}
