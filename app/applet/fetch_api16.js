import fs from 'fs';

const data = fs.readFileSync('aaeff9c04c042415.js', 'utf8');
const matches = data.match(/.{0,50}fetch\([^)]+\).{0,50}/g);
if (matches) {
  matches.slice(0, 20).forEach(m => console.log(m));
} else {
  console.log('No fetch found');
}
