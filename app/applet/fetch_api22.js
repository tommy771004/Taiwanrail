import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const jsFiles = data.match(/src="([^"]+\.js)"/g);
    if (jsFiles) {
      jsFiles.forEach(file => {
        const url = file.replace('src="', '').replace('"', '');
        const fullUrl = url.startsWith('http') ? url : `https://taiwanrail.waccliu.tw${url.startsWith('/') ? '' : '/web/'}${url}`;
        https.get(fullUrl, (res2) => {
          let jsData = '';
          res2.on('data', (chunk) => { jsData += chunk; });
          res2.on('end', () => {
            const idx = jsData.indexOf('headers');
            if (idx !== -1) {
              const headerStr = jsData.substring(idx - 50, idx + 200);
              if (headerStr.includes('TaiwanRailWeb') || headerStr.includes('verify') || headerStr.includes('Verify')) {
                console.log('Found headers in', fullUrl);
                console.log(headerStr);
              }
            }
          });
        });
      });
    }
  });
});
