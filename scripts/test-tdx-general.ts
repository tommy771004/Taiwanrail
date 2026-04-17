import 'dotenv/config';

async function main() {
  const tokenRes = await fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${process.env.TDX_CLIENT_ID}&client_secret=${process.env.TDX_CLIENT_SECRET}`
  });
  const { access_token } = await tokenRes.json();

  const res = await fetch('https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/GeneralTrainTimetable?$format=JSON', {
    headers: { 'Authorization': `Bearer ${access_token}`, 'Accept-Encoding': 'gzip' }
  });
  const data = await res.json();
  const jsonString = JSON.stringify(data);
  console.log(`Length: ${jsonString.length}`);
  console.log(`Keys: ${Object.keys(data)}`);
  if (data.TrainTimetables) {
    console.log(`Train count: ${data.TrainTimetables.length}`);
  }
}

main();
