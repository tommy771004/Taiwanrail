import https from 'https';
import fs from 'fs';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/aaeff9c04c042415.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    fs.writeFileSync('aaeff9c04c042415.js', data);
    console.log('Saved');
  });
});
