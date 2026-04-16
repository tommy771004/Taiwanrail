import https from 'https';

const testEndpoint = (path, headers) => {
  const url = `https://taiwanrail.waccliu.tw/gateway/api${path}`;
  console.log('Testing', url, headers);
  https.get(url, { headers }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(path, 'Status:', res.statusCode);
      console.log(path, 'Response:', data.substring(0, 200));
    });
  });
};

testEndpoint('/thsr/stations', { 'Api-Verify-Code': 'TaiwanRailWeb' });
testEndpoint('/thsr/stations', { 'api-verify-code': 'TaiwanRailWeb' });
testEndpoint('/thsr/stations', { 'Verify-Code': 'TaiwanRailWeb' });
testEndpoint('/thsr/stations', { 'API_VERIFY_CODE': 'TaiwanRailWeb' });
testEndpoint('/thsr/stations', { 'Authorization': 'Bearer TaiwanRailWeb' });
