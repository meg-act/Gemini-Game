/**
 * ワンハンドルマスコン全15段定義（index 0 = EB 〜 index 14 = P5）
 */
export const NOTCH_STEPS = [
  { id: 'EB', type: 'eb', level: 9, label: 'EB (非常)', targetBcKpa: 480 },
  { id: 'B8', type: 'brake', level: 8, label: 'B8', targetBcKpa: 395 },
  { id: 'B7', type: 'brake', level: 7, label: 'B7', targetBcKpa: 345 },
  { id: 'B6', type: 'brake', level: 6, label: 'B6', targetBcKpa: 295 },
  { id: 'B5', type: 'brake', level: 5, label: 'B5', targetBcKpa: 245 },
  { id: 'B4', type: 'brake', level: 4, label: 'B4', targetBcKpa: 195 },
  { id: 'B3', type: 'brake', level: 3, label: 'B3', targetBcKpa: 145 },
  { id: 'B2', type: 'brake', level: 2, label: 'B2', targetBcKpa: 95 },
  { id: 'B1', type: 'brake', level: 1, label: 'B1', targetBcKpa: 50 },
  { id: 'N', type: 'neutral', level: 0, label: 'N (惰行)', targetBcKpa: 0 },
  { id: 'P1', type: 'power', level: 1, label: 'P1', targetBcKpa: 0 },
  { id: 'P2', type: 'power', level: 2, label: 'P2', targetBcKpa: 0 },
  { id: 'P3', type: 'power', level: 3, label: 'P3', targetBcKpa: 0 },
  { id: 'P4', type: 'power', level: 4, label: 'P4', targetBcKpa: 0 },
  { id: 'P5', type: 'power', level: 5, label: 'P5', targetBcKpa: 0 },
];

export const NEUTRAL_INDEX = 9;
