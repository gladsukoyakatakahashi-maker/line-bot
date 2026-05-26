'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const { Redis } = require('@upstash/redis');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================================
// メール送信設定（nodemailer / Gmail）
// 環境変数：MAIL_USER / MAIL_PASS / MAIL_TO
// ============================================================
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendBookingMail(bookingInfo) {
  const subject = '【仮予約】' + bookingInfo.datetime + ' ' + bookingInfo.phone;
  const body =
    '健やか整骨院 豊玉院 LINEより仮予約が入りました。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '【予約種別】' + (bookingInfo.bookingType === 'new' ? '新規' : '来院中') + '\n' +
    '【希望日時】' + bookingInfo.datetime + '\n' +
    '【電話番号】' + bookingInfo.phone + '\n' +
    '【症　　状】' + bookingInfo.symptoms + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '※このメールはLINEボットから自動送信されています。\n' +
    '当日〜翌日中にお電話でご確認ください。';

  try {
    await mailer.sendMail({
      from: process.env.MAIL_USER,
      to: process.env.MAIL_TO,
      subject: subject,
      text: body,
    });
    console.log('予約メール送信成功:', subject);
  } catch (e) {
    console.error('予約メール送信失敗:', e);
  }
}

// ============================================================
// 症状マスター
// ============================================================
const SYMPTOMS_MAP = {
  '1': '首痛', '2': '肩こり', '3': '肩の痛み', '4': '腰痛', '5': '膝痛',
  '6': '股関節痛', '7': '足首痛', '8': '産後の骨盤矯正', '9': '交通事故の治療',
  '10': 'トレーニング', '11': 'リハビリ', '12': 'オイルエステ',
};
const SYMPTOMS_LIST = [
  { id: '1', name: '首痛' }, { id: '2', name: '肩こり' }, { id: '3', name: '肩の痛み' },
  { id: '4', name: '腰痛' }, { id: '5', name: '膝痛' }, { id: '6', name: '股関節痛' },
  { id: '7', name: '足首痛' }, { id: '8', name: '産後の骨盤矯正' }, { id: '9', name: '交通事故の治療' },
  { id: '10', name: 'トレーニング' }, { id: '11', name: 'リハビリ' }, { id: '12', name: 'オイルエステ' },
];

// ============================================================
// システムプロンプト（ジョイ君・全事業対応）
// ============================================================
const SYSTEM_PROMPT = `あなたは「健やか整骨院」グループの公式マスコットキャラクター「ジョイ君」です。
太陽のように明るく元気なキャラクターで、患者・お客様の心強いコンシェルジュとして対応します。

## キャラクター設定
- 名前：ジョイ君（健やか整骨院グループ公式マスコット）
- 性格：明るく元気、親しみやすい、礼儀正しい
- 口調：丁寧かつ親しみやすい（です・ます調ベース）
- 絵文字：☀️😊👍💪✨を適度に使い明るい雰囲気を演出
- 夜間・休日も24時間対応

## グループ事業概要

### 🏥 健やか整骨院（整骨院・治療）
国家資格者による治療院。痛み・不調・産後ケアなど。
公式サイト：https://sukoyaka-seikotsuin.com/

### 💪 RISEGYM（ライズジム）- 医療系パーソナルジム
- コンセプト：「整えてから鍛える」医療知識とトレーニングの融合
- スタッフ：作業療法士・理学療法士・柔道整復師などの国家資格者
- 特徴：完全個室・完全予約制・マンツーマン指導
- 対象：姿勢改善・慢性的な痛み予防・リハビリ後の機能回復・加齢対策・ダイエット・ボディメイク
- 店舗：豊玉（TEL:080-3348-1397）・平和台・朝霞・宇都宮
- 公式サイト：https://www.reha-rise-gym.com/

### ✨ RiseBeauty（ライズビューティー）- メディカルオイルエステ
- コンセプト：「毎日がんばる女性に、安心してゆるむ時間を」
- 特徴：整骨院運営・医療従事者による解剖学的施術・無理な勧誘なし
- 保育士による無料託児あり（予約必須・平日午前9:30〜13:00のみ）
- 産後1ヶ月検診後から利用可能
- 施術メニュー：デコルテ・お腹・背中・フット・下半身・フェイシャル・全身・パーソナルオイル・ヘッドスパ・セルキュア4T plus+
- 本店：平和台（TEL:03-6906-8162）/ 姉妹店：上板橋・朝霞
- 公式サイト：https://www.sukoyaka-rise-beauty.com/

## 健やか整骨院 グループ店舗情報

### 豊玉院（メインLINE対応院）
- 住所：〒176-0012 東京都練馬区豊玉北4-4-7
- 電話：03-5946-9959
- 営業時間：火〜金 9:30〜13:00 / 15:00〜19:00、土 9:30〜13:00 / 15:00〜18:00
- 定休日：日・月曜日、祝日営業
- アクセス：練馬駅・桜台駅から徒歩7分 / キッズルーム・保育士在中・RISEGYM併設

### 平和台院
- 電話：03-6906-8162 / 平和台駅から徒歩4分 / RISEGYM・RiseBeauty・RehaRISE併設

### 上板橋院
- 電話：03-6912-3136 / 上板橋駅から徒歩3〜5分 / RiseBeauty施術対応

### 朝霞院
- 電話：048-487-8490 / 駐車場5台 / RISEGYM・RiseBeauty施術対応

### 宇都宮院
- 電話：028-666-4384 / 駐車場10台 / パーソナルジム併設

## 整骨院 施術内容
骨盤矯正・産後骨盤矯正・猫背矯正・首肩腰膝の痛み治療・電気治療・ハイボルテージ・
楽トレ（EMS）・マッサージ・ストレッチ・テーピング・鍼灸治療・美容鍼・
メディカルオイルマッサージ・酸素カプセル・交通事故治療（自賠責保険対応）・
スポーツ外傷・リハビリ・パーソナルトレーニング・コンディショニングトレーニング

## 回答スタイル
- 丁寧かつ親しみやすい日本語（です・ます調）
- 【重要】回答は必ず3〜4文以内の短文でまとめること。長文・箇条書き・見出し（##）は使用禁止
- 【重要】文と文の間は必ず改行を入れること。1文ごとに改行して読みやすくすること
- 【重要】Markdownの記号（**、##、-など）は一切使用禁止。プレーンテキストのみで回答すること
- 詳細情報（店舗一覧・施術内容の列挙など）は書かず「お気軽にご相談ください」で締めくくる
- 医療診断・処方は行わない
- 緊急症状（激しい胸痛・呼吸困難・麻痺など）は迷わず救急を勧める
- 料金詳細は「院にお問い合わせください」の一言のみで案内し、詳細は書かない
- 予約確定には院からの電話確認が必要な旨を伝える
- このLINEから24時間いつでも仮予約可能（豊玉院のみ）

## 【重要】言語ルール
- 回答は必ず100%日本語で行うこと
- 英単語・英語表記は一切使用禁止（例：shoulder→肩、knee→膝、lower back→腰、muscle→筋肉）
- 身体部位・症状・施術名はすべて日本語で表記すること
- 固有名詞（RISEGYM、RiseBeauty）のみ英語表記を許可する
- ユーザーが英語で話しかけてきた場合も、回答は日本語で行うこと`;

// ============================================================
// 予約フロー中のAI割り込み用プロンプト（案B）
// ============================================================
const BOOKING_INTERRUPT_PROMPT = `あなたはジョイ君です。ユーザーは現在予約フローの途中ですが、質問をしてきました。
質問に簡潔に答えた上で、必ず「予約を続ける」ボタンを案内してください。
回答は2〜3文程度で簡潔にまとめてください。
回答は必ず100%日本語で記述してください。英単語は使用禁止です。`;

// ============================================================
// 営業時間チェック
// ============================================================
const CLOSED_DAYS = [0, 1]; // 日=0, 月=1

// 定休日チェック（日・月 ＋ 年末年始 12/29〜1/3）
function isClosedDay(date) {
  const day = date.getDay();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  // 日・月曜日
  if (CLOSED_DAYS.includes(day)) return true;

  // 年末年始休暇：12/29〜12/31、1/1〜1/3
  if (m === 12 && d >= 29) return true;
  if (m === 1 && d <= 3) return true;

  return false;
}

function getBusinessHours(dayOfWeek) {
  if (dayOfWeek === 6) {
    return { morning: { start: '09:30', end: '13:00' }, afternoon: { start: '15:00', end: '18:00' } };
  }
  return { morning: { start: '09:30', end: '13:00' }, afternoon: { start: '15:00', end: '19:00' } };
}

function isBusinessHours() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  if (isClosedDay(now)) return false;
  const day = now.getDay();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const timeStr = h + ':' + m;
  const hours = getBusinessHours(day);
  return (timeStr >= hours.morning.start && timeStr < hours.morning.end) ||
         (timeStr >= hours.afternoon.start && timeStr < hours.afternoon.end);
}

// ============================================================
// 予約可能日・時間スロット
// ============================================================
function getAvailableDays() {
  const days = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const d = new Date(now);
  while (days.length < 6) {
    d.setDate(d.getDate() + 1);
    if (!isClosedDay(d)) {
      days.push(new Date(d));
    }
  }
  return days;
}

function getTimeSlots(dayOfWeek) {
  const morning = ['9:30', '10:10', '10:50', '11:30', '12:10'];
  const afternoonWeekday = ['15:00', '15:40', '16:20', '17:00', '17:40', '18:20'];
  const afternoonSaturday = ['15:00', '15:40', '16:20', '17:00', '17:40'];
  if (dayOfWeek === 6) return morning.concat(afternoonSaturday);
  return morning.concat(afternoonWeekday);
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(d) {
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_NAMES[d.getDay()] + ')';
}

// ============================================================
// 症状クイックリプライ（全11症状＋完了ボタン・1ページ）
// ============================================================
function buildSymptomsQuickReply(selected) {
  // ✔ 選択完了を先頭に配置（合計13個：完了1＋症状12＝LINEの上限ちょうど）
  const items = [{
    type: 'action',
    action: { type: 'message', label: '✔ 選択完了', text: '症状確定' },
  }];
  SYMPTOMS_LIST.forEach(function(s) {
    const isSelected = selected.includes(s.id);
    items.push({
      type: 'action',
      action: {
        type: 'message',
        label: (isSelected ? '✅' : '') + s.name,
        text: '症状選択:' + s.id,
      },
    });
  });
  return { type: 'quickReply', items: items };
}

// 症状選択の案内文を生成
function buildSymptomsMessage(selected) {
  const selectedNames = selected.length > 0
    ? '選択中：' + symptomsIdsToNames(selected)
    : '';
  return '🩺 症状をタップで選択してください✅\n選択完了後一番左にある「✔ 選択完了」を押してください' +
    (selectedNames ? '\n\n' + selectedNames : '');
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
// メインメニュー / サブメニュー
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
        { type: 'message', label: '✏️ 予約変更・キャンセル', text: '予約変更・キャンセル' },
        { type: 'message', label: '💬 AIジョイ君になんでも相談', text: 'AI相談' },
      ],
    },
  };
}

// ============================================================
// ジョイ君 AI相談（カテゴリ別・会話履歴保持）
// ============================================================
async function handleAiChat(userId, replyToken, userMessage, session) {
  const history = session.aiHistory || [];
  const category = session.aiCategory || 'general';

  let categoryHint = '';
  if (category === 'risegym') {
    categoryHint = '※ユーザーはRISEGYM（パーソナルジム）についての相談をしています。RISEGYMの情報を中心に案内してください。';
  } else if (category === 'risebeauty') {
    categoryHint = '※ユーザーはRiseBeauty（メディカルオイルエステ）についての相談をしています。RiseBeautyの情報を中心に案内してください。';
  }

  const japaneseRule = '【絶対ルール】①返答は必ず完全な日本語で。②英単語（shoulder, knee, muscle, pain, back, neck, hip, ankle, joint, stiffness, rehabilitation, training, massage, treatmentなど）は使用禁止。③回答は3〜4文以内の短文のみ。長文・箇条書き・見出し（##）・Markdown記号（**、-など）は絶対に使用禁止。④必ず1文ごとに改行を入れて読みやすくすること。⑤詳細な店舗一覧や施術内容の列挙はしない。⑥RISEGYM・RiseBeautyなど固有名詞のみ英語表記を許可。';

  const fullSystem = SYSTEM_PROMPT +
    (categoryHint ? '\n\n' + categoryHint : '') +
    '\n\n' + japaneseRule;

  let aiReply = '';
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: fullSystem,
        messages: history.concat([{ role: 'user', content: userMessage }]),
      });
      aiReply = response.content[0].text;
      break;
    } catch (e) {
      console.error('Claude API error attempt ' + attempt + ':', JSON.stringify(e));
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

  let actions;
  if (category === 'risegym') {
    actions = [
      { type: 'message', label: '💪 RISEGYMをもっと聞く', text: 'RISEGYMについてもっと教えて' },
      { type: 'message', label: '🆕 整骨院を予約する', text: '新規予約' },
      { type: 'message', label: '🏠 メニューへ戻る', text: 'メニュー' },
    ];
  } else if (category === 'risebeauty') {
    actions = [
      { type: 'message', label: '✨ 施術メニューを聞く', text: 'RiseBeautyの施術メニューを教えて' },
      { type: 'message', label: '✨ 予約方法を聞く', text: 'RiseBeautyの予約方法を教えて' },
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
// 【案B】予約フロー中のAI割り込み処理
// ボタン外のテキストが来たらAIが回答→「予約を続ける」ボタンで元のステップへ
// ============================================================
async function handleBookingInterrupt(userId, replyToken, userMessage, session) {
  const japaneseRule = '返答は必ず完全な日本語で。英単語使用禁止。';
  const fullSystem = BOOKING_INTERRUPT_PROMPT + '\n\n' + SYSTEM_PROMPT + '\n\n' + japaneseRule;

  let aiReply = '';
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: fullSystem,
      messages: [{ role: 'user', content: userMessage }],
    });
    aiReply = response.content[0].text;
  } catch (e) {
    console.error('Claude interrupt error:', e);
    aiReply = 'ご質問ありがとうございます😊 詳しくは院へお気軽にお問い合わせください。';
  }

  // 「予約を続ける」ボタンで元のステップの案内を再表示
  return replyMessages(replyToken, [
    { type: 'text', text: aiReply },
    {
      type: 'template',
      altText: '予約を続けますか？',
      template: {
        type: 'buttons',
        text: '引き続き予約を続けますか？😊',
        actions: [
          { type: 'message', label: '✅ 予約を続ける', text: '予約を続ける' },
          { type: 'message', label: '🏠 メニューへ戻る', text: 'メニュー' },
        ],
      },
    },
  ]);
}

// ============================================================
// 予約フロー（新規・来院中共通）
// ============================================================
async function handleBooking(userId, replyToken, text, session) {
  const step = session.step || 0;
  const type = session.bookingType;

  // 「予約を続ける」→ 現在のステップを再表示
  if (text === '予約を続ける') {
    return resumeBookingStep(replyToken, session);
  }

  // STEP2: 日付選択
  if (step === 2) {
    const days = (session.availableDays || []).map(function(d) { return new Date(d); });
    const matched = days.find(function(d) { return formatDate(d) === text; });
    if (!matched) {
      return handleBookingInterrupt(userId, replyToken, text, session);
    }
    const slots = getTimeSlots(matched.getDay());
    const morningSlots = slots.filter(function(s) { return parseInt(s.split(':')[0]) < 13; });
    const afternoonSlots = slots.filter(function(s) { return parseInt(s.split(':')[0]) >= 13; });
    await setSession(userId, Object.assign({}, session, {
      selectedDate: matched.toISOString(),
      allSlots: slots,
      morningSlots: morningSlots,
      afternoonSlots: afternoonSlots,
      step: 3,
    }));
    // 全スロットをクイックリプライで1画面表示
    const timeItems = slots.map(function(s) {
      return { type: 'action', action: { type: 'message', label: s, text: s } };
    });
    return replyTextWithQuickReply(
      replyToken,
      formatDate(matched) + '\nご希望の時間をお選びください😊\n横スクロールで全時間帯を確認できます👇',
      { type: 'quickReply', items: timeItems }
    );
  }

  // STEP3: 時間確定
  if (step === 3) {
    const allSlots = session.allSlots || [];
    if (!allSlots.includes(text)) {
      return handleBookingInterrupt(userId, replyToken, text, session);
    }
    await setSession(userId, Object.assign({}, session, { selectedTime: text, step: 4 }));
    return replyText(replyToken, '📱 お電話番号を入力してください。\n（例：090-1234-5678）');
  }

  // STEP4: 電話番号入力（半角・全角どちらも対応）
  if (step === 4) {
    // 全角数字・ハイフン・括弧を半角に変換
    const normalized = text
      .replace(/[０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[－ー−]/g, '-')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')');
    if (!/[\d\-()]{10,}/.test(normalized)) {
      // 電話番号でなければAI割り込み（ただし電話番号入力を再案内）
      return replyMessages(replyToken, [
        { type: 'text', text: '📱 お電話番号を入力してください。\n（例：090-1234-5678）\n\nご質問があればお気軽にどうぞ😊' },
        {
          type: 'template',
          altText: 'メニュー',
          template: {
            type: 'buttons',
            text: '予約をやめる場合はこちら',
            actions: [
              { type: 'message', label: '🏠 メニューへ戻る', text: 'メニュー' },
            ],
          },
        },
      ]);
    }
    await setSession(userId, Object.assign({}, session, { phone: normalized, step: 5, selectedSymptoms: [] }));
    return replyTextWithQuickReply(
      replyToken,
      buildSymptomsMessage([]),
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
        buildSymptomsMessage(newSelected),
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

      // 予約完了処理
      const selectedDate = new Date(session.selectedDate);
      const datetime = formatDate(selectedDate) + ' ' + session.selectedTime;
      const symptomsText = symptomsIdsToNames(selectedSymptoms);

      // ① メール送信（非同期・失敗してもLINE返答は続行）
      sendBookingMail({
        bookingType: type,
        datetime: datetime,
        phone: session.phone,
        symptoms: symptomsText,
      });

      // ② LINEへ完了メッセージ
      const msg =
        '✅ 仮予約を受け付けました！\n\n' +
        '院より当日〜翌日中にお電話でご確認いたします。\n' +
        '連絡が取れ次第予約確定になります。ご了承ください。\n' +
        '※ 日・月曜日はお電話対応ができないため、火曜日以降のご連絡となります。\n\n' +
        '📅 希望日時：' + datetime + '\n' +
        '📱 電話番号：' + session.phone + '\n' +
        '🩺 症状：' + symptomsText + '\n\n' +
        '☀️ ジョイ君がご来院をお待ちしています！\n' +
        '健やか整骨院 豊玉院\n📞 03-5946-9959';
      await clearSession(userId);
      return replyText(replyToken, msg);
    }

    // 症状選択中のボタン外テキスト → AI割り込み
    return handleBookingInterrupt(userId, replyToken, text, session);
  }
}

// ============================================================
// 「予約を続ける」→ 現在のステップを再表示する
// ============================================================
async function resumeBookingStep(replyToken, session) {
  const step = session.step || 0;

  if (step === 2) {
    const days = (session.availableDays || []).map(function(d) { return new Date(d); });
    const dateItems = days.map(function(d) {
      return { type: 'action', action: { type: 'message', label: formatDate(d), text: formatDate(d) } };
    });
    return replyTextWithQuickReply(
      replyToken,
      'ご希望の日をお選びください😊\n横スクロールで10日分確認できます👇',
      { type: 'quickReply', items: dateItems }
    );
  }

  if (step === 3) {
    const allSlots = session.allSlots || [];
    const timeItems = allSlots.map(function(s) {
      return { type: 'action', action: { type: 'message', label: s, text: s } };
    });
    return replyTextWithQuickReply(
      replyToken,
      'ご希望の時間をお選びください😊\n横スクロールで全時間帯を確認できます👇',
      { type: 'quickReply', items: timeItems }
    );
  }

  if (step === 4) {
    return replyText(replyToken, '📱 お電話番号を入力してください。\n（例：090-1234-5678）');
  }

  if (step === 5) {
    const selectedSymptoms = session.selectedSymptoms || [];
    return replyTextWithQuickReply(
      replyToken,
      buildSymptomsMessage(selectedSymptoms),
      buildSymptomsQuickReply(selectedSymptoms)
    );
  }

  return client.replyMessage(replyToken, buildMainMenu());
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

  // AI相談モード中
  const menuKeywords = ['新規予約', '来院中の予約', 'AI相談', '予約変更・キャンセル'];
  if (session.mode === 'ai_chat' && !menuKeywords.includes(text)) {
    return handleAiChat(userId, replyToken, text, session);
  }

  // 予約フロー中（案B：ボタン外テキストはAI割り込みで対応）
  if (session.mode === 'booking' && session.step >= 2) {
    return handleBooking(userId, replyToken, text, session);
  }

  // 新規予約（24時間対応）
  if (text === '新規予約') {
    const days = getAvailableDays();
    const newSession = {
      mode: 'booking', bookingType: 'new', step: 2,
      availableDays: days.map(function(d) { return d.toISOString(); }),
    };
    await setSession(userId, newSession);
    const prefix = isBusinessHours() ? '' : '☀️ 営業時間外でも仮予約は24時間受け付けています！\n院より翌営業日にお電話でご確認いたします。\n\n';
    const dateItems = days.map(function(d) {
      return { type: 'action', action: { type: 'message', label: formatDate(d), text: formatDate(d) } };
    });
    return replyTextWithQuickReply(
      replyToken,
      prefix + '新規予約を承ります😊\nご希望の日をお選びください。\n横スクロールで10日分確認できます👇',
      { type: 'quickReply', items: dateItems }
    );
  }

  // 来院中の予約（24時間対応）
  if (text === '来院中の予約') {
    const days = getAvailableDays();
    const newSession = {
      mode: 'booking', bookingType: 'returning', step: 2,
      availableDays: days.map(function(d) { return d.toISOString(); }),
    };
    await setSession(userId, newSession);
    const prefix = isBusinessHours() ? '' : '☀️ 営業時間外でも仮予約は24時間受け付けています！\n院より翌営業日にお電話でご確認いたします。\n\n';
    const dateItems = days.map(function(d) {
      return { type: 'action', action: { type: 'message', label: formatDate(d), text: formatDate(d) } };
    });
    return replyTextWithQuickReply(
      replyToken,
      prefix + 'ご予約を承ります😊\nご希望の日をお選びください。\n横スクロールで10日分確認できます👇',
      { type: 'quickReply', items: dateItems }
    );
  }

  // AI相談（全般・RISEGYM・RiseBeautyも含めてジョイ君が対応）
  if (text === 'AI相談') {
    const existingHistory = session.aiHistory || [];
    await setSession(userId, { mode: 'ai_chat', aiHistory: existingHistory, aiCategory: 'general' });
    const greetingText = existingHistory.length === 0
      ? '☀️ こんにちは！健やか整骨院グループのジョイ君です！\n\n整骨院・RISEGYM・RiseBeauty、何でもお気軽にご相談ください😊\n夜間・休日も24時間対応していますよ！\n\n（メニューに戻るには「メニュー」と送ってください）'
      : '☀️ ジョイ君です！引き続きどうぞ😊\n\n（メニューに戻るには「メニュー」と送ってください）';
    return replyText(replyToken, greetingText);
  }

  // 予約変更・キャンセル
  if (text === '予約変更・キャンセル') {
    await setSession(userId, { mode: 'change_cancel', step: 1 });
    return replyText(replyToken,
      '以下のテンプレートをコピーして、内容を記入してお送りください。\n\n' +
      '【予約変更・キャンセル】\n' +
      'お名前：\n電話番号：\nご予約日時：\n' +
      'ご希望内容：（変更 or キャンセル）\n変更希望日時：（変更の場合）'
    );
  }

  // 変更・キャンセル受付
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

  // それ以外はメインメニュー＋サブメニュー
  return client.replyMessage(replyToken, buildMainMenu());
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
