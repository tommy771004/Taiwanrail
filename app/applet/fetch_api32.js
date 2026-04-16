import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/a6dad97d9634a72d.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const idx = data.indexOf('XMLHttpRequest');
    if (idx !== -1) {
      console.log(data.substring(idx - 200, idx + 500));
    }
  });
});
