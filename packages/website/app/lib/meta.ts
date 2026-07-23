import type { MetaDescriptor } from 'react-router';

export const SITE_URL = 'https://git-span.com';
export const DEFAULT_TITLE = 'git-span -- Semantic code annotations for git';
export const DEFAULT_DESCRIPTION =
  'Git-native code annotations that ship with every commit. Keep context where it belongs -- in your source tree, not your brain.';
export const DEFAULT_OG_IMAGE = {
  path: '/og-image.png',
  alt: 'Agents should read between the lines.'
};
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

export interface RouteMetaInput {
  title: string;
  description?: string;
  pathname: string;
  image?: { path: string; alt: string };
}

export function buildRouteMeta({ title, description, pathname, image }: RouteMetaInput): MetaDescriptor[] {
  const desc = description ?? DEFAULT_DESCRIPTION;
  const img = image ?? DEFAULT_OG_IMAGE;
  const url = `${SITE_URL}${pathname}`;
  return [
    { title },
    { name: 'description', content: desc },
    { property: 'og:title', content: title },
    { property: 'og:description', content: desc },
    { property: 'og:url', content: url },
    { property: 'og:image', content: `${SITE_URL}${img.path}` },
    { property: 'og:image:width', content: String(OG_IMAGE_WIDTH) },
    { property: 'og:image:height', content: String(OG_IMAGE_HEIGHT) },
    { property: 'og:image:alt', content: img.alt },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: desc },
    { name: 'twitter:image', content: `${SITE_URL}${img.path}` }
  ];
}
