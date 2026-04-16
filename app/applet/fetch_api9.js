import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/aaeff9c04c042415.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const idx = data.indexOf('API_VERIFY_CODE');
    if (idx !== -1) {
      console.log(data.substring(idx - 100, idx + 100));
      const idx2 = data.indexOf('API_VERIFY_CODE', idx + 1);
      if (idx2 !== -1) {
        console.log(data.substring(idx2 - 100, idx2 + 100));
      }
    } else {
      console.log("Not found");
    }
  });
});
