'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const { Redis } = require('@upstash/redis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// LINE設定
const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(lineConfig);

// Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================
// システムプロンプト（健やか整骨院 全店舗情報）
// ============================================================
const SYSTEM_PROMPT = `あなたは「健やか整骨院」のLINE公式アカウントのAIアシスタントです。
患者さまからのご質問に、丁寧で温かみのある言葉でお答えください。

## あなたの役割
- 症状やお悩みへのアドバイス（整骨院で対応できる範囲の一般的な情報提供）
- 院・施術内容の案内
- 各店舗へのご予約の誘導
- 不明な点は「直接お電話でご確認ください」と案内する

## 回答スタイル
- 丁寧で流暢な日本語（です・ます調）
- 温かみがあり、患者さまに寄り添う言葉遣い
- 長すぎず、要点を分かりやすく伝える
- 医療的な診断は行わず、「一度ご来院の上、ご相談ください」と案内する

## 健やか整骨院 グループ店舗情報

### 健やか整骨院 豊玉院（東京・練馬区）
- 住所：〒176-0012 東京都練馬区豊玉北４丁目４−７−１０１
- 電話：03-5946-9959
- 営業時間：火〜金 9:30〜13:00 / 15:00〜19:00、土 9:30〜13:00 / 15:00〜18:00
- 定休日：日・月曜日、祝日営業

### 健やか整骨院 上板橋院（東京）
- エリア：東京都板橋区 上板橋
- グループ店舗

### 健やか整骨院 平和台院（東京）
- エリア：東京都練馬区 平和台
- グループ店舗

### 健やか整骨院 朝霞院（埼玉）
- エリア：埼玉県朝霞市
- グループ店舗

### 健やか整骨院 宇都宮院（栃木）
- エリア：栃木県宇都宮市
- グループ店舗

※上板橋・平和台・朝霞・宇都宮院の詳細（住所・電話・営業時間）は現在情報を準備中です。
詳細をお知りになりたい場合は「直接各院にお問い合わせください」とお伝えください。

## 施術内容
- 骨盤矯正・産後骨盤矯正
- 首・肩・腰・膝などの痛み治療
- 電気治療・マッサージ・テーピング
- 交通事故治療（自賠責保険対応）
- スポーツ外傷・リハビリ
- トレーニング指導

## 対応できる主な症状
首痛、肩こり、肩の痛み、腰痛、膝痛、股関節痛、足首痛、産後の骨盤矯正、交通事故の治療、トレーニング、リハビリ など

## 重要な注意事項
- 医療診断・処方は行わない
- 緊急症状（激しい胸痛・呼吸困難・麻痺など）は迷わず救急を勧める
- 料金の詳細は「院にお問い合わせください」と案内する
- 予約の最終確定は院からの電話確認が必要である旨を伝える

## 予約について（このLINEでできること）
- このLINEから仮予約が可能（豊玉院のみ）
- 予約後、院より電話で確認・確定
- 「予約したい」という流れになったら、メニューの予約ボタンを案内する`;

// ============================================================
// 営業時間チェック
// ============================================================
const CLOSED_DAYS = [0, 1]; // 日=0, 月=1

function getBusinessHours(dayOfWeek) {
  if (dayOfWeek === 6) return { morning: { start: '09:30', end: '13:00' }, afternoon: { start: '15:00', end: '18:00' } };
  return { morning: { start: '09:30', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } };
}

function isBusinessHours() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const day = now.getDay();
  if (CLOSED_DAYS.includes(day)) return false;
  const hours = getBusinessHours(day);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (timeStr >= hours.morning.start && timeStr < hours.morning.end) ||
         (timeStr >= hours.afternoon.start && timeStr < hours.afternoon.end);
}

// ============================================================
// 予約可能日・時間スロット
// ============================================================
function getAvailableDays() {
  const days = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  let d = new Date(now);
  while (days.length < 6) {
    d.setDate(d.getDate() + 1);
    if (!CLOSED_DAYS.includes(d.getDay())) {
      days.push(new Date(d));
    }
  }
  return days;
}

function getTimeSlots(dayOfWeek) {
  const morning = ['9:30', '10:10', '10:50', '11:30', '12:10'];
  if (dayOfWeek === 6) return [...morning, '15:00', '15:40', '16:20', '17:00', '17:40'];
  return [...morning, '15:00', '15:40', '16:20', '17:00', '17:40', '18:20'];
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_NAMES[d.getDay()]})`;
}

// ============================================================
// セッション操作
// ============================================================
const SESSION_TTL = 86400;

async function getSession(userId) {
  try {
    const data = await redis.get(`session:${userId}`);
    return data || {};
  } catch (e) {
    console.error('Redis get error:', e);
    return {};
  }
}

async function setSession(userId, sessionData) {
  try {
    await redis.set(`session:${userId}`, sessionData, { ex: SESSION_TTL });
  } catch (e) {
    console.error('Redis set error:', e);
  }
}

async function clearSession(userId) {
  try {
    await redis.del(`session:${userId}`);
  } catch (e) {
    console.error('Redis del error:', e);
  }
}

// ============================================================
// メッセージ送信ヘルパー
// ============================================================
async function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: 'text', text });
}

async function replyMessages(replyToken, messages) {
  return client.replyMessage(replyToken, messages);
}

// ============================================================
// メインメニュー
// ============================================================
function buildMainMenu() {
  return {
    type: 'template',
    altText: '健やか整骨院 豊玉院 メニュー',
    template: {
      type: 'buttons',
      title: '健やか整骨院 豊玉院',
      text: 'ご用件をお選びください',
      actions: [
        { type: 'message', label: '🆕 新規予約（初めての方）', text: '新規予約' },
        { type: 'message', label: '🗓️ 予約（来院中の方）', text: '来院中の予約' },
        { type: 'message', label: '✏️ 予約変更・キャンセル', text: '予約変更・キャンセル' },
        { type: 'message', label: '💬 AIに相談する', text: 'AI相談' },
      ],
    },
  };
}

// ============================================================
// AI相談モードの処理（Gemini）
// ============================================================
async function handleAiChat(userId, replyToken, userMessage, session) {
  const history = session.aiHistory || [];

  let aiReply = '';
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash-001',  // ← ここを修正
        systemInstruction: SYSTEM_PROMPT,
      });

      const chat = model.startChat({
        history: history,
        generationConfig: { maxOutputTokens: 600 },
      });

      const result = await chat.sendMessage(userMessage);
      aiReply = result.response.text();
      break;
    } catch (e) {
      console.error(`Gemini API error (attempt ${attempt}):`, e);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      } else {
        aiReply = '申し訳ございません。現在AIが混み合っております。\n少し時間をおいてから再度お試しください🙏\n\nお急ぎの場合はお電話ください。\n📞 03-5946-9959';
      }
    }
  }

  // 履歴に追加（Gemini形式: role は "user" / "model"）
  const updatedHistory = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
    { role: 'model', parts: [{ text: aiReply }] },
  ];

  // 直近20往復まで保持
  const trimmedHistory = updatedHistory.length > 40
    ? updatedHistory.slice(updatedHistory.length - 40)
    : updatedHistory;

  await setSession(userId, { ...session, mode: 'ai_chat', aiHistory: trimmedHistory });

  const messages = [
    { type: 'text', text: aiReply },
    {
      type: 'template',
      altText: '続けてご相談いただくか、予約へお進みください',
      template: {
        type: 'buttons',
        text: '他にご質問はありますか？',
        actions: [
          { type: 'message', label: '🆕 新規予約（初めての方）', text: '新規予約' },
          { type: 'message', label: '🗓️ 予約（来院中の方）', text: '来院中の予約' },
          { type: 'message', label: '🏠 メニューに戻る', text: 'メニュー' },
        ],
      },
    },
  ];

  return replyMessages(replyToken, messages);
}

// ============================================================
// 予約フロー（新規・来院中共通）
// ============================================================
async function handleBooking(userId, replyToken, text, session) {
  const step = session.step || 0;
  const type = session.bookingType;

  // STEP 1: 希望日選択
  if (step === 1) {
    const days = getAvailableDays();
    const actions = days.slice(0, 4).map(d => ({
      type: 'message',
      label: formatDate(d),
      text: formatDate(d),
    }));
    await setSession(userId, { ...session, availableDays: days.map(d => d.toISOString()), step: 2 });
    return replyMessages(replyToken, [
      { type: 'text', text: type === 'new' ? '【新規予約】\nご希望の日をお選びください。' : '【予約】\nご希望の日をお選びください。' },
      {
        type: 'template',
        altText: '日付を選んでください',
        template: { type: 'buttons', text: '※直近4日を表示しています', actions },
      },
    ]);
  }

  // STEP 2: 希望時間選択
  if (step === 2) {
    const days = (session.availableDays || []).map(d => new Date(d));
    const matched = days.find(d => formatDate(d) === text);
    if (!matched) return replyText(replyToken, '表示されている日付からお選びください。');
    const slots = getTimeSlots(matched.getDay());
    const actions = slots.slice(0, 4).map(s => ({ type: 'message', label: s, text: s }));
    await setSession(userId, { ...session, selectedDate: matched.toISOString(), allSlots: slots, step: 3 });
    return replyMessages(replyToken, [{
      type: 'template',
      altText: '時間を選んでください',
      template: { type: 'buttons', text: `${formatDate(matched)}\nご希望の時間をお選びください`, actions },
    }]);
  }

  // STEP 3: 時間確定
  if (step === 3) {
    const allSlots = session.allSlots || [];
    if (!allSlots.includes(text)) return replyText(replyToken, '表示されている時間からお選びください。');
    await setSession(userId, { ...session, selectedTime: text, step: 4 });
    return replyText(replyToken, '📱 お電話番号を入力してください。\n（例：090-1234-5678）');
  }

  // STEP 4: 電話番号
  if (step === 4) {
    if (!/[\d\-（）()]{10,}/.test(text)) return replyText(replyToken, '電話番号を正しい形式で入力してください。\n例：090-1234-5678');
    await setSession(userId, { ...session, phone: text, step: 5 });
    const symptomsText = `🩺 気になる症状を番号で入力してください（複数可・カンマ区切り）

1.首痛 2.肩こり 3.肩の痛み 4.腰痛 5.膝痛
6.股関節痛 7.足首痛 8.産後の骨盤矯正 9.交通事故の治療
10.トレーニング 11.リハビリ

例：1,4 または 腰痛と肩こりなど自由入力もOKです`;
    return replyText(replyToken, symptomsText);
  }

  // STEP 5: 症状 → 完了
  if (step === 5) {
    const selectedDate = new Date(session.selectedDate);
    const datetime = `${formatDate(selectedDate)} ${session.selectedTime}`;
    const completionMessage = `✅ 仮予約を受け付けました。
※予約はまだ確定していません。

📅 希望日時：${datetime}
📱 電話番号：${session.phone}
🩺 症状：${text}

院より当日〜翌日中にお電話でご確認いたします。
連絡が取れ次第予約確定になります。
ご了承ください。
※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。

健やか整骨院 豊玉院
📞 03-5946-9959`;
    await clearSession(userId);
    return replyText(replyToken, completionMessage);
  }
}

// ============================================================
// Webhookルート
// ============================================================
app.post('/webhook',
  line.middleware(lineConfig),
  (req, res) => {
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
  const resetWords = ['やめる', 'やめます', '最初に戻る', 'メニュー', 'menu', 'Menu', 'MENU', 'キャンセル'];
  if (resetWords.some(w => text.includes(w))) {
    await clearSession(userId);
    return client.replyMessage(replyToken, [
      { type: 'text', text: 'メニューに戻ります。' },
      buildMainMenu(),
    ]);
  }

  // AI相談モード中はGeminiに流す
  if (session.mode === 'ai_chat') {
    return handleAiChat(userId, replyToken, text, session);
  }

  // 予約フロー中
  if (session.mode === 'booking' && session.step > 0) {
    return handleBooking(userId, replyToken, text, session);
  }

  // メニュー選択
  if (text === '新規予約') {
    if (!isBusinessHours()) {
      return replyText(replyToken, `現在は受付時間外です。\n\n【営業時間】\n火〜金：9:30〜13:00 / 15:00〜19:00\n土：9:30〜13:00 / 15:00〜18:00\n定休日：日・月曜日\n\n📞 03-5946-9959`);
    }
    await setSession(userId, { mode: 'booking', bookingType: 'new', step: 1 });
    return handleBooking(userId, replyToken, text, { mode: 'booking', bookingType: 'new', step: 1 });
  }

  if (text === '来院中の予約') {
    if (!isBusinessHours()) {
      return replyText(replyToken, `現在は受付時間外です。\n\n【営業時間】\n火〜金：9:30〜13:00 / 15:00〜19:00\n土：9:30〜13:00 / 15:00〜18:00\n定休日：日・月曜日\n\n📞 03-5946-9959`);
    }
    await setSession(userId, { mode: 'booking', bookingType: 'returning', step: 1 });
    return handleBooking(userId, replyToken, text, { mode: 'booking', bookingType: 'returning', step: 1 });
  }

  if (text === '予約変更・キャンセル') {
    const template = `以下のテンプレートをコピーして、内容を記入してお送りください。

【予約変更・キャンセル】
お名前：
電話番号：
ご予約日時：
ご希望内容：（変更 or キャンセル）
変更希望日時：（変更の場合）`;
    await setSession(userId, { mode: 'change_cancel', step: 1 });
    return replyText(replyToken, template);
  }

  if (text === 'AI相談') {
    await setSession(userId, { mode: 'ai_chat', aiHistory: [] });
    return replyText(replyToken, `💬 AIアシスタントです。\n\n症状のお悩みや院についてのご質問など、お気軽にご相談ください😊\n\n（メニューに戻るには「メニュー」と送ってください）`);
  }

  // 変更・キャンセルフロー完了
  if (session.mode === 'change_cancel' && session.step === 1) {
    const completionMessage = `✅ 変更・キャンセルのご連絡を受け付けました。

院より確認のご連絡をいたします。
※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。

健やか整骨院 豊玉院
📞 03-5946-9959`;
    await clearSession(userId);
    return replyText(replyToken, completionMessage);
  }

  // それ以外はメニューを表示
  return client.replyMessage(replyToken, buildMainMenu());
}

// ============================================================
// ヘルスチェック・監視エンドポイント
// ============================================================
app.get('/health', async (req, res) => {
  try {
    await redis.set('health_check', new Date().toISOString(), { ex: 60 });
    res.status(200).json({ status: 'ok', redis: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', redis: 'disconnected' });
  }
});

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/ping2', (req, res) => res.status(200).send('pong2'));

// ============================================================
// サーバー起動
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
