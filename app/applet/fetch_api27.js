import fs from 'fs';

const data = fs.readFileSync('aaeff9c04c042415.js', 'utf8');
const idx = data.indexOf('window.fetch=(t,r)=>{');
if (idx !== -1) {
  console.log(data.substring(idx, idx + 1000));
}
