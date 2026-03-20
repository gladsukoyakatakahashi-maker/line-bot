require('dotenv').config();

const line = require('@line/bot-sdk');
const express = require('express');

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const client = new line.Client(config);
const app = express();

const CLINIC = {
  name: '健やか整骨院 豊玉',
  tel: '03-5946-9959',
  hours: '火〜金 9:30〜12:10 / 15:00〜19:00\n土 9:30〜12:10 / 15:00〜17:40',
  closed: '日・月・祝日',
};

const SYMPTOMS = ['首痛', '肩こり', '肩の痛み', '腰痛', '膝痛', '股関節痛', '足首痛', '産後の骨盤矯正', '交通事故の治療', 'トレーニング', 'リハビリ'];

const sessions = {};
function getSession(userId) {
  if (!sessions[userId]) sessions[userId] = { step: 'idle', booking: {} };
  return sessions[userId];
}

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(err => { console.error(err); res.status(500).end(); });
});

async function handleEvent(event) {
  if (event.type === 'follow') return sendWelcome(event.replyToken);
  if (event.type === 'postback') return handlePostback(event);
  if (event.type === 'message' && event.message.type === 'text') return handleText(event);
}

async function handleText(event) {
  const { replyToken, source: { userId }, message: { text } } = event;
  const session = getSession(userId);
  const t = text.trim();

  if (['メニュー','menu','最初','やり直し','ホーム','トップ'].includes(t)) {
    session.step = 'idle';
    session.booking = {};
    return sendMainMenu(replyToken);
  }

  if (session.step === 'idle') {
    const lower = t.toLowerCase();
    if (['予約','よやく','予約したい','予約お願い'].some(k => lower.includes(k))) {
      session.step = 'await_datetime';
      session.booking = {};
      return client.replyMessage(replyToken, {
        type: 'text',
        text: 'ご予約ですね！\nご希望の日時を入力してください。\n\n例）3月25日 10時\n　　来週火曜 午後3時\n\n※営業日：火〜金・土\n※定休日：日・月・祝日',
      });
    }
    if (['料金','施術','値段','いくら'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, makeMenuInfoFlex());
    }
    if (['営業','時間','何時','休み','定休'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, makeHoursFlex());
    }
    if (['電話','連絡'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, { type: 'text', text: `📞 ${CLINIC.name}\n\n${CLINIC.tel}\n\n火〜金 9:30〜19:00\n土 9:30〜17:40` });
    }
    if (['こんにちは','こんばんは','おはよう','はじめまして'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, [
        { type: 'text', text: `こんにちは！\n${CLINIC.name}のLINE予約窓口です😊` },
        makeMainMenuFlex(),
      ]);
    }
    return client.replyMessage(replyToken, [
      { type: 'text', text: 'ご用件をお選びください。' },
      makeMainMenuFlex(),
    ]);
  }

  switch (session.step) {
    case 'await_datetime':
      session.booking.datetime = t;
      session.step = 'await_name';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `「${t}」ですね、承りました。\n\nお名前をフルネームで入力してください。\n例）山田 太郎`,
      });

    case 'await_name':
      session.booking.name = t;
      session.step = 'await_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `${t} 様、ありがとうございます。\nお電話番号を入力してください。\n例）03-5946-0000`,
      });

    case 'await_phone':
      session.booking.phone = t;
      session.step = 'await_symptom';
      return client.replyMessage(replyToken, makeSymptomSelect());

    case 'await_symptom': {
      const nums = t.match(/10|11|[1-9]/g);
      if (nums) {
        const selected = [...new Set(nums)].map(n => SYMPTOMS[parseInt(n) - 1]).filter(Boolean);
        session.booking.symptom = selected.join('・');
      } else {
        session.booking.symptom = t;
      }
      session.step = 'await_first_visit';
      return client.replyMessage(replyToken, [
        { type: 'text', text: `「${session.booking.symptom}」ですね、承りました。` },
        makeFirstVisitMsg(),
      ]);
    }

    case 'await_first_visit': {
      const lower = t.toLowerCase();
      if (['初診','はじめて','初めて','1'].some(k => lower.includes(k))) {
        session.booking.isFirst = true;
      } else if (['再診','通院','2'].some(k => lower.includes(k))) {
        session.booking.isFirst = false;
      } else {
        return client.replyMessage(replyToken, [
          { type: 'text', text: '「初診」または「再診」とご入力ください。' },
          makeFirstVisitMsg(),
        ]);
      }
      const b = { ...session.booking };
      session.step = 'idle';
      session.booking = {};
      return client.replyMessage(replyToken, makeBookingComplete(b));
    }

    case 'await_manage_name':
      session.step = 'idle';
      session.booking = {};
      return client.replyMessage(replyToken, makeManageComplete(t));

    default:
      session.step = 'idle';
      session.booking = {};
      return client.replyMessage(replyToken, [
        { type: 'text', text: '最初からやり直してください。' },
        makeMainMenuFlex(),
      ]);
  }
}

async function handlePostback(event) {
  const { replyToken, source: { userId }, postback: { data } } = event;
  const session = getSession(userId);
  const params = new URLSearchParams(data);
  const action = params.get('action');

  switch (action) {
    case 'main_menu':
      session.step = 'idle';
      session.booking = {};
      return sendMainMenu(replyToken);

    case 'new_booking':
      session.step = 'await_datetime';
      session.booking = {};
      return client.replyMessage(replyToken, {
        type: 'text',
        text: 'ご予約ですね！\nご希望の日時を入力してください。\n\n例）3月25日 10時\n　　来週火曜 午後3時\n\n※営業日：火〜金・土\n※定休日：日・月・祝日',
      });

    case 'manage_booking':
      session.step = 'await_manage_name';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: '予約の確認・変更・取消のご要望ですね。\n\nお名前をお願いいたします。',
      });

    case 'show_menus':
      return client.replyMessage(replyToken, makeMenuInfoFlex());

    default:
      return sendMainMenu(replyToken);
  }
}

function sendWelcome(replyToken) {
  return client.replyMessage(replyToken, [
    { type: 'text', text: `🌿 はじめまして！\n${CLINIC.name}のLINE予約窓口です。\n\nご予約・お問い合わせをお気軽にどうぞ。` },
    makeMainMenuFlex(),
  ]);
}

function sendMainMenu(replyToken) {
  return client.replyMessage(replyToken, makeMainMenuFlex());
}

function makeMainMenuFlex() {
  return {
    type: 'flex', altText: 'メインメニュー',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', paddingAll: '20px',
        contents: [
          { type: 'text', text: `🏥 ${CLINIC.name}`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'ご用件をお選びください', color: '#c8e6c9', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          makeMenuButton('① 新規予約', 'action=new_booking', '#1a6b5a'),
          makeMenuButton('② 予約確認・変更・取消', 'action=manage_booking', '#2c7a7b'),
          makeMenuButton('③ 施術メニュー・料金案内', 'action=show_menus', '#5c6bc0'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#888888', align: 'center' },
          { type: 'text', text: `営業：${CLINIC.hours}`, size: 'xs', color: '#888888', align: 'center', wrap: true },
          { type: 'text', text: `休院：${CLINIC.closed}`, size: 'xs', color: '#888888', align: 'center' },
        ],
      },
    },
  };
}

function makeMenuButton(label, data, color) {
  return { type: 'button', style: 'primary', color, action: { type: 'postback', label, data, displayText: label } };
}

function makeHoursFlex() {
  return {
    type: 'flex', altText: '営業時間のご案内',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: '🕐 営業時間', color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '火〜金曜日', weight: 'bold', size: 'sm' },
          { type: 'text', text: '午前：9:30〜12:10\n午後：15:00〜19:00', size: 'sm', color: '#444444', wrap: true },
          { type: 'separator' },
          { type: 'text', text: '土曜日', weight: 'bold', size: 'sm' },
          { type: 'text', text: '午前：9:30〜12:10\n午後：15:00〜17:40', size: 'sm', color: '#444444', wrap: true },
          { type: 'separator' },
          { type: 'text', text: '休院日：日・月・祝日', size: 'sm', color: '#e53935', wrap: true },
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'sm', color: '#1a6b5a', margin: 'md', align: 'center' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: '予約する', data: 'action=new_booking', displayText: '予約する' } }],
      },
    },
  };
}

function makeMenuInfoFlex() {
  const menus = [
    { label: '新患施術', time: '60〜90分', price: '初回カウンセリング込み' },
    { label: '一般施術', time: '40分', price: '施術内容により異なる' },
    { label: 'パーソナルトレーニング', time: '40分', price: '4,950円' },
    { label: 'リハビリ', time: '40分', price: '4,950円' },
  ];
  return {
    type: 'flex', altText: '施術メニュー・料金案内',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#5c6bc0', contents: [{ type: 'text', text: '💴 施術メニュー・料金', color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: menus.map(m => ({
          type: 'box', layout: 'vertical', spacing: 'xs',
          contents: [
            { type: 'text', text: m.label, weight: 'bold', size: 'sm' },
            { type: 'box', layout: 'horizontal', contents: [
              { type: 'text', text: `⏱ ${m.time}`, size: 'xs', color: '#888888', flex: 1 },
              { type: 'text', text: `💴 ${m.price}`, size: 'xs', color: '#888888', flex: 2 },
            ]},
            { type: 'separator', margin: 'sm' },
          ],
        })),
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: '予約する', data: 'action=new_booking', displayText: '予約する' } }],
      },
    },
  };
}

function makeSymptomSelect() {
  const list = SYMPTOMS.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return {
    type: 'text',
    text: `気になる症状をお聞かせください。\n複数ある場合は番号をまとめて送ってください。\n\n${list}\n\n例）「1 3」や「1・3」など\n直接文字で入力もOKです。`,
  };
}

function makeFirstVisitMsg() {
  return {
    type: 'text',
    text: '初診・再診をテキストで送ってください。\n\n「初診」→ 初めてご来院の方\n「再診」→ 通院中の方',
  };
}

function makeInfoRow(label, value) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#888888', flex: 3 },
      { type: 'text', text: String(value || '　'), size: 'sm', flex: 5, wrap: true },
    ],
  };
}

function makeBookingComplete(b) {
  const bookingId = 'BK' + Date.now().toString().slice(-6);
  console.log('予約受付:', bookingId, b.name, b.datetime);
  return {
    type: 'flex', altText: '予約受付が完了しました',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2e7d32',
        contents: [{ type: 'text', text: '✅ 予約受付が完了しました', color: '#fff', weight: 'bold' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          makeInfoRow('受付番号', bookingId),
          makeInfoRow('希望日時', b.datetime),
          makeInfoRow('お名前', `${b.name} 様`),
          makeInfoRow('電話番号', b.phone),
          makeInfoRow('気になる症状', b.symptom || ''),
          makeInfoRow('区分', b.isFirst ? '初診' : '再診'),
          {
            type: 'text', size: 'xs', color: '#bf6f00', wrap: true, margin: 'md',
            text: '📞 整骨院よりご予約内容の確認のお電話が届き次第、ご予約完了となります。当日〜翌日の間にご連絡いたします。ご了承ください。',
          },
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#1a6b5a', margin: 'sm', align: 'center' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } }],
      },
    },
  };
}

function makeManageComplete(name) {
  return {
    type: 'flex', altText: 'お問い合わせを受け付けました',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#2c7a7b', contents: [{ type: 'text', text: '✅ 受け付けました', color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: `${name} 様`, weight: 'bold', size: 'md' },
          { type: 'separator', margin: 'md' },
          { type: 'text', wrap: true, size: 'sm', color: '#444444', margin: 'md', text: 'こちらから内容確認いたしますので、しばらくお待ちください。\n\nご不明な点はお電話でもお気軽にどうぞ。' },
          {
            type: 'box', layout: 'vertical', backgroundColor: '#fff8e1', paddingAll: '10px', cornerRadius: '8px', margin: 'md',
            contents: [
              { type: 'text', text: '📞 ご確認のお電話について', weight: 'bold', size: 'xs', color: '#bf6f00', wrap: true },
              { type: 'text', size: 'xs', color: '#555555', wrap: true, margin: 'sm', text: '整骨院よりご予約内容の確認のお電話が届き次第、ご予約完了となります。\n当日〜翌日の間にご連絡いたします。\nご了承ください。' },
            ],
          },
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'sm', color: '#1a6b5a', margin: 'sm', align: 'center' },
        ],
      },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } }] },
    },
  };
}

app.get('/ping', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${CLINIC.name} LINE Bot listening on port ${PORT}`));
