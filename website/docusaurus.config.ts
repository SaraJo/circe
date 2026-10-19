import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const repoUrl = 'https://github.com/SaraJo/circe';

const config: Config = {
  title: 'Circe',
  tagline: 'Your agent crew, at home on your desktop.',
  favicon: 'img/synced/icon-v4.png',

  // GitHub Pages project site: https://sarajo.github.io/circe/
  url: 'https://sarajo.github.io',
  baseUrl: '/circe/',
  organizationName: 'SaraJo',
  projectName: 'circe',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  // The synced .md files are plain CommonMark (they contain text such as
  // `Circe-<version>.dmg`), so only parse .mdx files as MDX.
  markdown: {
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/synced/circe-header.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Circe',
      logo: {
        alt: 'Circe app icon',
        src: 'img/synced/icon-v4.png',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs'},
        {to: '/docs/install', label: 'Install', position: 'left'},
        {to: '/docs/release-notes', label: 'Release notes', position: 'left'},
        {href: `${repoUrl}/releases`, label: 'Download', position: 'right'},
        {href: repoUrl, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Install Circe', to: '/docs/install'},
            {label: 'Onboarding and agent behavior', to: '/docs/onboarding'},
            {label: 'Windows beta', to: '/docs/windows'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'Releases', href: `${repoUrl}/releases`},
            {label: 'Contributing', to: '/docs/contributing'},
            {label: 'GitHub', href: repoUrl},
          ],
        },
        {
          title: 'Hermes',
          items: [{label: 'Hermes Agent', href: 'https://hermes-agent.nousresearch.com'}],
        },
      ],
      copyright: `Circe is MIT licensed. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'powershell'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
