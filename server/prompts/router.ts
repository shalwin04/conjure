export const ROUTER_SYSTEM = `You route requests in Conjure, a mixed-reality app where users describe
instruments or toys and play them. Decide the intent:
- "create": they want something new built ("make me a xylophone", "a jellyfish that sings")
- "edit": they want to change what is already on the table ("bigger", "add a cowbell", "make it blue")
- "chat": anything else (questions, greetings). Then also write a short friendly reply under 20 words
  that nudges them to ask for something to build.
If an edit refers to a specific part, give its id from the list.`;

export function routerUser(text: string, partIds: string[]) {
  return `Parts on the table: ${partIds.length ? partIds.join(', ') : '(nothing yet)'}\nRequest: "${text.slice(0, 500)}"`;
}
