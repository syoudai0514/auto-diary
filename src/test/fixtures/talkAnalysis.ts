import type { TalkAnalysis } from '@/lib/talk';

/** テスト用の妥当な話し合い分析データ。 */
export const sampleAnalysis: TalkAnalysis = {
  title: '家事分担についての話し合い',
  summary: '夕食後の片付けを巡って意見がぶつかった。',
  topics: ['家事分担'],
  sideA: {
    label: '私',
    claims: ['仕事で疲れていて余裕がない'],
    feelings: ['疲労', '焦り'],
    needs: ['休息を認めてほしい'],
  },
  sideB: {
    label: '妻',
    claims: ['自分ばかり片付けている'],
    feelings: ['不公平感'],
    needs: ['負担を分かち合いたい'],
  },
  misunderstandings: [
    {
      point: '「後でやる」の解釈',
      aView: '今日中にやるつもりだった',
      bView: 'やる気がないように聞こえた',
      explanation: '期限を言わなかったことで放置の意思表示に受け取られた。',
    },
  ],
  verdict: {
    overall: '片付けの負担が偏っている点でBの主張がより妥当。',
    leansToward: 'B',
    behaviorsA: [
      { behavior: '「後でやる」と言って時期を示さなかった', assessment: '相手の不信感を強めた' },
    ],
    behaviorsB: [
      { behavior: '溜まった不満を一度にぶつけた', assessment: '本題が伝わりにくくなった' },
    ],
  },
  adviceA: ['「後でやる」ではなく「21時までにやる」と時刻で伝える'],
  adviceB: ['不満は溜めず、その日のうちに1件ずつ伝える'],
  commonGround: ['家庭を居心地よくしたい'],
  reconciliationScript: [
    { speaker: '私', line: '片付けを任せきりにしてごめん。' },
    { speaker: '妻', line: '言い方がきつくなってごめんね。' },
  ],
  safetyNote: '',
};
