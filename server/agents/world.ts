/**
 * World Planner: Conjure's Holodeck-style path for places. One structured call
 * (Gemini in the hybrid profile) returns a ScenePlan (objects, counts, sizes,
 * spatial relations, story); the deterministic layout solver places it on the
 * terrain. Parts then stream to the headset so the world assembles in front
 * of the user, followed by the story. Falls back to the Designer on failure.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { blueprintFor } from '../../src/spec/presets.js';
import { ScenePlan, solveScene } from '../../src/spec/scene.js';
import { guessBiome } from '../../src/engine/biome.js';
import { guessTrack } from '../../src/engine/track.js';
import { validateCreation, type PartT } from '../../src/spec/schema.js';
import { fixStory, storyProblem, storyRequestFor } from '../../src/spec/story.js';
import { isFixture, structuredModel } from '../llm/models.js';
import { WORLD_SYSTEM, worldUser } from '../prompts/world.js';
import { designer } from './designer.js';
import { sleep } from './util.js';
import { emit, type NodeConfig, type State, type Update } from '../graph/state.js';

const newId = () => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function worldPlanner(state: State, config: NodeConfig): Promise<Update> {
  const wish = state.request.text;
  if (isFixture('planner') || (process.env.BLUEPRINTS !== 'off' && blueprintFor(wish))) return designer(state, config);
  emit(config, { type: 'stage', stage: 'designing', message: 'Planning the world' });
  const t0 = Date.now();
  let plan;
  try {
    plan = await structuredModel('planner', ScenePlan, 'scene_plan').invoke(
      [new SystemMessage(WORLD_SYSTEM), new HumanMessage(worldUser(wish))],
      { signal: config.signal },
    );
  } catch (err) {
    if (config.signal?.aborted) throw err;
    console.warn('[world] planner failed, using the designer', err instanceof Error ? err.message.slice(0, 160) : err);
    return designer(state, config);
  }
  // The biome makes worlds feel different; the wish's own words win when they are explicit.
  const guess = guessBiome(wish);
  if (!plan.terrain.biome || (guess === 'city' || guess === 'desert' || guess === 'snow')) plan.terrain.biome = guess !== 'meadow' ? guess : plan.terrain.biome ?? 'meadow';
  const track = guessTrack(wish);
  if (track && !plan.terrain.track) plan.terrain.track = track;
  // A race circuit is countryside, not a city block, unless the wish says city.
  if (plan.terrain.track && plan.terrain.biome === 'city' && guess !== 'city') plan.terrain.biome = 'meadow';
  const solved = solveScene(plan, newId());
  if (!solved.story) console.warn(`[world] story rejected (${storyProblem}); the headset will ask the Story Director`);
  const v = validateCreation(solved.creation);
  if (!v.ok || !v.creation) {
    console.warn('[world] solved world invalid, using the designer', v.errors.slice(0, 3));
    return designer(state, config);
  }
  const world = v.creation;
  console.info(`[world] "${world.title}": ${plan.objects.length} groups -> ${world.parts.length} parts in ${Date.now() - t0}ms${solved.notes.length ? ` (${solved.notes.join('; ')})` : ''}`);

  emit(config, {
    type: 'plan', source: 'live',
    header: { title: world.title, palette: world.palette, style: world.style, narration: world.narration, kind: 'world', terrain: world.terrain, ambient: world.ambient },
  });
  // Big things first, so the place takes shape before the details.
  const order = [...world.parts].sort((a, b) => size(b) - size(a));
  for (const [i, part] of order.entries()) {
    await sleep(35, config.signal);
    emit(config, { type: 'part', part, index: i });
  }
  if (solved.story) emit(config, { type: 'story', story: fixStory(solved.story, storyRequestFor(world, wish)) });
  return { draft: { ...world, parts: order }, blueprint: 'scene' };
}

function size(p: PartT) {
  return p.shape.kind === 'asset' ? p.shape.size : 0;
}
