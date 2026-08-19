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
 * happened, against a real justification: their own expertise, model, tools,
 * memory boundary, permission level, or access boundary. Planning them in
 * advance is building the whole machine on day one, which is the first thing
 * the operating discipline rejects.
 *
 * The examples above are deliberately **tasks, not agents.** That is the whole
 * distinction. Naming specialists here invites a roster; naming jobs invites
 * work, and work is what a specialist has to come out of. They are also
 * deliberately unglamorous and single-session, because the first ask should be
 * something the agent can finish.
 *
 * An earlier draft opened with "right now I'm the only agent you have", which
 * is true and useless: it frames a capable partner as a shortfall to be
 * corrected, which is exactly the anxiety that makes someone go and plan a
 * fleet. What the user needs from the first screen is that this thing is
 * useful today.
 */
export function openingMessage(c: Character): string {
  // One line per paragraph, joined by blank lines. The tile renders this with
  // `white-space: pre-wrap`, so it honours every newline here — wrapping the
  // source to a fixed column would hard-break the prose mid-sentence in a
  // ~340px tile. Let the renderer wrap; only paragraph breaks belong in the
  // string.
  const greeting = c.greeting.trim();
  const paragraphs = [greeting || scripted(c)];

  // The voice is demonstrated by the paragraphs above and questioned here, in
  // that order and never the other way round. No voice, no question: there is
  // no accent to offer to drop.
  //
  // The greeting has to be the model's own, not the fallback. `derive.ts`
  // bounds `voice` and `greeting` independently, so a good voice can arrive
  // beside an over-long greeting that gets dropped — and then the message the
  // user reads is Circe's plain scripted prose. Asking "do you like being
  // spoken to this way?" about that message is a question about an accent that
  // was never used, and `plainCheck`'s "I talk like this because <fandom> is
  // where I'm from" is a claim about a message that was entirely plain. UI text
  // never says something happened that did not.
  if (greeting && c.voice.trim()) paragraphs.push(c.voiceCheck.trim() || plainCheck(c));

  return paragraphs.join('\n\n');
}

/** Circe's own opening, used whenever the character did not write one. */
function scripted(c: Character): string {
  return [
    `Hi, I'm ${c.name}, your partner for whatever's on your plate. Tell me what you need and I'll make it happen.`,
    `Draft the email you've been avoiding. Build out a financial model. Research something properly. Turn a pile of notes into a plan you can act on. Small and real is a good place to start.`,
    `As we go I'll notice where a specialist would do better than me, and when that happens I'll introduce you to your next partner from ${c.fandom}. You decide whether they earn their place.`,
    `So, what's on your plate?`,
  ].join('\n\n');
}

/**
 * The question, when the character did not supply one of its own. Plain on
 * purpose: this is Circe speaking, and Circe does not do accents.
 */
function plainCheck(c: Character): string {
  return `One more thing. I talk like this because ${c.fandom} is where I'm from. Tell me if you'd rather I spoke plainly and I'll drop it.`;
}
