import https from 'https';

function fetchJson(url: string) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const data: any = await fetchJson('https://tdx.transportdata.tw/api/basic/v2/Rail/Metro/StationTimeTable/TRTC?$top=2&$format=JSON');
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
main();
