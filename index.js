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
  name: '健やか整骨院 豊玉院',
  tel: '03-5946-9959',
  address: '〒176-0012 東京都練馬区豊玉北４丁目４−７−１０１',
  hours: '火〜金 9:30〜13:00 / 15:00〜19:00\n土 9:30〜13:00 / 15:00〜18:00\n祝日営業',
  closed: '日・月曜日',
};

const SYMPTOMS = [
  '首痛', '肩こり', '肩の痛み', '腰痛', '膝痛',
  '股関節痛', '足首痛', '産後の骨盤矯正', '交通事故の治療',
  'トレーニング', 'リハビリ',
];

const sessions = {};
function getSession(userId) {
  if (!sessions[userId]) sessions[userId] = { step: 'idle', data: {} };
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

  if (['メニュー','最初','やり直し','トップ','menu'].some(k => t.includes(k))) {
    session.step = 'idle';
    session.data = {};
    return sendMainMenu(replyToken);
  }

  if (session.step === 'idle') {
    const lower = t.toLowerCase();
    if (['予約','よやく','新規'].some(k => lower.includes(k))) {
      return startNewBooking(replyToken, session);
    }
    if (['再診','再来院'].some(k => lower.includes(k))) {
      return startRevisitBooking(replyToken, session);
    }
    if (['変更','キャンセル','取消'].some(k => lower.includes(k))) {
      return startChange(replyToken, session);
    }
    if (['営業','時間','何時','休み'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, makeHoursFlex());
    }
    if (['電話','連絡','住所','場所','アクセス'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, makeInfoFlex());
    }
    return client.replyMessage(replyToken, [
      { type: 'text', text: 'ご用件をお選びください。' },
      makeMainMenuFlex(),
    ]);
  }

  switch (session.step) {
    case 'await_datetime':
      session.data.datetime = t;
      session.step = 'await_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `「${t}」ですね、承りました。\n\n次に、お電話番号を入力してください。\n例）03-5946-0000`,
      });

    case 'await_phone':
      session.data.phone = t;
      session.step = 'await_symptom';
      return client.replyMessage(replyToken, makeSymptomSelect());

    case 'await_symptom': {
      const nums = t.match(/10|11|[1-9]/g);
      if (nums) {
        const selected = [...new Set(nums)].map(n => SYMPTOMS[parseInt(n) - 1]).filter(Boolean);
        session.data.symptom = selected.join('・');
      } else {
        session.data.symptom = t;
      }
      const d = { ...session.data };
      const type = session.data.type;
      session.step = 'idle';
      session.data = {};
      return client.replyMessage(replyToken, makeBookingComplete(d, type));
    }

    case 'await_change_detail': {
      const detail = t;
      session.step = 'idle';
      session.data = {};
      return client.replyMessage(replyToken, makeChangeComplete(detail));
    }

    default:
      session.step = 'idle';
      session.data = {};
      return client.replyMessage(replyToken, [
        { type: 'text', text: 'もう一度最初からお試しください。' },
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
      session.data = {};
      return sendMainMenu(replyToken);

    case 'new_booking':
      return startNewBooking(replyToken, session);

    case 'revisit_booking':
      return startRevisitBooking(replyToken, session);

    case 'change_booking':
      return startChange(replyToken, session);

    default:
      return sendMainMenu(replyToken);
  }
}

function startNewBooking(replyToken, session) {
  session.step = 'await_datetime';
  session.data = { type: 'new' };
  return client.replyMessage(replyToken, {
    type: 'text',
    text: '【新規予約】\nご希望の日時をご入力ください。\n\n例）3月25日 10時\n　　来週火曜 午後3時\n\n営業日：火〜金・土・祝日\n定休日：日・月曜日',
  });
}

function startRevisitBooking(replyToken, session) {
  session.step = 'await_datetime';
  session.data = { type: 'revisit' };
  return client.replyMessage(replyToken, {
    type: 'text',
    text: '【再診予約】\n（1ヶ月以上ぶりのご来院の方）\n\nご希望の日時をご入力ください。\n\n例）3月25日 10時\n　　来週火曜 午後3時\n\n営業日：火〜金・土・祝日\n定休日：日・月曜日',
  });
}

function startChange(replyToken, session) {
  session.step = 'await_change_detail';
  session.data = { type: 'change' };
  return client.replyMessage(replyToken, {
    type: 'text',
    text: '【予約変更・キャンセル】\n以下の内容をそのままコピーして\n必要事項を入力してください。\n\n━━━━━━━━━━\nお名前：\n電話番号：\n変更・キャンセル希望日時：\nご要望（変更先日時など）：\n━━━━━━━━━━',
  });
}

function makeBookingComplete(d, type) {
  const typeLabel = type === 'new' ? '新規予約' : '再診予約';
  const bookingId = 'BK' + Date.now().toString().slice(-6);
  console.log(`${typeLabel}受付:`, bookingId, d.phone, d.datetime);
  return {
    type: 'flex', altText: '受付完了',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a',
        contents: [
          { type: 'text', text: '✅ 受付完了', color: '#fff', weight: 'bold', size: 'lg' },
          { type: 'text', text: typeLabel, color: '#c8e6c9', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          makeRow('受付番号', bookingId),
          makeRow('希望日時', d.datetime),
          makeRow('電話番号', d.phone),
          makeRow('気になる症状', d.symptom),
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', backgroundColor: '#fff8e1',
            paddingAll: '12px', cornerRadius: '8px', margin: 'md',
            contents: [
              { type: 'text', text: '📞 ご予約の確定について', weight: 'bold', size: 'sm', color: '#bf6f00', wrap: true },
              { type: 'text', size: 'xs', color: '#666', wrap: true, margin: 'sm',
                text: '当院よりお電話にてご予約内容を確認させていただきます。\n\n折り返しのご連絡は当日〜翌日となります。\n\n※日・月曜日はお電話対応ができません。ご了承ください。' },
            ],
          },
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#1a6b5a', align: 'center', margin: 'md' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } },
        ],
      },
    },
  };
}

function makeChangeComplete(detail) {
  console.log('変更・キャンセル受付:', detail);
  return {
    type: 'flex', altText: '受付完了',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2c7a7b',
        contents: [
          { type: 'text', text: '✅ 受付完了', color: '#fff', weight: 'bold', size: 'lg' },
          { type: 'text', text: '予約変更・キャンセル', color: '#b2dfdb', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'ご要望を受け付けました。', size: 'sm', wrap: true },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'vertical', backgroundColor: '#fff8e1',
            paddingAll: '12px', cornerRadius: '8px', margin: 'md',
            contents: [
              { type: 'text', text: '📞 ご確認のお電話について', weight: 'bold', size: 'sm', color: '#bf6f00', wrap: true },
              { type: 'text', size: 'xs', color: '#666', wrap: true, margin: 'sm',
                text: '当院よりお電話にて内容を確認させていただきます。\n\n折り返しのご連絡は当日〜翌日となります。\n\n※日・月曜日はお電話対応ができません。ご了承ください。' },
            ],
          },
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#1a6b5a', align: 'center', margin: 'md' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: 'メニューに戻る', data: 'action=main_menu', displayText: 'メニューに戻る' } },
        ],
      },
    },
  };
}

function makeRow(label, value) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#888', flex: 3 },
      { type: 'text', text: String(value || ''), size: 'sm', flex: 5, wrap: true },
    ],
  };
}

function sendWelcome(replyToken) {
  return client.replyMessage(replyToken, [
    {
      type: 'text',
      text: `🌿 はじめまして！\n${CLINIC.name}のLINE窓口です。\n\nご予約・お問い合わせをお気軽にどうぞ。`,
    },
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
          { type: 'text', text: `🏥 ${CLINIC.name}`, color: '#fff', size: 'lg', weight: 'bold' },
          { type: 'text', text: 'ご用件をお選びください', color: '#c8e6c9', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          makeMenuBtn('① 新規予約（初めての方）', 'action=new_booking', '#1a6b5a'),
          makeMenuBtn('② 再診予約（1ヶ月以上ぶりの方）', 'action=revisit_booking', '#2e7d32'),
          makeMenuBtn('③ 予約変更・キャンセル', 'action=change_booking', '#2c7a7b'),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: `📞 ${CLINIC.tel}`, size: 'xs', color: '#888', align: 'center' },
          { type: 'text', text: '営業：火〜金・土・祝日', size: 'xs', color: '#888', align: 'center' },
          { type: 'text', text: '定休：日・月曜日', size: 'xs', color: '#888', align: 'center' },
        ],
      },
    },
  };
}

function makeMenuBtn(label, data, color) {
  return { type: 'button', style: 'primary', color, margin: 'sm', action: { type: 'postback', label, data, displayText: label } };
}

function makeHoursFlex() {
  return {
    type: 'flex', altText: '営業時間',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: '🕐 営業時間', color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '火・水・木・金曜日', weight: 'bold', size: 'sm' },
          { type: 'text', text: '午前 9:30〜13:00\n午後 15:00〜19:00', size: 'sm', color: '#444', wrap: true },
          { type: 'separator' },
          { type: 'text', text: '土曜日・祝日', weight: 'bold', size: 'sm' },
          { type: 'text', text: '午前 9:30〜13:00\n午後 15:00〜18:00', size: 'sm', color: '#444', wrap: true },
          { type: 'separator' },
          { type: 'text', text: '定休日：日・月曜日', size: 'sm', color: '#e53935', weight: 'bold' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: '予約する', data: 'action=new_booking', displayText: '予約する' } }],
      },
    },
  };
}

function makeInfoFlex() {
  return {
    type: 'flex', altText: '院情報',
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: `🏥 ${CLINIC.name}`, color: '#fff', weight: 'bold' }] },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          makeRow('📞 電話', CLINIC.tel),
          makeRow('📍 住所', CLINIC.address),
          { type: 'separator' },
          { type: 'text', text: '営業日', weight: 'bold', size: 'sm' },
          { type: 'text', text: '火〜金 9:30〜13:00 / 15:00〜19:00\n土・祝 9:30〜13:00 / 15:00〜18:00', size: 'sm', color: '#444', wrap: true },
          { type: 'text', text: '定休：日・月曜日', size: 'sm', color: '#e53935' },
        ],
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
    text: `気になる症状をお聞かせください。\n番号で複数選択できます。\n\n${list}\n\n例）「1 4」や「腰痛」など\n直接入力もOKです。`,
  };
}

app.get('/ping', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${CLINIC.name} LINE Bot listening on port ${PORT}`));
