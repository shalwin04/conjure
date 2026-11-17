/**
 * Story Director: writes the story a world is played through (one structured
 * call, the planner's model: Gemini in the hybrid profile). Falls back to a
 * template story so a world always has one.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { coerceStory, fixStory, templateStory, type StoryRequest, type StoryT } from '../../src/spec/story.js';
import { isFixture, structuredModel } from '../llm/models.js';
import { STORY_SYSTEM, storyUser } from '../prompts/story.js';

export async function directStory(req: StoryRequest, signal?: AbortSignal): Promise<{ story: StoryT; source: 'live' | 'template' }> {
  if (isFixture('planner') || !req.parts.length) return { story: templateStory(req), source: 'template' };
  const t0 = Date.now();
  try {
    // Loose schema + coerceStory: a long line or a missing field shouldn't throw the whole story away.
    const raw = await structuredModel('planner', z.object({ title: z.string(), intro: z.string(), chapters: z.array(z.record(z.string(), z.any())), ending: z.string() }), 'world_story').invoke(
      [new SystemMessage(STORY_SYSTEM), new HumanMessage(storyUser(req))],
      { signal },
    );
    const coerced = coerceStory(raw);
    if (!coerced) throw new Error('story did not validate');
    const story = fixStory(coerced, req);
    console.info(`[story] "${story.title}" ${story.chapters.length} chapters in ${Date.now() - t0}ms`);
    return { story, source: 'live' };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn('[story] model failed, using the template story', err instanceof Error ? err.message : err);
    return { story: templateStory(req), source: 'template' };
  }
}
