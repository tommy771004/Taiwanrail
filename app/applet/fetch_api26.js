import fs from 'fs';

const data = fs.readFileSync('aaeff9c04c042415.js', 'utf8');
const regex = /API_VERIFY_CODE/g;
let match;
while ((match = regex.exec(data)) !== null) {
  console.log('Match at', match.index);
  console.log(data.substring(match.index - 100, match.index + 200));
}
