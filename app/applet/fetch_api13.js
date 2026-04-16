import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/_next/static/chunks/aaeff9c04c042415.js', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const regex = /API_VERIFY_CODE/g;
    let match;
    while ((match = regex.exec(data)) !== null) {
      console.log(data.substring(match.index - 50, match.index + 100));
    }
  });
});
