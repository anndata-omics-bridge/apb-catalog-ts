import { defineConfig } from 'vitepress'

// The documentation site, published to GitHub Pages under the repository's name.
export default defineConfig({
  title: 'apb-catalog-ts',
  description: "apb-catalog's API in TypeScript: look up APB result fields by meaning in the browser",
  base: '/apb-catalog-ts/',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Get started', link: '/getting-started' },
      { text: 'API', link: '/api' },
      { text: 'apb-catalog', link: 'https://anndata-omics-bridge.github.io/apb-catalog/' }
    ],
    sidebar: [
      { text: 'Overview', link: '/' },
      { text: 'Get started', link: '/getting-started' },
      { text: 'API', link: '/api' }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/anndata-omics-bridge/apb-catalog-ts' }],
    outline: [2, 3]
  }
})
