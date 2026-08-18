import type { Character } from '../../shared/types';

/**
 * Written into the tile as if the agent sent it. Global Constraint 7 governs the
 * wording: the user has one agent, and this conversation is what produces more.
 *
 * **It must never ask the user to plan their fleet.** The previous version did
 * — "tell me what you spend your time on and I'll suggest specialists worth
 * having — one for your job, one for the code, one for the household admin you
 * keep forgetting" — and the orchestrator duly asked its first user to name the
 * agents it should spin up. That read like the model drifting from its skill;
 * it was not. This string was telling it to, and no amount of correct procedure
 * in `circe-orchestrator/SKILL.md` survives an opening line that asks for the
 * opposite.
 *
 * Specialists are supposed to earn their place out of work that has actually
 * happened, against a real justification — their own expertise, model, tools,
 * memory boundary, permission level, or access boundary. Planning them in
 * advance is building the whole machine on day one, which is the first thing
 * the operating discipline rejects. So this message declines the roster out
 * loud, states the bar, leaves the decision with the user, and asks about one
 * real thing.
 */
export function openingMessage(c: Character): string {
  // One line per paragraph, joined by blank lines. The tile renders this with
  // `white-space: pre-wrap`, so it honours every newline here — wrapping the
  // source to a fixed column would hard-break the prose mid-sentence in a
  // ~340px tile. Let the renderer wrap; only paragraph breaks belong in the
  // string.
  return [
    `Hi, I'm ${c.name}. Right now I'm the only agent you have, and that's the right number to start with.`,
    `We can add more later, but I'd rather not hand you a roster to approve on day one. I don't know your work yet. When something comes up that genuinely needs its own agent, with its own tools, its own memory, its own permissions, I'll introduce you to your next partner from ${c.fandom} and tell you why they're worth having. You decide whether they earn their place.`,
    'So: what are you working on right now?',
    `(Or say "just show me around" and I'll wait until you're ready.)`,
  ].join('\n\n');
}
