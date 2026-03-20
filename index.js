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

const MENUS = [
  { id: 'shinkan',  label: '新患施術',              time: '60〜90分', price: '初回カウンセリング込み', needsDetail: true },
  { id: 'ippan',    label: '一般施術',              time: '40分',     price: '施術内容により異なる',   needsDetail: true },
  { id: 'kotsuban', label: '骨盤矯正',              time: '40分',     price: '3,300円',               needsDetail: false },
  { id: 'nekoze',   label: '猫背矯正',              time: '40分',     price: '2,750円',               needsDetail: false },
  { id: 'stretch',  label: '下肢ストレッチ',        time: '40分',     price: '2,750円',               needsDetail: false },
  { id: 'personal', label: 'パーソナルトレーニング', time: '40分',    price: '4,950円',               needsDetail: false },
  { id: 'rehab',    label: 'リハビリ',              time: '40分',     price: '4,950円',               needsDetail: false },
];

const SYMPTOMS = ['首痛', '肩こり', '肩の痛み', '腰痛', '膝痛', '股関節痛', '足首痛', '産後の骨盤矯正', '交通事故の治療', 'トレーニング', 'リハビリ'];
const OPEN_DAYS = [2, 3, 4, 5, 6];
const SLOTS = {
  weekday:  ['09:30','10:10','10:50','11:30','15:00','15:40','16:20','17:00','17:40','18:20'],
  saturday: ['09:30','10:10','10:50','11:30','15:00','15:40','16:20','17:00'],
};

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
      session.step = 'select_date';
      session.booking = {};
      return client.replyMessage(replyToken, [
        { type: 'text', text: 'ご予約ですね！\n以下から日程をお選びください。' },
        makeDatePicker(),
      ]);
    }
    if (['料金','施術','値段','いくら'].some(k => lower.includes(k))) {
      return client.replyMessage(replyToken, makeMenuCarousel());
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
    case 'await_name':
      session.booking.name = t;
      session.step = 'await_phone';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `${t} 様、ありがとうございます。\nお電話番号を入力してください。\n例）03-5946-0000`,
      });

    case 'await_phone':
      session.booking.phone = t;
      if (session.booking.menu && session.booking.menu.needsDetail) {
        session.step = 'await_symptom';
        return client.replyMessage(replyToken, makeSymptomSelect());
      }
      session.step = 'await_first_visit';
      return client.replyMessage(replyToken, makeFirstVisitMsg());

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
      session.step = 'confirm_booking';
      return client.replyMessage(replyToken, makeBookingConfirm(session.booking));
    }

    case 'await_manage_name':
      session.step = 'idle';
      session.booking = {};
      return client.replyMessage(replyToken, makeManageComplete(t));

    default:
      session.step = 'idle';
      session.booking = {};
      return client.replyMessage(replyToken, [
        { type: 'text', text: 'セッションがリセットされました。\n最初からやり直してください。' },
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
      session.step = 'select_date';
      session.booking = {};
      return client.replyMessage(replyToken, makeDatePicker());

    case 'select_date':
      session.booking.date = params.get('date');
      session.booking.dayOfWeek = parseInt(params.get('dow'));
      session.step = 'select_time';
      return client.replyMessage(replyToken, makeTimePicker(session.booking.date, session.booking.dayOfWeek));

    case 'select_time':
      session.booking.time = params.get('time');
      session.step = 'select_menu';
      return client.replyMessage(replyToken, makeMenuSelect());

    case 'select_menu': {
      const menuId = params.get('menu');
      session.booking.menu = MENUS.find(m => m.id === menuId);
      session.step = 'await_name';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: `「${session.booking.menu.label}」を選択しました。\n\nお名前をフルネームで入力してください。\n例）山田 太郎`,
      });
    }

    case 'first_visit':
      session.booking.isFirst = params.get('val') === 'true';
      session.step = 'confirm_booking';
      return client.replyMessage(replyToken, makeBookingConfirm(session.booking));

    case 'confirm_booking': {
      if (params.get('ok') !== 'true') {
        session.step = 'idle';
        session.booking = {};
        return sendMainMenu(replyToken);
      }
      const b = { ...session.booking };
      const bookingId = 'BK' + Date.now().toString().slice(-6);
      console.log('予約完了:', bookingId, b.name, b.date, b.time, b.menu && b.menu.label);
      session.step = 'idle';
      session.booking = {};
      return client.replyMessage(replyToken, makeBookingComplete(b, bookingId));
    }

    case 'manage_booking':
      session.step = 'await_manage_name';
      return client.replyMessage(replyToken, {
        type: 'text',
        text: '予約の確認・変更・取消のご要望ですね。\n\nお名前をお願いいたします。',
      });

    case 'show_menus':
      return client.replyMessage(replyToken, makeMenuCarousel());

    case 'menu_detail': {
      const m = MENUS.find(x => x.id === params.get('menu'));
      return client.replyMessage(replyToken, makeMenuDetail(m));
    }

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

function makeDatePicker() {
  const today = new Date();
  const items = [];
  const dayNames = ['日','月','火','水','木','金','土'];
  for (let i = 1; i <= 14 && items.length < 10; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dow = d.getDay();
    if (!OPEN_DAYS.includes(dow)) continue;
    const m = d.getMonth() + 1, day = d.getDate();
    items.push({
      type: 'action',
      action: {
        type: 'postback',
        label: `${m}/${day}(${dayNames[dow]})`,
        data: `action=select_date&date=${d.toISOString().slice(0,10)}&dow=${dow}`,
        displayText: `${m}/${day}(${dayNames[dow]})を希望`,
      },
    });
  }
  return { type: 'text', text: '📅 ご希望の日付をお選びください\n※日・月・祝日は休院です', quickReply: { items } };
}

function makeTimePicker(date, dow) {
  const slots = dow === 6 ? SLOTS.saturday : SLOTS.weekday;
  return {
    type: 'text',
    text: `${date} のご希望時間をお選びください`,
    quickReply: {
      items: slots.map(t => ({
        type: 'action',
        action: { type: 'postback', label: t, data: `action=select_time&time=${t}`, displayText: `${t}を希望` },
      })),
    },
  };
}

function makeMenuSelect() {
  return {
    type: 'flex', altText: '施術メニューを選択してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: '施術メニューを選択', weight: 'bold', size: 'lg', margin: 'none' },
          { type: 'separator', margin: 'md' },
          ...MENUS.map(m => ({
            type: 'button', style: 'secondary', margin: 'sm',
            action: { type: 'postback', label: `${m.label}（${m.time}）`, data: `action=select_menu&menu=${m.id}` },
          })),
        ],
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

function makeBookingConfirm(b) {
  const rows = [
    makeInfoRow('日時（希望）', `${b.date} ${b.time}`),
    makeInfoRow('施術', b.menu ? b.menu.label : ''),
    makeInfoRow('料金', b.menu ? b.menu.price : ''),
    makeInfoRow('お名前', `${b.name} 様`),
    makeInfoRow('電話番号', b.phone),
    makeInfoRow('区分', b.isFirst ? '初診' : '再診'),
  ];
  if (b.symptom) rows.push(makeInfoRow('気になる症状', b.symptom));
  rows.push({
    type: 'text', size: 'xs', color: '#bf6f00', wrap: true, margin: 'md',
    text: '📞 整骨院よりご予約内容の確認のお電話が届き次第、ご予約完了となります。当日〜翌日の間にご連絡いたします。ご了承ください。',
  });
  return {
    type: 'flex', altText: '予約内容の確認',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a',
        contents: [{ type: 'text', text: '📋 予約内容の確認', color: '#fff', weight: 'bold' }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'button', style: 'secondary', action: { type: 'postback', label: '修正する', data: 'action=main_menu' } },
          { type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: '確定する', data: 'action=confirm_booking&ok=true' } },
        ],
      },
    },
  };
}

function makeBookingComplete(b, bookingId) {
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
          makeInfoRow('日時（希望）', `${b.date} ${b.time}`),
          makeInfoRow('施術', b.menu ? b.menu.label : ''),
          makeInfoRow('お名前', `${b.name} 様`),
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

function makeMenuCarousel() {
  return {
    type: 'flex', altText: '施術メニュー一覧',
    contents: {
      type: 'carousel',
      contents: MENUS.map(m => ({
        type: 'bubble',
        header: { type: 'box', layout: 'vertical', backgroundColor: '#1a6b5a', contents: [{ type: 'text', text: m.label, color: '#fff', weight: 'bold', size: 'md', wrap: true }] },
        body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [makeInfoRow('⏱ 時間', m.time), makeInfoRow('💴 料金', m.price)] },
        footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [{ type: 'button', style: 'primary', color: '#1a6b5a', action: { type: 'postback', label: 'このメニューで予約', data: 'action=new_booking', displayText: '新規予約を開始' } }] },
      })),
    },
  };
}

const MENU_DESCRIPTIONS = {
  shinkan:  '初めてご来院の方向けです。問診・検査・施術を含む丁寧なカウンセリングを行います（60〜90分）。',
  ippan:    '通院中の方向けの施術です。ご予約時に気になる症状をお知らせください。',
  kotsuban: '骨盤のゆがみを整え、腰痛・産後の不調・姿勢改善に効果的です。',
  nekoze:   '背骨・肩甲骨まわりを整え、猫背・肩こり・首こりの改善を目指します。',
  stretch:  '下肢の筋肉・関節をほぐし、股関節・膝・足首の可動域を広げます。',
  personal: 'お身体の状態に合わせたオーダーメイドのトレーニング指導を行います。',
  rehab:    'ケガや術後の回復をサポートする運動療法・
