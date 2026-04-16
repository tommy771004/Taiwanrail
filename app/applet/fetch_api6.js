import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/aaeff9c04c042415.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const matches = data.match(/['"`]\/[a-zA-Z0-9_\-\/]+['"`]/g);
    if (matches) {
      console.log('Strings starting with /:', [...new Set(matches)].filter(s => s.includes('train') || s.includes('station') || s.includes('rail') || s.includes('hsr')));
    }
  });
});
