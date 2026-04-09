'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const { Redis } = require('@upstash/redis');
const OpenAI = require('openai');

const app = express();

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(lineConfig);

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// ============================================================
// 症状マスター
// ============================================================
const SYMPTOMS_MAP = {
  '1': '首痛', '2': '肩こり', '3': '肩の痛み', '4': '腰痛', '5': '膝痛',
  '6': '股関節痛', '7': '足首痛', '8': '産後の骨盤矯正', '9': '交通事故の治療',
  '10': 'トレーニング', '11': 'リハビリ',
};
const SYMPTOMS_LIST = [
  { id: '1', name: '首痛' }, { id: '2', name: '肩こり' }, { id: '3', name: '肩の痛み' },
  { id: '4', name: '腰痛' }, { id: '5', name: '膝痛' }, { id: '6', name: '股関節痛' },
  { id: '7', name: '足首痛' }, { id: '8', name: '産後の骨盤矯正' }, { id: '9', name: '交通事故の治療' },
  { id: '10', name: 'トレーニング' }, { id: '11', name: 'リハビリ' },
];

// ============================================================
// システムプロンプト（整骨院 + RISEGYM + RiseBeauty 全対応）
// ============================================================
const SYSTEM_PROMPT = `あなたは「健やか整骨院」グループの公式マスコットキャラクター「ジョイ君」です。
太陽のように明るく元気なキャラクターで、患者・お客様の心強いコンシェルジュとして対応します。

## キャラクター設定
- 名前：ジョイ君（健やか整骨院グループ公式マスコット）
- 性格：明るく元気、親しみやすい、礼儀正しい
- 口調：丁寧かつ親しみやすい（です・ます調ベース）
- 絵文字：☀️😊👍💪✨を適度に使い明るい雰囲気を演出
- 夜間・休日も24時間対応

## グループ3事業の概要

### 🏥 健やか整骨院（整骨院・治療）
国家資格者による治療院。痛み・不調・産後ケアなど。

### 💪 RISEGYM（ライズジム）- 医療系パーソナルジム
- 運営：健やか整骨院グループ（株式会社Glad）
- コンセプト：「整えてから鍛える」医療知識とトレーニングの融合
- スタッフ：作業療法士・理学療法士・柔道整復師などの国家資格者が監修・在籍
- 特徴：完全個室・完全予約制・マンツーマン指導
- 対象：姿勢改善・慢性的な痛み予防・リハビリ後の機能回復・加齢対策・ダイエット・ボディメイク
- 会員の約9割が健やか整骨院の患者様
- 展開地域：東京都（練馬区平和台・豊玉）、埼玉県朝霞市、栃木県宇都宮市
- URL：https://www.reha-rise-gym.com/

### ✨ RiseBeauty（ライズビューティー）- メディカルオイルエステ
- 運営：健やか整骨院グループ
- コンセプト：「毎日がんばる女性に、安心してゆるむ時間を」
- 特徴：整骨院運営・医療従事者による解剖学的施術・無理な勧誘なし
- 保育士による無料託児あり（予約必須・平日午前9:30〜13:00のみ）
- 産後1ヶ月検診後から利用可能
- 施術メニュー：デコルテ・お腹・背中・フット・下半身・フェイシャル・全身・パーソナルオイル・ヘッドスパ・セルキュア4T plus+
- こんな方におすすめ：肩こり・腰痛・産後の体型戻し・むくみ・慢性疲労・リラクゼーション
- 月1〜2回ペースがおすすめ
- 本店：東京都練馬区早宮2-19-13 2階（平和台駅徒歩5分）TEL：03-6906-8162
- 姉妹店：上板橋院（03-6912-3136）・朝霞院（048-487-8490）
- URL：https://www.sukoyaka-rise-beauty.com/

## 健やか整骨院 グループ店舗情報

### 豊玉院（東京・練馬区）
- 住所：〒176-0012 東京都練馬区豊玉北４丁目４−７−１０１
- 電話：03-5946-9959
- 営業時間：火〜金 9:30〜13:00 / 15:00〜19:00、土 9:30〜13:00 / 15:00〜18:00
- 定休日：日・月曜日、祝日営業
- アクセス：練馬駅・桜台駅から徒歩7分・キッズスペースあり・保育士在中

### 平和台院（東京・練馬区）
- 電話：03-6906-8162 / 定休日：日・月曜日 / 平和台駅から徒歩5〜8分

### 上板橋院（東京・板橋区）
- 電話：03-6912-3136 / 定休日：日・月曜日 / 上板橋駅から徒歩5分

### 朝霞院（埼玉・朝霞市）
- 電話：048-487-8490 / 定休日：日・月曜日 / 駐車場5台完備

### 宇都宮院（栃木・宇都宮市）
- 電話：028-666-4384 / 定休日：日・月曜日 / 駐車場10台・パーソナルジム併設

## 整骨院 施術内容
骨盤矯正・産後骨盤矯正・猫背矯正・首肩腰膝の痛み治療・電気治療・ハイボルテージ・
楽トレ（EMS）・マッサージ・ストレッチ・テーピング・鍼灸治療・美容鍼・
メディカルオイルマッサージ・酸素カプセル・交通事故治療（自賠責保険対応）・
スポーツ外傷・リハビリ・パーソナルトレーニング

## 回答スタイル
- 丁寧かつ親しみやすい日本語（です・ます調）
- 要点を分かりやすく、長すぎない回答
- 医療診断・処方は行わない
- 緊急症状（激しい胸痛・呼吸困難・麻痺など）は迷わず救急を勧める
- 料金詳細は「院にお問い合わせください」と案内
- 予約確定には院からの電話確認が必要な旨を伝える
- このLINEから24時間いつでも仮予約可能（豊玉院のみ）`;

// ============================================================
// 営業時間チェック
// ============================================================
const CLOSED_DAYS = [0, 1];

function getBusinessHours(dayOfWeek) {
  if (dayOfWeek === 6) {
    return { morning: { start: '09:30', end: '13:00' }, afternoon: { start: '15:00', end: '18:00' } };
  }
  return { morning: { start: '09:30', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } };
}

function isBusinessHours() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const day = now.getDay();
  if (CLOSED_DAYS.includes(day)) return false;
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const timeStr = h + ':' + m;
  const hours = getBusinessHours(day);
  return (timeStr >= hours.morning.start && timeStr < hours.morning.end) ||
         (timeStr >= hours.afternoon.start && timeStr < hours.afternoon.end);
}

// ============================================================
// 予約可能日・時間スロット
// 【修正】曜日ごとに正しい午前＋午後スロットを返す
// ============================================================
function getAvailableDays() {
  const days = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const d = new Date(now);
  while (days.length < 6) {
    d.setDate(d.getDate() + 1);
    if (!CLOSED_DAYS.includes(d.getDay())) {
      days.push(new Date(d));
    }
  }
  return days;
}

function getTimeSlots(dayOfWeek) {
  // 午前スロット（火〜土共通）
  const morning = ['9:30', '10:10', '10:50', '11:30', '12:10'];
  // 午後スロット（土曜は18:00終了なので18:20なし）
  const afternoonWeekday = ['15:00', '15:40', '16:20', '17:00', '17:40', '18:20'];
  const afternoonSaturday = ['15:00', '15:40', '16:20', '17:00', '17:40'];
  if (dayOfWeek === 6) {
    return morning.concat(afternoonSaturday);
  }
  return morning.concat(afternoonWeekday);
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(d) {
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_NAMES[d.getDay()] + ')';
}

// ============================================================
// 症状クイックリプライ（全11症状＋完了ボタン＝12個・1ページ）
// ============================================================
function buildSymptomsQuickReply(selected) {
  const items = SYMPTOMS_LIST.map(function(s) {
    const isSelected = selected.includes(s.id);
    return {
      type: 'action',
      action: {
        type: 'message',
        label: (isSelected ? '✅' : '') + s.name,
        text: '症状選択:' + s.id,
      },
    };
  });
  items.push({
    type: 'action',
    action: { type: 'message', label: '✔ 選択完了', text: '症状確定' },
  });
  return { type: 'quickReply', items: items };
}

function symptomsIdsToNames(ids) {
  return ids.map(function(id) { return SYMPTOMS_MAP[id] || id; }).join('、');
}

// ============================================================
// セッション操作
// ============================================================
const SESSION_TTL = 86400;

async function getSession(userId) {
  try {
    const data = await redis.get('session:' + userId);
    return data || {};
  } catch (e) {
    console.error('Redis get error:', e);
    return {};
  }
}

async function setSession(userId, sessionData) {
  try {
    await redis.set('session:' + userId, sessionData, { ex: SESSION_TTL });
  } catch (e) {
    console.error('Redis set error:', e);
  }
}

async function clearSession(userId) {
  try {
    await redis.del('session:' + userId);
  } catch (e) {
    console.error('Redis del error:', e);
  }
}

// ============================================================
// メッセージ送信ヘルパー
// ============================================================
async function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text: text });
}

async function replyTextWithQuickReply(replyToken, text, quickReply) {
  return client.replyMessage(replyToken, { type: 'text', text: text, quickReply: quickReply });
}

async function replyMessages(replyToken, messages) {
  return client.replyMessage(replyToken, messages);
}

// ============================================================
// 【C案】メインメニュー（6ボタン）
// 整骨院予約 / 来院中予約 / 変更キャンセル / RISEGYM / RiseBeauty / ジョイ君相談
// ============================================================
function buildMainMenu() {
  return {
    type: 'template',
    altText: '健やか整骨院グループ メニュー',
    template: {
      type: 'buttons',
      title: '☀️ 健やか整骨院グループ',
      text: 'ジョイ君がお手伝いします！\nご用件をお選びください😊',
      actions: [
        { type: 'message', label: '🆕 新規予約（初めての方）', text: '新規予約' },
        { type: 'message', label: '🗓️ 予約（来院中の方）', text: '来院中の予約' },
        { type: 'message', label: '💪 RISEGYMに相談', text: 'RISEGYM相談' },
        { type: 'message', label: '✨ RiseBeautyに相談', text: 'RiseBeauty相談' },
      ],
    },
  };
}

// ※LINEのボタンテンプレートは最大4ボタンのため、
// 予約変更・キャンセルとジョイ君相談はサブメニューに移動
function buildSubMenu() {
  return {
    type: 'template',
    altText: 'その他メニュー',
    template: {
      type: 'buttons',
      text: 'その他のご用件はこちら',
      actions: [
        { type: 'message', label: '✏️ 予約変更・キャンセル', text: '予約変更・キャンセル' },
        { type: 'message', label: '💬 ジョイ君に何でも相談', text: 'AI相談' },
        { type: 'message', label: '🏠 メインメニューへ', text: 'メニュー' },
      ],
    },
  };
}

// ============================================================
// ジョイ君 AI相談（会話履歴保持・カテゴリ対応）
// ============================================================
async function handleAiChat(userId, replyToken, userMessage, session) {
  const history = session.aiHistory || [];
  const category = session.aiCategory || 'general';

  // カテゴリに応じてシステムプロンプトの冒頭を強調
  let categoryHint = '';
  if (category === 'risegym') {
    categoryHint = '※ユーザーはRISEGYM（パーソナルジム）についての相談をしています。RISEGYMの情報を中心に回答してください。';
  } else if (category === 'risebeauty') {
    categoryHint = '※ユーザーはRiseBeauty（メディカルオイルエステ）についての相談をしています。RiseBeautyの情報を中心に回答してください。';
  }

  let aiReply = '';
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const systemContent = categoryHint ? SYSTEM_PROMPT + '\n\n' + categoryHint : SYSTEM_PROMPT;
      const msgList = [{ role: 'system', content: systemContent }]
        .concat(history)
        .concat([{ role: 'user', content: userMessage }]);

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: msgList,
        max_tokens: 600,
        temperature: 0.7,
      });

      aiReply = completion.choices[0].message.content;
      break;
    } catch (e) {
      console.error('Groq error attempt ' + attempt + ':', JSON.stringify(e));
      if (attempt < maxRetries) {
        await new Promise(function(r) { setTimeout(r, 2000 * attempt); });
      } else {
        aiReply = '申し訳ありません！ジョイ君、今ちょっと混み合っています☀️\n少し時間をおいてから再度お試しください🙏\n\nお急ぎの場合はお電話ください。\n📞 03-5946-9959';
      }
    }
  }

  const updatedHistory = history
    .concat([{ role: 'user', content: userMessage }])
    .concat([{ role: 'assistant', content: aiReply }]);

  const trimmedHistory = updatedHistory.length > 40
    ? updatedHistory.slice(updatedHistory.length - 40)
    : updatedHistory;

  await setSession(userId, { mode: 'ai_chat', aiHistory: trimmedHistory, aiCategory: category });

  // カテゴリに応じてアクションボタンを変える
  let actions;
  if (category === 'risegym') {
    actions = [
      { type: 'message', label: '🆕 整骨院を予約する', text: '新規予約' },
      { type: 'message', label: '💪 RISEGYMをもっと聞く', text: 'RISEGYMについてもっと教えて' },
      { type: 'message', label: '🏠 メニューへ戻る', text: 'メニュー' },
    ];
  } else if (category === 'risebeauty') {
    actions = [
      { type: 'message', label: '✨ RiseBeautyの予約方法は？', text: 'RiseBeautyの予約方法を教えて' },
      { type: 'message', label: '✨ 施術メニューを聞く', text: 'RiseBeautyの施術メニューを教えて' },
      { type: 'message', label: '🏠 メニューへ戻る', text: 'メニュー' },
    ];
  } else {
    actions = [
      { type: 'message', label: '🆕 新規予約（初めての方）', text: '新規予約' },
      { type: 'message', label: '🗓️ 予約（来院中の方）', text: '来院中の予約' },
      { type: 'message', label: '🏠 メニューへ戻る', text: 'メニュー' },
    ];
  }

  return replyMessages(replyToken, [
    { type: 'text', text: aiReply },
    {
      type: 'template',
      altText: '続けてご相談いただくか、次のアクションをお選びください',
      template: { type: 'buttons', text: '他にご質問はありますか？😊', actions: actions },
    },
  ]);
}

// ============================================================
// 予約フロー（新規・来院中共通）
// 【修正】時間スロット：午前＋午後を正しく表示
// ============================================================
async function handleBooking(userId, replyToken, text, session) {
  const step = session.step || 0;
  const type = session.bookingType;

  // STEP2: 時間選択
  if (step === 2) {
    const days = (session.availableDays || []).map(function(d) { return new Date(d); });
    const matched = days.find(function(d) { return formatDate(d) === text; });
    if (!matched) return replyText(replyToken, '表示されている日付からお選びください。');

    const slots = getTimeSlots(matched.getDay());
    // 午前・午後に分けてボタン表示（最大4個）→ まず午前4枠を表示
    const morningSlots = slots.filter(function(s) {
      const hour = parseInt(s.split(':')[0]);
      return hour < 13;
    });
    const afternoonSlots = slots.filter(function(s) {
      const hour = parseInt(s.split(':')[0]);
      return hour >= 13;
    });

    await setSession(userId, Object.assign({}, session, {
      selectedDate: matched.toISOString(),
      allSlots: slots,
      morningSlots: morningSlots,
      afternoonSlots: afternoonSlots,
      step: 3,
      timeSelectPhase: 'morning',
    }));

    const actions = morningSlots.slice(0, 4).map(function(s) {
      return { type: 'message', label: s, text: s };
    });
    // 午後も見たい場合のボタン
    if (afternoonSlots.length > 0) {
      actions.push({ type: 'message', label: '午後の時間を見る▶', text: '午後の時間を見る' });
    }

    return replyMessages(replyToken, [
      { type: 'text', text: formatDate(matched) + '\nご希望の時間をお選びください😊' },
      {
        type: 'template',
        altText: '時間を選んでください',
        template: {
          type: 'buttons',
          text: '【午前】の時間帯',
          actions: actions.slice(0, 4),
        },
      },
    ]);
  }

  // STEP3: 時間確定 or 午後ページ切り替え
  if (step === 3) {
    const allSlots = session.allSlots || [];
    const afternoonSlots = session.afternoonSlots || [];
    const morningSlots = session.morningSlots || [];
    const timeSelectPhase = session.timeSelectPhase || 'morning';

    // 午後ページへ切り替え
    if (text === '午後の時間を見る') {
      await setSession(userId, Object.assign({}, session, { timeSelectPhase: 'afternoon' }));
      const actions = afternoonSlots.slice(0, 3).map(function(s) {
        return { type: 'message', label: s, text: s };
      });
      actions.push({ type: 'message', label: '◀ 午前の時間を見る', text: '午前の時間を見る' });
      return replyMessages(replyToken, [{
        type: 'template',
        altText: '午後の時間を選んでください',
        template: {
          type: 'buttons',
          text: '【午後】の時間帯',
          actions: actions.slice(0, 4),
        },
      }]);
    }

    // 午前ページへ切り替え
    if (text === '午前の時間を見る') {
      await setSession(userId, Object.assign({}, session, { timeSelectPhase: 'morning' }));
      const actions = morningSlots.slice(0, 4).map(function(s) {
        return { type: 'message', label: s, text: s };
      });
      if (afternoonSlots.length > 0) {
        actions.push({ type: 'message', label: '午後の時間を見る▶', text: '午後の時間を見る' });
      }
      return replyMessages(replyToken, [{
        type: 'template',
        altText: '午前の時間を選んでください',
        template: {
          type: 'buttons',
          text: '【午前】の時間帯',
          actions: actions.slice(0, 4),
        },
      }]);
    }

    // 時間が選択された
    if (!allSlots.includes(text)) {
      return replyText(replyToken, '表示されている時間からお選びください。');
    }
    await setSession(userId, Object.assign({}, session, { selectedTime: text, step: 4 }));
    return replyText(replyToken, '📱 お電話番号を入力してください。\n（例：090-1234-5678）');
  }

  // STEP4: 電話番号入力 → 症状選択へ
  if (step === 4) {
    if (!/[\d\-（）()]{10,}/.test(text)) {
      return replyText(replyToken, '電話番号を正しい形式で入力してください。\n例：090-1234-5678');
    }
    await setSession(userId, Object.assign({}, session, { phone: text, step: 5, selectedSymptoms: [] }));
    return replyTextWithQuickReply(
      replyToken,
      '🩺 気になる症状をタップしてください✅\n（複数選択できます）\n\n選び終わったら「✔ 選択完了」を押してください',
      buildSymptomsQuickReply([])
    );
  }

  // STEP5: 症状タップ選択
  if (step === 5) {
    const selectedSymptoms = session.selectedSymptoms || [];

    if (text.startsWith('症状選択:')) {
      const id = text.replace('症状選択:', '');
      const newSelected = selectedSymptoms.includes(id)
        ? selectedSymptoms.filter(function(s) { return s !== id; })
        : selectedSymptoms.concat([id]);
      await setSession(userId, Object.assign({}, session, { selectedSymptoms: newSelected }));
      const selectedNames = newSelected.length > 0
        ? '選択中：' + symptomsIdsToNames(newSelected)
        : '（まだ選択されていません）';
      return replyTextWithQuickReply(
        replyToken,
        '🩺 症状をタップで選択してください✅\n' + selectedNames,
        buildSymptomsQuickReply(newSelected)
      );
    }

    if (text === '症状確定') {
      if (selectedSymptoms.length === 0) {
        return replyTextWithQuickReply(
          replyToken,
          '症状を1つ以上タップして選択してください😊',
          buildSymptomsQuickReply([])
        );
      }
      const selectedDate = new Date(session.selectedDate);
      const datetime = formatDate(selectedDate) + ' ' + session.selectedTime;
      const symptomsText = symptomsIdsToNames(selectedSymptoms);
      const msg =
        '✅ 仮予約を受け付けました！\n※予約はまだ確定していません。\n\n' +
        '📅 希望日時：' + datetime + '\n' +
        '📱 電話番号：' + session.phone + '\n' +
        '🩺 症状：' + symptomsText + '\n\n' +
        '院より当日〜翌日中にお電話でご確認いたします。\n' +
        '連絡が取れ次第予約確定になります。ご了承ください。\n' +
        '※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。\n\n' +
        '☀️ ジョイ君がご来院をお待ちしています！\n' +
        '健やか整骨院 豊玉院\n📞 03-5946-9959';
      await clearSession(userId);
      return replyText(replyToken, msg);
    }

    const selectedNames = selectedSymptoms.length > 0
      ? '選択中：' + symptomsIdsToNames(selectedSymptoms)
      : '（まだ選択されていません）';
    return replyTextWithQuickReply(
      replyToken,
      '症状をタップして選択してください😊\n' + selectedNames,
      buildSymptomsQuickReply(selectedSymptoms)
    );
  }
}

// ============================================================
// Webhookルート
// ============================================================
app.post('/webhook',
  line.middleware(lineConfig),
  function(req, res) {
    res.sendStatus(200);
    Promise.all(req.body.events.map(handleEvent)).catch(console.error);
  }
);

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();
  const session = await getSession(userId);

  // リセットワード
  const resetWords = ['やめる', 'やめます', '最初に戻る', 'メニュー', 'menu', 'Menu', 'MENU'];
  if (resetWords.some(function(w) { return text === w; })) {
    await clearSession(userId);
    return client.replyMessage(replyToken, [
      { type: 'text', text: 'メニューに戻ります☀️' },
      buildMainMenu(),
    ]);
  }

  // AI相談モード中（予約系ボタン以外はすべてジョイ君が回答）
  const bookingKeywords = ['新規予約', '来院中の予約', 'RISEGYM相談', 'RiseBeauty相談', 'AI相談', '予約変更・キャンセル'];
  if (session.mode === 'ai_chat' && !bookingKeywords.includes(text)) {
    return handleAiChat(userId, replyToken, text, session);
  }

  // 予約フロー中
  if (session.mode === 'booking' && session.step >= 2) {
    return handleBooking(userId, replyToken, text, session);
  }

  // ── 新規予約（24時間対応）──
  if (text === '新規予約') {
    const days = getAvailableDays();
    const newSession = {
      mode: 'booking',
      bookingType: 'new',
      step: 2,
      availableDays: days.map(function(d) { return d.toISOString(); }),
    };
    await setSession(userId, newSession);
    const prefix = isBusinessHours() ? '' : '☀️ 営業時間外でも仮予約は24時間受け付けています！\n院より翌営業日にお電話でご確認いたします。\n\n';
    return replyMessages(replyToken, [
      { type: 'text', text: prefix + '新規予約を承ります😊\nご希望の日をお選びください。' },
      {
        type: 'template',
        altText: '日付を選んでください',
        template: {
          type: 'buttons',
          text: '※直近4日を表示しています',
          actions: days.slice(0, 4).map(function(d) {
            return { type: 'message', label: formatDate(d), text: formatDate(d) };
          }),
        },
      },
    ]);
  }

  // ── 来院中の予約（24時間対応）──
  if (text === '来院中の予約') {
    const days = getAvailableDays();
    const newSession = {
      mode: 'booking',
      bookingType: 'returning',
      step: 2,
      availableDays: days.map(function(d) { return d.toISOString(); }),
    };
    await setSession(userId, newSession);
    const prefix = isBusinessHours() ? '' : '☀️ 営業時間外でも仮予約は24時間受け付けています！\n院より翌営業日にお電話でご確認いたします。\n\n';
    return replyMessages(replyToken, [
      { type: 'text', text: prefix + 'ご予約を承ります😊\nご希望の日をお選びください。' },
      {
        type: 'template',
        altText: '日付を選んでください',
        template: {
          type: 'buttons',
          text: '※直近4日を表示しています',
          actions: days.slice(0, 4).map(function(d) {
            return { type: 'message', label: formatDate(d), text: formatDate(d) };
          }),
        },
      },
    ]);
  }

  // ── RISEGYM相談（カテゴリ付きAIモード）──
  if (text === 'RISEGYM相談') {
    const existingHistory = (session.aiCategory === 'risegym' ? session.aiHistory : null) || [];
    await setSession(userId, { mode: 'ai_chat', aiHistory: existingHistory, aiCategory: 'risegym' });
    return replyText(replyToken,
      '💪 RISEGYMのご相談ですね！\n\n' +
      'RISEGYMは健やか整骨院グループが運営する医療系パーソナルジムです。\n国家資格者がマンツーマンで指導する完全個室のジムです😊\n\n' +
      'トレーニング内容・料金・体験・店舗など、何でもお気軽にご質問ください！\n\n' +
      '（メニューに戻るには「メニュー」と送ってください）'
    );
  }

  // ── RiseBeauty相談（カテゴリ付きAIモード）──
  if (text === 'RiseBeauty相談') {
    const existingHistory = (session.aiCategory === 'risebeauty' ? session.aiHistory : null) || [];
    await setSession(userId, { mode: 'ai_chat', aiHistory: existingHistory, aiCategory: 'risebeauty' });
    return replyText(replyToken,
      '✨ RiseBeautyのご相談ですね！\n\n' +
      'RiseBeautyは整骨院が運営するメディカルオイルエステサロンです。\n医療従事者が解剖学的知識に基づいて施術します。保育士による無料託児もあります😊\n\n' +
      '施術内容・予約方法・店舗など、お気軽にご質問ください！\n\n' +
      '（メニューに戻るには「メニュー」と送ってください）'
    );
  }

  // ── AI相談（全般）──
  if (text === 'AI相談') {
    const existingHistory = session.aiHistory || [];
    await setSession(userId, { mode: 'ai_chat', aiHistory: existingHistory, aiCategory: 'general' });
    const greetingText = existingHistory.length === 0
      ? '☀️ こんにちは！健やか整骨院グループのジョイ君です！\n\n整骨院・RISEGYM・RiseBeauty、何でもお気軽にご相談ください😊\n夜間・休日も24時間対応していますよ！\n\n（メニューに戻るには「メニュー」と送ってください）'
      : '☀️ ジョイ君です！引き続きどうぞ😊\n\n（メニューに戻るには「メニュー」と送ってください）';
    return replyText(replyToken, greetingText);
  }

  // ── 予約変更・キャンセル ──
  if (text === '予約変更・キャンセル') {
    await setSession(userId, { mode: 'change_cancel', step: 1 });
    return replyText(replyToken,
      '以下のテンプレートをコピーして、内容を記入してお送りください。\n\n' +
      '【予約変更・キャンセル】\n' +
      'お名前：\n電話番号：\nご予約日時：\n' +
      'ご希望内容：（変更 or キャンセル）\n変更希望日時：（変更の場合）'
    );
  }

  // ── 変更・キャンセル受付 ──
  if (session.mode === 'change_cancel' && session.step === 1) {
    await clearSession(userId);
    return replyText(replyToken,
      '✅ 変更・キャンセルのご連絡を受け付けました！\n\n' +
      '院より確認のご連絡をいたします。\n' +
      '※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。\n\n' +
      '☀️ またいつでもジョイ君に声をかけてください！\n' +
      '健やか整骨院 豊玉院\n📞 03-5946-9959'
    );
  }

  // ── それ以外はメインメニュー ──
  return client.replyMessage(replyToken, [buildMainMenu(), buildSubMenu()]);
}

// ============================================================
// ヘルスチェック・監視エンドポイント
// ============================================================
app.get('/health', async function(req, res) {
  try {
    await redis.set('health_check', new Date().toISOString(), { ex: 60 });
    res.status(200).json({ status: 'ok', redis: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', redis: 'disconnected' });
  }
});

app.get('/ping', function(req, res) { res.status(200).send('pong'); });
app.get('/ping2', function(req, res) { res.status(200).send('pong2'); });

// ============================================================
// サーバー起動
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
