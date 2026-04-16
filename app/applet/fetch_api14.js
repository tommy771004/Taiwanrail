import https from 'https';

https.get('https://taiwanrail.waccliu.tw/web/', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const matches = data.match(/href="([^"]+\.json)"/g);
    console.log(matches);
    const scriptMatches = data.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (scriptMatches) {
      const nextData = JSON.parse(scriptMatches[1]);
      console.log(Object.keys(nextData.props.pageProps));
    } else {
      console.log("No __NEXT_DATA__ found");
    }
  });
});
