const rest = { '$format': 'JSON' };
const qs = new URLSearchParams();
for (const [k, v] of Object.entries(rest)) {
  if (Array.isArray(v)) v.forEach(val => qs.append(k, val));
  else qs.set(k, v as string);
}
qs.set('$format', 'JSON');
console.log(qs.toString());
