import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().optional(),
    // A keyword-rich <title> for SEO, distinct from the short nav/H1 `title`.
    seoTitle: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  }),
});

export const collections = { docs };
