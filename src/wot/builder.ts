export function parseContactList(event: { tags: string[][] }): string[] {
  return event.tags.filter((tag) => tag[0] === 'p' && tag.length >= 2).map((tag) => tag[1]);
}

// QueryFn: given pubkeys, returns a map of pubkey -> follow list
export type QueryFn = (pubkeys: string[]) => Promise<Map<string, string[]>>;

export async function buildWotGraph(
  rootPubkeys: string[],
  maxDepth: number,
  queryFn: QueryFn,
): Promise<Set<string>> {
  const visited = new Set<string>();
  let frontier = new Set(rootPubkeys);

  // Add roots
  for (const pk of rootPubkeys) visited.add(pk);

  for (let depth = 0; depth < maxDepth; depth++) {
    if (frontier.size === 0) break;

    const contactLists = await queryFn([...frontier]);
    const nextFrontier = new Set<string>();

    for (const [pubkey, follows] of contactLists) {
      if (!frontier.has(pubkey)) continue;
      for (const follow of follows) {
        if (!visited.has(follow)) {
          visited.add(follow);
          nextFrontier.add(follow);
        }
      }
    }

    frontier = nextFrontier;
  }

  return visited;
}
