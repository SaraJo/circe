import type { Character } from '../../shared/types';

/**
 * Written into the tile as if the agent sent it. Global Constraint 7 governs the
 * wording: the user has one agent, and this conversation is what produces more.
 */
export function openingMessage(c: Character): string {
  return [
    `Hi — I'm ${c.name}. Right now I'm the only agent you have, and my job is to`,
    'help you build the rest.',
    '',
    "Think of it like hiring. Tell me what you spend your time on and I'll suggest",
    'specialists worth having — one for your job, one for the code, one for the',
    `household admin you keep forgetting. I'll set each of them up, give them a name`,
    `from ${c.fandom}, and hand them the tools they need.`,
    '',
    'So: what do you spend your week on?',
    '',
    `(Or say "just show me around" and I'll wait until you're ready.)`,
  ].join('\n');
}
