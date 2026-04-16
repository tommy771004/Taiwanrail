import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/aaeff9c04c042415.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const matches = data.match(/headers:\{[^}]+\}/g);
    if (matches) {
      console.log(matches);
    } else {
      console.log("Not found");
    }
  });
});
