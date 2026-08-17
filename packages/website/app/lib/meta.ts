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
  const img = image ?? DEFAULT_OG_IMAGE;
  // A canonical URL names one address for the page: the slash-free,
  // extension-free form, root preserved. The docs loader 301s trailing-slash
  // variants before render, so this is defense in depth — a route that ever
  // renders a slash variant must not declare that variant canonical.
  const canonicalPathname = pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
  const url = `${SITE_URL}${canonicalPathname}`;
  // Descriptions are explicit per call site; no description means the head
  // carries no description tags at all rather than the product-level default.
  const descriptionTags =
    description === undefined
      ? []
      : [
          { name: 'description', content: description },
          { property: 'og:description', content: description },
          { name: 'twitter:description', content: description }
        ];
  return [
    { title },
    { tagName: 'link', rel: 'canonical', href: url },
    ...descriptionTags,
    { property: 'og:title', content: title },
    { property: 'og:url', content: url },
    { property: 'og:image', content: `${SITE_URL}${img.path}` },
    { property: 'og:image:width', content: String(OG_IMAGE_WIDTH) },
    { property: 'og:image:height', content: String(OG_IMAGE_HEIGHT) },
    { property: 'og:image:alt', content: img.alt },
    { name: 'twitter:title', content: title },
    { name: 'twitter:image', content: `${SITE_URL}${img.path}` }
  ];
}
