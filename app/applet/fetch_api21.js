import fs from 'fs';

const data = fs.readFileSync('aaeff9c04c042415.js', 'utf8');
const idx = data.indexOf('API_VERIFY_CODE');
if (idx !== -1) {
  console.log(data.substring(idx - 200, idx + 500));
}
