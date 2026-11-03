/**
 * 從台鐵營運通阻（TDX v3 TRA/Alert）的文字裡找出停駛車次。
 *
 * 只認「車次號碼 + 次」（第 123 次、123、125 次）或「車次 123、125」的寫法。
 * 原本只要描述含「停駛／取消」就把所有 3–4 位數都當車次，「115 年」「2026」「K123」
 * 都會被當成停駛，把正常列車從列表標成停駛並略過——那段程式過去從未生效
 * （gateway 把 v3 的外層物件當失敗，前端永遠拿到空陣列），修好 gateway 後才會跑到。
 * 寧可漏標也不要誤標：漏掉時乘客仍看得到通阻公告本身。
 */
export interface AlertText {
  Title?: string;
  Description?: string;
}

const CANCEL_WORDS = /停駛|取消|Cancel/i;
const NUM = String.raw`\d{1,4}`;
const SEP = String.raw`\s*[、,，及和]\s*`;
// 「第123、125次」「123次」
const BEFORE_CI = new RegExp(String.raw`(${NUM}(?:${SEP}${NUM})*)\s*次`, 'g');
// 「車次123、125」「車次：123」
const AFTER_CHECI = new RegExp(String.raw`車次\s*[:：]?\s*(${NUM}(?:${SEP}${NUM})*)`, 'g');

export function parseCancelledTrainNos(alerts: readonly AlertText[]): Set<string> {
  const out = new Set<string>();
  for (const a of alerts) {
    const text = `${a.Title || ''}\n${a.Description || ''}`;
    if (!CANCEL_WORDS.test(text)) continue;
    for (const re of [BEFORE_CI, AFTER_CHECI]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        for (const n of m[1].match(/\d+/g) || []) out.add(String(Number(n)));
      }
    }
  }
  return out;
}
