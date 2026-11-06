import type { MetadataRoute } from 'next';
import { SITE, ALL_ROUTES } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ALL_ROUTES.map((path) => ({
    url: new URL(path, SITE.url).toString(),
    lastModified: now,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.6,
  }));
}
