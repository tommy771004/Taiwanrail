import https from 'https';

const testEndpoint = (path) => {
  const url = `https://taiwanrail.waccliu.tw/gateway/api${path}`;
  console.log('Testing', url);
  https.get(url, { headers: { 'Verify-Code': 'TaiwanRailWeb' } }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(path, 'Status:', res.statusCode);
      console.log(path, 'Response:', data.substring(0, 200));
    });
  });
};

testEndpoint('/v1/train/stations');
testEndpoint('/v1/thsr/stations');
testEndpoint('/v1/train/timetable');
testEndpoint('/v1/thsr/timetable');
testEndpoint('/train/stations');
testEndpoint('/thsr/stations');
