const site = (process.env.APP_URL || process.env.VITE_APP_URL || 'https://taiwanrail.vercel.app').replace(/\/+$/, '');

const pages = [
  { label: 'Home', path: '/' },
  { label: 'English home', path: '/en/' },
  { label: 'TRA route', path: '/routes/train/taipei-to-kaohsiung/' },
  { label: 'THSR route', path: '/routes/hsr/taipei-to-zuoying/' },
  { label: 'Sitemap', path: '/sitemap.xml' },
  { label: 'Robots', path: '/robots.txt' },
];

function absolute(path) {
  return `${site}${path}`;
}

function encode(url) {
  return encodeURIComponent(url);
}

console.log('P4 external SEO monitoring targets');
console.log(`Site: ${site}`);
console.log('');

for (const page of pages) {
  const url = absolute(page.path);
  console.log(`${page.label}: ${url}`);
}

console.log('');
console.log('PageSpeed Insights:');
for (const page of pages.filter((page) => page.path.endsWith('/'))) {
  const url = absolute(page.path);
  console.log(`- ${page.label}: https://pagespeed.web.dev/analysis?url=${encode(url)}`);
}

console.log('');
console.log('Rich Results Test:');
for (const page of pages.filter((page) => page.path.endsWith('/'))) {
  const url = absolute(page.path);
  console.log(`- ${page.label}: https://search.google.com/test/rich-results?url=${encode(url)}`);
}

console.log('');
console.log('Search Console URL Inspection targets:');
for (const page of pages.filter((page) => page.path.endsWith('/'))) {
  console.log(`- ${absolute(page.path)}`);
}

console.log('');
console.log('Sitemap submission target:');
console.log(`- ${absolute('/sitemap.xml')}`);
