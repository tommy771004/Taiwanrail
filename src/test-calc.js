const getDurationMinutes = (dep, arr) => {
  const [depH, depM] = dep.split(':').map(Number);
  const [arrH, arrM] = arr.split(':').map(Number);
  let diffM = (arrH * 60 + arrM) - (depH * 60 + depM);
  if (diffM < 0) diffM += 24 * 60;
  return diffM;
};
const calculateDuration = (dep, arr) => {
  if (!dep || !arr || dep.includes('--') || arr.includes('--')) return "0:0";
  const diffM = getDurationMinutes(dep, arr);
  const h = Math.floor(diffM / 60);
  const m = diffM % 60;
  return `${h}:${m}`;
};

console.log(calculateDuration("10:00", "14:28"));
console.log(calculateDuration("--:--", "14:28"));
