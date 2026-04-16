import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const jsFiles = data.match(/src="([^"]+\.js)"/g);
    if (jsFiles) {
      jsFiles.forEach(file => {
        const url = file.replace('src="', '').replace('"', '');
        const fullUrl = url.startsWith('http') ? url : `https://taiwanrail.waccliu.tw${url.startsWith('/') ? '' : '/web/'}${url}`;
        console.log('Fetching JS:', fullUrl);
        https.get(fullUrl, (res2) => {
          let jsData = '';
          res2.on('data', (chunk) => { jsData += chunk; });
          res2.on('end', () => {
            const apis = jsData.match(/https?:\/\/[^"'\s]+/g);
            if (apis) {
              const uniqueApis = [...new Set(apis)].filter(api => api.includes('api') || api.includes('tdx') || api.includes('rail'));
              console.log('Found APIs in', fullUrl, ':', uniqueApis);
            }
          });
        });
      });
    } else {
      console.log('No JS files found');
    }
  });
});
