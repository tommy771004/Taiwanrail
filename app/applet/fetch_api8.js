import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/aaeff9c04c042415.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const idx = data.indexOf('TaiwanRailWeb');
    if (idx !== -1) {
      console.log(data.substring(idx - 100, idx + 100));
    } else {
      console.log("Not found");
    }
  });
});
